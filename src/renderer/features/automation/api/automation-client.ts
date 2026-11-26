/**
 * Typed IPC adapter for the Automation feature — centralizes all
 * `window.electronAPI.automation` calls with availability checks.
 */
import type { ElectronApi } from '../../../../shared/contracts/electron-api';

type AutomationApi = ElectronApi['automation'];

function api(): AutomationApi {
  const bridge = window.electronAPI?.automation;
  if (!bridge) throw new Error('Automation IPC bridge is unavailable');
  return bridge;
}

export const automationClient = {
  isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.electronAPI?.automation);
  },
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
  scripts: {
    get: (...args: Parameters<AutomationApi['scripts']['get']>) => api().scripts.get(...args),
    publish: (...args: Parameters<AutomationApi['scripts']['publish']>) =>
      api().scripts.publish(...args),
  },
};
