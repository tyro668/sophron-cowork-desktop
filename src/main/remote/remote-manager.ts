/**
 * Remote Manager
 * 远程控制系统管理器，整合 Gateway、Channels 和 MessageRouter
 */

import { EventEmitter } from 'events';
import { createHash } from 'node:crypto';
import { log, logError, logWarn } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { RemoteGateway } from './gateway';
import { MessageRouter } from './message-router';
import { isNonRetryableChannelError } from './channels/channel-base';
import { FeishuChannel } from './channels/feishu';
import { DingtalkChannel } from './channels/dingtalk';
import { WecomChannel } from './channels/wecom';
import { WechatChannel } from './channels/wechat/wechat-channel';
import { SlackChannel } from './channels/slack';
import { remoteConfigStore } from './remote-config-store';
import { tunnelManager, TunnelStatus } from './tunnel-manager';
import { buildRemoteSessionTitle } from './remote-title';
import enTranslations from '../../shared/i18n/locales/en.json';
import zhTranslations from '../../shared/i18n/locales/zh.json';
import type {
  GatewayStatus,
  GatewayConfig,
  FeishuChannelConfig,
  WechatChannelConfig,
  DingtalkChannelConfig,
  WecomChannelConfig,
  ChannelType,
  ControllableChannelType,
  ControllableChannelState,
  RemoteSessionMapping,
  PairedUser,
  PairingRequest,
  RemoteConfig,
} from './types';
import type { Message, ContentBlock, ServerEvent, Session } from '../../shared/contracts';

// Agent executor interface - exported for use in main process
export interface AgentExecutor {
  startSession(title: string, prompt: string, cwd?: string): Promise<Session>;
  continueSession(
    sessionId: string,
    prompt: string,
    content?: ContentBlock[],
    cwd?: string
  ): Promise<void>;
  waitForSessionIdle?(sessionId: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  validateWorkingDirectory?(cwd: string): Promise<string | null> | string | null;
}

// Question/Permission request from agent
export interface RemoteInteraction {
  type: 'question' | 'permission';
  sessionId: string; // Actual session ID
  remoteSessionId: string; // Remote session ID (for routing back)
  ownerSenderId: string; // Sender ID of the session owner (for security verification)
  questionId?: string;
  toolUseId?: string;
  toolName?: string;
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  input?: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

interface RemoteResponseBuffer {
  items: Array<{ text: string; channelInfo: RemoteChannelContext }>;
  lastSent: number;
  toolSteps: string[];
  retryCount: number;
}

interface RemoteChannelContext {
  channelType: ChannelType;
  channelId: string;
  replyTo?: string;
  language?: RemoteMessageLanguage;
}

type RemoteMessageLanguage = 'en' | 'zh';
type RemoteBotMessageKey = keyof typeof enTranslations.remote.botMessages;

const RESPONSE_DEBOUNCE_MS = 2000;
const RESPONSE_RETRY_BASE_MS = 1000;
const MAX_RESPONSE_RETRIES = 3;
const INTERACTION_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SENT_MESSAGE_KEYS = 500;

interface StopOptions {
  preserveInteractions?: boolean;
}

interface SettledInteraction {
  interaction: RemoteInteraction;
  resolver?: (response: string) => void;
}

export class RemoteManager extends EventEmitter {
  private gateway?: RemoteGateway;
  private messageRouter: MessageRouter;
  private agentExecutor?: AgentExecutor;
  private sendToRenderer?: (event: ServerEvent) => void;

  // Mapping: actual session ID -> remote session ID
  private sessionIdMapping: Map<string, string> = new Map();

  // Mapping: remote session ID -> actual session ID (reverse mapping)
  private reverseSessionIdMapping: Map<string, string> = new Map();

  // Mapping: remote session ID -> channel info (for routing responses back)
  private sessionChannelMapping: Map<string, RemoteChannelContext> = new Map();

  // Mapping: remote session ID -> owner sender ID (for interaction security)
  private sessionOwnerMapping: Map<string, string> = new Map();

  // Pending interactions (questions/permissions) waiting for user response
  private pendingInteractions: Map<string, RemoteInteraction> = new Map();

  // Callbacks for resolving pending interactions
  private interactionResolvers: Map<string, (response: string) => void> = new Map();

  // Timeout handles for pending interactions, keyed by question/tool-use ID
  private interactionTimers: Map<string, NodeJS.Timeout> = new Map();

  // Response buffer for collecting messages before sending (to avoid spam)
  private responseBuffers: Map<string, RemoteResponseBuffer> = new Map();

  // Stable renderer message IDs (or SHA-256 fallback keys) used for per-turn deduplication
  private sentMessageKeys: Map<string, Set<string>> = new Map();

  // Debounce timers for sending buffered responses
  private sendTimers: Map<string, NodeJS.Timeout> = new Map();

  // In-flight flushes and deferred per-turn cleanup prevent concurrent sends or lost retries
  private flushPromises: Map<string, Promise<boolean>> = new Map();
  private cleanupAfterFlush: Set<string> = new Set();

  // Promise-chain mutex for synchronizing pendingInteractions access
  private lockChain: Promise<void> = Promise.resolve();

  // Serialize the complete desired-state workflow before work reaches the gateway transport queue.
  private channelControlOperations: Map<ControllableChannelType, Promise<void>> = new Map();

  // 远程默认工作目录（用于未指定 cwd 的会话）
  private defaultWorkingDirectory?: string;

  constructor() {
    super();
    this.messageRouter = new MessageRouter();
    this.messageRouter.onSessionExpired((remoteSessionId) => {
      this.clearRemoteSession(remoteSessionId);
    });
  }

  /**
   * Set agent executor (called from main process)
   */
  setAgentExecutor(executor: AgentExecutor): void {
    this.agentExecutor = executor;

    // Set up message router callback
    this.messageRouter.setAgentCallback(
      async (
        sessionId,
        prompt,
        content,
        workingDirectory,
        channelType,
        channelId,
        senderId,
        messageId
      ) => {
        await this.executeAgent(
          sessionId,
          prompt,
          content,
          workingDirectory,
          channelType as ChannelType,
          channelId,
          senderId,
          messageId
        );
      }
    );

    if (executor.validateWorkingDirectory) {
      this.messageRouter.setWorkingDirectoryValidator(executor.validateWorkingDirectory);
    }

    log('[RemoteManager] Agent executor set');
  }

