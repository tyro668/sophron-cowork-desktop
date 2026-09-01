import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const config = {
    gateway: { enabled: false },
    channels: {
      feishu: {
        type: 'feishu' as const,
        enabled: undefined as boolean | undefined,
        appId: 'app-id',
        appSecret: 'app-secret',
        dm: { policy: 'open' as const },
      },
    },
  };
  let setChannelEnabledError: Error | undefined;
  return {
    config,
    setChannelEnabled: vi.fn((_type: 'feishu', enabled: boolean) => {
      if (setChannelEnabledError) throw setChannelEnabledError;
      mocks.config.channels.feishu.enabled = enabled;
    }),
    setSetChannelEnabledError: (error?: Error) => {
      setChannelEnabledError = error;
    },
  };
});

vi.mock('../../main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: vi.fn(() => mocks.config),
    getPairedUsers: vi.fn(() => []),
    setChannelEnabled: mocks.setChannelEnabled,
  },
}));

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { RemoteManager } from '../../main/remote/remote-manager';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('RemoteManager per-channel state', () => {
  beforeEach(() => {
    mocks.config.channels.feishu.enabled = undefined;
    mocks.setSetChannelEnabledError();
    mocks.setChannelEnabled.mockClear();
  });

  it('treats a legacy channel without enabled as enabled while the service is stopped', () => {
    const manager = new RemoteManager();

    expect(manager.getStatus().channels).toContainEqual({
      type: 'feishu',
      enabled: true,
      connected: false,
    });
  });

  it('persists and applies a single-channel toggle without restarting the manager', async () => {
    const manager = new RemoteManager();
    const gateway = {
      setChannelEnabled: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({
        running: true,
        channels: [],
        activeSessions: 0,
        pendingPairings: 0,
      })),
    };
    (manager as unknown as { gateway: typeof gateway }).gateway = gateway;

    await manager.setChannelEnabled('feishu', false);

    expect(mocks.setChannelEnabled).toHaveBeenCalledWith('feishu', false);
    expect(gateway.setChannelEnabled).toHaveBeenCalledWith('feishu', false);
    expect(mocks.config.channels.feishu.enabled).toBe(false);
  });

  it('does not cancel interactions or touch the gateway when persistence fails', async () => {
    const manager = new RemoteManager();
    const gateway = {
      setChannelEnabled: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({
        running: true,
        channels: [],
        activeSessions: 0,
        pendingPairings: 0,
      })),
    };
    const cancelPending = vi.fn(async () => []);
    (manager as unknown as { gateway: typeof gateway }).gateway = gateway;
    (
      manager as unknown as {
        cancelPendingInteractionsForChannel: typeof cancelPending;
      }
    ).cancelPendingInteractionsForChannel = cancelPending;
    mocks.setSetChannelEnabledError(new Error('disk write failed'));

    await expect(manager.setChannelEnabled('feishu', false)).rejects.toThrow('disk write failed');

    expect(cancelPending).not.toHaveBeenCalled();
    expect(gateway.setChannelEnabled).not.toHaveBeenCalled();
    expect(mocks.config.channels.feishu.enabled).toBeUndefined();
  });

  it('serializes notification work so the latest requested state wins', async () => {
    const manager = new RemoteManager();
    const notificationStarted = createDeferred();
    const releaseNotification = createDeferred();
    const gateway = {
      setChannelEnabled: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({
        running: true,
        channels: [],
        activeSessions: 0,
        pendingPairings: 0,
      })),
    };
    (manager as unknown as { gateway: typeof gateway }).gateway = gateway;
    (
      manager as unknown as {
        cancelPendingInteractionsForChannel: () => Promise<unknown[]>;
        notifyCancelledInteractions: () => Promise<void>;
      }
    ).cancelPendingInteractionsForChannel = vi.fn(async () => []);
    (
      manager as unknown as {
        notifyCancelledInteractions: () => Promise<void>;
      }
    ).notifyCancelledInteractions = vi.fn(async () => {
      notificationStarted.resolve();
      await releaseNotification.promise;
    });

    const disablePromise = manager.setChannelEnabled('feishu', false);
    await notificationStarted.promise;
    const enablePromise = manager.setChannelEnabled('feishu', true);
    await Promise.resolve();

    expect(gateway.setChannelEnabled).not.toHaveBeenCalled();
    expect(mocks.config.channels.feishu.enabled).toBe(false);

    releaseNotification.resolve();
    await Promise.all([disablePromise, enablePromise]);

    expect(gateway.setChannelEnabled.mock.calls).toEqual([
      ['feishu', false],
      ['feishu', true],
    ]);
    expect(mocks.config.channels.feishu.enabled).toBe(true);
  });

  it('preserves desired enabled state when the transport fails to start', async () => {
    mocks.config.channels.feishu.enabled = false;
    const manager = new RemoteManager();
    const gateway = {
      setChannelEnabled: vi.fn(async () => {
        throw new Error('connection failed');
      }),
      getStatus: vi.fn(() => ({
        running: true,
        channels: [
          {
            type: 'feishu' as const,
            enabled: true,
            connected: false,
            error: 'connection failed',
          },
        ],
        activeSessions: 0,
        pendingPairings: 0,
      })),
    };
    (manager as unknown as { gateway: typeof gateway }).gateway = gateway;

    await expect(manager.setChannelEnabled('feishu', true)).rejects.toThrow('connection failed');

    expect(mocks.config.channels.feishu.enabled).toBe(true);
    expect(manager.getChannelControlState('feishu')).toEqual({
      type: 'feishu',
      desiredEnabled: true,
      connected: false,
      channelError: 'connection failed',
    });
  });
});
