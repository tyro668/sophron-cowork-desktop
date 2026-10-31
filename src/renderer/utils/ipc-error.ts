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
