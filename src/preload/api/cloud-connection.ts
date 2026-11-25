import { ipcRenderer } from 'electron';
import type {
  CloudConnectionActionResult,
  CloudConnectionGroupInput,
  CloudConnectionState,
  CloudConnectionTableInput,
  CloudConnectionTablePreview,
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
    addGroup: (input: CloudConnectionGroupInput): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.addGroup', input),
    updateGroup: (
      id: string,
      input: CloudConnectionGroupInput
    ): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.updateGroup', id, input),
    deleteGroup: (id: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.deleteGroup', id),
    saveTable: (
      groupId: string,
      originalName: string | null,
      input: CloudConnectionTableInput
    ): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.saveTable', groupId, originalName, input),
    deleteTable: (groupId: string, tableName: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.deleteTable', groupId, tableName),
    removeLegacyFile: (groupId: string, filePath: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.removeLegacyFile', groupId, filePath),
    refreshTables: (groupId?: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.refreshTables', groupId),
    previewTable: (groupId: string, tableId: string): Promise<CloudConnectionTablePreview> =>
      ipcRenderer.invoke('cloudConnection.previewTable', groupId, tableId),
    previewDraft: (
      groupId: string,
      originalName: string | null,
      input: CloudConnectionTableInput
    ): Promise<CloudConnectionTablePreview> =>
      ipcRenderer.invoke('cloudConnection.previewDraft', groupId, originalName, input),
    pickDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('cloudConnection.pickDirectory'),
    pickTablePath: (groupId: string, kind: 'file' | 'directory'): Promise<string | null> =>
      ipcRenderer.invoke('cloudConnection.pickTablePath', groupId, kind),
    onState: (callback: (state: CloudConnectionState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: CloudConnectionState) =>
        callback(state);
      ipcRenderer.on('cloudConnection.state', listener);
      return () => ipcRenderer.removeListener('cloudConnection.state', listener);
    },
  };
}
