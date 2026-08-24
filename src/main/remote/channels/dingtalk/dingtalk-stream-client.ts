import { EventEmitter } from 'events';
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import { log, logError, logWarn } from '../../../utils/logger';
import type { DingtalkRobotPayload } from './dingtalk-types';

const CONNECT_TIMEOUT_MS = 15_000;
const HEALTH_INTERVAL_MS = 1_000;

export interface DingtalkStreamConfig {
  appKey: string;
  appSecret: string;
}

export class DingtalkStreamClient extends EventEmitter {
  private client?: DWClient;
  private healthTimer?: NodeJS.Timeout;
  private healthTimerGeneration?: number;
  private stopped = true;
  private starting = false;
  private lastConnected = false;
  private lifecycleGeneration = 0;
  private startCompletion?: Promise<void>;

  constructor(private readonly config: DingtalkStreamConfig) {
    super();
  }

  async start(): Promise<void> {
    const pendingStart = this.startCompletion;
    if (pendingStart) return pendingStart;
    if (this.client && !this.stopped) return;

    const generation = ++this.lifecycleGeneration;
    this.stopped = false;
    this.starting = true;
    this.lastConnected = false;

    const client = new DWClient({
      clientId: this.config.appKey,
      clientSecret: this.config.appSecret,
      autoReconnect: true,
      keepAlive: true,
      maxPendingCallbackHandlers: 20,
    });
    this.client = client;

    client.registerCallbackListener(TOPIC_ROBOT, async (message) => {
      if (!this.isCurrentLifecycle(client, generation)) return;
      await this.handleRobotCallback(client, message, generation);
    });

    const startCompletion = this.startClient(client, generation);
    this.startCompletion = startCompletion;

    try {
      await startCompletion;
    } finally {
      if (generation === this.lifecycleGeneration) this.starting = false;
      if (this.startCompletion === startCompletion) this.startCompletion = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped && !this.starting && !this.client && !this.startCompletion) return;

    const pendingStart = this.startCompletion;
    this.startCompletion = undefined;
    this.lifecycleGeneration++;
    this.stopped = true;
    this.starting = false;
    this.stopHealthMonitor();
    const client = this.client;
    this.client = undefined;
    client?.disconnect();
    if (this.lastConnected) {
      this.lastConnected = false;
      this.emit('disconnected');
    }

    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        // The lifecycle was explicitly cancelled by stop(). The original
        // start() caller still receives the cancellation error.
      }
    }
  }

  isConnected(): boolean {
    return Boolean(this.client?.connected && !this.stopped);
  }

  private async startClient(client: DWClient, generation: number): Promise<void> {
    this.startHealthMonitor(client, generation);
    try {
      await client.connect();
      if (!this.isCurrentLifecycle(client, generation)) {
        throw new Error('DingTalk Stream start cancelled');
      }
      await this.waitUntilConnected(client, generation);
    } catch (error) {
      client.disconnect();
      this.stopHealthMonitor(generation);
      if (this.client === client && generation === this.lifecycleGeneration) {
        this.client = undefined;
        this.lastConnected = false;
      }
      throw error;
    }
  }

  private async handleRobotCallback(
    client: DWClient,
    message: DWClientDownStream,
    generation?: number
  ): Promise<void> {
    if (generation !== undefined && !this.isCurrentLifecycle(client, generation)) return;
    const streamMessageId = message.headers.messageId;
    try {
      const payload = JSON.parse(message.data) as DingtalkRobotPayload;
      this.emit('message', payload, streamMessageId);
      client.socketCallBackResponse(streamMessageId, { success: true });
    } catch (error) {
      // Poison messages are acknowledged so malformed input cannot cause an
      // endless server retry loop.
      logError('[DingTalkStream] Failed to process robot callback:', error);
      try {
        client.socketCallBackResponse(streamMessageId, { success: false });
      } catch (ackError) {
        logError('[DingTalkStream] Failed to acknowledge callback:', ackError);
      }
    }
  }

  private startHealthMonitor(client: DWClient, generation: number): void {
    this.stopHealthMonitor();
    this.healthTimerGeneration = generation;
    this.healthTimer = setInterval(() => {
      if (!this.isCurrentLifecycle(client, generation)) return;
      const connected = client.connected;
      if (connected === this.lastConnected) return;
      this.lastConnected = connected;
      this.emit(connected ? 'connected' : 'disconnected');
    }, HEALTH_INTERVAL_MS);
  }

  private stopHealthMonitor(generation?: number): void {
    if (generation !== undefined && this.healthTimerGeneration !== generation) return;
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = undefined;
    this.healthTimerGeneration = undefined;
  }

  private async waitUntilConnected(
    client: DWClient,
    generation = this.lifecycleGeneration
  ): Promise<void> {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    while (this.isCurrentLifecycle(client, generation) && Date.now() < deadline) {
      // DWClient.connect() follows the public SDK contract and resolves after
      // the WebSocket is open. `registered` is an internal protocol detail and
      // is not guaranteed by the public API or required by DingTalk's examples.
      if (client.connected) {
        if (!this.lastConnected) {
          this.lastConnected = true;
          this.emit('connected');
        }
        log('[DingTalkStream] Stream socket connected');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.isCurrentLifecycle(client, generation)) {
      throw new Error('DingTalk Stream start cancelled');
    }
    logWarn('[DingTalkStream] Timed out waiting for Stream socket connection');
    throw new Error('DingTalk Stream connection timed out');
  }

  private isCurrentLifecycle(client: DWClient, generation: number): boolean {
    return !this.stopped && generation === this.lifecycleGeneration && this.client === client;
  }
}
