import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import type { registerApp } from '@larksuiteoapi/node-sdk';

type Options = Parameters<typeof registerApp>[0];
type Result = Awaited<ReturnType<typeof registerApp>>;
interface RegistrationResponse extends Partial<Result> {
  error?: string;
  device_code?: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
}

/** Official SDK device-registration protocol, with cancellation on every HTTP request and wait.
 * SDK 1.73's signal only settles the polling promise; an in-flight request can schedule another poll.
 */
export async function registerFeishuApp(options: Options): Promise<Result> {
  const signal = options.signal ?? new AbortController().signal;
  let origin =
    options.domain === 'accounts.larksuite.com'
      ? 'https://accounts.larksuite.com'
      : 'https://accounts.feishu.cn';
  const request = async (body: Record<string, string>): Promise<RegistrationResponse> => {
    const response = await fetch(`${origin}/oauth/v1/app/registration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    });
    // OAuth device flow uses HTTP 400 for pending/slow_down as well as terminal outcomes.
    if (!response.ok && response.status !== 400)
      throw new Error(`Registration HTTP ${response.status}`);
    const data = (await response.json()) as RegistrationResponse;
    signal.throwIfAborted();
    return data;
  };
  const begin = await request({
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id',
  });
  if (begin.error || !begin.device_code || !begin.verification_uri_complete)
    throw new Error('Unable to begin app registration');
  const url = new URL(begin.verification_uri_complete);
  url.searchParams.set('from', 'sdk');
  url.searchParams.set('source', 'node-sdk/sophron');
  url.searchParams.set('tp', 'sdk');
  url.searchParams.set('createOnly', 'true');
  if (options.addons)
    url.searchParams.set('addons', gzipSync(JSON.stringify(options.addons)).toString('base64url'));
  const expires =
    Number.isFinite(begin.expires_in) && begin.expires_in! > 0 ? begin.expires_in! : 600;
  const deadline = Date.now() + expires * 1000;
  let interval = Math.min(60, Math.max(1, begin.interval || 5));
  options.onQRCodeReady({ url: url.toString(), expireIn: expires });
  let switched = options.domain === 'accounts.larksuite.com';
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = await request({ action: 'poll', device_code: begin.device_code });
    if (result.user_info?.tenant_brand === 'lark' && !switched) {
      origin = 'https://accounts.larksuite.com';
      switched = true;
      options.onStatusChange?.({ status: 'domain_switched' });
      continue;
    }
    if (result.client_id && result.client_secret)
      return {
        client_id: result.client_id,
        client_secret: result.client_secret,
        user_info: result.user_info,
      };
    if (result.error === 'slow_down') interval = Math.min(interval + 5, 60);
    else if (result.error && result.error !== 'authorization_pending') {
      throw Object.assign(new Error('App registration failed'), { code: result.error });
    }
    await delay(Math.min(interval * 1000, Math.max(1, deadline - Date.now())), undefined, {
      signal,
    });
  }
  throw Object.assign(new Error('App registration expired'), { code: 'expired_token' });
}
