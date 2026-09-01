import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: () => ({ gateway: { enabled: false }, channels: {} }),
    isEnabled: () => false,
    getPairedUsers: () => [],
  },
}));

import { RemoteManager } from '../src/main/remote/remote-manager';
import { NonRetryableChannelError } from '../src/main/remote/channels/channel-base';
import type { RemoteMessage } from '../src/main/remote/types';
import type { Session } from '../src/renderer/types';

interface RemoteManagerInternals {
  gateway: { sendResponse: (response: unknown) => Promise<void> };
  messageRouter: { routeMessage: (message: RemoteMessage) => Promise<void> };
  sessionChannelMapping: Map<string, { replyTo?: string }>;
  responseBuffers: Map<string, unknown>;
  sendTimers: Map<string, NodeJS.Timeout>;
}

function internalsOf(manager: RemoteManager): RemoteManagerInternals {
  return manager as unknown as RemoteManagerInternals;
}

function buildMessage(id: string, text: string): RemoteMessage {
  return {
    id,
    channelType: 'wecom',
    channelId: 'dm:user-1',
    sender: { id: 'user-1', isBot: false },
    content: { type: 'text', text },
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: false,
  };
}

describe('remote webhook reply correlation', () => {
  it('propagates the inbound message ID to outbound responses', async () => {
    const manager = new RemoteManager();
    const sendResponse = vi.fn(async () => {});
    internalsOf(manager).gateway = { sendResponse };
    manager.setAgentExecutor({
      startSession: async () => ({ id: 'actual-session-1' }) as Session,
      continueSession: async () => {},
      stopSession: async () => {},
    });

    const router = internalsOf(manager).messageRouter;
    await router.routeMessage(buildMessage('wecom-message-1', 'run task'));
    await manager.sendResponseToChannel('actual-session-1', 'task result', true);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'wecom',
        channelId: 'dm:user-1',
        replyTo: 'wecom-message-1',
      })
    );
  });

  it('does not replace reply context until the previous agent turn is idle', async () => {
    const manager = new RemoteManager();
    const idleResolvers: Array<() => void> = [];
    const continueSession = vi.fn(async () => {});
    manager.setAgentExecutor({
      startSession: async () => ({ id: 'actual-session-1' }) as Session,
      continueSession,
      waitForSessionIdle: async () =>
        new Promise<void>((resolve) => {
          idleResolvers.push(resolve);
        }),
      stopSession: async () => {},
    });

    const router = internalsOf(manager).messageRouter;
    const firstRoute = router.routeMessage(buildMessage('wecom-message-1', 'first task'));
    await vi.waitFor(() => expect(idleResolvers).toHaveLength(1));

    await router.routeMessage(buildMessage('wecom-message-2', 'second task'));
    const sessionChannelMapping = internalsOf(manager).sessionChannelMapping;
    expect([...sessionChannelMapping.values()][0]?.replyTo).toBe('wecom-message-1');
    expect(continueSession).not.toHaveBeenCalled();

    idleResolvers.shift()!();
    await vi.waitFor(() => expect(continueSession).toHaveBeenCalledTimes(1));
    expect([...sessionChannelMapping.values()][0]?.replyTo).toBe('wecom-message-2');

    await vi.waitFor(() => expect(idleResolvers).toHaveLength(1));
    idleResolvers.shift()!();
    await firstRoute;
  });

  it('keeps the captured replyTo when a buffered response flushes after a later turn starts', async () => {
    const manager = new RemoteManager();
    const sendResponse = vi.fn(async () => {});
    internalsOf(manager).gateway = { sendResponse };
    manager.setAgentExecutor({
      startSession: async () => ({ id: 'actual-session-1' }) as Session,
      continueSession: async () => {},
      stopSession: async () => {},
    });

    const router = internalsOf(manager).messageRouter;
    await router.routeMessage(buildMessage('wecom-message-1', 'first task'));
    await manager.sendResponseToChannel('actual-session-1', 'first result');

    await router.routeMessage(buildMessage('wecom-message-2', 'second task'));
    await manager.clearSessionBuffer('actual-session-1');

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'wecom-message-1' })
    );
  });

  it('does not retry a one-time channel response with an ambiguous delivery outcome', async () => {
    const manager = new RemoteManager();
    const sendResponse = vi.fn(async () => {
      throw new NonRetryableChannelError('one-time response outcome is unknown');
    });
    const internals = internalsOf(manager);
    internals.gateway = { sendResponse };
    manager.setAgentExecutor({
      startSession: async () => ({ id: 'actual-session-1' }) as Session,
      continueSession: async () => {},
      stopSession: async () => {},
    });

    await internals.messageRouter.routeMessage(buildMessage('wecom-message-1', 'run task'));
    await manager.sendResponseToChannel('actual-session-1', 'task result');
    await manager.clearSessionBuffer('actual-session-1');

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(internals.responseBuffers.has('actual-session-1')).toBe(false);
    expect(internals.sendTimers.has('actual-session-1')).toBe(false);
  });
});
