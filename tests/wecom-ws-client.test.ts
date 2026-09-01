import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WecomWsClient } from '../src/main/remote/channels/wecom/wecom-ws-client';

const sdk = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const instances: MockSdkClient[] = [];

  class MockAuthFailureError extends Error {
    readonly code = 'WS_AUTH_FAILURE_EXHAUSTED';
  }

  class MockSdkClient {
    isConnected = false;
    connect = vi.fn(() => this);
    disconnect = vi.fn(() => {
      this.isConnected = false;
    });
    replyStream = vi.fn(async () => ({}));
    sendMessage = vi.fn(async () => ({}));
    private readonly listeners = new Map<string, Set<Listener>>();

    constructor(readonly options: Record<string, unknown>) {
      instances.push(this);
    }

    on(event: string, listener: Listener) {
      const listeners = this.listeners.get(event) || new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      if (event === 'authenticated') this.isConnected = true;
      for (const listener of this.listeners.get(event) || []) listener(...args);
    }

    removeAllListeners(): void {
      this.listeners.clear();
    }
  }

  return { MockSdkClient, MockAuthFailureError, instances };
});

vi.mock('@wecom/aibot-node-sdk', () => ({
  WSClient: sdk.MockSdkClient,
  WSAuthFailureError: sdk.MockAuthFailureError,
  generateReqId: () => 'generated-request-id',
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

describe('WecomWsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.instances.length = 0;
  });

  it('becomes ready only after WeCom authentication', async () => {
    const client = new WecomWsClient({ botId: 'bot-id', secret: 'secret' });
    let started = false;
    const start = client.start().then(() => {
      started = true;
    });
    const sdkClient = sdk.instances[0];

    expect(sdkClient.connect).toHaveBeenCalledOnce();
    expect(started).toBe(false);
    expect(client.isConnected()).toBe(false);

    sdkClient.emit('authenticated');
    await start;
    expect(started).toBe(true);
    expect(client.isConnected()).toBe(true);
    expect(sdkClient.options).toMatchObject({
      botId: 'bot-id',
      secret: 'secret',
      maxReconnectAttempts: -1,
      maxAuthFailureAttempts: 3,
    });
  });

  it('rejects exhausted authentication and ignores transient transport errors', async () => {
    const client = new WecomWsClient({ botId: 'bot-id', secret: 'bad-secret' });
    const start = client.start();
    const sdkClient = sdk.instances[0];

    sdkClient.emit('error', new Error('temporary network failure'));
    sdkClient.emit('error', new sdk.MockAuthFailureError('bad credentials'));

    await expect(start).rejects.toThrow('bad credentials');
  });

  it('cancels a pending authentication promptly on stop', async () => {
    const client = new WecomWsClient({ botId: 'bot-id', secret: 'secret' });
    const startResult = client.start().then(
      () => null,
      (error: unknown) => error
    );
    const sdkClient = sdk.instances[0];

    await client.stop();

    expect(await startResult).toBeInstanceOf(Error);
    expect(sdkClient.disconnect).toHaveBeenCalledOnce();
    expect(client.isConnected()).toBe(false);
  });

  it('uses callback replies and stable proactive targets after authentication', async () => {
    const client = new WecomWsClient({ botId: 'bot-id', secret: 'secret' });
    const start = client.start();
    const sdkClient = sdk.instances[0];
    sdkClient.emit('authenticated');
    await start;

    const frame = { headers: { req_id: 'incoming-request' }, body: {} } as never;
    await client.replyMarkdown(frame, '**done**');
    await client.sendMarkdown('user-1', 'later result');

    expect(sdkClient.replyStream).toHaveBeenCalledWith(
      frame,
      'generated-request-id',
      '**done**',
      true
    );
    expect(sdkClient.sendMessage).toHaveBeenCalledWith('user-1', {
      msgtype: 'markdown',
      markdown: { content: 'later result' },
    });
  });
});
