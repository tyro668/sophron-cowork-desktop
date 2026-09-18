import { afterEach, describe, expect, it, vi } from 'vitest';
import type { registerApp } from '@larksuiteoapi/node-sdk';
import { RemoteQrSetupService } from '../../main/remote/qr-setup-service';

function harness() {
  let resolve!: (value: Awaited<ReturnType<typeof registerApp>>) => void;
  let reject!: (error: unknown) => void;
  let options!: Parameters<typeof registerApp>[0];
  const register = vi.fn((input: Parameters<typeof registerApp>[0]) => {
    options = input;
    return new Promise<Awaited<ReturnType<typeof registerApp>>>((yes, no) => {
      resolve = yes;
      reject = no;
    });
  });
  const save = vi.fn(async () => {});
  const encode = vi.fn(async () => 'data:image/png;base64,qr');
  const service = new RemoteQrSetupService(save, register, encode);
  return {
    service,
    save,
    encode,
    get options() {
      return options;
    },
    get resolve() {
      return resolve;
    },
    get reject() {
      return reject;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('remote QR setup lifecycle', () => {
  it('returns only QR state and saves credentials after authorization', async () => {
    const h = harness();
    h.service.begin(1, 'first', 'feishu');
    h.options.onQRCodeReady({
      url: 'https://open.feishu.cn/page/launcher?code=temporary',
      expireIn: 60,
    });
    await vi.waitFor(() => expect(h.service.get(1, 'first').status).toBe('waiting'));
    expect(h.encode).toHaveBeenCalledWith('https://open.feishu.cn/page/launcher?code=temporary');
    expect(h.save).not.toHaveBeenCalled();
    h.resolve({ client_id: 'app', client_secret: 'secret' });
    await vi.waitFor(() => expect(h.service.get(1, 'first').status).toBe('completed'));
    expect(h.save).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app',
        appSecret: 'secret',
        useWebSocket: true,
        type: 'feishu',
      })
    );
    expect(JSON.stringify(h.service.get(1, 'first'))).not.toContain('secret');
    h.service.cancel(1);
  });

  it('drops a cancelled begin callback and late authorization', async () => {
    const h = harness();
    h.service.begin(1, 'old', 'feishu');
    const oldOptions = h.options;
    const oldResolve = h.resolve;
    h.service.begin(1, 'new', 'feishu');
    expect(oldOptions.signal?.aborted).toBe(true);
    oldOptions.onQRCodeReady({ url: 'https://accounts.feishu.cn/old', expireIn: 60 });
    oldResolve({ client_id: 'old-app', client_secret: 'old-secret' });
    await Promise.resolve();
    expect(h.encode).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    h.service.cancel(1, 'old');
    expect(h.service.get(1, 'new').status).toBe('generating');
    h.service.cancel(1, 'new');
  });

  it('keeps attempts private to their initiating window', () => {
    const h = harness();
    h.service.begin(1, 'id', 'feishu');
    expect(h.service.get(2, 'id').status).toBe('cancelled');
    h.service.cancel(2, 'id');
    expect(h.options.signal?.aborted).toBe(false);
    h.service.cancel(1);
  });

  it('expires the QR and rejects a late result', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.service.begin(1, 'id', 'feishu');
    h.options.onQRCodeReady({ url: 'https://accounts.feishu.cn/auth', expireIn: 2 });
    await vi.advanceTimersByTimeAsync(2001);
    expect(h.service.get(1, 'id').status).toBe('expired');
    h.resolve({ client_id: 'late', client_secret: 'late-secret' });
    await Promise.resolve();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('times out initialization and never exposes SDK error bodies', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.service.begin(1, 'id', 'feishu');
    await vi.advanceTimersByTimeAsync(30_001);
    expect(h.service.get(1, 'id')).toMatchObject({
      status: 'failed',
      errorCode: 'registration_failed',
    });
    h.reject({ code: 'network', request: { secret: 'sensitive' } });
    await Promise.resolve();
    expect(JSON.stringify(h.service.get(1, 'id'))).not.toContain('sensitive');
  });

  it('preserves the Lark launcher URL and stores an independent Lark channel', async () => {
    const h = harness();
    h.service.begin(1, 'id', 'lark');
    h.options.onQRCodeReady({
      url: 'https://open.larksuite.com/page/launcher?code=1',
      expireIn: 60,
    });
    expect(h.encode).toHaveBeenCalledWith('https://open.larksuite.com/page/launcher?code=1');
    h.options.onStatusChange?.({ status: 'domain_switched' });
    h.resolve({ client_id: 'lark', client_secret: 'secret', user_info: { tenant_brand: 'lark' } });
    await vi.waitFor(() =>
      expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'lark' }))
    );
    h.service.cancel(1);
  });

  it.each([
    'https://open.feishu.cn.evil.example/page/launcher',
    'https://evil.example/page/launcher',
    'http://open.feishu.cn/page/launcher',
    'https://user:password@open.feishu.cn/page/launcher',
    'https://open.feishu.cn:8443/page/launcher',
  ])('rejects an untrusted QR URL: %s', (url) => {
    const h = harness();
    h.service.begin(1, 'id', 'feishu');
    h.options.onQRCodeReady({ url, expireIn: 60 });
    expect(h.service.get(1, 'id')).toMatchObject({
      status: 'failed',
      errorCode: 'registration_failed',
    });
    expect(h.encode).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.options.signal?.aborted).toBe(true);
    h.service.cancel(1);
  });

  it('rejects credentials from a mismatched brand', async () => {
    const h = harness();
    h.service.begin(1, 'id', 'feishu');
    h.resolve({ client_id: 'lark', client_secret: 'secret', user_info: { tenant_brand: 'lark' } });
    await vi.waitFor(() => expect(h.service.get(1, 'id').errorCode).toBe('unsupported_brand'));
    expect(h.save).not.toHaveBeenCalled();
  });

  it('does not allow refresh to race a credential save and reports save failure', async () => {
    const h = harness();
    let failSave!: (error: Error) => void;
    h.save.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSave = reject;
        })
    );
    h.service.begin(1, 'id', 'feishu');
    h.resolve({ client_id: 'app', client_secret: 'secret' });
    await vi.waitFor(() => expect(h.service.get(1, 'id').status).toBe('saving'));
    expect(() => h.service.begin(1, 'next', 'feishu')).toThrow();
    h.service.cancel(1, 'id');
    expect(h.service.get(1, 'id').status).toBe('saving');
    failSave(new Error('sensitive error'));
    await vi.waitFor(() => expect(h.service.get(1, 'id').errorCode).toBe('save_failed'));
  });
});