  /**
   * 设置远程会话的默认工作目录
   */
  setDefaultWorkingDirectory(dir?: string): void {
    this.defaultWorkingDirectory = dir;
    this.messageRouter.setDefaultWorkingDirectory(dir);
    log('[RemoteManager] Default working directory set:', dir || '(none)');
  }

  /**
   * Set renderer callback (for UI updates)
   */
  setRendererCallback(callback: (event: ServerEvent) => void): void {
    this.sendToRenderer = callback;
  }

  /**
   * Initialize and start remote control
   */
  async start(): Promise<void> {
    const config = remoteConfigStore.getAll();

    if (!config.gateway.enabled) {
      log('[RemoteManager] Remote control is disabled');
      return;
    }

    log('[RemoteManager] Starting remote control system...');

    try {
      // Create gateway
      this.gateway = new RemoteGateway(config.gateway, this.messageRouter, config.channels);

      // 设置远程默认工作目录（优先使用配置，其次使用全局默认）
      const configuredDefaultWorkingDir =
        config.gateway.defaultWorkingDirectory || this.defaultWorkingDirectory;
      if (configuredDefaultWorkingDir) {
        this.setDefaultWorkingDirectory(configuredDefaultWorkingDir);
      }

      // Set up gateway event handlers
      this.setupGatewayEvents();

      // Set up message interceptor for interaction responses
      this.gateway.setMessageInterceptor((message) => {
        return this.handlePotentialInteractionResponse(
          message.channelType,
          message.channelId,
          message.sender.id,
          message.content.text || ''
        );
      });

      // Register configured channels
      await this.registerChannels(config);

      // Load paired users from config
      this.loadPairedUsers();

      // Start gateway
      await this.gateway.start();

      // Start tunnel if configured
      const tunnelUrl = await tunnelManager.start(config.gateway.port);
      if (tunnelUrl) {
        log('[RemoteManager] Tunnel URL:', tunnelUrl);
        if (
          config.channels.feishu?.enabled !== false &&
          config.channels.feishu?.useWebSocket === false
        ) {
          log('[RemoteManager] Feishu Webhook URL:', `${tunnelUrl}/webhook/feishu`);
        }
        if (
          config.channels.dingtalk?.enabled !== false &&
          config.channels.dingtalk?.receiveMode === 'webhook'
        ) {
          log('[RemoteManager] DingTalk Webhook URL:', `${tunnelUrl}/webhook/dingtalk`);
        }
        if (
          config.channels.wecom?.enabled !== false &&
          config.channels.wecom?.receiveMode === 'webhook'
        ) {
          log('[RemoteManager] WeCom Webhook URL:', `${tunnelUrl}/webhook/wecom`);
        }
      }

      log('[RemoteManager] Remote control system started');
      this.emitStatusUpdate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE') {
        logWarn(
          '[RemoteManager] Remote control port already in use, skipping startup for this instance'
        );
        await this.gateway?.stop();
        this.gateway = undefined;
        this.emitStatusUpdate();
        return;
      }

      logError('[RemoteManager] Failed to start remote control:', error);
      throw error;
    }
  }

  /**
   * Stop remote control
   */
  async stop(options: StopOptions = {}): Promise<void> {
    if (!options.preserveInteractions) {
      const cancelled = await this.cancelPendingInteractions();
      await this.notifyCancelledInteractions(cancelled, 'remoteServiceStoppedCancellation');
    }

    if (!this.gateway) return;

    log('[RemoteManager] Stopping remote control system...');

    // Clear all pending debounce send timers to avoid post-stop flushes
    for (const timer of this.sendTimers.values()) {
      clearTimeout(timer);
    }
    this.sendTimers.clear();

    // Stop tunnel first
    await tunnelManager.stop();

    try {
      await this.gateway.stop();
      this.gateway = undefined;

      log('[RemoteManager] Remote control system stopped');
      this.emitStatusUpdate();
    } catch (error) {
      logError('[RemoteManager] Error stopping remote control:', error);
    }
  }

  /**
   * Restart remote control
   */
  async restart(): Promise<void> {
    // A transport/config restart is temporary. Keep interaction timers and
    // resolvers alive so the user can still answer after the channel reconnects.
    await this.stop({ preserveInteractions: true });
    await this.start();
  }

  /**
   * Get gateway status
   */
  getStatus(): GatewayStatus & { tunnel?: TunnelStatus } {
    if (!this.gateway) {
      const config = remoteConfigStore.getAll();
      const channels = Object.entries(config.channels)
        .filter((entry): entry is [ChannelType, NonNullable<(typeof entry)[1]>] =>
          Boolean(entry[1])
        )
        .map(([type, channelConfig]) => ({
          type,
          enabled: !('enabled' in channelConfig) || channelConfig.enabled !== false,
          connected: false,
        }));
      return {
        running: false,
        channels,
        activeSessions: 0,
        pendingPairings: 0,
      };
    }

    return {
      ...this.gateway.getStatus(),
      tunnel: tunnelManager.getStatus(),
    };
  }

  /**
   * Get tunnel status
   */
  getTunnelStatus(): TunnelStatus {
    return tunnelManager.getStatus();
  }

  /** Get a channel webhook URL from the active tunnel. */
  getWebhookUrl(channelType: ChannelType = 'feishu'): string | null {
    return tunnelManager.getWebhookUrl(channelType);
  }

  /**
   * Update gateway config
   */
  async updateGatewayConfig(config: Partial<GatewayConfig>): Promise<void> {
    remoteConfigStore.setGatewayConfig(config);

    // Restart if running
    if (this.gateway?.running) {
      await this.restart();
    }
  }

  async updateWechatConfig(config: WechatChannelConfig): Promise<void> {
    remoteConfigStore.setWechatConfig(config);
    if (this.gateway?.running) await this.restart();
  }

  async updateFeishuConfig(config: FeishuChannelConfig): Promise<void> {
    remoteConfigStore.setFeishuConfig(config);

    // Restart to apply changes
    if (this.gateway?.running) {
      await this.restart();
    }
  }

  /**
   * Update DingTalk channel config
   */
  async updateDingtalkConfig(
    config: DingtalkChannelConfig,
    gatewayConfig?: Partial<GatewayConfig>
  ): Promise<void> {
    remoteConfigStore.setDingtalkConfig(config);
    if (gatewayConfig) remoteConfigStore.setGatewayConfig(gatewayConfig);
    if (this.gateway?.running) {
      await this.restart();
    }
  }

