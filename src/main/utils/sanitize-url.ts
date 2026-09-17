/**
 * Strips credentials and query data from a URL before it reaches a log line.
 * Keeps origin + pathname for diagnostics; drops userinfo, query, and
 * fragment (which may carry tokens or keys). Malformed URLs get a string
 * fallback that still removes userinfo and anything after `?`/`#`.
 */
export function sanitizeUrlForLog(value: string): string {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.origin}${pathname}`;
  } catch {
    return value
      .replace(/[?#].*$/, '')
      .replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]*@/, '$1***@');
  }
}
