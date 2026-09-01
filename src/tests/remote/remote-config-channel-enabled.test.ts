import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const get = vi.fn((path: string, fallback?: unknown) => {
    const value = path.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[segment];
    }, state);
    return value ?? fallback;
  });
  const set = vi.fn((path: string, value: unknown) => {
    const segments = path.split('.');
    let target = state;
    for (const segment of segments.slice(0, -1)) {
      const existing = target[segment];
      if (!existing || typeof existing !== 'object') target[segment] = {};
      target = target[segment] as Record<string, unknown>;
    }
    target[segments.at(-1)!] = value;
  });
  return { state, store: { get, set } };
});

vi.mock('../../main/utils/store-encryption', () => ({
  createEncryptedStoreWithKeyRotation: vi.fn(() => mocks.store),
}));

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
}));

import { remoteConfigStore } from '../../main/remote/remote-config-store';

describe('RemoteConfigStore channel enabled compatibility', () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.state)) delete mocks.state[key];
    mocks.state.gateway = { enabled: true, auth: { mode: 'open' } };
    mocks.state.channels = {
      feishu: { enabled: false },
      dingtalk: { enabled: false },
      wecom: { enabled: false },
    };
    mocks.store.get.mockClear();
    mocks.store.set.mockClear();
  });

  it('does not re-enable a disabled bot when its credentials are saved', () => {
    remoteConfigStore.setFeishuConfig({
      type: 'feishu',
      appId: 'app-id',
      appSecret: 'app-secret',
      dm: { policy: 'open' },
    });
    remoteConfigStore.setDingtalkConfig({
      type: 'dingtalk',
      appKey: 'app-key',
      appSecret: 'app-secret',
      dm: { policy: 'open' },
    });
    remoteConfigStore.setWecomConfig({
      type: 'wecom',
      botId: 'bot-id',
      secret: 'secret',
      dm: { policy: 'open' },
    });

    expect(remoteConfigStore.getFeishuConfig()?.enabled).toBe(false);
    expect(remoteConfigStore.getDingtalkConfig()?.enabled).toBe(false);
    expect(remoteConfigStore.getWecomConfig()?.enabled).toBe(false);
  });

  it('defaults newly configured bots to enabled', () => {
    mocks.state.channels = {};

    remoteConfigStore.setFeishuConfig({
      type: 'feishu',
      appId: 'app-id',
      appSecret: 'app-secret',
      dm: { policy: 'open' },
    });
    remoteConfigStore.setDingtalkConfig({
      type: 'dingtalk',
      appKey: 'app-key',
      appSecret: 'app-secret',
      dm: { policy: 'open' },
    });
    remoteConfigStore.setWecomConfig({
      type: 'wecom',
      botId: 'bot-id',
      secret: 'secret',
      dm: { policy: 'open' },
    });

    expect(remoteConfigStore.getFeishuConfig()?.enabled).toBe(true);
    expect(remoteConfigStore.getDingtalkConfig()?.enabled).toBe(true);
    expect(remoteConfigStore.getWecomConfig()?.enabled).toBe(true);
  });

  it('uses an explicitly supplied enabled state', () => {
    remoteConfigStore.setFeishuConfig({
      type: 'feishu',
      enabled: true,
      appId: 'app-id',
      appSecret: 'app-secret',
      dm: { policy: 'open' },
    });

    expect(remoteConfigStore.getFeishuConfig()?.enabled).toBe(true);
  });
});