  /** Update the WeCom AI Bot channel config. */
  async updateWecomConfig(
    config: WecomChannelConfig,
    gatewayConfig?: Partial<GatewayConfig>
  ): Promise<void> {
    const receiveMode = config.receiveMode === 'webhook' ? 'webhook' : 'websocket';
    const botId = typeof config.botId === 'string' ? config.botId.trim() : '';
    const secret = typeof config.secret === 'string' ? config.secret.trim() : '';
    const wsUrl = typeof config.wsUrl === 'string' ? config.wsUrl.trim() || undefined : undefined;
    const webhookToken =
      typeof config.webhookToken === 'string' ? config.webhookToken.trim() || undefined : undefined;
    const webhookEncodingAESKey =
      typeof config.webhookEncodingAESKey === 'string'
        ? config.webhookEncodingAESKey.trim() || undefined
        : undefined;
    if (receiveMode === 'websocket' && (!botId || !secret)) {
      throw new Error('WeCom Bot ID and Secret are required');
    }
    if (receiveMode === 'webhook') {
      if (!webhookToken || !/^[A-Za-z0-9]{1,32}$/.test(webhookToken)) {
        throw new Error('WeCom Webhook Token must contain 1-32 letters or digits');
      }
      if (!webhookEncodingAESKey || !/^[A-Za-z0-9]{43}$/.test(webhookEncodingAESKey)) {
        throw new Error('WeCom EncodingAESKey must contain exactly 43 letters or digits');
      }
    }
    if (receiveMode === 'websocket' && wsUrl) {
      let parsed: URL;
      try {
        parsed = new URL(wsUrl);
      } catch {
        throw new Error('Invalid WeCom WebSocket URL');
      }
      if (parsed.protocol !== 'wss:') {
        throw new Error('WeCom WebSocket URL must use wss://');
      }
    }

    remoteConfigStore.setWecomConfig({
      ...config,
      receiveMode,
      botId,
      secret,
      wsUrl,
      webhookToken,
      webhookEncodingAESKey,
    });
    if (gatewayConfig) remoteConfigStore.setGatewayConfig(gatewayConfig);
    if (this.gateway?.running) {
      await this.restart();
    }
  }

  /** Persist and apply one bot's desired state without restarting other channels. */
  async setChannelEnabled(
    type: ControllableChannelType,
    enabled: boolean
  ): Promise<ControllableChannelState> {
    return this.enqueueChannelControlOperation(type, async () => {
      const config = remoteConfigStore.getAll().channels[type];
      if (!config) throw new Error(`Channel is not configured: ${type}`);

      // Persist the desired state before cancelling interactions. If the store write
      // fails, no user work is cancelled and the running transport remains unchanged.
      remoteConfigStore.setChannelEnabled(type, enabled);

      try {
        if (!enabled) {
          const cancelled = await this.cancelPendingInteractionsForChannel(type);
          await this.notifyCancelledInteractions(cancelled, 'channelDisabledCancellation');
        }

        if (this.gateway) {
          await this.gateway.setChannelEnabled(type, enabled);
        }
        return this.getChannelControlState(type);
      } finally {
        // A failed transport start/stop still changes observable desired/runtime state.
        this.emitStatusUpdate();
      }
    });
  }

  /** Read the durable desired state together with the current transport state. */
  getChannelControlState(type: ControllableChannelType): ControllableChannelState {
    const config = remoteConfigStore.getAll().channels[type];
    if (!config) throw new Error(`Channel is not configured: ${type}`);

    const runtime = this.gateway?.getStatus().channels.find((channel) => channel.type === type);
    return {
      type,
      desiredEnabled: config.enabled !== false,
      connected: runtime?.connected ?? false,
      channelError: runtime?.error,
    };
  }

  private enqueueChannelControlOperation<T>(
    type: ControllableChannelType,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.channelControlOperations.get(type) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    const settled = queued.then(
      () => undefined,
      () => undefined
    );
    this.channelControlOperations.set(type, settled);
    void settled.then(() => {
      if (this.channelControlOperations.get(type) === settled) {
        this.channelControlOperations.delete(type);
      }
    });
    return queued;
  }

  /**
   * Approve pairing request
   */
  approvePairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) {
      return false;
    }

    const success = this.gateway.approvePairing(channelType, userId);

    if (success) {
      // Persist to config
      remoteConfigStore.addPairedUser({
        userId,
        channelType,
        pairedAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      this.emitStatusUpdate();
    }

    return success;
  }

  /**
   * Reject pairing request
   */
  rejectPairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) {
      return false;
    }

    const success = this.gateway.rejectPairing(channelType, userId);

    if (success) {
      this.emitStatusUpdate();
    }

