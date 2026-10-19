/**
 * Automatic retry policy for model turns.
 *
 * The SDK session (`AgentSession`) owns the retry loop: when an assistant turn
 * ends with a retryable error it drops the failed attempt from the model
 * projection, backs off, and re-runs the same turn. This module keeps the
 * policy knobs and the user-facing wording in one place so the event bridge
 * and tests agree on them.
 */

/** Retry policy handed to `PiSettingsManager.inMemory({ retry })`. */
export const AGENT_TURN_RETRY_SETTINGS = {
  enabled: true,
  /** Retries after the first failed attempt (so up to 4 requests in total). */
  maxRetries: 3,
  /** Exponential backoff: 2s, 4s, 8s. */
  baseDelayMs: 2000,
  maxAgentDelayMs: 30_000,
} as const;

const TRANSIENT_NETWORK_ERROR_PATTERN = new RegExp(
  [
    '\\bterminated\\b',
    'econnreset',
    'econnaborted',
    'econnrefused',
    'etimedout',
    'epipe',
    'enotfound',
    'eai_again',
    'und_err_socket',
    'connection.?error',
    'connection.?reset',
    'connection.?closed',
    'connection.?lost',
    'connection.?refused',
    'socket hang up',
    'socket connection was closed',
    'other side closed',
    'fetch failed',
    'network.?error',
    'reset before headers',
    'upstream.?connect',
    'premature close',
    'unexpected eof',
  ].join('|'),
  'i'
);

/**
 * True when an error message looks like a dropped / interrupted transport
 * (proxy cut the stream, socket reset, DNS hiccup) rather than a provider
 * rejection. These are always safe to retry: the failed attempt never
 * reaches tool execution because its stop reason is `error`.
 */
export function isTransientNetworkError(errorText: string | undefined | null): boolean {
  if (!errorText) return false;
  return TRANSIENT_NETWORK_ERROR_PATTERN.test(errorText);
}

export type AgentRetryReason = 'network' | 'provider';

export function classifyRetryReason(errorText: string | undefined | null): AgentRetryReason {
  return isTransientNetworkError(errorText) ? 'network' : 'provider';
}

/** Short status shown in the run status line while a retry is pending. */
export function formatRetryStatus(
  attempt: number,
  maxAttempts: number,
  errorText: string | undefined | null
): string {
  const prefix = classifyRetryReason(errorText) === 'network' ? '连接中断' : '模型服务异常';
  return `${prefix}，正在重试 (${attempt}/${maxAttempts})`;
}
