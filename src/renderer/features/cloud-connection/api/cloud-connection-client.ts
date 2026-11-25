/**
 * Typed IPC adapter for the 云连接 feature — the only place in the renderer that
 * touches `window.electronAPI.cloudConnection`.
 */
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
  setSourceName: (name: string) => api().setSourceName(name),
  addFiles: () => api().addFiles(),
  removeFile: (filePath: string) => api().removeFile(filePath),
  refreshFiles: () => api().refreshFiles(),
  previewFile: (filePath: string) => api().previewFile(filePath),
  onState: (callback: Parameters<CloudConnectionApi['onState']>[0]) =>
    window.electronAPI?.cloudConnection?.onState(callback) ?? (() => undefined),
};
