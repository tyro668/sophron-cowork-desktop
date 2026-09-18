import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => {
  type WSClientOptions = {
    handshakeTimeoutMs?: number;
    domain?: string;
    onReady?: () => void;
    onError?: (error: Error) => void;
    onReconnecting?: () => void;
    onReconnected?: () => void;
  };

  class FakeWSClient {
    static instances: FakeWSClient[] = [];

    readonly options: WSClientOptions;
    readonly start = vi.fn(async () => undefined);
    readonly close = vi.fn();

    constructor(options: WSClientOptions) {
      this.options = options;
      FakeWSClient.instances.push(this);
    }

    triggerReady(): void {
      this.options.onReady?.();
    }

    triggerError(error: Error): void {
      this.options.onError?.(error);
    }

    triggerReconnecting(): void {
      this.options.onReconnecting?.();
    }

    triggerReconnected(): void {
      this.options.onReconnected?.();
    }
  }

  class FakeEventDispatcher {
    register(): this {
      return this;
    }
  }

  return { FakeWSClient, FakeEventDispatcher };
});

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: { Feishu: 'https://open.feishu.cn', Lark: 'https://open.larksuite.com' },
  Client: class {},
  WSClient: sdkMocks.FakeWSClient,
  EventDispatcher: sdkMocks.FakeEventDispatcher,
  LoggerLevel: { debug: 0, info: 1, warn: 2, error: 3 },
}));

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { FeishuWSClient } from '../../main/remote/channels/feishu/feishu-ws-client';
import { FeishuChannel } from '../../main/remote/channels/feishu/feishu-channel';

async function waitForSDKInstance(
  index: number
): Promise<InstanceType<typeof sdkMocks.FakeWSClient>> {
  await vi.waitFor(() => {
    expect(sdkMocks.FakeWSClient.instances[index]).toBeDefined();
  });
  return sdkMocks.FakeWSClient.instances[index];
}

