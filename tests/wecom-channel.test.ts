import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WecomChannel } from '../src/main/remote/channels/wecom/wecom-channel';
import type { RemoteMessage } from '../src/main/remote/types';
import type { WecomTextFrame } from '../src/main/remote/channels/wecom/wecom-ws-client';
import { WecomWebhookCrypto } from '../src/main/remote/channels/wecom/wecom-webhook-crypto';

const WEBHOOK_TOKEN = 'Token123';
const WEBHOOK_AES_KEY = 'A'.repeat(43);
const startedChannels: WecomChannel[] = [];

interface WecomChannelInternals {
  webhookSessionsByMessage: Map<string, unknown>;
  webhookSessionsByStream: Map<string, unknown>;
  storeWebhookSession: (session: {
    messageId: string;
    streamId: string;
    channelId: string;
    responseUrlUsed: boolean;
    content: string;
    finish: boolean;
    delivered: boolean;
    createdAt: number;
    updatedAt: number;
  }) => void;
}

function internalsOf(channel: WecomChannel): WecomChannelInternals {
  return channel as unknown as WecomChannelInternals;
}

const wsClients = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const instances: MockWecomWsClient[] = [];

  class MockWecomWsClient {
    connected = false;
    readonly replyMarkdown = vi.fn(async (_frame: unknown, _content: string) => {});
    readonly sendMarkdown = vi.fn(async (_target: string, _content: string) => {});
    private readonly listeners = new Map<string, Set<Listener>>();

    constructor(_config: unknown) {
      instances.push(this);
    }

    on(event: string, listener: Listener) {
      const listeners = this.listeners.get(event) || new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) || []) listener(...args);
    }

    removeAllListeners(): void {
      this.listeners.clear();
    }

    async start(): Promise<void> {
      this.connected = true;
      this.emit('authenticated');
    }

    async stop(): Promise<void> {
      this.connected = false;
    }

    isConnected(): boolean {
      return this.connected;
    }
  }

  return { MockWecomWsClient, instances };
});

