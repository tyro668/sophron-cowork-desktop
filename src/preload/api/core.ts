import { ipcRenderer } from 'electron';
import type { ClientEvent, ServerEvent } from '../../shared/contracts';
import { isAllowedClientEventType } from '../../shared/client-event-allowlist';
import type { ElectronApi } from '../../shared/contracts/electron-api';

type CoreApi = Pick<
  ElectronApi,
  'send' | 'on' | 'invoke' | 'platform' | 'getSystemTheme' | 'getVersion'
>;

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
      console.log('[Preload] Sending event:', event.type);
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
        console.log('[Preload] Received event:', data.type);
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
      console.log('[Preload] Invoking:', event.type);
      return ipcRenderer.invoke('client-invoke', event);
    },

    platform: process.platform,

    getSystemTheme: () => ipcRenderer.invoke('system.getTheme'),

    getVersion: () => ipcRenderer.invoke('get-version'),
  };
}
