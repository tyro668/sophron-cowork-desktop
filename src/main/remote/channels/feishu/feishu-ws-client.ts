/**
 * Feishu WebSocket Long Connection Client
 * 飞书长连接客户端 - 无需公网 IP 或 ngrok
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { EventEmitter } from 'events';
import { log, logError, logWarn } from '../../../utils/logger';

export interface FeishuWSConfig {
  brand?: 'feishu' | 'lark';
  appId: string;
  appSecret: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Maximum time to wait for the first successful connection. */
  connectTimeoutMs?: number;
  /** Maximum time the SDK waits for a single WebSocket handshake. */
  handshakeTimeoutMs?: number;
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
  // The SDK can spend up to 15s discovering the endpoint and another 15s on
  // the WebSocket handshake. Keep the outer deadline beyond both phases so a
  // timeout does not abandon the SDK in the middle of its initial handshake.
  private static readonly DEFAULT_CONNECT_TIMEOUT_MS = 35_000;
  private static readonly DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;

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
  private cancelPendingStart: ((error: Error) => void) | null = null;

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
    let cancelStart: ((error: Error) => void) | null = null;
    let readySettled = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const settleReady = (error?: Error): boolean => {
      if (readySettled) return false;
      readySettled = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      if (error) {
        rejectReady(error);
      } else {
        resolveReady();
      }
      return true;
    };

    try {
      // Close any lingering previous connection before creating a new one
      await this.closeWSClient();

      if (this.stopped || generation !== this.lifecycleGeneration) {
        throw new Error('Feishu WebSocket start cancelled');
      }

      this.client = new Lark.Client({
        appId,
        appSecret,
        domain: this.config.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
        disableTokenCache: false,
      });

      const loggerLevel = this.getLoggerLevel();

      sdkWSClient = new Lark.WSClient({
        appId,
        appSecret,
        domain: this.config.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
        loggerLevel,
        autoReconnect: true,
        handshakeTimeoutMs:
          this.config.handshakeTimeoutMs ?? FeishuWSClient.DEFAULT_HANDSHAKE_TIMEOUT_MS,
        onReady: () => {
          if (!this.isCurrentClient(generation, sdkWSClient)) {
            if (sdkWSClient) this.closeSpecificWSClient(sdkWSClient);
            settleReady(new Error('Feishu WebSocket start cancelled'));
            return;
          }
          settleReady();
        },
        onError: (error: Error) => {
          const client = sdkWSClient;
          if (!client || !this.isCurrentClient(generation, client)) return;

          // Before the first ready signal, let start() own cleanup and retry.
          if (settleReady(error)) return;

          // The SDK emits onError only after its reconnect loop is exhausted.
          this.handleTerminalConnectionError(client, error);
        },
        onReconnecting: () => {
          if (!this.isCurrentClient(generation, sdkWSClient)) return;
          const wasConnected = this.connected;
          this.connected = false;
          logWarn('[FeishuWS] Connection lost, SDK is reconnecting...');
          if (wasConnected) this.emit('disconnected');
        },
        onReconnected: () => {
          if (!this.isCurrentClient(generation, sdkWSClient)) {
            if (sdkWSClient) this.closeSpecificWSClient(sdkWSClient);
            return;
          }
          this.connected = true;
          this.reconnectAttempts = 0;
          log('[FeishuWS] Long connection re-established successfully');
          this.emit('connected');
        },
      });
      this.wsClient = sdkWSClient;
      cancelStart = (error: Error) => {
        settleReady(error);
      };
      this.cancelPendingStart = cancelStart;

      const connectTimeoutMs =
        this.config.connectTimeoutMs ?? FeishuWSClient.DEFAULT_CONNECT_TIMEOUT_MS;
      readyTimer = setTimeout(() => {
        settleReady(new Error(`Feishu WebSocket connection timed out after ${connectTimeoutMs}ms`));
      }, connectTimeoutMs);

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

      // SDK 1.73.0 start() starts the connection in the background. onReady is
      // the public signal that the first WebSocket handshake actually succeeded.
      await readyPromise;

      // Double-check: stop() may have been called while waiting for onReady.
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
      settleReady();
      if (cancelStart && this.cancelPendingStart === cancelStart) {
        this.cancelPendingStart = null;
      }
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
    const cancelPendingStart = this.cancelPendingStart;
    this.cancelPendingStart = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    cancelPendingStart?.(new Error('Feishu WebSocket start cancelled'));
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

  private isCurrentClient(generation: number, client: Lark.WSClient | null): boolean {
    return (
      client !== null &&
      !this.stopped &&
      generation === this.lifecycleGeneration &&
      this.wsClient === client
    );
  }

  /**
   * The SDK has already exhausted its own reconnect loop. Close that instance
   * before the outer retry creates a fresh one, so only one reconnect owner is
   * active at a time.
   */
  private handleTerminalConnectionError(client: Lark.WSClient, error: Error): void {
    if (this.wsClient !== client || this.stopped) return;

    const wasConnected = this.connected;
    this.connected = false;
    this.starting = false;
    this.closeSpecificWSClient(client);
    this.client = null;
    logError('[FeishuWS] Connection failed after SDK retries:', error);
    this.emit('error', error);
    if (wasConnected) this.emit('disconnected');
    this.scheduleReconnect();
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
    if (this.reconnectTimer) {
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