    return success;
  }

  /**
   * Revoke user pairing
   */
  revokePairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) {
      return false;
    }

    const success = this.gateway.revokePairing(channelType, userId);

    if (success) {
      remoteConfigStore.removePairedUser(channelType, userId);
      this.emitStatusUpdate();
    }

    return success;
  }

  /**
   * Get paired users
   */
  getPairedUsers(): PairedUser[] {
    return remoteConfigStore.getPairedUsers();
  }

  /**
   * Get pending pairing requests
   */
  getPendingPairings(): PairingRequest[] {
    return this.gateway?.getPendingPairings() || [];
  }

  /**
   * Get active remote sessions
   */
  getRemoteSessions(): RemoteSessionMapping[] {
    return this.messageRouter.getAllSessionMappings();
  }

  /**
   * Clear remote session
   */
  clearRemoteSession(sessionId: string): boolean {
    const actualSessionId = this.reverseSessionIdMapping.get(sessionId);
    const cancelled = this.cancelPendingInteractionsForSession(sessionId);
    void this.notifyCancelledInteractions(cancelled, 'remoteSessionEndedCancellation');

    if (actualSessionId) {
      this.sessionIdMapping.delete(actualSessionId);
      this.responseBuffers.delete(actualSessionId);
      this.sentMessageKeys.delete(actualSessionId);
      this.cleanupAfterFlush.delete(actualSessionId);

      const timer = this.sendTimers.get(actualSessionId);
      if (timer) {
        clearTimeout(timer);
        this.sendTimers.delete(actualSessionId);
      }
    }

    this.reverseSessionIdMapping.delete(sessionId);
    this.sessionChannelMapping.delete(sessionId);
    this.sessionOwnerMapping.delete(sessionId);

    const routerCleared = this.messageRouter.clearSession(sessionId);
    return Boolean(actualSessionId) || routerCleared;
  }

  /**
   * Check if a session is a remote session
   */
  isRemoteSession(actualSessionId: string): boolean {
    return this.sessionIdMapping.has(actualSessionId);
  }

  /**
   * Get remote session ID from actual session ID
   */
  getRemoteSessionId(actualSessionId: string): string | undefined {
    return this.sessionIdMapping.get(actualSessionId);
  }

  /**
   * Handle question request from agent (for remote sessions)
   * Returns true if handled, false if should use normal UI
   */
  async handleQuestionRequest(
    actualSessionId: string,
    questionId: string,
    questions: Array<{
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>
  ): Promise<string | null> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) {
      return null; // Not a remote session
    }

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) {
      return null;
    }

    log('[RemoteManager] Handling question request for remote session:', remoteSessionId);

    // Build question message for Feishu
    let messageText = '🤔 **需要你的回答**\n\n';

    questions.forEach((q, _qIdx) => {
      if (q.header) {
        messageText += `**${q.header}**\n`;
      }
      messageText += `${q.question}\n\n`;

      if (q.options && q.options.length > 0) {
        q.options.forEach((opt, optIdx) => {
          messageText += `  ${optIdx + 1}. ${opt.label}`;
          if (opt.description) {
            messageText += ` - ${opt.description}`;
          }
          messageText += '\n';
        });
        messageText += '\n';
        if (q.multiSelect) {
          messageText += `*（可多选，用逗号分隔，如: 1,3）*\n\n`;
        } else {
          messageText += `*（请回复选项数字，如: 1）*\n\n`;
        }
      } else {
        messageText += `*（请直接回复你的答案）*\n\n`;
      }
    });

    messageText += `---\n*回复此消息来作答，或发送 "跳过" 跳过问题*`;

    // Store pending interaction
    const interaction: RemoteInteraction = {
      type: 'question',
      sessionId: actualSessionId,
      remoteSessionId,
      ownerSenderId: this.sessionOwnerMapping.get(remoteSessionId) || '',
      questionId,
      questions,
      createdAt: Date.now(),
      expiresAt: Date.now() + INTERACTION_TIMEOUT_MS,
    };
    let resolveResponse!: (response: string) => void;
    const responsePromise = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    const registered = await this.registerPendingInteraction(
      questionId,
      interaction,
      resolveResponse
    );
    if (!registered) return null;
    if (!this.pendingInteractions.has(questionId)) return responsePromise;

    // Send to channel
    try {
      await this.gateway.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: messageText,
        },
        replyTo: channelInfo.replyTo,
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send question to channel:', err);
      const cancelled = await this.settlePendingInteraction(questionId, '{}');
      return cancelled ? null : responsePromise;
    }

    return responsePromise;
  }

  /**
   * Handle permission request from agent (for remote sessions)
   * Returns true if handled, false if should use normal UI
   */
  async handlePermissionRequest(
    actualSessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ allow: boolean; remember?: boolean } | null> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) {
      return null; // Not a remote session
    }

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) {
      return null;
    }

    log('[RemoteManager] Handling permission request for remote session:', remoteSessionId);

    // Check if auto-approve is enabled for safe tools
    const config = remoteConfigStore.getAll();
    if (config.gateway.autoApproveSafeTools) {
      const safeTools = [
        // Read-only tools
        'Read',
        'Glob',
        'Grep',
        'LS',
        'WebFetch',
        'WebSearch',
        // MCP Chrome tools (for browsing)
        'mcp__Chrome__navigate_page',
        'mcp__Chrome__take_screenshot',
        'mcp__Chrome__take_snapshot',
        'mcp__Chrome__click',
        'mcp__Chrome__fill',
        'mcp__Chrome__hover',
        'mcp__Chrome__list_pages',
        'mcp__Chrome__select_page',
        'mcp__Chrome__new_page',
        'mcp__Chrome__close_page',
        'mcp__Chrome__wait_for',
        'mcp__Chrome__press_key',
        'mcp__Chrome__evaluate_script',
        'mcp__Chrome__get_network_request',
        'mcp__Chrome__list_network_requests',
        'mcp__Chrome__list_console_messages',
        // Task tools
        'Task',
      ];

      if (safeTools.includes(toolName)) {
        log('[RemoteManager] Auto-approving safe tool:', toolName);
        // Send notification to user
        await this.doSendToChannel(channelInfo, `🔧 自动执行: **${toolName}**`);
        return { allow: true };
      }
    }

    // Build permission request message
    let messageText = '⚠️ **需要你的授权**\n\n';
    messageText += `工具: **${toolName}**\n\n`;
    messageText += `参数:\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\n`;
    messageText += `---\n`;
    messageText += `回复 "允许" 或 "y" 授权\n`;
    messageText += `回复 "拒绝" 或 "n" 拒绝\n`;
    messageText += `回复 "始终允许" 记住此授权`;

    // Store pending interaction
    const interaction: RemoteInteraction = {
      type: 'permission',
      sessionId: actualSessionId,
      remoteSessionId,
      ownerSenderId: this.sessionOwnerMapping.get(remoteSessionId) || '',
      toolUseId,
      toolName,
      input,
      createdAt: Date.now(),
      expiresAt: Date.now() + INTERACTION_TIMEOUT_MS,
    };
    let resolveResponse!: (response: string) => void;
    const responsePromise = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    const registered = await this.registerPendingInteraction(
      toolUseId,
      interaction,
      resolveResponse
    );
    if (!registered) return null;
    if (!this.pendingInteractions.has(toolUseId)) {
      return this.parsePermissionResponse(await responsePromise);
    }

    // Send to channel
    try {
      await this.gateway.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: messageText,
        },
        replyTo: channelInfo.replyTo,
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send permission request to channel:', err);
      const cancelled = await this.settlePendingInteraction(toolUseId, '拒绝');
      if (cancelled) return null;
    }

    return this.parsePermissionResponse(await responsePromise);
  }

  private async registerPendingInteraction(
    id: string,
    interaction: RemoteInteraction,
    resolver: (response: string) => void
  ): Promise<boolean> {
    return this.withInteractionLock(async () => {
      // The session may have been cleared while this registration was queued.
      if (this.sessionIdMapping.get(interaction.sessionId) !== interaction.remoteSessionId) {
        resolver(this.getInteractionFallback(interaction));
        return false;
      }

      // IDs should be unique. If an upstream caller reuses one, settle the old
      // waiter before replacing it so no promise is left hanging.
      const previous = this.takePendingInteraction(id);
      if (previous) {
        previous.resolver?.(this.getInteractionFallback(previous.interaction));
      }

      this.pendingInteractions.set(id, interaction);
      this.interactionResolvers.set(id, resolver);
      const timer = setTimeout(
        () => {
          void this.expirePendingInteraction(id).catch((error) => {
            logError('[RemoteManager] Interaction timeout lock error:', error);
          });
        },
        Math.max(0, interaction.expiresAt - Date.now())
      );
      this.interactionTimers.set(id, timer);
      return true;
    });
  }

  private async expirePendingInteraction(id: string): Promise<void> {
    await this.withInteractionLock(async () => {
      const settled = this.takePendingInteraction(id);
      if (!settled) return;

      log(
        `[RemoteManager] ${settled.interaction.type === 'question' ? 'Question' : 'Permission'} timeout:`,
        id
      );
      settled.resolver?.(this.getInteractionFallback(settled.interaction));
    });
  }

  private async settlePendingInteraction(id: string, response: string): Promise<boolean> {
    return this.withInteractionLock(async () => {
      const settled = this.takePendingInteraction(id);
      if (!settled) return false;
      settled.resolver?.(response);
      return true;
    });
  }

  private takePendingInteraction(id: string): SettledInteraction | undefined {
    const interaction = this.pendingInteractions.get(id);
    const resolver = this.interactionResolvers.get(id);
    const timer = this.interactionTimers.get(id);

    this.pendingInteractions.delete(id);
    this.interactionResolvers.delete(id);
    this.interactionTimers.delete(id);
    if (timer) clearTimeout(timer);

    return interaction ? { interaction, resolver } : undefined;
  }

  private getInteractionFallback(interaction: RemoteInteraction): string {
    return interaction.type === 'question' ? '{}' : '拒绝';
  }

  private parsePermissionResponse(response: string): { allow: boolean; remember?: boolean } {
    const lowerResponse = response.toLowerCase().trim();
    if (
      lowerResponse === '允许' ||
      lowerResponse === 'y' ||
      lowerResponse === 'yes' ||
      lowerResponse === '是'
    ) {
      return { allow: true };
    }
    if (lowerResponse === '始终允许' || lowerResponse === 'always') {
      return { allow: true, remember: true };
    }
    return { allow: false };
  }

  private async cancelPendingInteractions(): Promise<RemoteInteraction[]> {
    return this.withInteractionLock(async () => this.cancelPendingInteractionsMatching(() => true));
  }

  private async cancelPendingInteractionsForChannel(
    channelType: ControllableChannelType
  ): Promise<RemoteInteraction[]> {
    return this.withInteractionLock(async () =>
      this.cancelPendingInteractionsMatching((interaction) => {
        return (
          this.sessionChannelMapping.get(interaction.remoteSessionId)?.channelType === channelType
        );
      })
    );
  }

  private cancelPendingInteractionsForSession(remoteSessionId: string): RemoteInteraction[] {
    return this.cancelPendingInteractionsMatching(
      (interaction) => interaction.remoteSessionId === remoteSessionId
    );
  }

  private cancelPendingInteractionsMatching(
    predicate: (interaction: RemoteInteraction) => boolean
  ): RemoteInteraction[] {
    const cancelled: RemoteInteraction[] = [];
    for (const [id, interaction] of this.pendingInteractions) {
      if (!predicate(interaction)) continue;
      const settled = this.takePendingInteraction(id);
      if (!settled) continue;
      settled.resolver?.(this.getInteractionFallback(settled.interaction));
      cancelled.push(settled.interaction);
    }
    return cancelled;
  }

  private async notifyCancelledInteractions(
    interactions: RemoteInteraction[],
    messageKey: RemoteBotMessageKey
  ): Promise<void> {
    if (!this.gateway || interactions.length === 0) return;

    const destinations = new Map<string, RemoteChannelContext>();
    for (const interaction of interactions) {
      const channelInfo = this.sessionChannelMapping.get(interaction.remoteSessionId);
      if (channelInfo) destinations.set(interaction.remoteSessionId, channelInfo);
    }

    const results = await Promise.allSettled(
      [...destinations.values()].map((channelInfo) =>
        this.doSendToChannel(channelInfo, this.localizeRemoteBotMessage(messageKey, channelInfo))
      )
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        logError('[RemoteManager] Failed to send interaction cancellation notice:', result.reason);
      }
    }
  }

  private localizeRemoteBotMessage(
    key: RemoteBotMessageKey,
    channelInfo: RemoteChannelContext
  ): string {
    const translations = channelInfo.language === 'zh' ? zhTranslations : enTranslations;
    return translations.remote.botMessages[key];
  }

  private async withInteractionLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const acquired = new Promise<void>((r) => {
      release = r;
    });
    const previous = this.lockChain;
    this.lockChain = acquired;
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Handle incoming message that might be a response to pending interaction
   * Returns true if the message was consumed as an interaction response
   */
  async handlePotentialInteractionResponse(
    channelType: ChannelType,
    channelId: string,
    senderId: string,
    messageText: string
  ): Promise<boolean> {
    return this.withInteractionLock(async () => {
      // Find any pending interaction for this user
      let found = false;
      for (const [id, interaction] of this.pendingInteractions) {
        const channelInfo = this.sessionChannelMapping.get(interaction.remoteSessionId);
        if (!channelInfo) continue;

        if (channelInfo.channelType === channelType && channelInfo.channelId === channelId) {
          // Verify that the responder is the session owner to prevent hijacking
          if (!interaction.ownerSenderId || senderId !== interaction.ownerSenderId) {
            log('[RemoteManager] Ignoring interaction response from non-owner sender:', senderId);
            continue;
          }

          log('[RemoteManager] Found pending interaction:', id);

          const settled = this.takePendingInteraction(id);
          if (settled?.resolver) {
            if (interaction.type === 'question') {
              // Parse question response
              const response = this.parseQuestionResponse(messageText, interaction.questions || []);
              settled.resolver(response);
            } else {
              // Pass through for permission
              settled.resolver(messageText);
            }
          }

          found = true;
          break; // Only handle one interaction per message
        }
      }

      return found;
    });
  }

  /**
   * Parse question response from user message
   */
  private parseQuestionResponse(
    messageText: string,
    questions: Array<{
      question: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>
  ): string {
    const answers: Record<number, string[]> = {};

    // Handle "跳过" response
    if (
      messageText.toLowerCase().trim() === '跳过' ||
      messageText.toLowerCase().trim() === 'skip'
    ) {
      return '{}';
    }

    // Simple parsing: if there are options, try to parse numbers
    questions.forEach((q, qIdx) => {
      if (q.options && q.options.length > 0) {
        // Parse comma-separated numbers like "1,3" or single number like "2"
        const numbers = messageText.match(/\d+/g);
        if (numbers) {
          const selectedLabels = numbers
            .map((n) => parseInt(n) - 1) // Convert to 0-indexed
            .filter((idx) => idx >= 0 && idx < q.options!.length)
            .map((idx) => q.options![idx].label);

          if (selectedLabels.length > 0) {
            answers[qIdx] = q.multiSelect ? selectedLabels : [selectedLabels[0]];
          }
        }
      } else {
        // Free text answer
        answers[qIdx] = [messageText.trim()];
      }
    });

    return JSON.stringify(answers);
  }

  /**
   * Get pending interactions count
   */
  getPendingInteractionsCount(): number {
    return this.pendingInteractions.size;
  }

  /**
   * Send agent response back to channel (with buffering to avoid spam)
   */
  async sendResponseToChannel(
    actualSessionId: string,
    text: string,
    immediate: boolean = false,
    messageId?: string
  ): Promise<void> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) {
      log('[RemoteManager] Not a remote session, skipping channel response:', actualSessionId);
      return;
    }

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) {
      logError('[RemoteManager] No channel info for remote session:', remoteSessionId);
      return;
    }

    // Prefer the renderer event ID. SHA-256 is only a fallback for older callers
    // that cannot provide a stable source-message identity.
    const messageKey = messageId
      ? `message:${messageId}`
      : `text:${createHash('sha256').update(text).digest('base64url')}`;
    if (!this.sentMessageKeys.has(actualSessionId)) {
      this.sentMessageKeys.set(actualSessionId, new Set());
    }
    const sentKeys = this.sentMessageKeys.get(actualSessionId)!;
    if (sentKeys.has(messageKey)) {
      log('[RemoteManager] Skipping duplicate message');
      return;
    }
    // Keep a bounded insertion-ordered window instead of dropping all recent
    // deduplication history when the limit is reached.
    if (sentKeys.size >= MAX_SENT_MESSAGE_KEYS) {
      const oldestKey = sentKeys.values().next().value;
      if (oldestKey) sentKeys.delete(oldestKey);
    }
    sentKeys.add(messageKey);

    // For immediate sends (like final result), send directly
    if (immediate) {
      try {
        await this.doSendToChannel(channelInfo, text);
      } catch (error) {
        // Allow the caller to retry an immediate message after a failed send.
        sentKeys.delete(messageKey);
        throw error;
      }
      return;
    }

    // Buffer the response
    if (!this.responseBuffers.has(actualSessionId)) {
      this.responseBuffers.set(actualSessionId, {
        items: [],
        lastSent: 0,
        toolSteps: [],
        retryCount: 0,
      });
    }
    const buffer = this.responseBuffers.get(actualSessionId)!;
    buffer.items.push({ text, channelInfo: { ...channelInfo } });
    buffer.retryCount = 0;
    this.cleanupAfterFlush.delete(actualSessionId);

    // Set debounce timer (send after 2 seconds of no new messages)
    this.scheduleResponseFlush(actualSessionId, RESPONSE_DEBOUNCE_MS);
  }

  /**
   * Schedule one flush per session, replacing any older debounce/retry timer.
   */
  private scheduleResponseFlush(actualSessionId: string, delayMs: number): void {
    const existingTimer = this.sendTimers.get(actualSessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.sendTimers.delete(actualSessionId);
      void this.flushResponseBuffer(actualSessionId);
    }, delayMs);
    this.sendTimers.set(actualSessionId, timer);
  }

  /**
   * Serialize flushes per session so a timer and an idle event cannot send the
   * same buffered response concurrently.
   */
  private async flushResponseBuffer(actualSessionId: string): Promise<boolean> {
    const existingFlush = this.flushPromises.get(actualSessionId);
    if (existingFlush) {
      return existingFlush;
    }

    const flushPromise = this.performResponseFlush(actualSessionId);
    this.flushPromises.set(actualSessionId, flushPromise);

    try {
      return await flushPromise;
    } finally {
      if (this.flushPromises.get(actualSessionId) === flushPromise) {
        this.flushPromises.delete(actualSessionId);
      }
    }
  }

  /**
   * Flush buffered responses. Text is removed only after the channel confirms
   * success; transient failures retain it and schedule bounded retries.
   */
  private async performResponseFlush(actualSessionId: string): Promise<boolean> {
    const buffer = this.responseBuffers.get(actualSessionId);
    if (!buffer || buffer.items.length === 0) {
      if (this.cleanupAfterFlush.has(actualSessionId)) {
        this.cleanupResponseState(actualSessionId);
      }
      return true;
    }

    if (!this.gateway) return false;

    // Snapshot only the contiguous items for the same inbound message. A
    // failed batch may remain queued while a later remote turn starts, so its
    // reply context must never be replaced by the session's latest mapping.
    const channelInfo = buffer.items[0].channelInfo;
    let batchSize = 1;
    while (
      batchSize < buffer.items.length &&
      this.isSameReplyContext(buffer.items[batchSize].channelInfo, channelInfo)
    ) {
      batchSize += 1;
    }
    const combinedText = buffer.items
      .slice(0, batchSize)
      .map((item) => item.text)
      .join('\n\n');

    const timer = this.sendTimers.get(actualSessionId);
    if (timer) {
      clearTimeout(timer);
      this.sendTimers.delete(actualSessionId);
    }

    try {
      await this.doSendToChannel(channelInfo, combinedText);
      buffer.items.splice(0, batchSize);
      buffer.lastSent = Date.now();
      buffer.retryCount = 0;

      if (buffer.items.length > 0) {
        this.scheduleResponseFlush(actualSessionId, RESPONSE_DEBOUNCE_MS);
      } else if (this.cleanupAfterFlush.has(actualSessionId)) {
        this.cleanupResponseState(actualSessionId);
      }
      return true;
    } catch (error) {
      if (isNonRetryableChannelError(error)) {
        buffer.items.splice(0, batchSize);
        buffer.retryCount = 0;
        logError('[RemoteManager] Non-retryable channel response failed; dropping batch:', error);
        if (buffer.items.length > 0) {
          this.scheduleResponseFlush(actualSessionId, RESPONSE_DEBOUNCE_MS);
        } else if (this.cleanupAfterFlush.has(actualSessionId)) {
          this.cleanupResponseState(actualSessionId);
        }
        return true;
      }

      buffer.retryCount += 1;
      logError(
        `[RemoteManager] Failed to send buffered response (attempt ${buffer.retryCount}):`,
        error
      );

      if (buffer.retryCount <= MAX_RESPONSE_RETRIES) {
        const retryDelay = RESPONSE_RETRY_BASE_MS * 2 ** (buffer.retryCount - 1);
        this.scheduleResponseFlush(actualSessionId, retryDelay);
      } else {
        logError('[RemoteManager] Response retries exhausted; retaining buffered text');
      }
      return false;
    }
  }

  /**
   * Actually send message to channel
   */
  private async doSendToChannel(channelInfo: RemoteChannelContext, text: string): Promise<void> {
    log('[RemoteManager] Sending to channel:', {
      channelType: channelInfo.channelType,
      textLength: text.length,
    });

    await this.gateway!.sendResponse({
      channelType: channelInfo.channelType,
      channelId: channelInfo.channelId,
      content: {
        type: 'markdown',
        markdown: text,
      },
      replyTo: channelInfo.replyTo,
    });
  }

  /**
   * Send tool execution progress to channel
   */
  async sendToolProgress(
    actualSessionId: string,
    toolName: string,
    status: 'running' | 'completed' | 'error',
    output?: string
  ): Promise<void> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) return;

    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) return;

    // Only send notifications for interesting tools
    const notifyTools = ['Bash', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'mcp__Chrome__'];
    const shouldNotify = notifyTools.some((t) => toolName.includes(t));

    if (!shouldNotify) return;

    let emoji = '🔧';
    let statusText = '';

    switch (status) {
      case 'running':
        emoji = '⏳';
        statusText = `正在执行 **${toolName}**...`;
        break;
      case 'completed':
        emoji = '✅';
        statusText = `**${toolName}** 执行完成`;
        if (output && output.length < 200) {
          statusText += `\n\`\`\`\n${output}\n\`\`\``;
        }
        break;
      case 'error':
        emoji = '❌';
        statusText = `**${toolName}** 执行失败`;
        if (output) {
          statusText += `: ${output.substring(0, 100)}`;
        }
        break;
    }

    // Only send running status for long-running tools
    if (status === 'running') {
      // Add to buffer's tool steps
      if (!this.responseBuffers.has(actualSessionId)) {
        this.responseBuffers.set(actualSessionId, {
          items: [],
          lastSent: 0,
          toolSteps: [],
          retryCount: 0,
        });
      }
      this.responseBuffers.get(actualSessionId)!.toolSteps.push(`${emoji} ${statusText}`);
      return;
    }

    // Send completed/error status immediately for important tools
    if (status === 'completed' && toolName.includes('mcp__Chrome__')) {
      // For Chrome MCP, send progress
      await this.doSendToChannel(channelInfo, `${emoji} ${statusText}`);
    }
  }

  /**
   * Clear per-turn response state after a session becomes idle or errors.
   * The remote-to-actual session mappings must remain so the next message can
   * continue the same conversation.
   */
  async clearSessionBuffer(actualSessionId: string): Promise<void> {
    // Mark cleanup first so a successful in-flight flush can finish the job.
    this.cleanupAfterFlush.add(actualSessionId);
    let flushed = await this.flushResponseBuffer(actualSessionId);

    // Different inbound messages are deliberately kept in separate batches.
    // Drain every successful batch at the turn boundary, but retain the rest
    // for the existing bounded retry path after the first failure.
    let buffer = this.responseBuffers.get(actualSessionId);
    while (flushed && buffer && buffer.items.length > 0) {
      flushed = await this.flushResponseBuffer(actualSessionId);
      buffer = this.responseBuffers.get(actualSessionId);
    }

    if (!buffer || buffer.items.length === 0) {
      this.cleanupResponseState(actualSessionId);
    }
  }

  private isSameReplyContext(a: RemoteChannelContext, b: RemoteChannelContext): boolean {
    return (
      a.channelType === b.channelType && a.channelId === b.channelId && a.replyTo === b.replyTo
    );
  }

  private cleanupResponseState(actualSessionId: string): void {
    this.responseBuffers.delete(actualSessionId);
    this.sentMessageKeys.delete(actualSessionId);
    this.cleanupAfterFlush.delete(actualSessionId);
    const timer = this.sendTimers.get(actualSessionId);
    if (timer) {
      clearTimeout(timer);
      this.sendTimers.delete(actualSessionId);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Set up gateway event handlers
   */
  private setupGatewayEvents(): void {
    if (!this.gateway) return;

    this.gateway.on('event', (event) => {
      this.emit('event', event);
    });

    this.gateway.on('gateway.pairing_request', (data) => {
      log('[RemoteManager] New pairing request:', data);
      this.emitToRenderer({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: 'remote.pairing_request' as any,
        payload: data,
      });
    });

    this.gateway.on('gateway.started', () => {
      this.emitStatusUpdate();
    });

    this.gateway.on('gateway.stopped', () => {
      this.emitStatusUpdate();
    });
  }

  /**
   * Register configured channels
   */
  private async registerChannels(config: RemoteConfig): Promise<void> {
    if (!this.gateway) return;

    const larkConfig = config.channels.lark;
    if (larkConfig?.appId && larkConfig.appSecret) {
      this.gateway.registerChannel(
        new FeishuChannel({ ...larkConfig, type: 'lark' }),
        larkConfig.enabled !== false
      );
    }
    const wechatConfig = config.channels.wechat;
    if (wechatConfig?.botToken && wechatConfig.botId) {
      this.gateway.registerChannel(new WechatChannel(wechatConfig), wechatConfig.enabled !== false);
    }

    // Register Feishu channel if configured
    const feishuConfig = config.channels.feishu;
    if (feishuConfig && feishuConfig.appId && feishuConfig.appSecret) {
      const feishuChannel = new FeishuChannel(feishuConfig);
      this.gateway.registerChannel(feishuChannel, feishuConfig.enabled !== false);

      // Set up webhook handler
      this.gateway.on(
        'webhook:feishu',
        (data: {
          headers: Record<string, string>;
          body: string;
          respond: (status: number, responseData: unknown) => void;
        }) => {
          const result = feishuChannel.handleWebhook(data.headers, data.body);
          data.respond(result.status, result.data);
        }
      );

      log('[RemoteManager] Feishu channel registered');
    }

    // Register Slack channel if configured
    const slackConfig = config.channels.slack;
    if (slackConfig && slackConfig.botToken) {
      const slackChannel = new SlackChannel(slackConfig);
      this.gateway.registerChannel(slackChannel);

      // Set up webhook handler for webhook mode
      this.gateway.on(
        'webhook:slack',
        (data: {
          headers: Record<string, string>;
          body: string;
          respond: (status: number, responseData: unknown) => void;
        }) => {
          const result = slackChannel.handleWebhook(data.headers, data.body);
          data.respond(result.status, result.data);
        }
      );

      log('[RemoteManager] Slack channel registered');
    }

    const dingtalkConfig = config.channels.dingtalk;
    if (dingtalkConfig && dingtalkConfig.appKey && dingtalkConfig.appSecret) {
      const dingtalkChannel = new DingtalkChannel(dingtalkConfig);
      this.gateway.registerChannel(dingtalkChannel, dingtalkConfig.enabled !== false);
      this.gateway.on(
        'webhook:dingtalk',
        (data: {
          headers: Record<string, string | string[] | undefined>;
          body: string;
          respond: (status: number, responseData: unknown) => void;
        }) => {
          const result = dingtalkChannel.handleWebhook(data.headers, data.body);
          data.respond(result.status, result.data);
        }
      );
      log('[RemoteManager] DingTalk channel registered');
    }

    const wecomConfig = config.channels.wecom;
    const wecomConfigured =
      wecomConfig?.receiveMode === 'webhook'
        ? Boolean(wecomConfig.webhookToken && wecomConfig.webhookEncodingAESKey)
        : Boolean(wecomConfig?.botId && wecomConfig.secret);
    if (wecomConfig && wecomConfigured) {
      const wecomChannel = new WecomChannel(wecomConfig);
      this.gateway.registerChannel(wecomChannel, wecomConfig.enabled !== false);
      this.gateway.on(
        'webhook:wecom',
        (data: {
          method: string;
          url: string;
          body: string;
          respond: (status: number, responseData: unknown, contentType?: string) => void;
        }) => {
          const result = wecomChannel.handleWebhook(data.method, data.url, data.body);
          data.respond(result.status, result.data, result.contentType);
        }
      );
      log('[RemoteManager] WeCom channel registered');
    }

    // TODO: Register other channels (personal WeChat, Telegram)
  }

  /**
   * Load paired users from config
   */
  private loadPairedUsers(): void {
    if (!this.gateway) return;
    const users = remoteConfigStore.getPairedUsers();

    for (const user of users) {
      this.gateway.restorePairedUser(user);
      log('[RemoteManager] Loaded paired user:', user.userId);
    }
  }

  /**
   * Execute agent for remote message
   */
  private async executeAgent(
    sessionId: string,
    prompt: string,
    content: ContentBlock[],
    workingDirectory: string | undefined,
    channelType: ChannelType,
    channelId: string,
    senderId: string,
    messageId: string
  ): Promise<void> {
    if (!this.agentExecutor) {
      throw new Error('Agent executor not set');
    }

    log('[RemoteManager] Executing agent for session:', sessionId);
    log('[RemoteManager] Working directory:', workingDirectory || '(default)');

    // The reverse mapping is the single source of truth. If it is missing,
    // recover by creating a new actual session instead of treating the remote
    // session as existing and failing with an internal error.
    const actualSessionId = this.reverseSessionIdMapping.get(sessionId);

    if (!actualSessionId) {
      // Create new session with working directory
      const newSession = await this.agentExecutor.startSession(
        buildRemoteSessionTitle(prompt),
        prompt,
        workingDirectory
      );

      // Store bidirectional mapping
      this.sessionIdMapping.set(newSession.id, sessionId);
      this.reverseSessionIdMapping.set(sessionId, newSession.id);

      // Store channel info for routing responses back
      this.sessionChannelMapping.set(sessionId, {
        channelType,
        channelId,
        replyTo: channelType === 'wecom' ? messageId : undefined,
        language: this.detectRemoteMessageLanguage(prompt),
      });

      // Store session owner for interaction security verification
      this.sessionOwnerMapping.set(sessionId, senderId);

      log(
        '[RemoteManager] Created new session:',
        newSession.id,
        'for remote:',
        sessionId,
        'cwd:',
        workingDirectory
      );
      log('[RemoteManager] Session mapping stored:', newSession.id, '<->', sessionId);
      log('[RemoteManager] Emitting session update to renderer for:', newSession.id);

      this.emitToRenderer({
        type: 'session.update',
        payload: { sessionId: newSession.id, updates: newSession },
      });

      this.emitRemoteUserMessage(newSession.id, content, prompt);

      if (this.agentExecutor.waitForSessionIdle) {
        await this.agentExecutor.waitForSessionIdle(newSession.id);
      }
    } else {
      // Continue existing session - use actual session ID
      log('[RemoteManager] Continuing session:', actualSessionId, 'for remote:', sessionId);
      this.sessionChannelMapping.set(sessionId, {
        channelType,
        channelId,
        replyTo: channelType === 'wecom' ? messageId : undefined,
        language: this.detectRemoteMessageLanguage(prompt),
      });
      this.emitRemoteUserMessage(actualSessionId, content, prompt);
      await this.agentExecutor.continueSession(actualSessionId, prompt, content, workingDirectory);
      if (this.agentExecutor.waitForSessionIdle) {
        await this.agentExecutor.waitForSessionIdle(actualSessionId);
      }
    }

    // Responses are emitted by the session manager and intercepted once in
    // sendToRenderer(), which is the single outbound response pipeline.
  }

  private detectRemoteMessageLanguage(content: string): RemoteMessageLanguage {
    return /[\u3400-\u9fff]/u.test(content) ? 'zh' : 'en';
  }

  /**
   * Emit status update to renderer
   */
  private emitStatusUpdate(): void {
    // Type assertion needed because remote.status is not in ServerEvent union yet
    this.emitToRenderer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'remote.status' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: this.getStatus() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  /**
   * Emit event to renderer
   */
  private emitToRenderer(event: ServerEvent): void {
    if (this.sendToRenderer) {
      this.sendToRenderer(event);
    }
    this.emit('renderer-event', event);
  }

  /**
   * 发送远程用户消息到本地 UI（仅远程会话使用）
   */
  private emitRemoteUserMessage(
    actualSessionId: string,
    content: ContentBlock[],
    prompt: string
  ): void {
    if (!this.sendToRenderer) return;

    const messageContent: ContentBlock[] =
      content && content.length > 0 ? content : [{ type: 'text', text: prompt }];

    const userMessage: Message = {
      id: uuidv4(),
      sessionId: actualSessionId,
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
    };

    this.sendToRenderer({
      type: 'stream.message',
      payload: { sessionId: actualSessionId, message: userMessage },
    });
  }
}

// Singleton instance
export const remoteManager = new RemoteManager();
