import type { TraceError } from '../../shared/contracts';

const SENSITIVE_KEY =
  /(?:^|_)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|cookie|secret|token)(?:$|_)/i;
const DATA_URL = /^data:[^;]+;base64,/i;

export interface TraceOutputPreview {
  preview: string;
  length: number;
  truncated: boolean;
}

export interface NormalizedTraceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costTotal: number;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeTraceUsage(usage: unknown): NormalizedTraceUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const raw = usage as Record<string, unknown>;
  const input = raw.input ?? raw.input_tokens ?? raw.inputTokens;
  const output = raw.output ?? raw.output_tokens ?? raw.outputTokens;
  if (typeof input !== 'number' || typeof output !== 'number') return undefined;

  const inputTokens = finiteNumber(input);
  const outputTokens = finiteNumber(output);
  const cacheReadTokens = finiteNumber(
    raw.cacheRead ?? raw.cache_read ?? raw.cache_read_tokens ?? raw.cacheReadTokens
  );
  const cacheWriteTokens = finiteNumber(
    raw.cacheWrite ?? raw.cache_write ?? raw.cache_write_tokens ?? raw.cacheWriteTokens
  );
  const reportedTotal = raw.totalTokens ?? raw.total_tokens;
  const cost =
    raw.cost && typeof raw.cost === 'object' ? (raw.cost as Record<string, unknown>) : {};

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: finiteNumber(
      reportedTotal,
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
    ),
    costTotal: finiteNumber(cost.total ?? raw.costTotal ?? raw.cost_total),
  };
}

/**
 * Produce a bounded, JSON-safe copy for persisted traces. Trace data is diagnostic
 * metadata, so credentials and large binary/string payloads never belong in it.
 */
export function sanitizeTraceValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    if (DATA_URL.test(value)) return `[base64 data omitted: ${value.length} chars]`;
    return value.length > 4_000 ? `${value.slice(0, 4_000)}…[truncated]` : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return String(value);
  if (depth >= 6) return '[max depth reached]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => sanitizeTraceValue(item, depth + 1, seen));
    if (value.length > 100) items.push(`[${value.length - 100} more items]`);
    return items;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : sanitizeTraceValue(item, depth + 1, seen);
  }
  return result;
}

export function sanitizeTraceInput(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeTraceValue(value);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return { value: sanitized };
}

export function buildTraceOutputPreview(output: string, maxLength = 2_000): TraceOutputPreview {
  const redacted = redactTraceText(output);
  const truncated = output.length > maxLength || redacted.length > maxLength;
  return {
    preview: truncated ? `${redacted.slice(0, maxLength)}…` : redacted,
    length: output.length,
    truncated,
  };
}

export function redactTraceText(output: string): string {
  return output
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(
      /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|cookie|secret|token)\b\s*[:=]\s*)(["']?)[^\s"',}]+(["']?)/gi,
      '$1$2[REDACTED]$3'
    );
}

export function buildTraceError(
  message: string,
  defaultStage: TraceError['stage'] = 'execution'
): TraceError {
  const normalized = redactTraceText(message.trim()) || 'Unknown error';
  const codeMatch = /^\[([A-Z][A-Z0-9_-]+)\]\s*/.exec(normalized);
  const lower = normalized.toLowerCase();
  let stage = defaultStage;
  if (/permission|not allowed|denied|拒绝|无权限/.test(lower)) stage = 'permission';
  else if (/timed?\s*out|timeout|超时/.test(lower)) stage = 'timeout';
  else if (/invalid|required|validation|缺少|无效/.test(lower)) stage = 'validation';

  return {
    stage,
    code: codeMatch?.[1],
    message: normalized.slice(0, 4_000),
    retriable: stage === 'timeout' || stage === 'provider',
  };
}
