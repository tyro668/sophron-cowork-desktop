import { afterEach, describe, expect, it, vi } from 'vitest';
import { WechatChannel } from '../../main/remote/channels/wechat/wechat-channel';
import { WechatApiError, type wechatRequest } from '../../main/remote/channels/wechat/wechat-api';

vi.mock('../../main/utils/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));
afterEach(() => vi.useRealTimers());
const config = {
  type: 'wechat' as const,
  botToken: 'secret',
  botId: 'bot',
  userId: 'owner',
  dm: { policy: 'pairing' as const },
};
const inbound = {
  message_id: '18446744073709551615',
  message_type: 1,
  message_state: 2,
  from_user_id: 'owner',
  context_token: 'reply-context',
  item_list: [{ type: 1, text_item: { text: 'Hello' } }],
};

describe('WeChat channel', () => {
  it('deduplicates inbound messages, advances the cursor and replies with the matching user context', async () => {
    const request = vi.fn(async (_base, endpoint) =>
      endpoint === 'getupdates'
        ? {
            msgs: [inbound, inbound, { ...inbound, message_id: 'bot-message', message_type: 2 }],
            get_updates_buf: 'next-cursor',
          }
        : { ret: 0 }
    );
    const channel = new WechatChannel(config, request as typeof wechatRequest);
    const received = vi.fn();
    channel.onMessage(received);
    await channel.start();
    await Promise.resolve();
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0]).toMatchObject({
      channelType: 'wechat',
      channelId: 'owner',
      content: { text: 'Hello' },
    });
    await channel.send({
      channelType: 'wechat',
      channelId: 'owner',
      content: { type: 'text', text: 'Reply' },
    });
    const send = request.mock.calls.find((call) => call[1] === 'sendmessage') as unknown as [
      string,
      string,
      { body: { msg: unknown } },
    ];
    expect(send[2].body.msg).toMatchObject({
      to_user_id: 'owner',
      context_token: 'reply-context',
      item_list: [{ type: 1, text_item: { text: 'Reply' } }],
    });
    await expect(
      channel.send({
        channelType: 'wechat',
        channelId: 'other-user',
        content: { type: 'text', text: 'no' },
      })
    ).rejects.toThrow('context unavailable');
    await vi.waitFor(
      () =>
        expect(request).toHaveBeenLastCalledWith(
          expect.any(String),
          'getupdates',
          expect.objectContaining({ body: { get_updates_buf: 'next-cursor' } })
        ),
      { timeout: 2000 }
    );
    const stop = channel.stop();
    await Promise.resolve();
    await stop;
    expect(channel.connected).toBe(false);
  });

  it('aborts an in-flight long poll on stop', async () => {
    const request = vi.fn(async (_base, endpoint, options) => {
      if (endpoint !== 'getupdates') return {};
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      );
    });
    const channel = new WechatChannel(config, request as typeof wechatRequest);
    await channel.start();
    await channel.stop();
    expect(request.mock.calls[1][2].signal.aborted).toBe(true);
    expect(channel.connected).toBe(false);
  });

  it('marks an expired session disconnected and reports a recoverable login action', async () => {
    const request = vi.fn(async (_base, endpoint) => {
      if (endpoint === 'getupdates') throw new WechatApiError(-14);
      return {};
    });
    const channel = new WechatChannel(config, request as typeof wechatRequest);
    const onError = vi.fn();
    channel.onError(onError);
    await channel.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(channel.connected).toBe(false);
    await channel.stop();
  });
});
