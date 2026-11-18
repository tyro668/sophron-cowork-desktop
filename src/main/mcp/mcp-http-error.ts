/**
 * Turns MCP HTTP/SSE transport errors into a short, readable message.
 * The SDK often formats failures as `Error POSTing to endpoint: ${body}` and
 * omits the HTTP status when the body is empty (e.g. a 401 with no payload).
 */

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

const MAX_BODY_SUMMARY = 180;

export function summarizeHttpBody(body: string | null | undefined): string {
  if (!body) return '';
  const trimmed = body.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  // Prefer a JSON error/message field when present.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const fromJson = summarizeJsonError(parsed);
      if (fromJson) return truncate(fromJson);
    } catch {
      // Fall through to raw text.
    }
  }
  return truncate(trimmed);
}

function summarizeJsonError(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const candidates = [record.error, record.message, record.error_description, record.detail];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === 'object') {
      const nested = summarizeJsonError(candidate);
      if (nested) return nested;
    }
  }
  return '';
}

function truncate(text: string): string {
  if (text.length <= MAX_BODY_SUMMARY) return text;
  return `${text.slice(0, MAX_BODY_SUMMARY - 1)}…`;
}

function formatStatus(status: number): string {
  const text = HTTP_STATUS_TEXT[status];
  return text ? `HTTP ${status} ${text}` : `HTTP ${status}`;
}

function extractStatusFromMessage(message: string): number | undefined {
  const patterns = [
    /\bHTTP\s+(\d{3})\b/i,
    /\bstatus(?:\s*code)?\s*[:=]\s*(\d{3})\b/i,
    /\b(\d{3})\s+(?:Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error)\b/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/**
 * Build a user-facing error string from an MCP transport failure.
 * Prefer an HTTP status (from StreamableHTTPError.code or the message) plus a
 * short body summary; never leave the trailing "endpoint:" empty.
 */
export function formatMcpTransportError(error: unknown): string {
  const err = error as { code?: unknown; message?: unknown; name?: unknown };
  const raw =
    typeof err?.message === 'string' && err.message.trim() ? err.message.trim() : String(error);
  const status =
    typeof err?.code === 'number' && Number.isFinite(err.code)
      ? err.code
      : extractStatusFromMessage(raw);

  const withoutPrefix = raw.replace(/^(?:Streamable HTTP error|SSE error):\s*/i, '');
  const postMatch = withoutPrefix.match(/^Error POSTing to endpoint:\s*(.*)$/is);
  const sseMatch = withoutPrefix.match(/^Failed to open SSE stream:\s*(.*)$/is);
  const payload = postMatch ? postMatch[1] : sseMatch ? sseMatch[1] : undefined;

  if (payload !== undefined) {
    const body = summarizeHttpBody(payload);
    if (status) return body ? `${formatStatus(status)}: ${body}` : formatStatus(status);
    return body ? `MCP request failed: ${body}` : 'MCP request failed';
  }

  if (status) {
    const body = summarizeHttpBody(withoutPrefix);
    // If the only useful bit is the status, don't repeat a long unhelpful message.
    if (!body || /Error POSTing to endpoint/i.test(withoutPrefix)) {
      return formatStatus(status);
    }
    if (new RegExp(`\\b${status}\\b`).test(withoutPrefix) && withoutPrefix.length < 220) {
      return withoutPrefix;
    }
    return `${formatStatus(status)}: ${body}`;
  }

  return withoutPrefix || raw;
}

export function isUnauthorizedMcpError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: unknown; message?: unknown; code?: unknown };
  if (err.name === 'UnauthorizedError') return true;
  if (typeof err.message === 'string' && /\bUnauthorizedError\b/i.test(err.message)) return true;
  return false;
}
