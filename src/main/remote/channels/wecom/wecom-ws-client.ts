import { EventEmitter } from 'node:events';
import {
  WSAuthFailureError,
  WSClient,
  generateReqId,
  type Logger,
  type TextMessage,
  type WsFrame,
} from '@wecom/aibot-node-sdk';
import { log, logError, logWarn } from '../../../utils/logger';

const AUTH_TIMEOUT_MS = 15_000;

export interface WecomWsClientConfig {
  botId: string;
  secret: string;
  wsUrl?: string;
}

export type WecomTextFrame = WsFrame<TextMessage>;

const sdkLogger: Logger = {
  debug: (message, ...args) => log('[WeComSDK]', message, ...args),
  info: (message, ...args) => log('[WeComSDK]', message, ...args),
  warn: (message, ...args) => logWarn('[WeComSDK]', message, ...args),
  error: (message, ...args) => logError('[WeComSDK]', message, ...args),
};

/**
 * Small lifecycle wrapper around the WeCom SDK. It deliberately resolves
 * start() only after application-level authentication has succeeded.
 */
export class WecomWsClient extends EventEmitter {
  private client?: WSClient;
  private startCompletion?: Promise<void>;
  private cancelPendingStart?: () => void;
  private lifecycleGeneration = 0;
  private authenticated = false;
  private stopped = true;

  constructor(private readonly config: WecomWsClientConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.startCompletion) return this.startCompletion;
    if (this.client && this.authenticated && !this.stopped) return;

    const generation = ++this.lifecycleGeneration;
    this.stopped = false;
    this.authenticated = false;

    const client = new WSClient({
      botId: this.config.botId,
      secret: this.config.secret,
      ...(this.config.wsUrl ? { wsUrl: this.config.wsUrl } : {}),
      maxReconnectAttempts: -1,
      maxAuthFailureAttempts: 3,
      logger: sdkLogger,
    });
    this.client = client;
    this.bindClientEvents(client, generation);

    const completion = this.connectAndWaitForAuthentication(client, generation);
    this.startCompletion = completion;
    try {
      await completion;
    } finally {
      if (this.startCompletion === completion) this.startCompletion = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped && !this.client && !this.startCompletion) return;

    const pendingStart = this.startCompletion;
    this.startCompletion = undefined;
    this.lifecycleGeneration++;
    this.stopped = true;
    this.authenticated = false;
    this.cancelPendingStart?.();
    this.cancelPendingStart = undefined;

    const client = this.client;
    this.client = undefined;
    if (client) {
      client.removeAllListeners();
      client.disconnect();
    }

    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        // stop() intentionally cancelled the in-flight start.
      }
    }
  }

  isConnected(): boolean {
    return Boolean(this.client?.isConnected && this.authenticated && !this.stopped);
  }

  async replyMarkdown(frame: WecomTextFrame, content: string): Promise<void> {
    const client = this.requireAuthenticatedClient();
    await client.replyStream(frame, generateReqId('sophron'), content, true);
  }

  async sendMarkdown(targetId: string, content: string): Promise<void> {
    const client = this.requireAuthenticatedClient();
    await client.sendMessage(targetId, {
      msgtype: 'markdown',
      markdown: { content },
    });
  }

  private bindClientEvents(client: WSClient, generation: number): void {
    client.on('authenticated', () => {
      if (!this.isCurrent(client, generation)) return;
      this.authenticated = true;
      this.emit('authenticated');
    });
    client.on('message.text', (frame) => {
      if (!this.isCurrent(client, generation)) return;
      this.emit('message', frame);
    });
    client.on('disconnected', (reason) => {
      if (!this.isCurrent(client, generation)) return;
      this.authenticated = false;
      this.emit('disconnected', reason);
    });
    client.on('reconnecting', (attempt) => {
      if (!this.isCurrent(client, generation)) return;
      this.authenticated = false;
      this.emit('reconnecting', attempt);
    });
    client.on('error', (error) => {
      if (!this.isCurrent(client, generation)) return;
      this.emit('error', error);
    });
  }

  private connectAndWaitForAuthentication(client: WSClient, generation: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('authenticated', handleAuthenticated);
        this.off('error', handleError);
        if (this.cancelPendingStart === cancelStart) this.cancelPendingStart = undefined;
        if (error) reject(error);
        else resolve();
      };
      const cancelStart = () => finish(new Error('WeCom channel start cancelled'));
      const handleAuthenticated = () => finish();
      const handleError = (error: Error) => {
        if (
          error instanceof WSAuthFailureError ||
          (error as Error & { code?: string }).code === 'WS_AUTH_FAILURE_EXHAUSTED'
        ) {
          finish(error);
        }
      };
      const timer = setTimeout(() => {
        finish(new Error('WeCom authentication timed out'));
      }, AUTH_TIMEOUT_MS);

      this.once('authenticated', handleAuthenticated);
      this.on('error', handleError);
      this.cancelPendingStart = cancelStart;
      try {
        client.connect();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }

      if (!this.isCurrent(client, generation)) {
        finish(new Error('WeCom channel start cancelled'));
      }
    });
  }

  private requireAuthenticatedClient(): WSClient {
    if (!this.client || !this.isConnected()) {
      throw new Error('WeCom channel is not authenticated');
    }
    return this.client;
  }

  private isCurrent(client: WSClient, generation: number): boolean {
    return !this.stopped && this.client === client && this.lifecycleGeneration === generation;
  }
}
