import { ipcRenderer } from 'electron';
import type {
  CloudConnectionActionResult,
  CloudConnectionGroupInput,
  CloudConnectionState,
  CloudConnectionTableRefInput,
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
    addTableRefs: (
      groupId: string,
      refs: CloudConnectionTableRefInput[]
    ): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.addTableRefs', groupId, refs),
    updateTableRef: (
      groupId: string,
      reportName: string,
      input: { reportName: string }
    ): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.updateTableRef', groupId, reportName, input),
    deleteTable: (groupId: string, reportName: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.deleteTable', groupId, reportName),
    refreshTables: (groupId?: string): Promise<CloudConnectionActionResult> =>
      ipcRenderer.invoke('cloudConnection.refreshTables', groupId),
    previewTable: (groupId: string, reportName: string): Promise<CloudConnectionTablePreview> =>
      ipcRenderer.invoke('cloudConnection.previewTable', groupId, reportName),
    onState: (callback: (state: CloudConnectionState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: CloudConnectionState) =>
        callback(state);
      ipcRenderer.on('cloudConnection.state', listener);
      return () => ipcRenderer.removeListener('cloudConnection.state', listener);
    },
  };
}
