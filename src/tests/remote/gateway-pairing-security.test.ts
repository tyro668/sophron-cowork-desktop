import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageRouter } from '../../main/remote/message-router';
import type {
  GatewayConfig,
  PairingRequest,
  PairedUser,
  RemoteMessage,
  RemoteResponse,
} from '../../main/remote/types';

vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { RemoteGateway } from '../../main/remote/gateway';

type GatewayInternals = {
  handleChannelMessage(message: RemoteMessage): Promise<void>;
  pairingRequests: Map<string, PairingRequest>;
  pairedUsers: Map<string, PairedUser>;
  channels: Map<string, { send(response: RemoteResponse): Promise<void> }>;
};

function createMessage(text: string, id: string = `message-${text}`): RemoteMessage {
  return {
    id,
    channelType: 'feishu',
    channelId: 'chat-1',
    sender: { id: 'user-1', name: 'User 1', isBot: false },
    content: { type: 'text', text },
    timestamp: Date.now(),
    isGroup: false,
    isMentioned: false,
  };
}

describe('RemoteGateway pairing security', () => {
  let gateway: RemoteGateway;
  let internals: GatewayInternals;
  let routeMessage: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn<(response: RemoteResponse) => Promise<void>>>;

  beforeEach(() => {
    routeMessage = vi.fn(async () => undefined);
    const router = {
      onResponse: vi.fn(),
      routeMessage,
    } as unknown as MessageRouter;
    const config: GatewayConfig = {
      enabled: true,
      port: 18789,
      bind: '127.0.0.1',
      auth: { mode: 'pairing' },
    };

    gateway = new RemoteGateway(config, router);
    internals = gateway as unknown as GatewayInternals;
    send = vi.fn(async (_response: RemoteResponse) => undefined);
    internals.channels.set('feishu', { send });
  });

  it('requires administrator approval and never accepts an echoed request code', async () => {
    await internals.handleChannelMessage(createMessage('hello', 'message-1'));

    const request = internals.pairingRequests.get('feishu:user-1');
    expect(request?.code).toMatch(/^\d{8}$/);
    expect(internals.pairedUsers.has('feishu:user-1')).toBe(false);

    await internals.handleChannelMessage(createMessage(request!.code, 'message-2'));

    expect(internals.pairedUsers.has('feishu:user-1')).toBe(false);
    expect(internals.pairingRequests.has('feishu:user-1')).toBe(true);
    expect(routeMessage).not.toHaveBeenCalled();
    expect(send.mock.calls.at(-1)?.[0].content.text).toContain('等待管理员审批');

    expect(gateway.approvePairing('feishu', 'user-1')).toBe(true);
    await internals.handleChannelMessage(createMessage('authorized message', 'message-3'));
    expect(routeMessage).toHaveBeenCalledOnce();
  });

  it('limits repeated new pairing requests after rejection', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await internals.handleChannelMessage(createMessage(`request-${attempt}`));
      expect(gateway.rejectPairing('feishu', 'user-1')).toBe(true);
    }

    await internals.handleChannelMessage(createMessage('request-4'));

    expect(internals.pairingRequests.has('feishu:user-1')).toBe(false);
    expect(send.mock.calls.at(-1)?.[0].content.text).toContain('申请过于频繁');
  });

  it('propagates programmatic channel send failures to the response owner', async () => {
    send.mockRejectedValueOnce(new Error('temporary Feishu failure'));

    await expect(
      gateway.sendResponse({
        channelType: 'feishu',
        channelId: 'chat-1',
        content: { type: 'text', text: 'response' },
      })
    ).rejects.toThrow('temporary Feishu failure');
  });
});
