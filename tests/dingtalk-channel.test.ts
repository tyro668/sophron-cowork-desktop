import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { DingtalkChannel } from '../src/main/remote/channels/dingtalk/dingtalk-channel';
import type {
  DingtalkOutboundContent,
  DingtalkRobotPayload,
  DingtalkSessionContext,
  DingtalkTarget,
} from '../src/main/remote/channels/dingtalk/dingtalk-types';
import type { RemoteMessage } from '../src/main/remote/types';

const streamClients = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const instances: MockDingtalkStreamClient[] = [];

  class MockDingtalkStreamClient {
    connected = false;
    private readonly listeners = new Map<string, Set<Listener>>();
    private resolveStart?: () => void;
    private rejectStart?: (error: Error) => void;

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

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        this.resolveStart = resolve;
        this.rejectStart = reject;
      });
    }

    async stop(): Promise<void> {
      this.connected = false;
    }

    isConnected(): boolean {
      return this.connected;
    }

    finishStart(): void {
      this.connected = true;
      this.emit('connected');
      this.resolveStart?.();
    }

    failStart(): void {
      this.rejectStart?.(new Error('cancelled old start'));
    }
  }

  return { MockDingtalkStreamClient, instances };
});

vi.mock('../src/main/remote/channels/dingtalk/dingtalk-stream-client', () => ({
  DingtalkStreamClient: streamClients.MockDingtalkStreamClient,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

function createApiMock() {
  return {
    sendSessionWebhook: vi.fn(
      async (_url: string, _content: DingtalkOutboundContent): Promise<void> => {}
    ),
    sendProactive: vi.fn(
      async (
        _target: DingtalkTarget,
        _robotCode: string,
        _content: DingtalkOutboundContent
      ): Promise<void> => {}
    ),
  };
}

type MockDingtalkApi = ReturnType<typeof createApiMock>;

interface DingtalkChannelInternals {
  api: MockDingtalkApi;
  _connected: boolean;
  streamClient?: unknown;
  sessionContexts: Map<string, DingtalkSessionContext>;
  handleRobotMessage(payload: DingtalkRobotPayload, streamMessageId: string): void;
}

function getChannelInternals(channel: DingtalkChannel): DingtalkChannelInternals {
  return channel as unknown as DingtalkChannelInternals;
}

function createChannel(receiveMode: 'stream' | 'webhook' = 'stream') {
  const channel = new DingtalkChannel({
    type: 'dingtalk',
    receiveMode,
    appKey: 'app-key',
    appSecret: 'app-secret',
    robotCode: 'robot-code',
    dm: { policy: 'open' },
    defaultGroupSettings: { requireMention: true },
  });
  const api = createApiMock();
  const internals = getChannelInternals(channel);
  internals.api = api;
  internals._connected = true;
  return { channel, api };
}

describe('DingtalkChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamClients.instances.length = 0;
  });

  it('normalizes group callbacks and suppresses duplicate delivery', () => {
    const { channel } = createChannel();
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));

    const payload = {
      conversationId: 'cid-group',
      conversationType: '2',
      msgId: 'robot-msg-1',
      msgtype: 'text',
      text: { content: '  run tests  ' },
      senderStaffId: 'staff-1',
      senderNick: 'Tester',
      createAt: 1234,
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=secret',
      sessionWebhookExpiredTime: Date.now() + 60_000,
      robotCode: 'robot-code',
    };

    const internals = getChannelInternals(channel);
    internals.handleRobotMessage(payload, 'stream-msg-1');
    internals.handleRobotMessage(payload, 'stream-msg-1');

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: 'robot-msg-1',
      channelType: 'dingtalk',
      channelId: 'group:cid-group',
      sender: { id: 'staff-1', name: 'Tester', isBot: false },
      content: { type: 'text', text: 'run tests' },
      isGroup: true,
      isMentioned: true,
    });
    expect(received[0]?.raw).not.toHaveProperty('sessionWebhook');
  });

  it('uses the sender staff ID as the direct-message target', () => {
    const { channel } = createChannel();
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));

    getChannelInternals(channel).handleRobotMessage(
      {
        conversationType: '1',
        msgId: 'dm-msg',
        msgtype: 'text',
        text: { content: 'hello' },
        senderStaffId: 'staff-dm',
      },
      'stream-dm'
    );

    expect(received[0]).toMatchObject({
      channelId: 'dm:staff-dm',
      sender: { id: 'staff-dm' },
      isGroup: false,
      isMentioned: false,
    });
  });

  it('starts webhook mode without opening a Stream connection', async () => {
    const { channel } = createChannel('webhook');
    const internals = getChannelInternals(channel);
    internals._connected = false;

    await channel.start();

    expect(channel.connected).toBe(true);
    expect(internals.streamClient).toBeUndefined();
  });

  it('does not let a cancelled Stream start overwrite a replacement connection', async () => {
    const channel = new DingtalkChannel({
      type: 'dingtalk',
      receiveMode: 'stream',
      appKey: 'app-key',
      appSecret: 'app-secret',
      dm: { policy: 'open' },
    });
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));

    const firstStartResult = channel.start().then(
      () => null,
      (error: unknown) => error
    );
    const firstClient = streamClients.instances[0];
    expect(firstClient).toBeTruthy();

    const stopping = channel.stop();
    const secondStart = channel.start();
    const secondClient = streamClients.instances[1];
    expect(secondClient).toBeTruthy();
    secondClient.finishStart();
    await secondStart;
    expect(channel.connected).toBe(true);
    secondClient.emit(
      'message',
      {
        conversationType: '1',
        msgId: 'replacement-message',
        msgtype: 'text',
        text: { content: 'replacement active' },
        senderStaffId: 'replacement-user',
        sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=current',
      },
      'replacement-stream-message'
    );

    firstClient.failStart();
    await stopping;
    expect(await firstStartResult).toBeInstanceOf(Error);
    expect(channel.connected).toBe(true);
    expect(received).toHaveLength(1);
    expect(getChannelInternals(channel).sessionContexts.size).toBe(1);

    firstClient.emit('disconnected');
    expect(channel.connected).toBe(true);
    await channel.stop();
  });

  it('validates a webhook signature and normalizes its message', () => {
    const { channel } = createChannel('webhook');
    const received: RemoteMessage[] = [];
    channel.onMessage((message) => received.push(message));
    const timestamp = String(Date.now());
    const sign = createHmac('sha256', 'app-secret')
      .update(`${timestamp}\napp-secret`)
      .digest('base64');
    const body = JSON.stringify({
      conversationType: '1',
      msgId: 'webhook-msg',
      msgtype: 'text',
      text: { content: 'from webhook' },
      senderStaffId: 'webhook-user',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=secret',
    });

    const result = channel.handleWebhook({ Timestamp: timestamp, Sign: sign }, body);

    expect(result).toEqual({ status: 200, data: {} });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: 'webhook-msg',
      channelId: 'dm:webhook-user',
      content: { type: 'text', text: 'from webhook' },
    });
  });

  it('rejects unsigned, forged, expired, and malformed webhook requests', () => {
    const { channel } = createChannel('webhook');
    const currentTimestamp = String(Date.now());
    const currentSign = createHmac('sha256', 'app-secret')
      .update(`${currentTimestamp}\napp-secret`)
      .digest('base64');
    const staleTimestamp = String(Date.now() - 60 * 60 * 1000 - 1);
    const staleSign = createHmac('sha256', 'app-secret')
      .update(`${staleTimestamp}\napp-secret`)
      .digest('base64');

    expect(channel.handleWebhook({}, '{}').status).toBe(401);
    expect(
      channel.handleWebhook({ timestamp: currentTimestamp, sign: 'forged' }, '{}').status
    ).toBe(401);
    expect(channel.handleWebhook({ timestamp: staleTimestamp, sign: staleSign }, '{}').status).toBe(
      401
    );
    expect(
      channel.handleWebhook({ timestamp: currentTimestamp, sign: currentSign }, '{bad').status
    ).toBe(400);
  });

  it('does not expose the webhook receiver while configured for Stream', () => {
    const { channel } = createChannel('stream');
    expect(channel.handleWebhook({}, '{}')).toEqual({
      status: 409,
      data: { error: 'DingTalk webhook mode is not enabled' },
    });
  });

  it('prefers the session webhook and falls back to group OpenAPI', async () => {
    const { channel, api } = createChannel();
    getChannelInternals(channel).sessionContexts.set('group:cid-group', {
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=secret',
      expiresAt: Date.now() + 60_000,
      robotCode: 'event-robot',
    });

    await channel.send({
      channelType: 'dingtalk',
      channelId: 'group:cid-group',
      content: { type: 'markdown', markdown: '# Result\nDone' },
    });
    expect(api.sendSessionWebhook).toHaveBeenCalledTimes(1);
    expect(api.sendProactive).not.toHaveBeenCalled();

    api.sendSessionWebhook.mockRejectedValueOnce(new Error('expired'));
    await channel.send({
      channelType: 'dingtalk',
      channelId: 'group:cid-group',
      content: { type: 'text', text: 'fallback' },
    });
    expect(api.sendProactive).toHaveBeenCalledWith(
      { kind: 'group', id: 'cid-group' },
      'robot-code',
      { kind: 'text', text: 'fallback' }
    );
  });

  it('splits long Chinese messages on UTF-8 character boundaries', async () => {
    const { channel, api } = createChannel();
    await channel.send({
      channelType: 'dingtalk',
      channelId: 'dm:staff-1',
      content: { type: 'text', text: '测'.repeat(3_000) },
    });

    expect(api.sendProactive.mock.calls.length).toBeGreaterThan(1);
    for (const call of api.sendProactive.mock.calls) {
      const content = call[2] as { text: string };
      expect(Buffer.byteLength(content.text, 'utf8')).toBeLessThanOrEqual(3_500);
      expect(content.text).not.toContain('\uFFFD');
    }
  });
});
