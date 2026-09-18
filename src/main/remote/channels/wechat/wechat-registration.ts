import { setTimeout as delay } from 'node:timers/promises';
import type { WechatChannelConfig } from '../../types';
import { trustedWechatBaseUrl, wechatRequest, WECHAT_BASE_URL } from './wechat-api';

interface LoginStatus {
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

export async function registerWechat(
  options: {
    signal: AbortSignal;
    onQRCodeReady: (info: { url: string; expireIn: number }) => void;
    onStatus: (status: 'scanned' | 'verifying' | 'waiting') => void;
    takeVerifyCode: () => string | undefined;
  },
  request = wechatRequest
): Promise<WechatChannelConfig> {
  const qr = await request<{ qrcode: string; qrcode_img_content: string }>(
    WECHAT_BASE_URL,
    'get_bot_qrcode?bot_type=3',
    { body: { local_token_list: [] }, signal: options.signal }
  );
  if (!qr.qrcode || !qr.qrcode_img_content) throw new Error('Invalid WeChat QR response');
  options.signal.throwIfAborted();
  options.onQRCodeReady({ url: qr.qrcode_img_content, expireIn: 300 });
  let baseUrl = WECHAT_BASE_URL;
  let needsCode = false;
  while (!options.signal.aborted) {
    const code = options.takeVerifyCode();
    if (needsCode && !code) {
      await delay(300, undefined, { signal: options.signal });
      continue;
    }
    const query = new URLSearchParams({ qrcode: qr.qrcode });
    if (code) query.set('verify_code', code);
    let result: LoginStatus;
    try {
      result = await request<LoginStatus>(baseUrl, `get_qrcode_status?${query}`, {
        signal: options.signal,
        timeoutMs: 35_000,
      });
    } catch (error) {
      options.signal.throwIfAborted();
      if (error instanceof Error && error.name === 'TimeoutError') continue;
      throw error;
    }
    options.signal.throwIfAborted();
    needsCode = result.status === 'need_verifycode';
    switch (result.status) {
      case 'confirmed':
        if (!result.bot_token || !result.ilink_bot_id || !result.ilink_user_id)
          throw new Error('Incomplete WeChat credentials');
        return {
          type: 'wechat',
          enabled: true,
          botToken: result.bot_token,
          botId: result.ilink_bot_id,
          userId: result.ilink_user_id,
          baseUrl: trustedWechatBaseUrl(result.baseurl || baseUrl),
          dm: { policy: 'allowlist', allowFrom: [result.ilink_user_id] },
        };
      case 'scaned_but_redirect':
        if (!result.redirect_host) throw new Error('Missing WeChat redirect');
        baseUrl = trustedWechatBaseUrl(`https://${result.redirect_host}`);
        break;
      case 'scaned':
        options.onStatus('scanned');
        break;
      case 'need_verifycode':
        options.onStatus('verifying');
        break;
      case 'expired':
        throw Object.assign(new Error('QR expired'), { code: 'expired_token' });
      case 'verify_code_blocked':
        throw Object.assign(new Error('Verification blocked'), { code: 'access_denied' });
      case 'wait':
        break;
      default:
        throw new Error('Unsupported WeChat login state');
    }
    await delay(1000, undefined, { signal: options.signal });
  }
  throw new Error('Registration cancelled');
}
