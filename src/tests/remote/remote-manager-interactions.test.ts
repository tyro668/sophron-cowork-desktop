import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteResponse } from '../../main/remote/types';

const tunnelManagerMock = vi.hoisted(() => ({
  stop: vi.fn(async () => undefined),
}));

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
  remoteConfigStore: {
    getAll: () => ({ gateway: { autoApproveSafeTools: false } }),
  },
}));

vi.mock('../../main/remote/tunnel-manager', () => ({
  tunnelManager: tunnelManagerMock,
  TunnelStatus: {},
}));

import { RemoteManager, type RemoteInteraction } from '../../main/remote/remote-manager';

type GatewayStub = {
  sendResponse: ReturnType<typeof vi.fn<(response: RemoteResponse) => Promise<void>>>;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

type RemoteManagerInternals = {
  gateway?: GatewayStub;
  sessionIdMapping: Map<string, string>;
  reverseSessionIdMapping: Map<string, string>;
  sessionChannelMapping: Map<string, { channelType: 'feishu'; channelId: string }>;
  sessionOwnerMapping: Map<string, string>;
  pendingInteractions: Map<string, RemoteInteraction>;
  interactionResolvers: Map<string, (response: string) => void>;
  interactionTimers: Map<string, NodeJS.Timeout>;
};

function asInternals(manager: RemoteManager): RemoteManagerInternals {
  return manager as unknown as RemoteManagerInternals;
}

function configureRemoteSession(manager: RemoteManager, gateway: GatewayStub): void {
  const internals = asInternals(manager);
  internals.gateway = gateway;
  internals.sessionIdMapping.set('actual-session-1', 'remote-session-1');
  internals.reverseSessionIdMapping.set('remote-session-1', 'actual-session-1');
  internals.sessionChannelMapping.set('remote-session-1', {
    channelType: 'feishu',
    channelId: 'chat-1',
  });
  internals.sessionOwnerMapping.set('remote-session-1', 'user-1');
}

function createGateway(): GatewayStub {
  return {
    sendResponse: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

describe('RemoteManager interaction lifecycle', () => {
  let manager: RemoteManager;

  beforeEach(() => {
    manager = new RemoteManager();
    tunnelManagerMock.stop.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the resolver before channel delivery can receive a fast reply', async () => {
    const gateway = createGateway();
    let finishSend!: () => void;
    gateway.sendResponse.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve;
        })
    );
    configureRemoteSession(manager, gateway);

    const answerPromise = manager.handleQuestionRequest('actual-session-1', 'question-1', [
      { question: '你的名字是什么？' },
    ]);

    await vi.waitFor(() => {
      expect(asInternals(manager).pendingInteractions.has('question-1')).toBe(true);
      expect(asInternals(manager).interactionResolvers.has('question-1')).toBe(true);
    });

    await expect(
      manager.handlePotentialInteractionResponse('feishu', 'chat-1', 'user-1', '小九')
    ).resolves.toBe(true);
    finishSend();

    await expect(answerPromise).resolves.toBe('{"0":["小九"]}');
    expect(asInternals(manager).interactionTimers.has('question-1')).toBe(false);
  });

  it('denies a permission request and clears all interaction state on timeout', async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    configureRemoteSession(manager, gateway);

    const permissionPromise = manager.handlePermissionRequest(
      'actual-session-1',
      'tool-use-1',
      'Bash',
      { command: 'echo test' }
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(asInternals(manager).pendingInteractions.has('tool-use-1')).toBe(true);
    expect(asInternals(manager).interactionTimers.has('tool-use-1')).toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await expect(permissionPromise).resolves.toEqual({ allow: false });
    expect(asInternals(manager).pendingInteractions.has('tool-use-1')).toBe(false);
    expect(asInternals(manager).interactionResolvers.has('tool-use-1')).toBe(false);
    expect(asInternals(manager).interactionTimers.has('tool-use-1')).toBe(false);
  });

  it('clears the resolver and timeout when channel delivery fails', async () => {
    const gateway = createGateway();
    gateway.sendResponse.mockRejectedValueOnce(new Error('delivery failed'));
    configureRemoteSession(manager, gateway);

    await expect(
      manager.handleQuestionRequest('actual-session-1', 'question-1', [{ question: '请输入答案' }])
    ).resolves.toBeNull();

    expect(asInternals(manager).pendingInteractions.has('question-1')).toBe(false);
    expect(asInternals(manager).interactionResolvers.has('question-1')).toBe(false);
    expect(asInternals(manager).interactionTimers.has('question-1')).toBe(false);
  });

  it('cancels pending interactions when the remote service is stopped', async () => {
    const gateway = createGateway();
    configureRemoteSession(manager, gateway);

    const answerPromise = manager.handleQuestionRequest('actual-session-1', 'question-1', [
      { question: '是否继续？', options: [{ label: '继续' }, { label: '停止' }] },
    ]);
    await vi.waitFor(() => {
      expect(asInternals(manager).pendingInteractions.has('question-1')).toBe(true);
    });

    await manager.stop();

    await expect(answerPromise).resolves.toBe('{}');
    expect(asInternals(manager).pendingInteractions.size).toBe(0);
    expect(asInternals(manager).interactionResolvers.size).toBe(0);
    expect(asInternals(manager).interactionTimers.size).toBe(0);
    expect(gateway.sendResponse).toHaveBeenCalledTimes(2);
    expect(gateway.stop).toHaveBeenCalledOnce();
  });

  it('preserves pending interactions across a temporary transport restart', async () => {
    const gateway = createGateway();
    configureRemoteSession(manager, gateway);

    const answerPromise = manager.handleQuestionRequest('actual-session-1', 'question-1', [
      { question: '请输入答案' },
    ]);
    await vi.waitFor(() => {
      expect(asInternals(manager).pendingInteractions.has('question-1')).toBe(true);
    });

    await manager.stop({ preserveInteractions: true });

    expect(asInternals(manager).pendingInteractions.has('question-1')).toBe(true);
    expect(asInternals(manager).interactionTimers.has('question-1')).toBe(true);
    expect(gateway.sendResponse).toHaveBeenCalledOnce();

    await expect(
      manager.handlePotentialInteractionResponse('feishu', 'chat-1', 'user-1', '继续')
    ).resolves.toBe(true);
    await expect(answerPromise).resolves.toBe('{"0":["继续"]}');
  });

  it('cancels only interactions belonging to a cleared remote session', async () => {
    const gateway = createGateway();
    configureRemoteSession(manager, gateway);

    const answerPromise = manager.handleQuestionRequest('actual-session-1', 'question-1', [
      { question: '请输入答案' },
    ]);
    await vi.waitFor(() => {
      expect(asInternals(manager).pendingInteractions.has('question-1')).toBe(true);
    });

    expect(manager.clearRemoteSession('remote-session-1')).toBe(true);

    await expect(answerPromise).resolves.toBe('{}');
    expect(asInternals(manager).pendingInteractions.size).toBe(0);
    expect(asInternals(manager).interactionResolvers.size).toBe(0);
    expect(asInternals(manager).interactionTimers.size).toBe(0);
  });
});
