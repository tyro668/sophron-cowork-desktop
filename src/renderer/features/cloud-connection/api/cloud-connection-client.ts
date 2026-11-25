/**
 * Typed IPC adapter for the 云连接 feature — the only place in the renderer that
 * touches `window.electronAPI.cloudConnection`.
 */
import type {
  CloudConnectionGroupInput,
  CloudConnectionTableRefInput,
} from '../../../../shared/contracts';
import type { ElectronApi } from '../../../../shared/contracts/electron-api';

type CloudConnectionApi = ElectronApi['cloudConnection'];

function api(): CloudConnectionApi {
  const bridge = window.electronAPI?.cloudConnection;
  if (!bridge) throw new Error('Cloud connection IPC bridge is unavailable');
  return bridge;
}

export const cloudConnectionClient = {
  isAvailable(): boolean {
    return Boolean(window.electronAPI?.cloudConnection);
  },
  getState: () => api().getState(),
  importConfig: () => api().importConfig(),
  clearConfig: () => api().clearConfig(),
  connect: () => api().connect(),
  disconnect: () => api().disconnect(),
  setAutoConnect: (enabled: boolean) => api().setAutoConnect(enabled),
  addGroup: (input: CloudConnectionGroupInput) => api().addGroup(input),
  updateGroup: (id: string, input: CloudConnectionGroupInput) => api().updateGroup(id, input),
  deleteGroup: (id: string) => api().deleteGroup(id),
  addTableRefs: (groupId: string, refs: CloudConnectionTableRefInput[]) =>
    api().addTableRefs(groupId, refs),
  updateTableRef: (groupId: string, reportName: string, input: { reportName: string }) =>
    api().updateTableRef(groupId, reportName, input),
  deleteTable: (groupId: string, reportName: string) => api().deleteTable(groupId, reportName),
  refreshTables: (groupId?: string) => api().refreshTables(groupId),
  previewTable: (groupId: string, reportName: string) => api().previewTable(groupId, reportName),
  onState: (callback: Parameters<CloudConnectionApi['onState']>[0]) =>
    window.electronAPI?.cloudConnection?.onState(callback) ?? (() => undefined),
};
