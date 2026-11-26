/** Message of a failed IPC call without Electron's "Error invoking remote method 'x': Error:" wrapper. */
export function ipcErrorMessage(error: unknown): string {
  let message = (error instanceof Error ? error.message : String(error)).trim();
  for (;;) {
    const next = message
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^Error:\s*/, '');
    if (next === message) return message;
    message = next;
  }
}

/** Extract a clean error message, returning `fallback` when `error` is not an Error or empty. */
export function formatIpcError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const msg = ipcErrorMessage(error);
  return msg || fallback;
}
