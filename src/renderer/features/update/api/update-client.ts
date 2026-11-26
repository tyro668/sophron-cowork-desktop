import type { AppUpdateState } from '../../../types';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

function requireUpdateApi() {
  return requireElectronNamespace('update');
}

export const updateClient = {
  isAvailable: () => isElectronNamespaceAvailable('update'),
  getState: () => requireUpdateApi().getState(),
  checkAndInstall: () => requireUpdateApi().checkAndInstall(),
  onState: (callback: (state: AppUpdateState) => void) => requireUpdateApi().onState(callback),
};
