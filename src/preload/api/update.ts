import { ipcRenderer } from 'electron';
import type { AppUpdateState } from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createUpdateApi(): ElectronApi['update'] {
  return {
    getState: (): Promise<AppUpdateState | null> => ipcRenderer.invoke('update.getState'),
    checkAndInstall: (): Promise<AppUpdateState> => ipcRenderer.invoke('update.checkAndInstall'),
    onState: (callback: (state: AppUpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState) =>
        callback(state);
      ipcRenderer.on('update.state', listener);
      return () => ipcRenderer.removeListener('update.state', listener);
    },
  };
}
