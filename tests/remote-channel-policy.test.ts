import { describe, expect, it, vi } from 'vitest';
import { RemoteGateway } from '../src/main/remote/gateway';
import type { MessageRouter } from '../src/main/remote/message-router';
import type { RemoteMessage } from '../src/main/remote/types';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const router = {
  onResponse: vi.fn(),
  getActiveSessionCount: vi.fn(() => 0),
} as unknown as MessageRouter;

interface RemoteGatewayInternals {
  checkAuthorization(message: RemoteMessage): Promise<boolean>;
  shouldProcessGroupMessage(message: RemoteMessage): boolean;
}

function getGatewayInternals(gateway: RemoteGateway): RemoteGatewayInternals {
  return gateway as unknown as RemoteGatewayInternals;
}

function message(channelType: 'feishu' | 'dingtalk' | 'wecom', senderId: string): RemoteMessage {
  return {
    id: 'message-1',
    channelType,
    channelId: channelType === 'feishu' ? 'chat-1' : 'dm:user',
    sender: { id: senderId, isBot: false },
    content: { type: 'text', text: 'hello' },
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: false,
  };
}

describe('RemoteGateway channel policies', () => {
  it('evaluates Feishu, DingTalk, and WeCom DM policies independently', async () => {
    const gateway = new RemoteGateway(
      {
        enabled: true,
        port: 18789,
        bind: '127.0.0.1',
        auth: { mode: 'allowlist', allowlist: [] },
      },
      router,
      {
        feishu: {
          type: 'feishu',
          appId: 'id',
          appSecret: 'secret',
          dm: { policy: 'open' },
        },
        dingtalk: {
          type: 'dingtalk',
          appKey: 'key',
          appSecret: 'secret',
          dm: { policy: 'allowlist', allowFrom: ['ding-user'] },
        },
        wecom: {
          type: 'wecom',
          botId: 'bot-id',
          secret: 'secret',
          dm: { policy: 'allowlist', allowFrom: ['wecom-user'] },
        },
      }
    );

    const internals = getGatewayInternals(gateway);
    await expect(internals.checkAuthorization(message('feishu', 'any-user'))).resolves.toBe(true);
    await expect(internals.checkAuthorization(message('dingtalk', 'ding-user'))).resolves.toBe(
      true
    );
    await expect(internals.checkAuthorization(message('dingtalk', 'other-user'))).resolves.toBe(
      false
    );
    await expect(internals.checkAuthorization(message('wecom', 'wecom-user'))).resolves.toBe(true);
    await expect(internals.checkAuthorization(message('wecom', 'other-user'))).resolves.toBe(false);
  });

  it('honors DingTalk group mention defaults', () => {
    const gateway = new RemoteGateway(
      {
        enabled: true,
        port: 18789,
        bind: '127.0.0.1',
        auth: { mode: 'open' },
      },
      router,
      {
        dingtalk: {
          type: 'dingtalk',
          appKey: 'key',
          appSecret: 'secret',
          dm: { policy: 'open' },
          defaultGroupSettings: { requireMention: false },
        },
      }
    );
    const groupMessage = {
      ...message('dingtalk', 'user'),
      channelId: 'group:cid-1',
      isGroup: true,
      isMentioned: false,
    };

    expect(getGatewayInternals(gateway).shouldProcessGroupMessage(groupMessage)).toBe(true);
  });

  it('keeps paired users authorized after switching a channel to allowlist mode', async () => {
    const gateway = new RemoteGateway(
      {
        enabled: true,
        port: 18789,
        bind: '127.0.0.1',
        auth: { mode: 'allowlist', allowlist: [] },
      },
      router,
      {
        dingtalk: {
          type: 'dingtalk',
          appKey: 'key',
          appSecret: 'secret',
          dm: { policy: 'allowlist' },
        },
      }
    );
    gateway.restorePairedUser({
      userId: 'paired-user',
      channelType: 'dingtalk',
      pairedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    await expect(
      getGatewayInternals(gateway).checkAuthorization(message('dingtalk', 'paired-user'))
    ).resolves.toBe(true);
  });
});
