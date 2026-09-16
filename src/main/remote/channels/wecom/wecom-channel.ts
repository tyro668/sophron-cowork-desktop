import { createHash } from 'node:crypto';
import { ChannelBase, NonRetryableChannelError, withRetry } from '../channel-base';
import { log, logError, logWarn } from '../../../utils/logger';
import type { RemoteMessage, RemoteResponse, WecomChannelConfig } from '../../types';
import enTranslations from '../../../../shared/i18n/locales/en.json';
import zhTranslations from '../../../../shared/i18n/locales/zh.json';
import { WecomWebhookCrypto, type WecomEncryptedEnvelope } from './wecom-webhook-crypto';
import { WecomWsClient, type WecomTextFrame } from './wecom-ws-client';

const MAX_CACHE_ENTRIES = 2_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000;
const WEBHOOK_SESSION_TTL_MS = 60 * 60 * 1000;
// Bound the lifetime of a captured signed callback. Five minutes still allows
// normal delivery retries and modest clock skew without leaving a multi-hour
// replay window after an application restart.
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_MARKDOWN_BYTES = 18 * 1024;
const RESPONSE_URL_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_ERROR_BYTES = 1_024;

function processingMessageFor(content: string): string {
  const translations = /[\u3400-\u9fff]/u.test(content) ? zhTranslations : enTranslations;
  return translations.remote.botMessages.processing;
}

interface CachedReplyFrame {
  frame: WecomTextFrame;
  createdAt: number;
}

interface WecomWebhookPayload {
  msgid?: string;
  create_time?: number;
  aibotid?: string;
  chatid?: string;
  chattype?: 'single' | 'group';
  from?: { userid?: string };
  response_url?: string;
  msgtype?: string;
  text?: { content?: string };
  voice?: { content?: string };
  mixed?: {
    msg_item?: Array<{ msgtype?: string; text?: { content?: string } }>;
  };
  stream?: { id?: string };
}

interface WebhookStreamSession {
  messageId: string;
  streamId: string;
  channelId: string;
  responseUrl?: string;
  responseUrlUsed: boolean;
  content: string;
  finish: boolean;
  delivered: boolean;
  createdAt: number;
  updatedAt: number;
}

type MarkdownBlock =
  | { kind: 'plain'; text: string }
  | {
      kind: 'fence';
      original: string;
      opener: string;
      content: string;
      closer: string;
      trailingNewline: boolean;
    };

export interface WecomWebhookResult {
  status: number;
  data: Record<string, unknown> | string;
  contentType?: string;
}

export class WecomChannel extends ChannelBase {
  readonly type = 'wecom' as const;

  private wsClient?: WecomWsClient;
  private webhookCrypto?: WecomWebhookCrypto;
  private readonly seenMessages = new Map<string, number>();
  private readonly replyFrames = new Map<string, CachedReplyFrame>();
  private readonly webhookSessionsByMessage = new Map<string, WebhookStreamSession>();
  private readonly webhookSessionsByStream = new Map<string, WebhookStreamSession>();
  private cleanupTimer?: NodeJS.Timeout;
  private lifecycleGeneration = 0;
  private startCompletion?: Promise<void>;

  constructor(private readonly config: WecomChannelConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.startCompletion) return this.startCompletion;
    if (this._connected || this.wsClient) return;

