import { randomBytes } from 'node:crypto';

export const WECHAT_BASE_URL = 'https://ilinkai.weixin.qq.com';
// Wire compatibility follows Tencent/openclaw-weixin 2.4.9 (docs/protocol.md).
const PROTOCOL_VERSION = '2.4.9';

export function trustedWechatBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === 'ilinkai.weixin.qq.com' || url.hostname.endsWith('.ilinkai.weixin.qq.com'))
  ) {
    throw new Error('Untrusted WeChat API host');
  }
  return url.origin;
}

export class WechatApiError extends Error {
  constructor(readonly code: number) {
    super(`WeChat API error (${code})`);
  }
}

/** No response bodies/URLs in errors: login requests and replies carry sensitive tokens. */
export async function wechatRequest<T>(
  baseUrl: string,
  endpoint: string,
  options: {
    body?: Record<string, unknown>;
    token?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': String((2 << 16) | (4 << 8) | 9),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    headers.AuthorizationType = 'ilink_bot_token';
    headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64');
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
  }
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const response = await fetch(`${trustedWechatBaseUrl(baseUrl)}/ilink/bot/${endpoint}`, {
    method: options.body ? 'POST' : 'GET',
    headers,
    signal,
    redirect: 'error',
    body: options.body
      ? JSON.stringify({
          ...options.body,
          ...(options.token
            ? {
                base_info: { channel_version: PROTOCOL_VERSION, bot_agent: 'Sophron/10.1.0' },
              }
            : {}),
        })
      : undefined,
  });
  if (!response.ok) throw new WechatApiError(response.status);
  // A reviver with source text preserves uint64 IDs on runtimes supporting JSON.parse context.
  const data = JSON.parse(await response.text(), (key, value, context?: { source: string }) =>
    ['message_id', 'msg_id', 'svr_id'].includes(key) && typeof value === 'number'
      ? (context?.source ?? String(value))
      : value
  ) as T & { ret?: number; errcode?: number };
  if (data.ret || data.errcode) throw new WechatApiError(data.errcode || data.ret!);
  return data;
}
