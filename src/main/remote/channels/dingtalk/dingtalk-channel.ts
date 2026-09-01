import { createHmac, timingSafeEqual } from 'node:crypto';
import { ChannelBase, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type { DingtalkChannelConfig, RemoteMessage, RemoteResponse } from '../../types';
import { DingtalkAPI, DingtalkAPIError } from './dingtalk-api';
import { DingtalkStreamClient } from './dingtalk-stream-client';
import type {
  DingtalkOutboundContent,
  DingtalkRobotPayload,
  DingtalkSessionContext,
} from './dingtalk-types';
import { parseDingtalkTarget } from './dingtalk-types';

const MAX_DEDUP_ENTRIES = 2_000;
const DEDUP_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_MESSAGE_BYTES = 3_500;
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 60 * 60 * 1000;

type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface DingtalkWebhookResult {
  status: number;
  data: Record<string, unknown>;
}

export class DingtalkChannel extends ChannelBase {
  readonly type = 'dingtalk' as const;

  private readonly api: DingtalkAPI;
  private streamClient?: DingtalkStreamClient;
  private readonly sessionContexts = new Map<string, DingtalkSessionContext>();
  private readonly seenMessages = new Map<string, number>();
  private lifecycleGeneration = 0;
  private startCompletion?: Promise<void>;

  constructor(private readonly config: DingtalkChannelConfig) {
    super();
    this.api = new DingtalkAPI(config.appKey, config.appSecret);
  }

  async start(): Promise<void> {
    const pendingStart = this.startCompletion;
    if (pendingStart) return pendingStart;
    if (this._connected || this.streamClient) {
      logWarn('[DingTalk] Channel already started');
      return;
    }

    const generation = ++this.lifecycleGeneration;
    const startCompletion = this.startLifecycle(generation);
    this.startCompletion = startCompletion;
    try {
      await startCompletion;
    } finally {
      if (this.startCompletion === startCompletion) this.startCompletion = undefined;
    }
  }

  private async startLifecycle(generation: number): Promise<void> {
    if (this.config.receiveMode === 'webhook') {
      if (generation !== this.lifecycleGeneration) {
        throw new Error('DingTalk channel start cancelled');
      }
      this._connected = true;
      log('[DingTalk] Webhook receiver ready');
      this.logStatus('Channel started successfully');
      return;
    }

    const streamClient = new DingtalkStreamClient({
      appKey: this.config.appKey,
      appSecret: this.config.appSecret,
    });
    this.streamClient = streamClient;
    streamClient.on('message', (payload: DingtalkRobotPayload, streamMessageId: string) => {
      if (!this.isCurrentStreamClient(streamClient, generation)) return;
      this.handleRobotMessage(payload, streamMessageId);
    });
    streamClient.on('connected', () => {
      if (!this.isCurrentStreamClient(streamClient, generation)) return;
      this._connected = true;
      log('[DingTalk] Stream connected');
    });
    streamClient.on('disconnected', () => {
      if (!this.isCurrentStreamClient(streamClient, generation)) return;
      this._connected = false;
      logWarn('[DingTalk] Stream disconnected');
    });
    streamClient.on('error', (error: Error) => {
      if (!this.isCurrentStreamClient(streamClient, generation)) return;
      this.emitError(error);
    });

    try {
      await streamClient.start();
      if (!this.isCurrentStreamClient(streamClient, generation)) {
        throw new Error('DingTalk channel start cancelled');
      }
      this._connected = streamClient.isConnected();
      if (!this._connected) throw new Error('DingTalk Stream did not become ready');
      this.logStatus('Channel started successfully');
    } catch (error) {
      streamClient.removeAllListeners();
      await streamClient.stop();
      if (this.isCurrentStreamClient(streamClient, generation)) {
        this.streamClient = undefined;
        this._connected = false;
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    const pendingStart = this.startCompletion;
    this.startCompletion = undefined;
    this.lifecycleGeneration++;
    const streamClient = this.streamClient;
    this.streamClient = undefined;
    this._connected = false;
    this.sessionContexts.clear();
    this.seenMessages.clear();
    this.logStatus('Channel stopped');
    if (streamClient) {
      streamClient.removeAllListeners();
      await streamClient.stop();
    }
    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        // stop() intentionally invalidated this start lifecycle.
      }
    }
  }

  private isCurrentStreamClient(streamClient: DingtalkStreamClient, generation: number): boolean {
    return this.streamClient === streamClient && generation === this.lifecycleGeneration;
  }

  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected) throw new Error('DingTalk channel not connected');
    const contents = this.toOutboundContents(response);
    const target = parseDingtalkTarget(response.channelId);

    for (const content of contents) {
      await withRetry(() => this.sendOne(response.channelId, target, content), {
        maxRetries: 3,
        delayMs: 800,
        shouldRetry: (error) => (error instanceof DingtalkAPIError ? error.retryable : true),
        onRetry: (attempt, error) => {
          logWarn(`[DingTalk] Send retry ${attempt}:`, error.message);
        },
      });
    }
  }

  /**
   * Validate and accept a DingTalk application-bot HTTP callback.
   * Processing is emitted synchronously and the HTTP request can be acknowledged
   * immediately; the eventual assistant response is sent through sessionWebhook
   * or OpenAPI by send().
   */
  handleWebhook(headers: WebhookHeaders, body: string): DingtalkWebhookResult {
    if (this.config.receiveMode !== 'webhook') {
      return { status: 409, data: { error: 'DingTalk webhook mode is not enabled' } };
    }

    const timestampValue = this.getHeader(headers, 'timestamp');
    const signatureValue = this.getHeader(headers, 'sign');
    if (!timestampValue || !signatureValue) {
      logWarn('[DingTalk] Rejected webhook without timestamp/sign headers');
      return { status: 401, data: { error: 'Missing DingTalk webhook signature' } };
    }

    const timestamp = Number(timestampValue);
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_MS
    ) {
      logWarn('[DingTalk] Rejected webhook with an invalid or expired timestamp');
      return { status: 401, data: { error: 'Invalid or expired DingTalk timestamp' } };
    }

    const expectedSignature = createHmac('sha256', this.config.appSecret)
      .update(`${timestampValue}\n${this.config.appSecret}`, 'utf8')
      .digest('base64');
    const normalizedSignature = this.decodeSignature(signatureValue);
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(normalizedSignature, 'utf8');
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      logWarn('[DingTalk] Rejected webhook with an invalid signature');
      return { status: 401, data: { error: 'Invalid DingTalk webhook signature' } };
    }

    let payload: DingtalkRobotPayload;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Webhook body must be an object');
      }
      payload = parsed as DingtalkRobotPayload;
    } catch (error) {
      logWarn(
        '[DingTalk] Rejected malformed webhook body:',
        error instanceof Error ? error.message : String(error)
      );
      return { status: 400, data: { error: 'Invalid JSON body' } };
    }

    const deliveryId = payload.msgId || `webhook:${timestampValue}`;
    this.handleRobotMessage(payload, deliveryId);
    return { status: 200, data: {} };
  }

  private handleRobotMessage(payload: DingtalkRobotPayload, streamMessageId: string): void {
    if (payload.msgtype !== 'text' || !payload.text?.content) {
      logWarn('[DingTalk] Ignoring unsupported message type:', payload.msgtype || 'unknown');
      return;
    }

    const isGroup = String(payload.conversationType) === '2';
    const senderId = payload.senderStaffId || payload.senderId;
    const targetId = isGroup ? payload.conversationId : senderId;
    if (!targetId || !senderId) {
      logWarn('[DingTalk] Ignoring message without a stable sender or conversation ID');
      return;
    }

    const channelId = `${isGroup ? 'group' : 'dm'}:${targetId}`;
    this.rememberSessionContext(channelId, payload);

    const messageId = payload.msgId || streamMessageId;
    const dedupKey = `${streamMessageId}:${messageId}`;
    if (this.isDuplicate(dedupKey)) {
      log('[DingTalk] Ignoring duplicate callback:', messageId);
      return;
    }

    const message: RemoteMessage = {
      id: messageId,
      channelType: 'dingtalk',
      channelId,
      sender: {
        id: senderId,
        name: payload.senderNick,
        isBot: false,
      },
      content: {
        type: 'text',
        text: payload.text.content.trim(),
      },
      timestamp: payload.createAt || Date.now(),
      isGroup,
      // DingTalk only delivers group robot callbacks after the bot is mentioned.
      isMentioned: isGroup,
      raw: {
        conversationId: payload.conversationId,
        conversationType: payload.conversationType,
        msgtype: payload.msgtype,
        robotCode: payload.robotCode,
      },
    };

    this.emitMessage(message);
  }

  private getHeader(headers: WebhookHeaders, name: string): string | undefined {
    const target = name.toLowerCase();
    for (const [headerName, value] of Object.entries(headers)) {
      if (headerName.toLowerCase() !== target) continue;
      return Array.isArray(value) ? value[0] : value;
    }
    return undefined;
  }

  private decodeSignature(signature: string): string {
    try {
      return decodeURIComponent(signature);
    } catch {
      return signature;
    }
  }

  private rememberSessionContext(channelId: string, payload: DingtalkRobotPayload): void {
    if (!payload.sessionWebhook && !payload.robotCode) return;
    const rawExpiry = Number(payload.sessionWebhookExpiredTime || 0);
    const expiresAt = rawExpiry
      ? rawExpiry < 1_000_000_000_000
        ? rawExpiry * 1000
        : rawExpiry
      : Date.now() + DEFAULT_SESSION_TTL_MS;
    this.sessionContexts.set(channelId, {
      sessionWebhook: payload.sessionWebhook,
      expiresAt,
      robotCode: payload.robotCode,
    });
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now();
    for (const [storedKey, timestamp] of this.seenMessages) {
      if (now - timestamp > DEDUP_TTL_MS) this.seenMessages.delete(storedKey);
    }
    if (this.seenMessages.has(key)) return true;
    this.seenMessages.set(key, now);
    while (this.seenMessages.size > MAX_DEDUP_ENTRIES) {
      const oldest = this.seenMessages.keys().next().value;
      if (!oldest) break;
      this.seenMessages.delete(oldest);
    }
    return false;
  }

  private async sendOne(
    channelId: string,
    target: ReturnType<typeof parseDingtalkTarget>,
    content: DingtalkOutboundContent
  ): Promise<void> {
    const context = this.sessionContexts.get(channelId);
    if (context?.sessionWebhook && context.expiresAt > Date.now()) {
      try {
        await this.api.sendSessionWebhook(context.sessionWebhook, content);
        return;
      } catch (error) {
        logWarn(
          '[DingTalk] Session webhook failed, falling back to OpenAPI:',
          error instanceof Error ? error.message : String(error)
        );
        this.sessionContexts.set(channelId, { ...context, expiresAt: 0 });
      }
    }

    const robotCode = this.config.robotCode || context?.robotCode || this.config.appKey;
    try {
      await this.api.sendProactive(target, robotCode, content);
    } catch (error) {
      logError('[DingTalk] OpenAPI send failed:', error);
      throw error;
    }
  }

  private toOutboundContents(response: RemoteResponse): DingtalkOutboundContent[] {
    let text = '';
    let markdown = false;
    if (response.content.type === 'markdown') {
      text = response.content.markdown || '';
      markdown = true;
    } else if (response.content.type === 'text') {
      text = response.content.text || '';
    } else {
      text = response.content.text || response.content.markdown || '[暂不支持的消息类型]';
    }

    return this.splitUtf8(text, MAX_MESSAGE_BYTES).map((chunk) =>
      markdown
        ? { kind: 'markdown', title: this.markdownTitle(chunk), text: chunk }
        : { kind: 'text', text: chunk }
    );
  }

  private splitUtf8(text: string, maxBytes: number): string[] {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];
    const chunks: string[] = [];
    let current = '';
    let bytes = 0;
    for (const character of text) {
      const characterBytes = Buffer.byteLength(character, 'utf8');
      if (bytes + characterBytes > maxBytes && current) {
        chunks.push(current);
        current = '';
        bytes = 0;
      }
      current += character;
      bytes += characterBytes;
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private markdownTitle(markdown: string): string {
    const firstLine = markdown
      .split('\n')
      .map((line) => line.replace(/^[#>*_`\-\s]+/, '').trim())
      .find(Boolean);
    return Array.from(firstLine || '九思助理')
      .slice(0, 20)
      .join('');
  }
}
