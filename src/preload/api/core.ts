import { ipcRenderer } from 'electron';
import type { ClientEvent, ServerEvent } from '../../shared/contracts';
import { isAllowedClientEventType } from '../../shared/client-event-allowlist';
import type { ElectronApi } from '../../shared/contracts/electron-api';

type CoreApi = Pick<
  ElectronApi,
  'send' | 'on' | 'invoke' | 'platform' | 'getSystemTheme' | 'getVersion'
>;

// Per-event IPC logs are a hot path — stream events fire constantly. Opt-in
// only for dev; packaged builds must stay silent.
const DEBUG_IPC =
  process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);
const debugIpc = (...args: unknown[]) => {
  if (DEBUG_IPC) console.log(...args);
};

export function createCoreApi(): CoreApi {
  // Track registered callbacks to prevent duplicate listeners
  let registeredCallback: ((event: ServerEvent) => void) | null = null;
  let ipcListener: ((event: Electron.IpcRendererEvent, data: ServerEvent) => void) | null = null;

  return {
    send: (event: ClientEvent) => {
      if (!isAllowedClientEventType(event.type)) {
        console.warn('[Preload] Blocked unauthorized event type:', event.type);
        return;
      }
      debugIpc('[Preload] Sending event:', event.type);
      ipcRenderer.send('client-event', event);
    },

    on: (callback: (event: ServerEvent) => void) => {
      // Remove previous listener if exists
      if (ipcListener) {
        console.log('[Preload] Removing previous listener');
        ipcRenderer.removeListener('server-event', ipcListener);
      }

      registeredCallback = callback;
      ipcListener = (_: Electron.IpcRendererEvent, data: ServerEvent) => {
        debugIpc('[Preload] Received event:', data.type);
        if (registeredCallback) {
          registeredCallback(data);
        }
      };

      console.log('[Preload] Registering new listener');
      ipcRenderer.on('server-event', ipcListener);

      // Return cleanup function
      return () => {
        console.log('[Preload] Cleanup called');
        if (ipcListener) {
          ipcRenderer.removeListener('server-event', ipcListener);
          ipcListener = null;
          registeredCallback = null;
        }
      };
    },

    invoke: async <T>(event: ClientEvent): Promise<T> => {
      if (!isAllowedClientEventType(event.type)) {
        console.warn('[Preload] Blocked unauthorized invoke type:', event.type);
        throw new Error(`Unauthorized event type: ${event.type}`);
      }
      debugIpc('[Preload] Invoking:', event.type);
      return ipcRenderer.invoke('client-invoke', event);
    },

    platform: process.platform,

    getSystemTheme: () => ipcRenderer.invoke('system.getTheme'),

    getVersion: () => ipcRenderer.invoke('get-version'),
  };
}
