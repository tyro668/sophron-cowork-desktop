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
import type { ScriptGenerateProgressEvent } from '../../shared/automation/script-package';

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
      get: (id) => ipcRenderer.invoke('automation.scripts.get', id),
      open: (id) => ipcRenderer.invoke('automation.scripts.open', id),
      testRun: (id, timeoutMs, target) =>
        ipcRenderer.invoke('automation.scripts.testRun', id, timeoutMs, target),
      versions: (id) => ipcRenderer.invoke('automation.scripts.versions', id),
      versionDetail: (id, version) =>
        ipcRenderer.invoke('automation.scripts.versionDetail', id, version),
      publish: (id, version) => ipcRenderer.invoke('automation.scripts.publish', id, version),
      deleteVersion: (id, version) =>
        ipcRenderer.invoke('automation.scripts.deleteVersion', id, version),
      setMeta: (id, patch) => ipcRenderer.invoke('automation.scripts.setMeta', id, patch),
      editorState: (id) => ipcRenderer.invoke('automation.scripts.editorState', id),
      lastOutput: (id) => ipcRenderer.invoke('automation.scripts.lastOutput', id),
      generateDraft: (input) => ipcRenderer.invoke('automation.scripts.generateDraft', input),
      cancelGenerate: (progressId) =>
        ipcRenderer.invoke('automation.scripts.cancelGenerate', progressId),
      chatTurns: (sessionId) => ipcRenderer.invoke('automation.scripts.chatTurns', sessionId),
      chatProposal: (input) => ipcRenderer.invoke('automation.scripts.chatProposal', input),
      onGenerateProgress: (callback) => {
        const listener = (_event: Electron.IpcRendererEvent, data: ScriptGenerateProgressEvent) =>
          callback(data);
        ipcRenderer.on('automation.scripts.generateProgress', listener);
        return () => ipcRenderer.removeListener('automation.scripts.generateProgress', listener);
      },
    },
    secrets: {
      list: (kind, id) => ipcRenderer.invoke('automation.secrets.list', kind, id),
      set: (kind, id, name, value) =>
        ipcRenderer.invoke('automation.secrets.set', kind, id, name, value),
      delete: (kind, id, name) => ipcRenderer.invoke('automation.secrets.delete', kind, id, name),
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
