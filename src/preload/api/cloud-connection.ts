import { ipcRenderer } from 'electron';
import type {
  CloudConnectionActionResult,
  CloudConnectionFilePreview,
  CloudConnectionState,
} from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createCloudConnectionApi(): ElectronApi['cloudConnection'] {
  return {
    getState: (): Promise<CloudConnectionState> => ipcRenderer.invoke('cloudConnection.getState'),
    importConfig: (): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.importConfig'),
    clearConfig: (): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.clearConfig'),
    connect: (): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.connect'),
    disconnect: (): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.disconnect'),
    setAutoConnect: (enabled: boolean): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.setAutoConnect', enabled),
    setSourceName: (name: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.setSourceName', name),
    addFiles: (): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.addFiles'),
    removeFile: (filePath: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.removeFile', filePath),
    refreshFiles: (): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.refreshFiles'),
    previewFile: (filePath: string): Promise<CloudConnectionFilePreview> =>
      ipcRenderer.invoke('cloudConnection.previewFile', filePath),
    onState: (callback: (state: CloudConnectionState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: CloudConnectionState) =>
        callback(state);
      ipcRenderer.on('cloudConnection.state', listener);
      return () => ipcRenderer.removeListener('cloudConnection.state', listener);
    },
  };
}