vi.mock('../src/main/remote/channels/wecom/wecom-ws-client', () => ({
  WecomWsClient: wsClients.MockWecomWsClient,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

function textFrame(overrides: Record<string, unknown> = {}): WecomTextFrame {
  return {
    headers: { req_id: 'req-1' },
    body: {
      msgid: 'msg-1',
      aibotid: 'bot-1',
      chattype: 'single',
      from: { userid: 'user-1' },
      create_time: 1_700_000_000,
      msgtype: 'text',
      text: { content: ' hello ' },
      ...overrides,
    },
  } as WecomTextFrame;
}

async function createStartedChannel() {
  const channel = new WecomChannel({
    type: 'wecom',
    botId: 'bot-id',
    secret: 'bot-secret',
    dm: { policy: 'open' },
    defaultGroupSettings: { requireMention: true },
  });
  await channel.start();
  startedChannels.push(channel);
  return { channel, client: wsClients.instances.at(-1)! };
}

async function createStartedWebhookChannel() {
  const channel = new WecomChannel({
    type: 'wecom',
    receiveMode: 'webhook',
    botId: '',
    secret: '',
    webhookToken: WEBHOOK_TOKEN,
    webhookEncodingAESKey: WEBHOOK_AES_KEY,
    dm: { policy: 'open' },
    defaultGroupSettings: { requireMention: true },
  });
  await channel.start();
  startedChannels.push(channel);
  return channel;
}

function invokeEncryptedWebhook(
  channel: WecomChannel,
  payload: Record<string, unknown>,
  overrides: { signature?: string; timestamp?: string; nonce?: string } = {}
) {
  const crypto = new WecomWebhookCrypto(WEBHOOK_TOKEN, WEBHOOK_AES_KEY);
  const timestamp = overrides.timestamp || String(Math.floor(Date.now() / 1000));
  const nonce = overrides.nonce || 'nonce-1';
  const envelope = crypto.encrypt(JSON.stringify(payload), timestamp, nonce);
  const signature = overrides.signature || envelope.msgsignature;
  const result = channel.handleWebhook(
    'POST',
    `/webhook/wecom?msg_signature=${encodeURIComponent(signature)}&timestamp=${timestamp}&nonce=${nonce}`,
    JSON.stringify({ encrypt: envelope.encrypt })
  );
  return { result, crypto, timestamp, nonce };
}

function decryptWebhookResult(
  result: ReturnType<WecomChannel['handleWebhook']>,
  crypto: WecomWebhookCrypto
): Record<string, unknown> {
  const envelope = result.data as { encrypt: string };
  return JSON.parse(crypto.decrypt(envelope.encrypt)) as Record<string, unknown>;
}

describe('WecomChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    wsClients.instances.length = 0;
  });

  afterEach(async () => {
    await Promise.all(startedChannels.splice(0).map((channel) => channel.stop()));
    vi.useRealTimers();
  });

  it('normalizes direct messages and suppresses duplicate callbacks', async () => {
    const { channel, client } = await createStartedChannel();
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));

    const frame = textFrame();
    client.emit('message', frame);
    client.emit('message', frame);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: 'msg-1',
      channelType: 'wecom',
      channelId: 'dm:user-1',
      sender: { id: 'user-1', isBot: false },
      content: { type: 'text', text: 'hello' },
      timestamp: 1_700_000_000_000,
      isGroup: false,
      isMentioned: false,
    });
    expect(received[0]?.raw).not.toHaveProperty('response_url');
  });

  it('normalizes group messages with a stable group target', async () => {
    const { channel, client } = await createStartedChannel();
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));

    client.emit(
      'message',
      textFrame({ chattype: 'group', chatid: 'group-1', from: { userid: 'member-1' } })
    );

    expect(received[0]).toMatchObject({
      channelId: 'group:group-1',
      sender: { id: 'member-1' },
      isGroup: true,
      isMentioned: true,
    });
  });

  it('uses a cached callback frame for a direct passive reply', async () => {
    const { channel, client } = await createStartedChannel();
    client.emit('message', textFrame());

    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      replyTo: 'msg-1',
      content: { type: 'text', text: 'accepted' },
    });

    expect(client.replyMarkdown).toHaveBeenCalledWith(expect.anything(), 'accepted');
    expect(client.sendMarkdown).not.toHaveBeenCalled();
  });

  it('falls back to proactive Markdown and splits long UTF-8 messages', async () => {
    const { channel, client } = await createStartedChannel();
    client.replyMarkdown.mockRejectedValue(new Error('reply expired'));
    client.emit('message', textFrame());

    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      replyTo: 'msg-1',
      content: { type: 'markdown', markdown: 'fallback' },
    });
    expect(client.sendMarkdown).toHaveBeenCalledWith('user-1', 'fallback');

    client.sendMarkdown.mockClear();
    await channel.send({
      channelType: 'wecom',
      channelId: 'group:group-1',
      content: { type: 'markdown', markdown: '企'.repeat(13_000) },
    });
    expect(client.sendMarkdown.mock.calls.length).toBeGreaterThan(1);
    expect(client.sendMarkdown.mock.calls.every(([target]) => target === 'group-1')).toBe(true);
    expect(
      client.sendMarkdown.mock.calls.every(
        ([, content]) => Buffer.byteLength(content, 'utf8') <= 18 * 1024
      )
    ).toBe(true);
  });

  it('prefers Markdown boundaries and balances oversized fenced code blocks', async () => {
    const { channel, client } = await createStartedChannel();

    const paragraphOne = '第一段'.repeat(2_000) + '\n\n';
    const paragraphTwo = '第二段'.repeat(2_000);
    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      content: { type: 'markdown', markdown: paragraphOne + paragraphTwo },
    });

    expect(client.sendMarkdown.mock.calls).toHaveLength(2);
    expect(client.sendMarkdown.mock.calls[0][1]).toBe(paragraphOne);
    expect(
      client.sendMarkdown.mock.calls.every(
        ([, content]) => Buffer.byteLength(content, 'utf8') <= 18 * 1024
      )
    ).toBe(true);

    client.sendMarkdown.mockClear();
    const longCodeBlock = `\`\`\`ts\n${'const value = "企业微信";\n'.repeat(1_000)}\`\`\``;
    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      content: { type: 'markdown', markdown: longCodeBlock },
    });

    expect(client.sendMarkdown.mock.calls.length).toBeGreaterThan(1);
    expect(
      client.sendMarkdown.mock.calls.every(([, content]) => {
        return (
          Buffer.byteLength(content, 'utf8') <= 18 * 1024 &&
          content.startsWith('```ts\n') &&
          content.trimEnd().endsWith('```')
        );
      })
    ).toBe(true);
  });

  it('reflects reconnect and stop lifecycle state', async () => {
    const { channel, client } = await createStartedChannel();
    expect(channel.connected).toBe(true);

    client.emit('reconnecting', 1);
    expect(channel.connected).toBe(false);
    client.emit('authenticated');
    expect(channel.connected).toBe(true);

    await channel.stop();
    expect(channel.connected).toBe(false);
  });

  it('rejects insecure custom WebSocket endpoints before connecting', async () => {
    const channel = new WecomChannel({
      type: 'wecom',
      botId: 'bot-id',
      secret: 'bot-secret',
      wsUrl: 'ws://untrusted.example.test',
      dm: { policy: 'open' },
    });

    await expect(channel.start()).rejects.toThrow('must use wss://');
    expect(wsClients.instances).toHaveLength(0);
  });

  it('verifies the callback URL and returns the decrypted echo as plain text', async () => {
    const channel = await createStartedWebhookChannel();
    const crypto = new WecomWebhookCrypto(WEBHOOK_TOKEN, WEBHOOK_AES_KEY);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const envelope = crypto.encrypt('wecom-url-verified', timestamp, 'nonce-get');

    const result = channel.handleWebhook(
      'GET',
      `/webhook/wecom?msg_signature=${envelope.msgsignature}&timestamp=${timestamp}&nonce=nonce-get&echostr=${encodeURIComponent(envelope.encrypt)}`,
      ''
    );

    expect(result).toEqual({
      status: 200,
      data: 'wecom-url-verified',
      contentType: 'text/plain; charset=utf-8',
    });
    expect(wsClients.instances).toHaveLength(0);
  });

  it('decrypts messages, deduplicates delivery, and completes the streaming reply', async () => {
    const channel = await createStartedWebhookChannel();
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));
    const payload = {
      msgid: 'webhook-message-1',
      create_time: 1_700_000_000,
      aibotid: 'bot-1',
      chattype: 'group',
      chatid: 'group-1',
      from: { userid: 'member-1' },
      response_url: 'https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=trusted',
      msgtype: 'text',
      text: { content: ' webhook task ' },
    };

    const initial = invokeEncryptedWebhook(channel, payload);
    invokeEncryptedWebhook(channel, payload);
    const initialReply = decryptWebhookResult(initial.result, initial.crypto) as {
      msgtype: string;
      stream: { id: string; finish: boolean; content: string };
    };

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: 'webhook-message-1',
      channelId: 'group:group-1',
      sender: { id: 'member-1' },
      content: { type: 'text', text: 'webhook task' },
      isGroup: true,
      isMentioned: true,
    });
    expect(received[0]?.raw).not.toHaveProperty('response_url');
    expect(initialReply).toMatchObject({
      msgtype: 'stream',
      stream: { finish: false, content: 'Processing, please wait…' },
    });

    await channel.send({
      channelType: 'wecom',
      channelId: 'group:group-1',
      replyTo: 'webhook-message-1',
      content: { type: 'markdown', markdown: '**completed**' },
    });
    const refresh = invokeEncryptedWebhook(channel, {
      msgid: 'refresh-1',
      msgtype: 'stream',
      stream: { id: initialReply.stream.id },
    });

    expect(decryptWebhookResult(refresh.result, refresh.crypto)).toEqual({
      msgtype: 'stream',
      stream: { id: initialReply.stream.id, finish: true, content: '**completed**' },
    });
  });

  it('localizes the initial Webhook processing message from the user command', async () => {
    const channel = await createStartedWebhookChannel();
    const english = invokeEncryptedWebhook(channel, {
      msgid: 'webhook-message-en',
      chattype: 'single',
      from: { userid: 'user-en' },
      msgtype: 'text',
      text: { content: 'summarize this report' },
    });
    const chinese = invokeEncryptedWebhook(channel, {
      msgid: 'webhook-message-zh',
      chattype: 'single',
      from: { userid: 'user-zh' },
      msgtype: 'text',
      text: { content: '总结这份报告' },
    });

    expect(decryptWebhookResult(english.result, english.crypto)).toMatchObject({
      stream: { content: 'Processing, please wait…', finish: false },
    });
    expect(decryptWebhookResult(chinese.result, chinese.crypto)).toMatchObject({
      stream: { content: '正在处理，请稍候…', finish: false },
    });
  });

  it('evicts webhook sessions from both indexes using their last update time', () => {
    const channel = new WecomChannel({
      type: 'wecom',
      receiveMode: 'webhook',
      botId: '',
      secret: '',
      webhookToken: WEBHOOK_TOKEN,
      webhookEncodingAESKey: WEBHOOK_AES_KEY,
      dm: { policy: 'open' },
    });
    const internals = internalsOf(channel);

    for (let index = 0; index <= 2_000; index += 1) {
      internals.storeWebhookSession({
        messageId: `capacity-message-${index}`,
        streamId: `capacity-stream-${index}`,
        channelId: 'dm:user-1',
        responseUrlUsed: false,
        content: 'processing',
        finish: false,
        delivered: false,
        createdAt: index,
        updatedAt: index === 0 ? 10_000 : index,
      });
    }

    expect(internals.webhookSessionsByMessage.size).toBe(2_000);
    expect(internals.webhookSessionsByStream.size).toBe(2_000);
    expect(internals.webhookSessionsByMessage.has('capacity-message-0')).toBe(true);
    expect(internals.webhookSessionsByMessage.has('capacity-message-1')).toBe(false);
    expect(internals.webhookSessionsByStream.has('capacity-stream-1')).toBe(false);
  });

  it('periodically removes expired webhook sessions from both indexes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
    const channel = await createStartedWebhookChannel();
    invokeEncryptedWebhook(channel, {
      msgid: 'periodic-cleanup-message',
      chattype: 'single',
      from: { userid: 'user-1' },
      msgtype: 'text',
      text: { content: 'cleanup later' },
    });
    const internals = internalsOf(channel);
    expect(internals.webhookSessionsByMessage.size).toBe(1);
    expect(internals.webhookSessionsByStream.size).toBe(1);

    await vi.advanceTimersByTimeAsync(61 * 60 * 1_000);

    expect(internals.webhookSessionsByMessage.size).toBe(0);
    expect(internals.webhookSessionsByStream.size).toBe(0);
  });

  it('requires an exact replyTo instead of guessing by channel ID', async () => {
    const channel = await createStartedWebhookChannel();
    invokeEncryptedWebhook(channel, {
      msgid: 'exact-reply-message',
      chattype: 'single',
      from: { userid: 'user-1' },
      msgtype: 'text',
      text: { content: 'start' },
    });

    await expect(
      channel.send({
        channelType: 'wecom',
        channelId: 'dm:user-1',
        content: { type: 'text', text: 'ambiguous response' },
      })
    ).rejects.toThrow('requires replyTo');
  });

  it('keeps interleaved messages in the same channel isolated by replyTo', async () => {
    const channel = await createStartedWebhookChannel();
    const first = invokeEncryptedWebhook(channel, {
      msgid: 'interleaved-1',
      chattype: 'single',
      from: { userid: 'user-1' },
      msgtype: 'text',
      text: { content: 'first task' },
    });
    const second = invokeEncryptedWebhook(channel, {
      msgid: 'interleaved-2',
      chattype: 'single',
      from: { userid: 'user-1' },
      msgtype: 'text',
      text: { content: 'second task' },
    });
    const firstStreamId = (
      decryptWebhookResult(first.result, first.crypto) as { stream: { id: string } }
    ).stream.id;
    const secondStreamId = (
      decryptWebhookResult(second.result, second.crypto) as { stream: { id: string } }
    ).stream.id;

    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      replyTo: 'interleaved-1',
      content: { type: 'text', text: 'first result' },
    });

    const firstRefresh = invokeEncryptedWebhook(channel, {
      msgid: 'refresh-interleaved-1',
      msgtype: 'stream',
      stream: { id: firstStreamId },
    });
    const secondRefresh = invokeEncryptedWebhook(channel, {
      msgid: 'refresh-interleaved-2',
      msgtype: 'stream',
      stream: { id: secondStreamId },
    });

    expect(decryptWebhookResult(firstRefresh.result, firstRefresh.crypto)).toMatchObject({
      stream: { id: firstStreamId, finish: true, content: 'first result' },
    });
    expect(decryptWebhookResult(secondRefresh.result, secondRefresh.crypto)).toMatchObject({
      stream: { id: secondStreamId, finish: false },
    });
  });

  it('rejects a second response before a finalized stream is delivered', async () => {
    const channel = await createStartedWebhookChannel();
    const initial = invokeEncryptedWebhook(channel, {
      msgid: 'no-overwrite-message',
      chattype: 'single',
      from: { userid: 'user-1' },
      msgtype: 'text',
      text: { content: 'start' },
    });
    const streamId = (
      decryptWebhookResult(initial.result, initial.crypto) as { stream: { id: string } }
    ).stream.id;

    const results = await Promise.allSettled([
      channel.send({
        channelType: 'wecom',
        channelId: 'dm:user-1',
        replyTo: 'no-overwrite-message',
        content: { type: 'text', text: 'first result' },
      }),
      channel.send({
        channelType: 'wecom',
        channelId: 'dm:user-1',
        replyTo: 'no-overwrite-message',
        content: { type: 'text', text: 'second result' },
      }),
    ]);
    expect(results[0]).toMatchObject({ status: 'fulfilled' });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining('already been finalized'),
      }),
    });

    const refresh = invokeEncryptedWebhook(channel, {
      msgid: 'refresh-no-overwrite',
      msgtype: 'stream',
      stream: { id: streamId },
    });
    expect(decryptWebhookResult(refresh.result, refresh.crypto)).toMatchObject({
      stream: { finish: true, content: 'first result' },
    });
  });

  it('accepts voice transcripts and rejects forged or stale callbacks', async () => {
    const channel = await createStartedWebhookChannel();
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));

    invokeEncryptedWebhook(channel, {
      msgid: 'voice-1',
      chattype: 'single',
      from: { userid: 'user-1' },
      msgtype: 'voice',
      voice: { content: '执行语音任务' },
    });
    expect(received[0]?.content.text).toBe('执行语音任务');

    expect(
      invokeEncryptedWebhook(
        channel,
        {
          msgid: 'forged-1',
          chattype: 'single',
          from: { userid: 'user-1' },
          msgtype: 'text',
          text: { content: 'forged' },
        },
        { signature: 'forged' }
      ).result.status
    ).toBe(401);
    expect(
      invokeEncryptedWebhook(
        channel,
        {
          msgid: 'stale-1',
          chattype: 'single',
          from: { userid: 'user-1' },
          msgtype: 'text',
          text: { content: 'stale' },
        },
        { timestamp: String(Math.floor(Date.now() / 1000) - 5 * 60 - 1) }
      ).result.status
    ).toBe(401);
    expect(received).toHaveLength(1);
  });

  it('enforces a five-minute timestamp window in both directions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));

    try {
      const channel = await createStartedWebhookChannel();
      const received: RemoteMessage[] = [];
      channel.onMessage((message) => received.push(message));
      const nowSeconds = Math.floor(Date.now() / 1000);

      const boundary = invokeEncryptedWebhook(
        channel,
        {
          msgid: 'timestamp-boundary',
          chattype: 'single',
          from: { userid: 'user-1' },
          msgtype: 'text',
          text: { content: 'boundary' },
        },
        { timestamp: String(nowSeconds - 5 * 60) }
      );
      const expired = invokeEncryptedWebhook(
        channel,
        {
          msgid: 'timestamp-expired',
          chattype: 'single',
          from: { userid: 'user-1' },
          msgtype: 'text',
          text: { content: 'expired' },
        },
        { timestamp: String(nowSeconds - 5 * 60 - 1) }
      );
      const future = invokeEncryptedWebhook(
        channel,
        {
          msgid: 'timestamp-future',
          chattype: 'single',
          from: { userid: 'user-1' },
          msgtype: 'text',
          text: { content: 'future' },
        },
        { timestamp: String(nowSeconds + 5 * 60 + 1) }
      );

      expect(boundary.result.status).toBe(200);
      expect(expired.result).toMatchObject({
        status: 401,
        data: { error: 'Invalid or expired WeCom timestamp' },
      });
      expect(future.result).toMatchObject({
        status: 401,
        data: { error: 'Invalid or expired WeCom timestamp' },
      });
      expect(received.map((message) => message.id)).toEqual(['timestamp-boundary']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the signed one-time response URL only after a final stream was delivered', async () => {
    const channel = await createStartedWebhookChannel();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const initial = invokeEncryptedWebhook(channel, {
      msgid: 'response-url-message',
      chattype: 'single',
      from: { userid: 'user-1' },
      response_url:
        'https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=one-time-code',
      msgtype: 'text',
      text: { content: 'start' },
    });
    const streamId = (
      decryptWebhookResult(initial.result, initial.crypto) as { stream: { id: string } }
    ).stream.id;

    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      replyTo: 'response-url-message',
      content: { type: 'text', text: 'stream result' },
    });
    invokeEncryptedWebhook(channel, {
      msgid: 'refresh-response-url',
      msgtype: 'stream',
      stream: { id: streamId },
    });
    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      replyTo: 'response-url-message',
      content: { type: 'markdown', markdown: 'follow-up result' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('qyapi.weixin.qq.com/cgi-bin/aibot/response'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: { content: 'follow-up result' },
        }),
      })
    );
    await expect(
      channel.send({
        channelType: 'wecom',
        channelId: 'dm:user-1',
        replyTo: 'response-url-message',
        content: { type: 'text', text: 'third result' },
      })
    ).rejects.toThrow('already been used');
  });

  it('bounds response URL requests and marks ambiguous failures as non-retryable', async () => {
    const channel = await createStartedWebhookChannel();
    const initial = invokeEncryptedWebhook(channel, {
      msgid: 'response-url-timeout',
      chattype: 'single',
      from: { userid: 'user-1' },
      response_url: 'https://qyapi.weixin.qq.com/cgi-bin/aibot/response?response_code=timeout-code',
      msgtype: 'text',
      text: { content: 'start' },
    });
    const streamId = (
      decryptWebhookResult(initial.result, initial.crypto) as { stream: { id: string } }
    ).stream.id;
    await channel.send({
      channelType: 'wecom',
      channelId: 'dm:user-1',
      replyTo: 'response-url-timeout',
      content: { type: 'text', text: 'stream result' },
    });
    invokeEncryptedWebhook(channel, {
      msgid: 'refresh-response-url-timeout',
      msgtype: 'stream',
      stream: { id: streamId },
    });

    const abortController = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abortController.signal);
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const sendResult = channel.send({
        channelType: 'wecom',
        channelId: 'dm:user-1',
        replyTo: 'response-url-timeout',
        content: { type: 'text', text: 'follow-up result' },
      });
      abortController.abort(new DOMException('timed out', 'TimeoutError'));

      await expect(sendResult).rejects.toMatchObject({ retryable: false });
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect(fetchMock).toHaveBeenCalledOnce();
      await expect(
        channel.send({
          channelType: 'wecom',
          channelId: 'dm:user-1',
          replyTo: 'response-url-timeout',
          content: { type: 'text', text: 'unsafe retry' },
        })
      ).rejects.toThrow('already been used');
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('validates Webhook credentials before exposing the receiver', async () => {
    const channel = new WecomChannel({
      type: 'wecom',
      receiveMode: 'webhook',
      botId: '',
      secret: '',
      webhookToken: WEBHOOK_TOKEN,
      webhookEncodingAESKey: 'short',
      dm: { policy: 'open' },
    });

    await expect(channel.start()).rejects.toThrow('EncodingAESKey');
    expect(channel.connected).toBe(false);
  });
});
