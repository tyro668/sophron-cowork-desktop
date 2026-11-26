import type { ElectronApi } from '../../../../shared/contracts/electron-api';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

type SandboxApi = ElectronApi['sandbox'];

const api = () => requireElectronNamespace('sandbox');

export const sandboxClient = {
  isAvailable: () => isElectronNamespaceAvailable('sandbox'),
  getStatus: () => api().getStatus(),
  checkWSL: () => api().checkWSL(),
  checkLima: () => api().checkLima(),
  retrySetup: () => api().retrySetup(),
  retryLimaSetup: () => api().retryLimaSetup(),
  startLimaInstance: () => api().startLimaInstance(),
  stopLimaInstance: () => api().stopLimaInstance(),
  installNodeInWSL: (...args: Parameters<SandboxApi['installNodeInWSL']>) =>
    api().installNodeInWSL(...args),
  installPythonInWSL: (...args: Parameters<SandboxApi['installPythonInWSL']>) =>
    api().installPythonInWSL(...args),
  installNodeInLima: () => api().installNodeInLima(),
  installPythonInLima: () => api().installPythonInLima(),
};
