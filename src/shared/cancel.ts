/**
 * User cancellation of an AI run (规则生成, AI 修复, 转成脚本 要点提取). The main process throws
 * `cancelledError()` once the run's AbortSignal fired; the renderer recognises it through
 * `isCancelledError` (the IPC layer prefixes messages) and shows a neutral 已取消 state.
 */
export const CANCELLED_CODE = 'E_CANCELLED';
export const CANCELLED_TEXT = '已取消';

export function cancelledError(): Error {
  const error = new Error(`${CANCELLED_CODE}: ${CANCELLED_TEXT}`);
  error.name = 'CancelledError';
  return error;
}

export function isCancelledError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(CANCELLED_CODE);
}

/** `cancelledError()` when `signal` fired, otherwise `error` unchanged. */
export function asCancelled(error: unknown, signal: AbortSignal | undefined): unknown {
  return signal?.aborted ? cancelledError() : error;
}
