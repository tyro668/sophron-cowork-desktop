import { setTimeout as delay } from 'node:timers/promises';
import type { DingtalkChannelConfig } from '../../types';
import { registrationRequest, type RegistrationOptions } from '../../registration-http';

interface RegistrationResponse {
  errcode: number;
  nonce?: string;
  device_code?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  status?: string;
  client_id?: string;
  client_secret?: string;
}

/** Protocol: DingTalk-Real-AI/dingtalk-openclaw-connector, src/device-auth.ts. */
export async function registerDingtalk(
  options: RegistrationOptions,
  request = registrationRequest
): Promise<DingtalkChannelConfig> {
  const call = async (action: string, body: Record<string, unknown>) => {
    const data = await request<RegistrationResponse>(
      `https://oapi.dingtalk.com/app/registration/${action}`,
      options.signal,
      body
    );
    if (data.errcode !== 0) throw new Error('DingTalk registration rejected');
    return data;
  };
  const init = await call('init', { source: 'DING_DWS_CLAW' });
  if (!init.nonce) throw new Error('Missing registration nonce');
  const begin = await call('begin', { nonce: init.nonce });
  if (!begin.device_code || !begin.verification_uri_complete)
    throw new Error('Missing device registration');
  options.signal.throwIfAborted();
  options.onQRCodeReady({
    url: begin.verification_uri_complete,
    expireIn: begin.expires_in || 7200,
  });
  while (!options.signal.aborted) {
    await delay(Math.min(Math.max(begin.interval || 3, 1), 60) * 1000, undefined, {
      signal: options.signal,
    });
    const result = await call('poll', { device_code: begin.device_code });
    options.signal.throwIfAborted();
    if (result.status === 'SUCCESS') {
      if (!result.client_id || !result.client_secret)
        throw new Error('Incomplete DingTalk credentials');
      return {
        type: 'dingtalk',
        enabled: true,
        appKey: result.client_id,
        appSecret: result.client_secret,
        robotCode: result.client_id,
        receiveMode: 'stream',
        dm: { policy: 'pairing' },
        defaultGroupSettings: { requireMention: true },
      };
    }
    if (result.status === 'EXPIRED')
      throw Object.assign(new Error('QR expired'), { code: 'expired_token' });
    if (result.status === 'FAIL')
      throw Object.assign(new Error('Authorization denied'), { code: 'access_denied' });
    if (result.status !== 'WAITING') throw new Error('Unknown DingTalk registration status');
  }
  throw new Error('Registration cancelled');
}