describe('FeishuWSClient lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers();
    sdkMocks.FakeWSClient.instances.length = 0;
  });

  it('uses the Lark endpoint for Lark channels', async () => {
    const client = new FeishuWSClient({ appId: 'lark-id', appSecret: 'secret', brand: 'lark' });
    const started = client.start();
    const sdk = await waitForSDKInstance(0);
    expect(sdk.options.domain).toBe('https://open.larksuite.com');
    sdk.triggerReady();
    await started;
    await client.stop();
  });

  it('reports connected only after the SDK emits its public ready signal', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    const connected = vi.fn();
    client.on('connected', connected);
    client.on('error', vi.fn());

    const startPromise = client.start();
    const sdkClient = await waitForSDKInstance(0);

    expect(client.isConnected()).toBe(false);
    expect(connected).not.toHaveBeenCalled();

    expect(sdkClient.start).toHaveBeenCalledOnce();
    expect(sdkClient.options.handshakeTimeoutMs).toBe(15_000);

    sdkClient.triggerReady();
    await startPromise;

    expect(client.isConnected()).toBe(true);
    expect(connected).toHaveBeenCalledOnce();
  });

  it('cancels a pending start immediately when stop is requested', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    client.on('error', vi.fn());

    const startPromise = client.start();
    const sdkClient = await waitForSDKInstance(0);

    const stopPromise = client.stop();
    await expect(startPromise).rejects.toThrow('start cancelled');
    await stopPromise;
    expect(client.isConnected()).toBe(false);
    expect(sdkClient.close).toHaveBeenCalled();

    // A late callback from the closed SDK instance must not revive the client.
    sdkClient.triggerReady();
    expect(client.isConnected()).toBe(false);
  });

  it('ignores a stale ready callback after a replacement start', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    client.on('error', vi.fn());

    const firstStart = client.start();
    const firstSDKClient = await waitForSDKInstance(0);
    const stopPromise = client.stop();
    await expect(firstStart).rejects.toThrow('start cancelled');
    await stopPromise;

    const secondStart = client.start();
    const secondSDKClient = await waitForSDKInstance(1);

    firstSDKClient.triggerReady();
    expect(client.isConnected()).toBe(false);
    expect(secondSDKClient.close).not.toHaveBeenCalled();

    secondSDKClient.triggerReady();
    await secondStart;

    expect(client.isConnected()).toBe(true);
    expect(secondSDKClient.close).not.toHaveBeenCalled();
  });

  it('rejects the initial start when the SDK reports a terminal error', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    const errors = vi.fn();
    client.on('error', errors);

    const startPromise = client.start();
    const sdkClient = await waitForSDKInstance(0);
    sdkClient.triggerError(new Error('invalid credentials'));

    await expect(startPromise).rejects.toThrow('invalid credentials');
    expect(client.isConnected()).toBe(false);
    expect(errors).toHaveBeenCalledOnce();
    expect(sdkClient.close).toHaveBeenCalled();
    await client.stop();
  });

  it('times out when the SDK never reports ready', async () => {
    const client = new FeishuWSClient({
      appId: 'app-id',
      appSecret: 'app-secret',
      connectTimeoutMs: 5,
    });
    client.on('error', vi.fn());

    const startPromise = client.start();
    const startRejection = expect(startPromise).rejects.toThrow('connection timed out after 5ms');
    const sdkClient = await waitForSDKInstance(0);

    await startRejection;
    expect(client.isConnected()).toBe(false);
    expect(sdkClient.close).toHaveBeenCalled();
    await client.stop();
  });

  it('tracks SDK reconnecting and reconnected callbacks', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    const connected = vi.fn();
    const disconnected = vi.fn();
    client.on('connected', connected);
    client.on('disconnected', disconnected);
    client.on('error', vi.fn());

    const startPromise = client.start();
    const sdkClient = await waitForSDKInstance(0);
    sdkClient.triggerReady();
    await startPromise;

    sdkClient.triggerReconnecting();
    expect(client.isConnected()).toBe(false);
    expect(disconnected).toHaveBeenCalledOnce();

    sdkClient.triggerReconnected();
    expect(client.isConnected()).toBe(true);
    expect(connected).toHaveBeenCalledTimes(2);

    await client.stop();
  });

  it('creates only one fresh client after the SDK exhausts its reconnects', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    const errors = vi.fn();
    client.on('error', errors);

    const startPromise = client.start();
    const firstSDKClient = await waitForSDKInstance(0);
    firstSDKClient.triggerReady();
    await startPromise;

    vi.useFakeTimers();
    firstSDKClient.triggerError(new Error('reconnect exhausted'));
    firstSDKClient.triggerError(new Error('duplicate terminal error'));

    expect(client.isConnected()).toBe(false);
    expect(errors).toHaveBeenCalledOnce();
    expect(firstSDKClient.close).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    expect(sdkMocks.FakeWSClient.instances).toHaveLength(2);

    const secondSDKClient = sdkMocks.FakeWSClient.instances[1];
    secondSDKClient.triggerReady();
    await Promise.resolve();
    expect(client.isConnected()).toBe(true);

    await client.stop();
  });
});

describe('FeishuChannel lifecycle', () => {
  it('stops a retained WebSocket client even when channel status is disconnected', async () => {
    const channel = new FeishuChannel({
      type: 'feishu',
      appId: 'app-id',
      appSecret: 'app-secret',
      useWebSocket: true,
      dm: { policy: 'pairing' },
    });
    const wsClient = {
      removeAllListeners: vi.fn(),
      stop: vi.fn(async () => undefined),
    };
    const internals = channel as unknown as {
      _connected: boolean;
      wsClient?: typeof wsClient;
    };
    internals._connected = false;
    internals.wsClient = wsClient;

    await channel.stop();

    expect(wsClient.removeAllListeners).toHaveBeenCalledOnce();
    expect(wsClient.stop).toHaveBeenCalledOnce();
    expect(internals.wsClient).toBeUndefined();
  });
});
