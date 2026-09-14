import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock, Session } from '../../renderer/types/index';
import type { AgentExecutor } from '../../main/remote/remote-manager';
import type { MessageRouter } from '../../main/remote/message-router';
import type { RemoteMessage, RemoteResponse } from '../../main/remote/types';

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../main/remote/gateway', () => ({
  RemoteGateway: class {},
}));

vi.mock('../../main/remote/channels/feishu', () => ({
  FeishuChannel: class {},
}));

vi.mock('../../main/remote/channels/slack', () => ({
  SlackChannel: class {},
}));

vi.mock('../../main/remote/remote-config-store', () => ({
  remoteConfigStore: {},
}));

vi.mock('../../main/remote/tunnel-manager', () => ({
  tunnelManager: {},
  TunnelStatus: {},
}));

import { RemoteManager } from '../../main/remote/remote-manager';

type RemoteManagerInternals = {
  executeAgent(
    sessionId: string,
    prompt: string,
    content: ContentBlock[],
    workingDirectory: string | undefined,
    channelType: 'feishu',
    channelId: string,
    senderId: string
  ): Promise<void>;
  reverseSessionIdMapping: Map<string, string>;
  sessionIdMapping: Map<string, string>;
  sessionChannelMapping: Map<string, { channelType: string; channelId: string }>;
  sessionOwnerMapping: Map<string, string>;
  messageRouter: MessageRouter;
  gateway?: { sendResponse(response: RemoteResponse): Promise<void> };
  responseBuffers: Map<
    string,
    {
      items: Array<{
        text: string;
        channelInfo: {
          channelType: string;
          channelId: string;
          replyTo?: string;
          language?: string;
        };
      }>;
      lastSent: number;
      toolSteps: string[];
      retryCount: number;
    }
  >;
  sentMessageKeys: Map<string, Set<string>>;
  performResponseFlush(actualSessionId: string): Promise<boolean>;
};

function asInternals(manager: RemoteManager): RemoteManagerInternals {
  return manager as unknown as RemoteManagerInternals;
}

