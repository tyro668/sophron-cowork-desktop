import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingtalkStreamClient } from '../src/main/remote/channels/dingtalk/dingtalk-stream-client';

const streamSdk = vi.hoisted(() => {
  type Callback = (message: {
    headers: { messageId: string };
    data: string;
  }) => void | Promise<void>;

  const clients: MockDWClient[] = [];

  class MockDWClient {
    connected = false;
    registered = false;
    callback?: Callback;
    private resolveConnect?: () => void;
    readonly disconnect = vi.fn(() => {
      this.connected = false;
      this.resolveConnect?.();
    });
    readonly socketCallBackResponse = vi.fn();

    constructor(_config: unknown) {
      clients.push(this);
    }

    registerCallbackListener(_topic: string, callback: Callback) {
      this.callback = callback;
      return this;
    }

    connect(): Promise<void> {
      return new Promise((resolve) => {
        this.resolveConnect = resolve;
      });
    }

    finishConnect(): void {
      this.connected = true;
      this.resolveConnect?.();
    }

    async deliver(messageId: string, data: string): Promise<void> {
      await this.callback?.({ headers: { messageId }, data });
    }
  }

  return { MockDWClient, clients };
});

vi.mock('dingtalk-stream', () => ({
  DWClient: streamSdk.MockDWClient,
  TOPIC_ROBOT: 'robot',
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

interface StreamSocketState {
  connected: boolean;
  registered?: boolean;
}

interface StreamCallbackClient {
  socketCallBackResponse(messageId: string, response: { success: boolean }): void;
}

interface StreamCallbackMessage {
  headers: { messageId: string };
  data: string;
}

interface DingtalkStreamClientInternals {
  client?: StreamSocketState;
  stopped: boolean;
  waitUntilConnected(client: StreamSocketState): Promise<void>;
  handleRobotCallback(client: StreamCallbackClient, message: StreamCallbackMessage): Promise<void>;
}

function getStreamInternals(stream: DingtalkStreamClient): DingtalkStreamClientInternals {
  return stream as unknown as DingtalkStreamClientInternals;
}

describe('DingtalkStreamClient callback acknowledgement', () => {
  afterEach(() => vi.useRealTimers());

  it('makes concurrent start callers wait for the same connection attempt', async () => {
    streamSdk.clients.length = 0;
    const stream = new DingtalkStreamClient({ appKey: 'key', appSecret: 'secret' });

    const firstStart = stream.start();
    const secondStart = stream.start();
    expect(streamSdk.clients).toHaveLength(1);
    expect(stream.isConnected()).toBe(false);

    streamSdk.clients[0].finishConnect();
    await Promise.all([firstStart, secondStart]);
    expect(stream.isConnected()).toBe(true);
    await stream.stop();
  });

  it('isolates a replacement lifecycle from a late completion and stale callback', async () => {
    vi.useFakeTimers();
    streamSdk.clients.length = 0;
    const stream = new DingtalkStreamClient({ appKey: 'key', appSecret: 'secret' });
    const received = vi.fn();
    const disconnected = vi.fn();
    stream.on('message', received);
    stream.on('disconnected', disconnected);

    const firstStartResult = stream.start().then(
      () => null,
      (error: unknown) => error
    );
    const firstClient = streamSdk.clients[0];
    expect(firstClient).toBeTruthy();

    const stopping = stream.stop();
    const secondStart = stream.start();
    const secondClient = streamSdk.clients[1];
    expect(secondClient).toBeTruthy();
    secondClient.finishConnect();

    await secondStart;
    await stopping;
    expect(await firstStartResult).toBeInstanceOf(Error);
    expect(stream.isConnected()).toBe(true);

    await firstClient.deliver(
      'stale-message',
      JSON.stringify({ msgId: 'stale', msgtype: 'text', text: { content: 'ignore' } })
    );
    await secondClient.deliver(
      'current-message',
      JSON.stringify({ msgId: 'current', msgtype: 'text', text: { content: 'accept' } })
    );
    expect(received).toHaveBeenCalledTimes(1);
    expect(secondClient.socketCallBackResponse).toHaveBeenCalledOnce();
    expect(firstClient.socketCallBackResponse).not.toHaveBeenCalled();

    secondClient.connected = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(disconnected).toHaveBeenCalledOnce();

    await stream.stop();
  });

  it('treats an open SDK socket as connected without requiring the internal registered flag', async () => {
    const stream = new DingtalkStreamClient({ appKey: 'key', appSecret: 'secret' });
    const client = { connected: true, registered: false };
    const internals = getStreamInternals(stream);
    internals.client = client;
    internals.stopped = false;

    await expect(internals.waitUntilConnected(client)).resolves.toBeUndefined();
    expect(stream.isConnected()).toBe(true);
  });

  it('emits a valid callback and acknowledges it exactly once', async () => {
    const stream = new DingtalkStreamClient({ appKey: 'key', appSecret: 'secret' });
    const ack = vi.fn();
    const received = vi.fn();
    stream.on('message', received);

    await getStreamInternals(stream).handleRobotCallback(
      { socketCallBackResponse: ack },
      {
        headers: { messageId: 'stream-1' },
        data: JSON.stringify({ msgId: 'robot-1', msgtype: 'text', text: { content: 'hello' } }),
      }
    );

    expect(received).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledOnce();
    expect(ack).toHaveBeenCalledWith('stream-1', { success: true });
  });

  it('acknowledges malformed poison messages without emitting them', async () => {
    const stream = new DingtalkStreamClient({ appKey: 'key', appSecret: 'secret' });
    const ack = vi.fn();
    const received = vi.fn();
    stream.on('message', received);

    await getStreamInternals(stream).handleRobotCallback(
      { socketCallBackResponse: ack },
      { headers: { messageId: 'stream-bad' }, data: '{bad json' }
    );

    expect(received).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith('stream-bad', { success: false });
  });
});
