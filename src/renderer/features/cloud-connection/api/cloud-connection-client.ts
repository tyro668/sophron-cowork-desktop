/**
 * Typed IPC adapter for the 云连接 feature — the only place in the renderer that
 * touches `window.electronAPI.cloudConnection`.
 */
import type {
  CloudConnectionGroupInput,
  CloudConnectionTableInput,
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
  saveTable: (groupId: string, originalName: string | null, input: CloudConnectionTableInput) =>
    api().saveTable(groupId, originalName, input),
  deleteTable: (groupId: string, tableName: string) => api().deleteTable(groupId, tableName),
  removeLegacyFile: (groupId: string, filePath: string) =>
    api().removeLegacyFile(groupId, filePath),
  refreshTables: (groupId?: string) => api().refreshTables(groupId),
  previewTable: (groupId: string, tableId: string) => api().previewTable(groupId, tableId),
  previewDraft: (groupId: string, originalName: string | null, input: CloudConnectionTableInput) =>
    api().previewDraft(groupId, originalName, input),
  pickDirectory: () => api().pickDirectory(),
  pickTablePath: (groupId: string, kind: 'file' | 'directory') =>
    api().pickTablePath(groupId, kind),
  onState: (callback: Parameters<CloudConnectionApi['onState']>[0]) =>
    window.electronAPI?.cloudConnection?.onState(callback) ?? (() => undefined),
};
