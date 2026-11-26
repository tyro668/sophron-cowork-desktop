import type { ElectronApi } from '../../../../shared/contracts/electron-api';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

type LogsApi = ElectronApi['logs'];

const api = () => requireElectronNamespace('logs');

export const logsClient = {
  isAvailable: () => isElectronNamespaceAvailable('logs'),
  isEnabled: () => api().isEnabled(),
  setEnabled: (...args: Parameters<LogsApi['setEnabled']>) => api().setEnabled(...args),
  getAll: () => api().getAll(),
  getDirectory: () => api().getDirectory(),
  export: () => api().export(),
  open: () => api().open(),
  clear: () => api().clear(),
};
