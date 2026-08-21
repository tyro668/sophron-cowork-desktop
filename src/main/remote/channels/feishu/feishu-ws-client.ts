/**
 * Feishu WebSocket Long Connection Client
 * 飞书长连接客户端 - 无需公网 IP 或 ngrok
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { EventEmitter } from 'events';
import { log, logError, logWarn } from '../../../utils/logger';

export interface FeishuWSConfig {
  appId: string;
  appSecret: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderId: string;
  senderType: 'user' | 'bot';
  messageType: string;
  content: string;
  createTime: string;
}

/**
 * Feishu WebSocket Client
 * Uses Feishu SDK's long connection mode
 */
export class FeishuWSClient extends EventEmitter {
  private config: FeishuWSConfig;
  private client: Lark.Client | null = null;
  private wsClient: Lark.WSClient | null = null;
  private connected: boolean = false;
  private stopped: boolean = false;
  private starting: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleGeneration: number = 0;
  private startCompletion: Promise<void> | null = null;

  constructor(config: FeishuWSConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the WebSocket connection
   */
  async start(): Promise<void> {
    if (this.connected || this.starting) {
      logWarn('[FeishuWS] Already connected or connecting');
      return;
    }

    const generation = ++this.lifecycleGeneration;
    this.starting = true;
    this.stopped = false;
    this.connected = false;

    const { appId, appSecret } = this.config;

    if (!appId || !appSecret) {
      this.starting = false;
      throw new Error('Feishu appId and appSecret are required');
    }

    let resolveStartCompletion!: () => void;
    const startCompletion = new Promise<void>((resolve) => {
      resolveStartCompletion = resolve;
    });
    this.startCompletion = startCompletion;

    log('[FeishuWS] Starting long connection...');

    let sdkWSClient: Lark.WSClient | null = null;

    try {
      // Close any lingering previous connection before creating a new one
      await this.closeWSClient();

      if (this.stopped || generation !== this.lifecycleGeneration) {
        throw new Error('Feishu WebSocket start cancelled');
      }

      this.client = new Lark.Client({
        appId,
        appSecret,
        disableTokenCache: false,
      });

      const loggerLevel = this.getLoggerLevel();

      sdkWSClient = new Lark.WSClient({
        appId,
        appSecret,
        loggerLevel,
      });
      this.wsClient = sdkWSClient;

      // Bail out if stop() was called while we were setting up
      if (this.stopped) {
        this.closeSpecificWSClient(sdkWSClient);
        this.client = null;
        this.starting = false;
        throw new Error('Feishu WebSocket start cancelled');
      }

      await sdkWSClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          'im.message.receive_v1': async (data: Record<string, unknown>) => {
            try {
              await this.handleMessageReceive(data);
            } catch (err) {
              logError('[FeishuWS] Error handling message:', err);
            }
          },
        }),
      });

      // Double-check: stop() may have been called during the async start above
      if (
        this.stopped ||
        generation !== this.lifecycleGeneration ||
        this.wsClient !== sdkWSClient
      ) {
        this.closeSpecificWSClient(sdkWSClient);
        this.client = null;
        this.starting = false;
        throw new Error('Feishu WebSocket start cancelled');
      }

      if (!this.isUnderlyingConnectionOpen(sdkWSClient)) {
        throw new Error('Feishu WebSocket did not reach the open state');
      }

      this.connected = true;
      this.starting = false;
      this.reconnectAttempts = 0;
      log('[FeishuWS] Long connection established successfully');
      this.emit('connected');
    } catch (error) {
      const isCurrentStart =
        generation === this.lifecycleGeneration && !this.stopped && this.wsClient === sdkWSClient;

      if (sdkWSClient) {
        this.closeSpecificWSClient(sdkWSClient);
      }

      if (!isCurrentStart) {
        throw error;
      }

      this.starting = false;
      this.connected = false;
      this.client = null;
      logError('[FeishuWS] Failed to start:', error);
      this.emit('error', error);

      this.scheduleReconnect();
      throw error;
    } finally {
      resolveStartCompletion();
      if (this.startCompletion === startCompletion) {
        this.startCompletion = null;
      }
    }
  }

  /**
   * Stop the WebSocket connection
   */
  async stop(): Promise<void> {
    if (this.stopped && !this.starting && !this.connected && !this.wsClient) {
      return;
    }

    log('[FeishuWS] Stopping long connection...');

    this.lifecycleGeneration++;
    this.stopped = true;
    this.starting = false;
    this.connected = false;
    const pendingStart = this.startCompletion;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    await this.closeWSClient();
    if (pendingStart) {
      await pendingStart;
    }
    this.client = null;

    this.emit('disconnected');
    log('[FeishuWS] Long connection stopped');
  }

  /**
   * Close the underlying Lark WSClient connection
   */
  private async closeWSClient(): Promise<void> {
    const client = this.wsClient;
    if (client) {
      this.closeSpecificWSClient(client);
    }
  }

  /**
   * Close exactly the SDK instance that belongs to a lifecycle generation.
   * A late completion from an old start must never close the replacement.
   */
  private closeSpecificWSClient(client: Lark.WSClient): void {
    try {
      client.close({ force: true });
    } catch (err) {
      logWarn('[FeishuWS] Error closing WSClient:', err);
    }

    if (this.wsClient === client) {
      this.wsClient = null;
    }
  }

  /**
   * SDK 1.59.0 exposes no public readiness callback. Its runtime WSConfig is
   * inspected only after the patched start() resolves so connected=true means
   * there is an actual OPEN socket, not merely a scheduled connection attempt.
   */
  private isUnderlyingConnectionOpen(client: Lark.WSClient): boolean {
    try {
      const runtimeClient = client as unknown as {
        wsConfig?: { getWSInstance?: () => { readyState?: number } | null };
      };
      return runtimeClient.wsConfig?.getWSInstance?.()?.readyState === 1;
    } catch {
      return false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a message
   * @param content - For text: plain text string. For interactive: card object (will be JSON stringified)
   */
  async sendMessage(
    receiveId: string,
    receiveIdType: 'chat_id' | 'open_id' | 'user_id' | 'union_id',
    content: string | object,
    msgType: 'text' | 'interactive' = 'text'
  ): Promise<boolean> {
    if (!this.client) {
      logError('[FeishuWS] Client not initialized');
      return false;
    }

    try {
      let messageContent: string;

      if (msgType === 'text') {
        // Text message: wrap in { text: ... }
        messageContent = JSON.stringify({ text: content });
      } else if (msgType === 'interactive') {
        // Interactive card: content should be the card object
        messageContent = typeof content === 'string' ? content : JSON.stringify(content);
      } else {
        messageContent = JSON.stringify({ text: String(content) });
      }

      log('[FeishuWS] Sending message:', { msgType, contentLength: messageContent.length });

      const response = await this.client.im.v1.message.create({
        params: {
          receive_id_type: receiveIdType,
        },
        data: {
          receive_id: receiveId,
          content: messageContent,
          msg_type: msgType,
        },
      });

      if (response.code === 0) {
        log('[FeishuWS] Message sent successfully');
        return true;
      } else {
        logError('[FeishuWS] Failed to send message:', response.msg);
        return false;
      }
    } catch (error) {
      logError('[FeishuWS] Error sending message:', error);
      return false;
    }
  }

  /**
   * Reply to a message
   * @param content - For text: plain text. For interactive: JSON string of card object
   */
  async replyMessage(
    messageId: string,
    content: string,
    msgType: 'text' | 'interactive' = 'text'
  ): Promise<boolean> {
    if (!this.client) {
      logError('[FeishuWS] Client not initialized');
      return false;
    }

    try {
      let messageContent: string;

      if (msgType === 'text') {
        messageContent = JSON.stringify({ text: content });
      } else if (msgType === 'interactive') {
        // Interactive card: content is already JSON string
        messageContent = content;
      } else {
        messageContent = JSON.stringify({ text: content });
      }

      log('[FeishuWS] Replying to message:', { msgType, contentLength: messageContent.length });

      const response = await this.client.im.v1.message.reply({
        path: {
          message_id: messageId,
        },
        data: {
          content: messageContent,
          msg_type: msgType,
        },
      });

      if (response.code === 0) {
        log('[FeishuWS] Reply sent successfully');
        return true;
      } else {
        logError('[FeishuWS] Failed to reply:', response.msg);
        return false;
      }
    } catch (error) {
      logError('[FeishuWS] Error replying:', error);
      return false;
    }
  }

  /**
   * Handle incoming message event
   */
  private async handleMessageReceive(data: Record<string, unknown>): Promise<void> {
    // Skip if connection has been stopped (old instance receiving messages)
    if (!this.connected) {
      log('[FeishuWS] Ignoring message - connection stopped');
      return;
    }

    log('[FeishuWS] Received message event:', JSON.stringify(data, null, 2));

    const message = data.message as Record<string, unknown> | undefined;
    if (!message) {
      logWarn('[FeishuWS] No message in event data');
      return;
    }

    const senderData = data.sender as Record<string, unknown> | undefined;
    const senderId = senderData?.sender_id as Record<string, unknown> | undefined;

    // Parse message
    const feishuMessage: FeishuMessage = {
      messageId: String(message.message_id || ''),
      chatId: String(message.chat_id || ''),
      chatType: message.chat_type === 'p2p' ? 'p2p' : 'group',
      senderId: String(senderId?.open_id || senderId?.user_id || ''),
      senderType: senderData?.sender_type === 'user' ? 'user' : 'bot',
      messageType: String(message.message_type || ''),
      content: String(message.content || ''),
      createTime: String(message.create_time || ''),
    };

    // Parse content based on message type
    let textContent = '';
    try {
      if (message.message_type === 'text') {
        const parsed = JSON.parse(String(message.content || '')) as Record<string, unknown>;
        textContent = String(parsed.text || '');
      } else {
        // For other types, just use raw content
        textContent = String(message.content || '');
      }
    } catch {
      textContent = String(message.content || '');
    }

    log('[FeishuWS] Parsed message:', {
      from: feishuMessage.senderId,
      chatType: feishuMessage.chatType,
      text: textContent,
    });

    // Emit message event
    const listenerCount = this.listenerCount('message');
    log('[FeishuWS] Emitting message event, listener count:', listenerCount);
    this.emit('message', {
      ...feishuMessage,
      text: textContent,
    });
    log('[FeishuWS] Message event emitted');
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.stopped) {
      log('[FeishuWS] Client stopped, skipping reconnect');
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logError('[FeishuWS] Max reconnect attempts reached');
      this.emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    log(`[FeishuWS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.start().catch((err) => {
        logError('[FeishuWS] Reconnect failed:', err);
      });
    }, delay);
  }

  /**
   * Get Lark SDK logger level
   */
  private getLoggerLevel(): Lark.LoggerLevel {
    switch (this.config.logLevel) {
      case 'debug':
        return Lark.LoggerLevel.debug;
      case 'info':
        return Lark.LoggerLevel.info;
      case 'warn':
        return Lark.LoggerLevel.warn;
      case 'error':
        return Lark.LoggerLevel.error;
      default:
        return Lark.LoggerLevel.info;
    }
  }
}