    const generation = ++this.lifecycleGeneration;
    const completion = this.startLifecycle(generation);
    this.startCompletion = completion;
    try {
      await completion;
    } finally {
      if (this.startCompletion === completion) this.startCompletion = undefined;
    }
  }

  private async startLifecycle(generation: number): Promise<void> {
    this.validateConfig();
    if (this.receiveMode === 'webhook') {
      this.webhookCrypto = new WecomWebhookCrypto(
        this.config.webhookToken!,
        this.config.webhookEncodingAESKey!
      );
      if (generation !== this.lifecycleGeneration) {
        throw new Error('WeCom channel start cancelled');
      }
      this._connected = true;
      this.startPeriodicCleanup();
      log('[WeCom] Webhook receiver ready');
      this.logStatus('Channel started successfully');
      return;
    }

    const client = new WecomWsClient({
      botId: this.config.botId,
      secret: this.config.secret,
      wsUrl: this.config.wsUrl,
    });
    this.wsClient = client;

    client.on('authenticated', () => {
      if (!this.isCurrentClient(client, generation)) return;
      this._connected = true;
      log('[WeCom] WebSocket authenticated');
    });
    client.on('message', (frame: WecomTextFrame) => {
      if (!this.isCurrentClient(client, generation)) return;
      this.handleTextMessage(frame);
    });
    client.on('reconnecting', (attempt: number) => {
      if (!this.isCurrentClient(client, generation)) return;
      this._connected = false;
      logWarn(`[WeCom] WebSocket reconnecting (attempt ${attempt})`);
    });
    client.on('disconnected', (reason: string) => {
      if (!this.isCurrentClient(client, generation)) return;
      this._connected = false;
      logWarn('[WeCom] WebSocket disconnected:', reason);
    });
    client.on('error', (error: Error) => {
      if (!this.isCurrentClient(client, generation)) return;
      this.emitError(error);
    });

    try {
      await client.start();
      if (!this.isCurrentClient(client, generation)) {
        throw new Error('WeCom channel start cancelled');
      }
      this._connected = client.isConnected();
      if (!this._connected) throw new Error('WeCom WebSocket did not authenticate');
      this.startPeriodicCleanup();
      this.logStatus('Channel started successfully');
    } catch (error) {
      client.removeAllListeners();
      await client.stop();
      if (this.isCurrentClient(client, generation)) {
        this.wsClient = undefined;
        this._connected = false;
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    const pendingStart = this.startCompletion;
    this.startCompletion = undefined;
    this.lifecycleGeneration++;
    this._connected = false;
    this.seenMessages.clear();
    this.replyFrames.clear();
    this.webhookSessionsByMessage.clear();
    this.webhookSessionsByStream.clear();
    this.webhookCrypto = undefined;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const client = this.wsClient;
    this.wsClient = undefined;
    if (client) {
      client.removeAllListeners();
      await client.stop();
    }
    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        // stop() intentionally invalidated the pending start.
      }
    }
    this.logStatus('Channel stopped');
  }

  async send(response: RemoteResponse): Promise<void> {
    if (!this._connected) throw new Error('WeCom channel not connected');
    if (this.receiveMode === 'webhook') {
      await this.sendWebhookResponse(response);
      return;
    }
    if (!this.wsClient) throw new Error('WeCom WebSocket is not connected');

    const text = this.responseText(response);
    const chunks = this.splitUtf8(text, MAX_MARKDOWN_BYTES);
    const replyFrame = response.replyTo ? this.takeReplyFrame(response.replyTo) : undefined;

    if (replyFrame && chunks.length === 1) {
      try {
        await withRetry(() => this.wsClient!.replyMarkdown(replyFrame, chunks[0]), {
          maxRetries: 2,
          delayMs: 500,
        });
        return;
      } catch (error) {
        logWarn(
          '[WeCom] Passive reply failed, falling back to proactive send:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const targetId = this.parseTarget(response.channelId);
    for (const chunk of chunks) {
      await withRetry(() => this.wsClient!.sendMarkdown(targetId, chunk), {
        maxRetries: 3,
        delayMs: 800,
      });
    }
  }

  /** Handle both callback URL verification and encrypted AI Bot callbacks. */
  handleWebhook(method: string, requestUrl: string, body: string): WecomWebhookResult {
    if (this.receiveMode !== 'webhook' || !this.webhookCrypto) {
      return { status: 409, data: { error: 'WeCom webhook mode is not enabled' } };
    }

    const url = new URL(requestUrl, 'http://127.0.0.1');
    const signature = url.searchParams.get('msg_signature') || '';
    const timestamp = url.searchParams.get('timestamp') || '';
    const nonce = url.searchParams.get('nonce') || '';
    if (!this.isFreshWebhookTimestamp(timestamp)) {
      return { status: 401, data: { error: 'Invalid or expired WeCom timestamp' } };
    }

    if (method === 'GET') {
      const echo = url.searchParams.get('echostr') || '';
      if (!this.webhookCrypto.verifySignature(signature, timestamp, nonce, echo)) {
        return { status: 401, data: { error: 'Invalid WeCom webhook signature' } };
      }
      try {
        return {
          status: 200,
          data: this.webhookCrypto.decrypt(echo),
          contentType: 'text/plain; charset=utf-8',
        };
      } catch (error) {
        logWarn('[WeCom] Failed to decrypt callback verification:', this.errorMessage(error));
        return { status: 400, data: { error: 'Invalid WeCom verification payload' } };
      }
    }

    if (method !== 'POST') {
      return { status: 405, data: { error: 'Method not allowed' } };
    }

    let encrypted = '';
    try {
      const envelope = JSON.parse(body) as { encrypt?: unknown };
      if (!envelope || typeof envelope.encrypt !== 'string') {
        throw new Error('Missing encrypt field');
      }
      encrypted = envelope.encrypt;
    } catch (error) {
      logWarn('[WeCom] Rejected malformed callback envelope:', this.errorMessage(error));
      return { status: 400, data: { error: 'Invalid WeCom callback body' } };
    }
    if (!this.webhookCrypto.verifySignature(signature, timestamp, nonce, encrypted)) {
      return { status: 401, data: { error: 'Invalid WeCom webhook signature' } };
    }

    let payload: WecomWebhookPayload;
    try {
      payload = JSON.parse(this.webhookCrypto.decrypt(encrypted)) as WecomWebhookPayload;
    } catch (error) {
      logWarn('[WeCom] Failed to decrypt callback:', this.errorMessage(error));
      return { status: 400, data: { error: 'Invalid WeCom encrypted callback' } };
    }

    const reply = this.handleWebhookPayload(payload);
    return {
      status: 200,
      data: { ...this.encryptWebhookReply(reply, timestamp, nonce) },
    };
  }

  private handleWebhookPayload(payload: WecomWebhookPayload): Record<string, unknown> {
    this.pruneCaches();
    if (payload.msgtype === 'stream') {
      const streamId = String(payload.stream?.id || '').trim();
      const session = this.webhookSessionsByStream.get(streamId);
      if (!session) {
        return this.streamReply(
          streamId || 'expired',
          '本次远程任务已失效，请重新发送指令。',
          true
        );
      }
      session.updatedAt = Date.now();
      if (session.finish) session.delivered = true;
      return this.streamReply(session.streamId, session.content, session.finish);
    }

    const content = this.webhookMessageText(payload);
    if (!content) return {};
    const messageId = String(payload.msgid || '').trim();
    const senderId = String(payload.from?.userid || '').trim();
    const isGroup = payload.chattype === 'group';
    const targetId = isGroup ? String(payload.chatid || '').trim() : senderId;
    if (!messageId || !senderId || !targetId) {
      logWarn('[WeCom] Ignoring webhook message without a stable message, sender, or chat ID');
      return {};
    }

    const existing = this.webhookSessionsByMessage.get(messageId);
    if (existing) {
      log('[WeCom] Reusing stream state for duplicate webhook:', messageId);
      return this.streamReply(existing.streamId, existing.content, existing.finish);
    }

    const channelId = `${isGroup ? 'group' : 'dm'}:${targetId}`;
    const session: WebhookStreamSession = {
      messageId,
      streamId: this.createStreamId(messageId),
      channelId,
      responseUrl: this.validateResponseUrl(payload.response_url),
      responseUrlUsed: false,
      content: processingMessageFor(content),
      finish: false,
      delivered: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.storeWebhookSession(session);
    this.seenMessages.set(messageId, Date.now());
    this.enforceCacheLimit(this.seenMessages);

    this.emitMessage(
      this.toRemoteMessage(payload, messageId, senderId, channelId, content, isGroup)
    );
    return this.streamReply(session.streamId, session.content, false);
  }

  private async sendWebhookResponse(response: RemoteResponse): Promise<void> {
    this.pruneCaches();
    if (!response.replyTo) {
      throw new Error('WeCom webhook response requires replyTo');
    }

    const session = this.webhookSessionsByMessage.get(response.replyTo);
    if (!session) {
      throw new Error('No active WeCom webhook reply context for this message');
    }
    if (session.channelId !== response.channelId) {
      throw new Error('WeCom webhook reply context does not match the target channel');
    }

    const text = this.truncateUtf8(this.responseText(response), MAX_MARKDOWN_BYTES);
    if (!session.delivered) {
      if (session.finish) {
        throw new Error('WeCom webhook stream has already been finalized');
      }
      session.content = text;
      session.finish = true;
      session.updatedAt = Date.now();
      return;
    }

    if (!session.responseUrl || session.responseUrlUsed) {
      throw new Error('WeCom webhook response URL is unavailable or has already been used');
    }
    session.responseUrlUsed = true;
    session.updatedAt = Date.now();
    try {
      const result = await fetch(session.responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content: text } }),
        signal: AbortSignal.timeout(RESPONSE_URL_TIMEOUT_MS),
      });
      if (!result.ok) {
        let errorBody = '';
        try {
          errorBody = this.truncateUtf8(await result.text(), MAX_RESPONSE_ERROR_BYTES);
        } catch {
          // The status code remains actionable if the response body cannot be read.
        }
        logError('[WeCom] Response URL rejected the request:', {
          status: result.status,
          body: errorBody,
        });
        throw new NonRetryableChannelError(`WeCom response URL returned HTTP ${result.status}`);
      }
    } catch (error) {
      if (error instanceof NonRetryableChannelError) throw error;
      logError(
        '[WeCom] Response URL request failed with an unknown delivery outcome:',
        this.errorMessage(error)
      );
      throw new NonRetryableChannelError(
        `WeCom response URL request failed: ${this.errorMessage(error)}`
      );
    }
  }

  private handleTextMessage(frame: WecomTextFrame): void {
    const body = frame.body;
    if (!body || body.msgtype !== 'text' || !body.text?.content) return;
    const content = body.text.content.trim();
    if (!content) return;

    const messageId = String(body.msgid || '').trim();
    const senderId = String(body.from?.userid || '').trim();
    const isGroup = body.chattype === 'group';
    const targetId = isGroup ? String(body.chatid || '').trim() : senderId;
    if (!messageId || !senderId || !targetId) {
      logWarn('[WeCom] Ignoring message without a stable message, sender, or chat ID');
      return;
    }
    if (this.isDuplicate(messageId)) {
      log('[WeCom] Ignoring duplicate callback:', messageId);
      return;
    }

    this.rememberReplyFrame(messageId, frame);
    this.emitMessage(
      this.toRemoteMessage(
        body as WecomWebhookPayload,
        messageId,
        senderId,
        `${isGroup ? 'group' : 'dm'}:${targetId}`,
        content,
        isGroup
      )
    );
  }

  private toRemoteMessage(
    payload: WecomWebhookPayload,
    messageId: string,
    senderId: string,
    channelId: string,
    content: string,
    isGroup: boolean
  ): RemoteMessage {
    const rawTimestamp = Number(payload.create_time || 0);
    const timestamp = rawTimestamp
      ? rawTimestamp < 1_000_000_000_000
        ? rawTimestamp * 1000
        : rawTimestamp
      : Date.now();
    return {
      id: messageId,
      channelType: 'wecom',
      channelId,
      sender: { id: senderId, isBot: false },
      content: { type: 'text', text: content },
      timestamp,
      isGroup,
      // Group callbacks are only delivered when the AI bot is addressed.
      isMentioned: isGroup,
      raw: {
        aibotid: payload.aibotid,
        chattype: payload.chattype,
        msgtype: payload.msgtype,
      },
    };
  }

  private webhookMessageText(payload: WecomWebhookPayload): string {
    if (payload.msgtype === 'text') return payload.text?.content?.trim() || '';
    if (payload.msgtype === 'voice') return payload.voice?.content?.trim() || '';
    if (payload.msgtype === 'mixed') {
      return (payload.mixed?.msg_item || [])
        .filter((item) => item.msgtype === 'text')
        .map((item) => item.text?.content?.trim() || '')
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  private streamReply(id: string, content: string, finish: boolean): Record<string, unknown> {
    return { msgtype: 'stream', stream: { id, finish, content } };
  }

  private encryptWebhookReply(
    reply: Record<string, unknown>,
    timestamp: string,
    nonce: string
  ): WecomEncryptedEnvelope {
    return this.webhookCrypto!.encrypt(JSON.stringify(reply), timestamp, nonce);
  }

  private isFreshWebhookTimestamp(value: string): boolean {
    if (!/^\d+$/.test(value)) return false;
    const timestamp = Number(value) * 1000;
    return (
      Number.isFinite(timestamp) &&
      Math.abs(Date.now() - timestamp) <= WEBHOOK_TIMESTAMP_TOLERANCE_MS
    );
  }

  private createStreamId(messageId: string): string {
    return `sophron_${createHash('sha256').update(messageId).digest('hex').slice(0, 24)}`;
  }

  private validateResponseUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'qyapi.weixin.qq.com') {
        logWarn('[WeCom] Ignoring untrusted response_url host');
        return undefined;
      }
      return url.toString();
    } catch {
      logWarn('[WeCom] Ignoring malformed response_url');
      return undefined;
    }
  }

  private isDuplicate(messageId: string): boolean {
    this.pruneCaches();
    if (this.seenMessages.has(messageId)) return true;
    this.seenMessages.set(messageId, Date.now());
    this.enforceCacheLimit(this.seenMessages);
    return false;
  }

  private rememberReplyFrame(messageId: string, frame: WecomTextFrame): void {
    this.pruneCaches();
    this.replyFrames.set(messageId, { frame, createdAt: Date.now() });
    this.enforceCacheLimit(this.replyFrames);
  }

  private takeReplyFrame(messageId: string): WecomTextFrame | undefined {
    this.pruneCaches();
    const cached = this.replyFrames.get(messageId);
    if (!cached) return undefined;
    this.replyFrames.delete(messageId);
    return cached.frame;
  }

  private pruneCaches(): void {
    const cacheCutoff = Date.now() - CACHE_TTL_MS;
    for (const [key, timestamp] of this.seenMessages) {
      if (timestamp < cacheCutoff) this.seenMessages.delete(key);
    }
    for (const [key, cached] of this.replyFrames) {
      if (cached.createdAt < cacheCutoff) this.replyFrames.delete(key);
    }

    const sessionCutoff = Date.now() - WEBHOOK_SESSION_TTL_MS;
    for (const session of this.webhookSessionsByMessage.values()) {
      if (session.updatedAt >= sessionCutoff) continue;
      this.deleteWebhookSession(session);
    }
    // Defensive repair for any inconsistent secondary-index entry introduced
    // by future code changes or a previously colliding stream ID.
    for (const [streamId, session] of this.webhookSessionsByStream) {
      if (this.webhookSessionsByMessage.get(session.messageId) !== session) {
        this.webhookSessionsByStream.delete(streamId);
      }
    }
  }

  private startPeriodicCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.pruneCaches(), CACHE_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  private storeWebhookSession(session: WebhookStreamSession): void {
    const streamCollision = this.webhookSessionsByStream.get(session.streamId);
    if (streamCollision && streamCollision !== session) {
      this.deleteWebhookSession(streamCollision);
    }
    this.webhookSessionsByMessage.set(session.messageId, session);
    this.webhookSessionsByStream.set(session.streamId, session);

    while (this.webhookSessionsByMessage.size > MAX_CACHE_ENTRIES) {
      let leastRecentlyUpdated: WebhookStreamSession | undefined;
      for (const candidate of this.webhookSessionsByMessage.values()) {
        if (!leastRecentlyUpdated || candidate.updatedAt < leastRecentlyUpdated.updatedAt) {
          leastRecentlyUpdated = candidate;
        }
      }
      if (!leastRecentlyUpdated) break;
      this.deleteWebhookSession(leastRecentlyUpdated);
    }
  }

  private deleteWebhookSession(session: WebhookStreamSession): void {
    if (this.webhookSessionsByMessage.get(session.messageId) === session) {
      this.webhookSessionsByMessage.delete(session.messageId);
    }
    if (this.webhookSessionsByStream.get(session.streamId) === session) {
      this.webhookSessionsByStream.delete(session.streamId);
    }
  }

  private enforceCacheLimit(map: Map<string, unknown>): void {
    while (map.size > MAX_CACHE_ENTRIES) {
      const oldestKey = map.keys().next().value;
      if (!oldestKey) break;
      map.delete(oldestKey);
    }
  }

  private responseText(response: RemoteResponse): string {
    if (response.content.type === 'markdown') return response.content.markdown || '';
    if (response.content.type === 'text') return response.content.text || '';
    return response.content.text || response.content.markdown || '[暂不支持的消息类型]';
  }

  private validateConfig(): void {
    if (this.receiveMode === 'webhook') {
      // Constructor performs exact format validation as well.
      new WecomWebhookCrypto(
        this.config.webhookToken || '',
        this.config.webhookEncodingAESKey || ''
      );
      return;
    }
    if (!this.config.botId.trim() || !this.config.secret.trim()) {
      throw new Error('WeCom Bot ID and Secret are required');
    }
    if (this.config.wsUrl) {
      let url: URL;
      try {
        url = new URL(this.config.wsUrl);
      } catch {
        throw new Error('Invalid WeCom WebSocket URL');
      }
      if (url.protocol !== 'wss:') {
        throw new Error('WeCom WebSocket URL must use wss://');
      }
    }
  }

  private get receiveMode(): 'websocket' | 'webhook' {
    return this.config.receiveMode === 'webhook' ? 'webhook' : 'websocket';
  }

  private parseTarget(channelId: string): string {
    const match = /^(?:group|dm):(.+)$/.exec(channelId);
    if (!match?.[1]) throw new Error(`Invalid WeCom channel target: ${channelId}`);
    return match[1];
  }

  private splitUtf8(text: string, maxBytes: number): string[] {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];

    const chunks: string[] = [];
    let current = '';
    const append = (piece: string) => {
      if (!piece) return;
      if (Buffer.byteLength(current + piece, 'utf8') <= maxBytes) {
        current += piece;
        return;
      }
      if (current) chunks.push(current);
      current = piece;
    };

    for (const block of this.markdownBlocks(text)) {
      const pieces =
        Buffer.byteLength(block.kind === 'plain' ? block.text : block.original, 'utf8') <= maxBytes
          ? [block.kind === 'plain' ? block.text : block.original]
          : block.kind === 'fence'
            ? this.splitMarkdownFence(block, maxBytes)
            : this.splitPlainUtf8(block.text, maxBytes);

      for (const piece of pieces) {
        if (Buffer.byteLength(piece, 'utf8') > maxBytes) {
          for (const fallback of this.splitPlainUtf8(piece, maxBytes)) append(fallback);
        } else {
          append(piece);
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private markdownBlocks(text: string): MarkdownBlock[] {
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
    const blocks: MarkdownBlock[] = [];
    let plain = '';
    let fence:
      | {
          openerLine: string;
          opener: string;
          marker: string;
          indent: string;
          content: string;
        }
      | undefined;

    const flushPlain = () => {
      if (!plain) return;
      blocks.push({ kind: 'plain', text: plain });
      plain = '';
    };

    for (const line of lines) {
      const withoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line;
      if (!fence) {
        const opener = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(withoutNewline);
        if (!opener) {
          plain += line;
          continue;
        }
        flushPlain();
        fence = {
          openerLine: line,
          opener: withoutNewline,
          marker: opener[2],
          indent: opener[1],
          content: '',
        };
        continue;
      }

      if (this.isClosingFence(withoutNewline, fence.marker)) {
        const closer = `${fence.indent}${fence.marker}`;
        blocks.push({
          kind: 'fence',
          original: fence.openerLine + fence.content + line,
          opener: fence.opener,
          content: fence.content,
          closer,
          trailingNewline: line.endsWith('\n'),
        });
        fence = undefined;
      } else {
        fence.content += line;
      }
    }

    if (fence) {
      blocks.push({
        kind: 'fence',
        original: fence.openerLine + fence.content,
        opener: fence.opener,
        content: fence.content,
        closer: `${fence.indent}${fence.marker}`,
        trailingNewline: false,
      });
    }
    flushPlain();
    return blocks;
  }

  private isClosingFence(line: string, openerMarker: string): boolean {
    const trimmed = line.trim();
    const markerCharacter = openerMarker[0];
    let markerLength = 0;
    while (trimmed[markerLength] === markerCharacter) markerLength += 1;
    return markerLength >= openerMarker.length && trimmed.slice(markerLength).trim() === '';
  }

  private splitMarkdownFence(
    block: Extract<MarkdownBlock, { kind: 'fence' }>,
    maxBytes: number
  ): string[] {
    const prefix = `${block.opener}\n`;
    const suffix = `\n${block.closer}`;
    const availableBytes =
      maxBytes - Buffer.byteLength(prefix, 'utf8') - Buffer.byteLength(suffix, 'utf8') - 1;
    if (availableBytes <= 0) return this.splitPlainUtf8(block.original, maxBytes);

    const contentChunks = this.splitPlainUtf8(block.content, availableBytes);
    return contentChunks.map((content, index) => {
      const separator = content.endsWith('\n') ? '' : '\n';
      const trailingNewline =
        index === contentChunks.length - 1 && block.trailingNewline ? '\n' : '';
      return `${prefix}${content}${separator}${block.closer}${trailingNewline}`;
    });
  }

  private splitPlainUtf8(text: string, maxBytes: number): string[] {
    if (!text) return [];
    const chunks: string[] = [];
    let remaining = text;

    while (Buffer.byteLength(remaining, 'utf8') > maxBytes) {
      let bytes = 0;
      let end = 0;
      for (const character of remaining) {
        const characterBytes = Buffer.byteLength(character, 'utf8');
        if (bytes + characterBytes > maxBytes) break;
        bytes += characterBytes;
        end += character.length;
      }
      if (end === 0) throw new Error('WeCom message byte limit is too small');

      const prefix = remaining.slice(0, end);
      const minimumPreferredBoundary = Math.floor(prefix.length / 2);
      const preferredBoundaries = [
        prefix.lastIndexOf('\n\n') + 2,
        prefix.lastIndexOf('\n') + 1,
        prefix.lastIndexOf(' ') + 1,
      ];
      const preferredEnd = preferredBoundaries.find(
        (candidate) => candidate >= minimumPreferredBoundary
      );
      const splitAt = preferredEnd || end;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  private truncateUtf8(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
    const suffix = '\n\n…（内容过长，已截断）';
    const limit = maxBytes - Buffer.byteLength(suffix, 'utf8');
    let result = '';
    for (const character of text) {
      if (Buffer.byteLength(result + character, 'utf8') > limit) break;
      result += character;
    }
    return result + suffix;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isCurrentClient(client: WecomWsClient, generation: number): boolean {
    return this.wsClient === client && this.lifecycleGeneration === generation;
  }
}
