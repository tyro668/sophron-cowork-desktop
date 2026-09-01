import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingtalkAPI } from '../src/main/remote/channels/dingtalk/dingtalk-api';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DingtalkAPI', () => {
  it('coalesces concurrent access-token refreshes', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = new DingtalkAPI('key', 'secret');

    await expect(Promise.all([api.getAccessToken(), api.getAccessToken()])).resolves.toEqual([
      'token-1',
      'token-1',
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('routes proactive group messages to the robot group endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new DingtalkAPI('key', 'secret');

    await api.sendProactive({ kind: 'group', id: 'cid-1' }, 'robot-1', {
      kind: 'text',
      text: 'hello',
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.dingtalk.com/v1.0/robot/groupMessages/send'
    );
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      robotCode: 'robot-1',
      openConversationId: 'cid-1',
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: 'hello' }),
    });
  });

  it('rejects untrusted session webhook hosts before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const api = new DingtalkAPI('key', 'secret');

    await expect(
      api.sendSessionWebhook('https://example.com/steal', { kind: 'text', text: 'secret' })
    ).rejects.toThrow('Rejected untrusted DingTalk session webhook URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
