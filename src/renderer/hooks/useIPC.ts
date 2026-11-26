import { useEffect } from 'react';
import { installIPCBridge } from './ipc-event-bridge';
import { ipcCommands } from './ipc-commands';

export { ipcCommands } from './ipc-commands';
export type { SessionSendOptions } from './ipc-commands';

/** Install the singleton main-process IPC listener (should be mounted once at App root). */
export function useIPCBridge(): void {
  useEffect(() => installIPCBridge(), []);
}

/** Access stable IPC commands while ensuring the singleton bridge is installed. */
export function useIPC() {
  useIPCBridge();
  return ipcCommands;
}
