import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDingtalk } from '../../main/remote/channels/dingtalk/dingtalk-registration';
import { registerWecom } from '../../main/remote/channels/wecom/wecom-registration';
import { registerWechat } from '../../main/remote/channels/wechat/wechat-registration';
import type { registrationRequest } from '../../main/remote/registration-http';
import { wechatRequest, trustedWechatBaseUrl } from '../../main/remote/channels/wechat/wechat-api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('QR registration protocols', () => {
  it('exchanges the DingTalk nonce and polls the device code without leaking credentials to QR state', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ errcode: 0, nonce: 'nonce' })
      .mockResolvedValueOnce({
        errcode: 0,
        device_code: 'device',
        verification_uri_complete: 'https://login.dingtalk.com/auth',
        interval: 1,
      })
      .mockResolvedValueOnce({ errcode: 0, status: 'WAITING' })
      .mockResolvedValueOnce({
        errcode: 0,
        status: 'SUCCESS',
        client_id: 'app',
        client_secret: 'secret',
      });
    const ready = vi.fn();
    const result = registerDingtalk(
      { signal: new AbortController().signal, onQRCodeReady: ready },
      request as typeof registrationRequest
    );
    await vi.advanceTimersByTimeAsync(2001);
    expect(await result).toMatchObject({
      type: 'dingtalk',
      appKey: 'app',
      appSecret: 'secret',
      receiveMode: 'stream',
    });
    expect(request.mock.calls[1][2]).toEqual({ nonce: 'nonce' });
    expect(request.mock.calls[2][2]).toEqual({ device_code: 'device' });
    expect(ready.mock.calls[0][0]).not.toHaveProperty('device_code');
  });

  it('retrieves WeCom bot credentials from a successful scan', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: { scode: 'code & space', auth_url: 'https://work.weixin.qq.com/auth' },
      })
      .mockResolvedValueOnce({
        data: { status: 'success', bot_info: { botid: 'bot', secret: 'secret' } },
      });
    const result = registerWecom(
      { signal: new AbortController().signal, onQRCodeReady: vi.fn() },
      request as typeof registrationRequest
    );
    await vi.advanceTimersByTimeAsync(3001);
    expect(await result).toMatchObject({
      type: 'wecom',
      botId: 'bot',
      secret: 'secret',
      receiveMode: 'websocket',
    });
    expect(request.mock.calls[1][0]).toContain('scode=code%20%26%20space');
  });

  it('handles WeChat phone verification and saves access limited to the scanning user', async () => {
    vi.useFakeTimers();
    let code: string | undefined = undefined;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ qrcode: 'token', qrcode_img_content: 'https://weixin.qq.com/q' })
      .mockResolvedValueOnce({ status: 'need_verifycode' })
      .mockResolvedValueOnce({
        status: 'confirmed',
        bot_token: 'secret',
        ilink_bot_id: 'bot',
        ilink_user_id: 'owner',
        baseurl: 'https://ilinkai.weixin.qq.com',
      });
    const onStatus = vi.fn();
    const result = registerWechat(
      {
        signal: new AbortController().signal,
        onQRCodeReady: vi.fn(),
        onStatus,
        takeVerifyCode: () => code,
      },
      request as typeof wechatRequest
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(onStatus).toHaveBeenCalledWith('verifying');
    code = '123456';
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({
      type: 'wechat',
      botToken: 'secret',
      dm: { policy: 'allowlist', allowFrom: ['owner'] },
    });
    expect(request.mock.calls[2][1]).toContain('verify_code=123456');
  });

  it('cancels pending polling before credentials can be saved', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValueOnce({
      data: { scode: 'code', auth_url: 'https://work.weixin.qq.com/auth' },
    });
    const result = registerWecom(
      { signal: controller.signal, onQRCodeReady: vi.fn() },
      request as typeof registrationRequest
    );
    const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await rejected;
    expect(request).toHaveBeenCalledOnce();
  });

  it('blocks token forwarding to untrusted WeChat hosts and preserves uint64 message IDs', async () => {
    expect(() => trustedWechatBaseUrl('https://ilinkai.weixin.qq.com.evil.test')).toThrow();
    expect(() => trustedWechatBaseUrl('http://ilinkai.weixin.qq.com')).toThrow();
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"ret":0,"msgs":[{"message_id":18446744073709551615}]}'));
    vi.stubGlobal('fetch', fetch);
    const result = await wechatRequest<{ msgs: Array<{ message_id: string }> }>(
      'https://ilinkai.weixin.qq.com',
      'getupdates',
      { token: 'secret', body: { get_updates_buf: '' } }
    );
    expect(result.msgs[0].message_id).toBe('18446744073709551615');
    expect(fetch.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer secret' },
    });
  });
});
