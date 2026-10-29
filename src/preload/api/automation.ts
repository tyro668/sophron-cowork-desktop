import { ipcRenderer } from 'electron';
import type {
  Automation,
  AutomationActionDefinitionSummary,
  AutomationArtifact,
  AutomationAssignGroupInput,
  AutomationCreateGroupInput,
  AutomationCreateInput,
  AutomationGroup,
  AutomationListQuery,
  AutomationListResult,
  AutomationRenameGroupInput,
  AutomationRun,
  AutomationRunQuery,
  AutomationUpdateInput,
} from '../../shared/contracts';
import type { ElectronApi } from '../../shared/contracts/electron-api';

export function createAutomationApi(): ElectronApi['automation'] {
  return {
    replaceTableAssociation: (table, previousId, nextId) =>
      ipcRenderer.invoke('automation.tableAssociation.replace', table, previousId, nextId),
    getTablePolicy: (table) => ipcRenderer.invoke('automation.tablePolicy.get', table),
    setTablePolicy: (table, patch) =>
      ipcRenderer.invoke('automation.tablePolicy.set', table, patch),
    list: (query?: AutomationListQuery): Promise<AutomationListResult> =>
      ipcRenderer.invoke('automation.list', query),
    get: (id: string): Promise<Automation | null> => ipcRenderer.invoke('automation.get', id),
    create: (payload: AutomationCreateInput): Promise<Automation> =>
      ipcRenderer.invoke('automation.create', payload),
    update: (id: string, updates: AutomationUpdateInput): Promise<Automation | null> =>
      ipcRenderer.invoke('automation.update', id, updates),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('automation.delete', id),
    setEnabled: (id: string, enabled: boolean): Promise<Automation | null> =>
      ipcRenderer.invoke('automation.setEnabled', id, enabled),
    pause: (id: string): Promise<Automation | null> => ipcRenderer.invoke('automation.pause', id),
    resume: (id: string): Promise<Automation | null> => ipcRenderer.invoke('automation.resume', id),
    runNow: (id: string): Promise<AutomationRun | null> =>
      ipcRenderer.invoke('automation.runNow', id),
    listRuns: (id: string, query?: AutomationRunQuery): Promise<AutomationRun[]> =>
      ipcRenderer.invoke('automation.runs.list', id, query),
    listArtifacts: (runId: string): Promise<AutomationArtifact[]> =>
      ipcRenderer.invoke('automation.artifacts.list', runId),
    listActionDefinitions: (): Promise<AutomationActionDefinitionSummary[]> =>
      ipcRenderer.invoke('automation.actions.listDefinitions'),
    scripts: {
      list: () => ipcRenderer.invoke('automation.scripts.list'),
      open: (id, pending) => ipcRenderer.invoke('automation.scripts.open', id, pending),
      testRun: (id, timeoutMs, pending) =>
        ipcRenderer.invoke('automation.scripts.testRun', id, timeoutMs, pending),
      confirmPending: (id) => ipcRenderer.invoke('automation.scripts.confirmPending', id),
      discardPending: (id) => ipcRenderer.invoke('automation.scripts.discardPending', id),
    },
    groups: {
      list: (): Promise<AutomationGroup[]> => ipcRenderer.invoke('automation.groups.list'),
      create: (payload: AutomationCreateGroupInput): Promise<AutomationGroup> =>
        ipcRenderer.invoke('automation.groups.create', payload),
      rename: (payload: AutomationRenameGroupInput): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('automation.groups.rename', payload),
      delete: (id: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('automation.groups.delete', id),
      assign: (payload: AutomationAssignGroupInput): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('automation.groups.assign', payload),
    },
  };
}