describe('RemoteManager remote session lifecycle', () => {
  let manager: RemoteManager;
  let startSession: ReturnType<typeof vi.fn<AgentExecutor['startSession']>>;
  let continueSession: ReturnType<typeof vi.fn<AgentExecutor['continueSession']>>;

  beforeEach(() => {
    manager = new RemoteManager();
    startSession = vi.fn(async () => ({ id: 'actual-session-1' }) as Session);
    continueSession = vi.fn(async () => undefined);

    manager.setAgentExecutor({
      startSession,
      continueSession,
      stopSession: vi.fn(async () => undefined),
    });
  });

  it('continues the same actual session after idle response state is cleared', async () => {
    const internals = asInternals(manager);

    await internals.executeAgent(
      'remote-session-1',
      'first message',
      [],
      '/tmp/workspace',
      'feishu',
      'chat-1',
      'user-1'
    );

    await manager.clearSessionBuffer('actual-session-1');

    expect(internals.reverseSessionIdMapping.get('remote-session-1')).toBe('actual-session-1');
    expect(internals.sessionIdMapping.get('actual-session-1')).toBe('remote-session-1');

    await internals.executeAgent(
      'remote-session-1',
      'second message',
      [],
      '/tmp/workspace',
      'feishu',
      'chat-1',
      'user-1'
    );

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(continueSession).toHaveBeenCalledOnce();
    expect(continueSession).toHaveBeenCalledWith(
      'actual-session-1',
      'second message',
      [],
      '/tmp/workspace'
    );
  });

  it('creates a new actual session when a remote session has no reverse mapping', async () => {
    const internals = asInternals(manager);

    await internals.executeAgent(
      'remote-session-without-mapping',
      'recover this message',
      [],
      undefined,
      'feishu',
      'chat-1',
      'user-1'
    );

    expect(startSession).toHaveBeenCalledOnce();
    expect(internals.reverseSessionIdMapping.get('remote-session-without-mapping')).toBe(
      'actual-session-1'
    );
  });

  it('clears both router and manager mappings when explicitly clearing a remote session', async () => {
    const internals = asInternals(manager);

    await internals.executeAgent(
      'remote-session-1',
      'first message',
      [],
      undefined,
      'feishu',
      'chat-1',
      'user-1'
    );

    expect(manager.clearRemoteSession('remote-session-1')).toBe(true);
    expect(internals.reverseSessionIdMapping.has('remote-session-1')).toBe(false);
    expect(internals.sessionIdMapping.has('actual-session-1')).toBe(false);
  });

  it('clears router and manager indexes together when a remote session expires', async () => {
    const internals = asInternals(manager);
    const message: RemoteMessage = {
      id: 'message-1',
      channelType: 'feishu',
      channelId: 'chat-1',
      sender: { id: 'user-1', name: 'User 1', isBot: false },
      content: { type: 'text', text: 'hello' },
      timestamp: Date.now(),
      isGroup: false,
      isMentioned: false,
    };

    await internals.messageRouter.routeMessage(message);
    const [mapping] = internals.messageRouter.getAllSessionMappings();
    expect(mapping).toBeDefined();
    mapping.lastActiveAt = 0;

    expect(internals.messageRouter.cleanupStaleSessions(1)).toBe(1);
    expect(internals.messageRouter.getAllSessionMappings()).toHaveLength(0);
    expect(internals.reverseSessionIdMapping.has(mapping.sessionId)).toBe(false);
    expect(internals.sessionIdMapping.has('actual-session-1')).toBe(false);
    expect(internals.sessionChannelMapping.has(mapping.sessionId)).toBe(false);
    expect(internals.sessionOwnerMapping.has(mapping.sessionId)).toBe(false);
  });

  it('does not drop distinct response texts that collide under the old 32-bit hash', async () => {
    const internals = asInternals(manager);
    const sendResponse = vi.fn(async () => undefined);
    internals.gateway = { sendResponse };
    internals.sessionIdMapping.set('actual-session-1', 'remote-session-1');
    internals.sessionChannelMapping.set('remote-session-1', {
      channelType: 'feishu',
      channelId: 'chat-1',
    });

    await manager.sendResponseToChannel('actual-session-1', 'Aa', true);
    await manager.sendResponseToChannel('actual-session-1', 'BB', true);

    expect(sendResponse).toHaveBeenCalledTimes(2);
  });

  it('deduplicates by stable renderer message ID', async () => {
    const internals = asInternals(manager);
    const sendResponse = vi.fn(async () => undefined);
    internals.gateway = { sendResponse };
    internals.sessionIdMapping.set('actual-session-1', 'remote-session-1');
    internals.sessionChannelMapping.set('remote-session-1', {
      channelType: 'feishu',
      channelId: 'chat-1',
    });

    await manager.sendResponseToChannel('actual-session-1', 'first copy', true, 'message-1');
    await manager.sendResponseToChannel('actual-session-1', 'duplicate event', true, 'message-1');

    expect(sendResponse).toHaveBeenCalledOnce();
  });

  it('evicts only the oldest deduplication key when the per-turn limit is reached', async () => {
    const internals = asInternals(manager);
    const sendResponse = vi.fn(async () => undefined);
    internals.gateway = { sendResponse };
    internals.sessionIdMapping.set('actual-session-1', 'remote-session-1');
    internals.sessionChannelMapping.set('remote-session-1', {
      channelType: 'feishu',
      channelId: 'chat-1',
    });
    internals.sentMessageKeys.set(
      'actual-session-1',
      new Set(Array.from({ length: 500 }, (_, index) => `message:message-${index}`))
    );

    await manager.sendResponseToChannel('actual-session-1', 'new response', true, 'message-500');
    await manager.sendResponseToChannel(
      'actual-session-1',
      'recent duplicate',
      true,
      'message-499'
    );

    const keys = internals.sentMessageKeys.get('actual-session-1')!;
    expect(keys).toHaveLength(500);
    expect(keys.has('message:message-0')).toBe(false);
    expect(keys.has('message:message-499')).toBe(true);
    expect(keys.has('message:message-500')).toBe(true);
    expect(sendResponse).toHaveBeenCalledOnce();
  });

  it('retains buffered text after a transient send failure and removes it after retry success', async () => {
    const internals = asInternals(manager);
    const sendResponse = vi
      .fn<(response: RemoteResponse) => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    internals.gateway = { sendResponse };
    internals.sessionIdMapping.set('actual-session-1', 'remote-session-1');
    internals.sessionChannelMapping.set('remote-session-1', {
      channelType: 'feishu',
      channelId: 'chat-1',
    });

    await manager.sendResponseToChannel(
      'actual-session-1',
      'important response',
      false,
      'message-1'
    );

    expect(await internals.performResponseFlush('actual-session-1')).toBe(false);
    expect(
      internals.responseBuffers.get('actual-session-1')?.items.map((item) => item.text)
    ).toEqual(['important response']);

    expect(await internals.performResponseFlush('actual-session-1')).toBe(true);
    expect(internals.responseBuffers.get('actual-session-1')?.items).toEqual([]);

    manager.clearRemoteSession('remote-session-1');
  });
});
