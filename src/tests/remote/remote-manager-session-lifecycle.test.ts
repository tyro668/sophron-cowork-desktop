import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock, Message, Session } from '../../renderer/types/index';
import type { AgentExecutor } from '../../main/remote/remote-manager';

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
    senderId: string,
    onMessage: (message: Message) => void,
    onPartial: (delta: string) => void
  ): Promise<void>;
  reverseSessionIdMapping: Map<string, string>;
  sessionIdMapping: Map<string, string>;
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
    const onMessage = vi.fn();
    const onPartial = vi.fn();

    await internals.executeAgent(
      'remote-session-1',
      'first message',
      [],
      '/tmp/workspace',
      'feishu',
      'chat-1',
      'user-1',
      onMessage,
      onPartial
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
      'user-1',
      onMessage,
      onPartial
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
      'user-1',
      vi.fn(),
      vi.fn()
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
      'user-1',
      vi.fn(),
      vi.fn()
    );

    expect(manager.clearRemoteSession('remote-session-1')).toBe(true);
    expect(internals.reverseSessionIdMapping.has('remote-session-1')).toBe(false);
    expect(internals.sessionIdMapping.has('actual-session-1')).toBe(false);
  });
});
