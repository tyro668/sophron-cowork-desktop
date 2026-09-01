import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteGateway } from '../../main/remote/gateway';
import type { MessageRouter } from '../../main/remote/message-router';
import type { ChannelType, IChannel, RemoteMessage, RemoteResponse } from '../../main/remote/types';

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

function createRouter() {
  return {
    onResponse: vi.fn(),
    routeMessage: vi.fn(async () => undefined),
    getActiveSessionCount: vi.fn(() => 0),
  } as unknown as MessageRouter;
}

interface ChannelLifecycleHooks {
  beforeStart?: () => Promise<void> | void;
  beforeStop?: () => Promise<void> | void;
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createChannel(type: ChannelType, hooks: ChannelLifecycleHooks = {}) {
  let connected = false;
  let messageHandler: ((message: RemoteMessage) => void) | undefined;
  const channel: IChannel = {
    type,
    get connected() {
      return connected;
    },
    start: vi.fn(async () => {
      await hooks.beforeStart?.();
      connected = true;
    }),
    stop: vi.fn(async () => {
      await hooks.beforeStop?.();
      connected = false;
    }),
    send: vi.fn(async (_response: RemoteResponse) => undefined),
    onMessage: vi.fn((handler) => {
      messageHandler = handler;
    }),
    onError: vi.fn(),
  };
  return {
    channel,
    emitMessage(message: RemoteMessage) {
      messageHandler?.(message);
    },
  };
}

function createGateway(router: MessageRouter): RemoteGateway {
  return new RemoteGateway(
    {
      enabled: true,
      port: 0,
      bind: '127.0.0.1',
      auth: { mode: 'open' },
    },
    router
  );
}

function markGatewayRunning(gateway: RemoteGateway): void {
  (gateway as unknown as { _running: boolean })._running = true;
}

function message(type: ChannelType): RemoteMessage {
  return {
    id: `message-${type}`,
    channelType: type,
    channelId: 'dm:user-1',
    sender: { id: 'user-1', isBot: false },
    content: { type: 'text', text: 'hello' },
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: false,
  };
}

describe('RemoteGateway per-channel lifecycle', () => {
  const gateways: RemoteGateway[] = [];

  afterEach(async () => {
    await Promise.all(gateways.map((gateway) => gateway.stop()));
    gateways.length = 0;
  });

  it('does not start a persistently disabled channel', async () => {
    const gateway = createGateway(createRouter());
    gateways.push(gateway);
    const dingtalk = createChannel('dingtalk');
    gateway.registerChannel(dingtalk.channel, false);
    markGatewayRunning(gateway);

    expect(dingtalk.channel.start).not.toHaveBeenCalled();
    expect(gateway.getStatus().channels).toContainEqual({
      type: 'dingtalk',
      enabled: false,
      connected: false,
      error: undefined,
    });
  });

  it('stops only the selected channel and rejects its stale inbound messages', async () => {
    const router = createRouter();
    const gateway = createGateway(router);
    gateways.push(gateway);
    const feishu = createChannel('feishu');
    const dingtalk = createChannel('dingtalk');
    gateway.registerChannel(feishu.channel);
    gateway.registerChannel(dingtalk.channel);
    markGatewayRunning(gateway);
    await gateway.setChannelEnabled('feishu', true);
    await gateway.setChannelEnabled('dingtalk', true);

    await gateway.setChannelEnabled('dingtalk', false);
    dingtalk.emitMessage(message('dingtalk'));

    expect(dingtalk.channel.stop).toHaveBeenCalledOnce();
    expect(feishu.channel.stop).not.toHaveBeenCalled();
    expect(feishu.channel.connected).toBe(true);
    expect(router.routeMessage).not.toHaveBeenCalled();
    expect(gateway.getStatus().channels.find((item) => item.type === 'dingtalk')).toMatchObject({
      enabled: false,
      connected: false,
    });
  });

  it('waits for a pending disable before starting the same channel again', async () => {
    const stopStarted = createDeferred();
    const releaseStop = createDeferred();
    const lifecycle: string[] = [];
    const gateway = createGateway(createRouter());
    gateways.push(gateway);
    const feishu = createChannel('feishu', {
      beforeStart: () => {
        lifecycle.push('start');
      },
      beforeStop: async () => {
        lifecycle.push('stop:start');
        stopStarted.resolve();
        await releaseStop.promise;
        lifecycle.push('stop:end');
      },
    });
    gateway.registerChannel(feishu.channel);
    markGatewayRunning(gateway);
    await gateway.setChannelEnabled('feishu', true);
    lifecycle.length = 0;

    const disablePromise = gateway.setChannelEnabled('feishu', false);
    await stopStarted.promise;
    const enablePromise = gateway.setChannelEnabled('feishu', true);
    await Promise.resolve();

    expect(lifecycle).toEqual(['stop:start']);
    expect(feishu.channel.connected).toBe(true);

    releaseStop.resolve();
    await Promise.all([disablePromise, enablePromise]);

    expect(lifecycle).toEqual(['stop:start', 'stop:end', 'start']);
    expect(gateway.getStatus().channels.find((item) => item.type === 'feishu')).toMatchObject({
      enabled: true,
      connected: true,
      error: undefined,
    });
  });

  it('keeps the logical channel gate closed when transport shutdown fails', async () => {
    const router = createRouter();
    const gateway = createGateway(router);
    gateways.push(gateway);
    const feishu = createChannel('feishu', {
      beforeStop: () => {
        throw new Error('transport shutdown failed');
      },
    });
    gateway.registerChannel(feishu.channel);
    markGatewayRunning(gateway);
    await gateway.setChannelEnabled('feishu', true);

    await expect(gateway.setChannelEnabled('feishu', false)).rejects.toThrow(
      'transport shutdown failed'
    );
    feishu.emitMessage(message('feishu'));

    expect(feishu.channel.connected).toBe(true);
    expect(router.routeMessage).not.toHaveBeenCalled();
    expect(gateway.getStatus().channels.find((item) => item.type === 'feishu')).toMatchObject({
      enabled: false,
      connected: false,
    });
  });

  it('returns 503 before dispatching a webhook for a disabled channel', async () => {
    const gateway = createGateway(createRouter());
    gateways.push(gateway);
    const wecom = createChannel('wecom');
    gateway.registerChannel(wecom.channel);
    const webhookHandler = vi.fn();
    gateway.on('webhook:wecom', webhookHandler);
    markGatewayRunning(gateway);
    await gateway.setChannelEnabled('wecom', true);
    await gateway.setChannelEnabled('wecom', false);

    const request = { method: 'POST', headers: {} } as unknown as IncomingMessage;
    const state = { status: 0, body: '', writableEnded: false };
    const response = {
      get writableEnded() {
        return state.writableEnded;
      },
      writeHead(status: number) {
        state.status = status;
        return this;
      },
      end(data?: string | Buffer) {
        state.body = data?.toString() ?? '';
        state.writableEnded = true;
        return this;
      },
    } as unknown as ServerResponse;

    (
      gateway as unknown as {
        handleWebhook(req: IncomingMessage, res: ServerResponse, url: string): void;
      }
    ).handleWebhook(request, response, '/webhook/wecom');

    expect(state.status).toBe(503);
    expect(state.body).toContain('disabled or disconnected');
    expect(webhookHandler).not.toHaveBeenCalled();
  });
});
