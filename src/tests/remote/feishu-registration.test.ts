import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { registerFeishuApp } from '../../main/remote/channels/feishu/feishu-registration';

afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('Feishu registration transport', () => {
  it('begins Lark registration on its own accounts domain', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          device_code: 'device',
          verification_uri_complete: 'https://accounts.larksuite.com/auth',
        })
      )
      .mockResolvedValueOnce(
        response({ client_id: 'app', client_secret: 'secret', user_info: { tenant_brand: 'lark' } })
      );
    vi.stubGlobal('fetch', fetch);
    await registerFeishuApp({ domain: 'accounts.larksuite.com', onQRCodeReady: vi.fn() });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://accounts.larksuite.com/oauth/v1/app/registration');
  });

  it('encodes bot permissions, switches Lark polling hosts and obtains app credentials', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          device_code: 'device',
          verification_uri_complete: 'https://accounts.feishu.cn/auth',
          expires_in: 600,
        })
      )
      .mockResolvedValueOnce(
        response({ user_info: { tenant_brand: 'lark' }, error: 'authorization_pending' }, 400)
      )
      .mockResolvedValueOnce(
        response({ client_id: 'app', client_secret: 'secret', user_info: { tenant_brand: 'lark' } })
      );
    vi.stubGlobal('fetch', fetch);
    const ready = vi.fn();
    const result = await registerFeishuApp({
      onQRCodeReady: ready,
      addons: { scopes: { tenant: ['im:message:send_as_bot'] } },
    });
    expect(result.client_id).toBe('app');
    expect(fetch.mock.calls[2][0]).toBe('https://accounts.larksuite.com/oauth/v1/app/registration');
    const qr = new URL(ready.mock.calls[0][0].url);
    expect(
      JSON.parse(gunzipSync(Buffer.from(qr.searchParams.get('addons')!, 'base64url')).toString())
    ).toMatchObject({ scopes: { tenant: ['im:message:send_as_bot'] } });
    expect(qr.searchParams.get('createOnly')).toBe('true');
  });

  it('aborts an in-flight poll without ever scheduling another request', async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          device_code: 'device',
          verification_uri_complete: 'https://accounts.feishu.cn/auth',
        })
      )
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          })
      );
    vi.stubGlobal('fetch', fetch);
    const result = registerFeishuApp({ signal: controller.signal, onQRCodeReady: vi.fn() });
    const rejected = expect(result).rejects.toThrow('aborted');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
