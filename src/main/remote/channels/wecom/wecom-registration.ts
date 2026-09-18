import { setTimeout as delay } from 'node:timers/promises';
import type { WecomChannelConfig } from '../../types';
import { registrationRequest, type RegistrationOptions } from '../../registration-http';

/** Protocol: WecomTeam/wecom-cli, crates/wecom-cli/src/auth/qrcode.rs. */
export async function registerWecom(
  options: RegistrationOptions,
  request = registrationRequest
): Promise<WecomChannelConfig> {
  const platform = process.platform === 'darwin' ? 1 : process.platform === 'win32' ? 2 : 3;
  const begin = await request<{ data?: { scode?: string; auth_url?: string } }>(
    `https://work.weixin.qq.com/ai/qc/generate?source=wecom_cli_external&plat=${platform}`,
    options.signal
  );
  if (!begin.data?.scode || !begin.data.auth_url) throw new Error('Missing WeCom QR session');
  options.signal.throwIfAborted();
  options.onQRCodeReady({ url: begin.data.auth_url, expireIn: 300 });
  while (!options.signal.aborted) {
    await delay(3000, undefined, { signal: options.signal });
    const result = await request<{
      data?: { status?: string; bot_info?: { botid?: string; secret?: string } };
    }>(
      `https://work.weixin.qq.com/ai/qc/query_result?scode=${encodeURIComponent(begin.data.scode)}`,
      options.signal
    );
    options.signal.throwIfAborted();
    if (result.data?.status === 'success') {
      const bot = result.data.bot_info;
      if (!bot?.botid || !bot.secret) throw new Error('Incomplete WeCom credentials');
      return {
        type: 'wecom',
        enabled: true,
        botId: bot.botid,
        secret: bot.secret,
        receiveMode: 'websocket',
        dm: { policy: 'pairing' },
        defaultGroupSettings: { requireMention: true },
      };
    }
    if (result.data?.status === 'expired')
      throw Object.assign(new Error('QR expired'), { code: 'expired_token' });
  }
  throw new Error('Registration cancelled');
}
