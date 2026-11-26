import type { ElectronApi } from '../../../../shared/contracts/electron-api';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

type MemoryApi = ElectronApi['memory'];

const api = () => requireElectronNamespace('memory');

export const memoryClient = {
  isAvailable: () => isElectronNamespaceAvailable('memory'),
  getOverview: (...args: Parameters<MemoryApi['getOverview']>) => api().getOverview(...args),
  setEnabled: (...args: Parameters<MemoryApi['setEnabled']>) => api().setEnabled(...args),
  listCoreEntries: (...args: Parameters<MemoryApi['listCoreEntries']>) =>
    api().listCoreEntries(...args),
  updateCoreEntry: (...args: Parameters<MemoryApi['updateCoreEntry']>) =>
    api().updateCoreEntry(...args),
  deleteCoreEntry: (...args: Parameters<MemoryApi['deleteCoreEntry']>) =>
    api().deleteCoreEntry(...args),
  listProjectEntries: (...args: Parameters<MemoryApi['listProjectEntries']>) =>
    api().listProjectEntries(...args),
  updateProjectEntry: (...args: Parameters<MemoryApi['updateProjectEntry']>) =>
    api().updateProjectEntry(...args),
  deleteProjectEntry: (...args: Parameters<MemoryApi['deleteProjectEntry']>) =>
    api().deleteProjectEntry(...args),
  listInjections: (...args: Parameters<MemoryApi['listInjections']>) =>
    api().listInjections(...args),
  rebuildWorkspace: (...args: Parameters<MemoryApi['rebuildWorkspace']>) =>
    api().rebuildWorkspace(...args),
};
