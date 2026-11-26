/**
 * Typed IPC adapter for the Automation feature — centralizes all
 * `window.electronAPI.automation` calls with availability checks.
 */
import type { ElectronApi } from '../../../../shared/contracts/electron-api';
import { isElectronNamespaceAvailable, requireElectronNamespace } from '../../../utils/ipc-client';

type AutomationApi = ElectronApi['automation'];

const api = () => requireElectronNamespace('automation');

export const automationClient = {
  isAvailable: () => isElectronNamespaceAvailable('automation'),
  list: (...args: Parameters<AutomationApi['list']>) => api().list(...args),
  get: (...args: Parameters<AutomationApi['get']>) => api().get(...args),
  create: (...args: Parameters<AutomationApi['create']>) => api().create(...args),
  update: (...args: Parameters<AutomationApi['update']>) => api().update(...args),
  delete: (...args: Parameters<AutomationApi['delete']>) => api().delete(...args),
  resume: (...args: Parameters<AutomationApi['resume']>) => api().resume(...args),
  runNow: (...args: Parameters<AutomationApi['runNow']>) => api().runNow(...args),
  listRuns: (...args: Parameters<AutomationApi['listRuns']>) => api().listRuns(...args),
  listActionDefinitions: () => api().listActionDefinitions(),
  groups: {
    list: () => api().groups.list(),
    create: (...args: Parameters<AutomationApi['groups']['create']>) =>
      api().groups.create(...args),
    assign: (...args: Parameters<AutomationApi['groups']['assign']>) =>
      api().groups.assign(...args),
    rename: (...args: Parameters<AutomationApi['groups']['rename']>) =>
      api().groups.rename(...args),
    delete: (...args: Parameters<AutomationApi['groups']['delete']>) =>
      api().groups.delete(...args),
  },
  get scripts(): AutomationApi['scripts'] {
    return api().scripts;
  },
};
