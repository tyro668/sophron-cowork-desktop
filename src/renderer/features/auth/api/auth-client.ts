import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

function requireAuthApi() {
  return requireElectronNamespace('auth');
}

export const authClient = {
  isAvailable: () => isElectronNamespaceAvailable('auth'),
  getStatus: () => requireAuthApi().getStatus(),
  login: () => requireAuthApi().login(),
  cancelLogin: () => requireAuthApi().cancelLogin(),
  logout: () => requireAuthApi().logout(),
};
