import type { ElectronApi } from '../../../../shared/contracts/electron-api';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

type SkillsApi = ElectronApi['skills'];
type PluginsApi = ElectronApi['plugins'];

const skillsApi = () => requireElectronNamespace('skills');
const pluginsApi = () => requireElectronNamespace('plugins');

export const skillsClient = {
  isAvailable: () => isElectronNamespaceAvailable('skills'),
  getAll: () => skillsApi().getAll(),
  getUsageCounts: (...args: Parameters<SkillsApi['getUsageCounts']>) =>
    skillsApi().getUsageCounts(...args),
  install: (...args: Parameters<SkillsApi['install']>) => skillsApi().install(...args),
  installFromSkillHub: (...args: Parameters<SkillsApi['installFromSkillHub']>) =>
    skillsApi().installFromSkillHub(...args),
  delete: (...args: Parameters<SkillsApi['delete']>) => skillsApi().delete(...args),
  setEnabled: (...args: Parameters<SkillsApi['setEnabled']>) => skillsApi().setEnabled(...args),
  validate: (...args: Parameters<SkillsApi['validate']>) => skillsApi().validate(...args),
  openSkillPath: (...args: Parameters<SkillsApi['openSkillPath']>) =>
    skillsApi().openSkillPath(...args),
  plugins: {
    isAvailable: () => isElectronNamespaceAvailable('plugins'),
    listCatalog: (...args: Parameters<PluginsApi['listCatalog']>) =>
      pluginsApi().listCatalog(...args),
    listInstalled: () => pluginsApi().listInstalled(),
    install: (...args: Parameters<PluginsApi['install']>) => pluginsApi().install(...args),
  },
};
