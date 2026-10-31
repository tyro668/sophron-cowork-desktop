/**
 * SSRF guard for agent web tools: only public addresses after DNS resolution; every redirect
 * hop is resolved and checked again.
 */
import { lookup as dnsLookup } from 'dns/promises';
import net from 'net';

export type LookupFn = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

function v4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Loopback, private, link-local, CGNAT, multicast, unspecified (v4, v6, v4-mapped). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(ip)) return v4Private(ip);
  if (!net.isIPv6(ip)) return true;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return v4Private(mapped[1]);
  if (lower === '::' || lower === '::1') return true;
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
}

export class BlockedUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`不允许访问 ${url}：${reason}`);
    this.name = 'BlockedUrlError';
  }
}

export async function assertPublicUrl(url: URL, lookup: LookupFn = defaultLookup): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol))
    throw new BlockedUrlError(url.href, '只支持 http/https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host))
    throw new BlockedUrlError(url.href, '本机或内网地址');
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await lookup(host);
  if (addresses.length === 0) throw new BlockedUrlError(url.href, '域名无法解析');
  const blocked = addresses.find((item) => isPrivateAddress(item.address));
  if (blocked) throw new BlockedUrlError(url.href, `解析到本机或内网地址 ${blocked.address}`);
}

/** fetch with manual redirects: each hop's host is resolved and must be public. */
export async function guardedFetch(
  input: string | URL,
  init: RequestInit = {},
  options: { maxRedirects?: number; lookup?: LookupFn; fetchImpl?: typeof fetch } = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let url = new URL(String(input));
  let method = init.method ?? 'GET';
  let body = init.body;
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop += 1) {
    await assertPublicUrl(url, options.lookup);
    const response = await fetchImpl(url, { ...init, method, body, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    url = new URL(location, url);
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      method = 'GET';
      body = undefined;
    }
  }
  throw new Error('重定向次数过多');
}
