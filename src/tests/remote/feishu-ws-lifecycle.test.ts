import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => {
  class FakeWSClient {
    static instances: FakeWSClient[] = [];

    private resolveStartPromise?: () => void;
    private readyState = 0;
    readonly close = vi.fn(() => {
      this.readyState = 3;
    });
    readonly wsConfig = {
      getWSInstance: () => (this.readyState === 1 ? { readyState: 1 } : null),
    };

    constructor() {
      FakeWSClient.instances.push(this);
    }

    async start(): Promise<void> {
      await new Promise<void>((resolve) => {
        this.resolveStartPromise = () => {
          this.readyState = 1;
          resolve();
        };
      });
    }

    resolveStart(): void {
      this.resolveStartPromise?.();
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
    sdkMocks.FakeWSClient.instances.length = 0;
  });

  it('reports connected only after the SDK start promise and socket are ready', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    const connected = vi.fn();
    client.on('connected', connected);
    client.on('error', vi.fn());

    const startPromise = client.start();
    const sdkClient = await waitForSDKInstance(0);

    expect(client.isConnected()).toBe(false);
    expect(connected).not.toHaveBeenCalled();

    sdkClient.resolveStart();
    await startPromise;

    expect(client.isConnected()).toBe(true);
    expect(connected).toHaveBeenCalledOnce();
  });

  it('closes an SDK connection that finishes after stop was requested', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    client.on('error', vi.fn());

    const startPromise = client.start();
    const sdkClient = await waitForSDKInstance(0);

    let stopCompleted = false;
    const stopPromise = client.stop().then(() => {
      stopCompleted = true;
    });
    await Promise.resolve();
    expect(stopCompleted).toBe(false);

    sdkClient.resolveStart();

    await expect(startPromise).rejects.toThrow('start cancelled');
    await stopPromise;
    expect(client.isConnected()).toBe(false);
    expect(sdkClient.close).toHaveBeenCalled();
  });

  it('starts a clean replacement only after the stopped start has settled', async () => {
    const client = new FeishuWSClient({ appId: 'app-id', appSecret: 'app-secret' });
    client.on('error', vi.fn());

    const firstStart = client.start();
    const firstSDKClient = await waitForSDKInstance(0);
    const stopPromise = client.stop();
    firstSDKClient.resolveStart();
    await expect(firstStart).rejects.toThrow('start cancelled');
    await stopPromise;

    const secondStart = client.start();
    const secondSDKClient = await waitForSDKInstance(1);
    secondSDKClient.resolveStart();
    await secondStart;

    expect(client.isConnected()).toBe(true);
    expect(secondSDKClient.close).not.toHaveBeenCalled();
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
