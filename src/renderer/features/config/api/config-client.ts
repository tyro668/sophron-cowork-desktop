import type { ElectronApi } from '../../../../shared/contracts/electron-api';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

type ConfigApi = ElectronApi['config'];

const api = () => requireElectronNamespace('config');

export const configClient = {
  isAvailable: () => isElectronNamespaceAvailable('config'),
  get: () => api().get(),
  save: (...args: Parameters<ConfigApi['save']>) => api().save(...args),
  isConfigured: () => api().isConfigured(),
  getPresets: () => api().getPresets(),
  test: (...args: Parameters<ConfigApi['test']>) => api().test(...args),
  diagnose: (...args: Parameters<ConfigApi['diagnose']>) => api().diagnose(...args),
  listModels: (...args: Parameters<ConfigApi['listModels']>) => api().listModels(...args),
  discoverLocal: (...args: Parameters<ConfigApi['discoverLocal']>) => api().discoverLocal(...args),
  createSet: (...args: Parameters<ConfigApi['createSet']>) => api().createSet(...args),
  updateSet: (...args: Parameters<ConfigApi['updateSet']>) => api().updateSet(...args),
  switchSet: (...args: Parameters<ConfigApi['switchSet']>) => api().switchSet(...args),
  selectBuiltinModel: (...args: Parameters<ConfigApi['selectBuiltinModel']>) =>
    api().selectBuiltinModel(...args),
  renameSet: (...args: Parameters<ConfigApi['renameSet']>) => api().renameSet(...args),
  deleteSet: (...args: Parameters<ConfigApi['deleteSet']>) => api().deleteSet(...args),
  codexAuthStatus: () => api().codexAuthStatus(),
  codexImportCli: () => api().codexImportCli(),
  codexLogin: () => api().codexLogin(),
  codexLogout: () => api().codexLogout(),
  codexSubmitLoginCode: (...args: Parameters<ConfigApi['codexSubmitLoginCode']>) =>
    api().codexSubmitLoginCode(...args),
};
