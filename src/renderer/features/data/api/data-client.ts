/**
 * Typed IPC adapter for the data feature.
 *
 * Every `window.electronAPI` touch in the data domain funnels through this
 * module — components and hooks never reach for the bridge directly. Methods
 * delegate with the exact `ElectronApi` signatures; `isAvailable`/`has` keep
 * the defensive bridge guards callers already had.
 */
import type { ElectronApi } from '../../../../shared/contracts/electron-api';

type DataApi = ElectronApi['data'];

function dataApi(): DataApi {
  const api = window.electronAPI?.data;
  if (!api) {
    throw new Error('Data IPC bridge is unavailable');
  }
  return api;
}

export const dataClient = {
  listAutomations: () => window.electronAPI.automation.list(),
  getAutomation: (id: string) => window.electronAPI.automation.get(id),
  updateAutomation: (...args: Parameters<ElectronApi['automation']['update']>) =>
    window.electronAPI.automation.update(...args),
  runAutomation: (id: string) => window.electronAPI.automation.runNow(id),
  /** Whether the preload data bridge is present at all. */
  isAvailable(): boolean {
    return Boolean(window.electronAPI?.data);
  },
  /** Defensive check for individual bridge methods. */
  has(method: keyof DataApi): boolean {
    return typeof window.electronAPI?.data?.[method] === 'function';
  },

  // ---- dashboard / tasks ----
  getDashboard: (...args: Parameters<DataApi['getDashboard']>) => dataApi().getDashboard(...args),
  getTask: (...args: Parameters<DataApi['getTask']>) => dataApi().getTask(...args),
  createTask: (...args: Parameters<DataApi['createTask']>) => dataApi().createTask(...args),
  updateTask: (...args: Parameters<DataApi['updateTask']>) => dataApi().updateTask(...args),
  deleteTask: (...args: Parameters<DataApi['deleteTask']>) => dataApi().deleteTask(...args),
  runTask: (...args: Parameters<DataApi['runTask']>) => dataApi().runTask(...args),
  runTaskWithDiagnostics: (...args: Parameters<DataApi['runTaskWithDiagnostics']>) =>
    dataApi().runTaskWithDiagnostics(...args),

  // ---- workflow ----
  getTaskWorkflow: (...args: Parameters<DataApi['getTaskWorkflow']>) =>
    dataApi().getTaskWorkflow(...args),
  getTaskNodeStats: (...args: Parameters<DataApi['getTaskNodeStats']>) =>
    dataApi().getTaskNodeStats(...args),
  saveTaskWorkflow: (...args: Parameters<DataApi['saveTaskWorkflow']>) =>
    dataApi().saveTaskWorkflow(...args),
  validateTaskWorkflowPlan: (...args: Parameters<DataApi['validateTaskWorkflowPlan']>) =>
    dataApi().validateTaskWorkflowPlan(...args),
  previewWorkflowNode: (...args: Parameters<DataApi['previewWorkflowNode']>) =>
    dataApi().previewWorkflowNode(...args),
  getWorkflowNodeColumns: (...args: Parameters<DataApi['getWorkflowNodeColumns']>) =>
    dataApi().getWorkflowNodeColumns(...args),
  getWorkflowNodeColumnTypes: (...args: Parameters<DataApi['getWorkflowNodeColumnTypes']>) =>
    dataApi().getWorkflowNodeColumnTypes(...args),
  getWorkflowNodeColumnValues: (...args: Parameters<DataApi['getWorkflowNodeColumnValues']>) =>
    dataApi().getWorkflowNodeColumnValues(...args),

  // ---- input tables ----
  importDataset: (...args: Parameters<DataApi['importDataset']>) =>
    dataApi().importDataset(...args),
  getInputTable: (...args: Parameters<DataApi['getInputTable']>) =>
    dataApi().getInputTable(...args),
  updateDataset: (...args: Parameters<DataApi['updateDataset']>) =>
    dataApi().updateDataset(...args),
  deleteDataset: (...args: Parameters<DataApi['deleteDataset']>) =>
    dataApi().deleteDataset(...args),
  previewDataset: (...args: Parameters<DataApi['previewDataset']>) =>
    dataApi().previewDataset(...args),
  previewInputTable: (...args: Parameters<DataApi['previewInputTable']>) =>
    dataApi().previewInputTable(...args),
  summarizeInputTableSource: (...args: Parameters<DataApi['summarizeInputTableSource']>) =>
    dataApi().summarizeInputTableSource(...args),

  // ---- output tables ----
  getOutputTable: (...args: Parameters<DataApi['getOutputTable']>) =>
    dataApi().getOutputTable(...args),
  createOutputTable: (...args: Parameters<DataApi['createOutputTable']>) =>
    dataApi().createOutputTable(...args),
  updateOutputTable: (...args: Parameters<DataApi['updateOutputTable']>) =>
    dataApi().updateOutputTable(...args),

  // ---- normalizer ----
  generateInputTableNormalizerDraft: (
    ...args: Parameters<DataApi['generateInputTableNormalizerDraft']>
  ) => dataApi().generateInputTableNormalizerDraft(...args),
  listInputTableNormalizerVersions: (
    ...args: Parameters<DataApi['listInputTableNormalizerVersions']>
  ) => dataApi().listInputTableNormalizerVersions(...args),
  previewInputTableNormalizerVersion: (
    ...args: Parameters<DataApi['previewInputTableNormalizerVersion']>
  ) => dataApi().previewInputTableNormalizerVersion(...args),
  publishInputTableNormalizerVersion: (
    ...args: Parameters<DataApi['publishInputTableNormalizerVersion']>
  ) => dataApi().publishInputTableNormalizerVersion(...args),
  deleteInputTableNormalizerVersion: (
    ...args: Parameters<DataApi['deleteInputTableNormalizerVersion']>
  ) => dataApi().deleteInputTableNormalizerVersion(...args),
  onInputTableNormalizerDraftProgress: (
    ...args: Parameters<DataApi['onInputTableNormalizerDraftProgress']>
  ) => dataApi().onInputTableNormalizerDraftProgress(...args),

  // ---- task generation ----
  generateTaskFromRequirement: (...args: Parameters<DataApi['generateTaskFromRequirement']>) =>
    dataApi().generateTaskFromRequirement(...args),
  analyzeTaskRequirement: (...args: Parameters<DataApi['analyzeTaskRequirement']>) =>
    dataApi().analyzeTaskRequirement(...args),

  // ---- cloud ----
  listCloudSpaces: (...args: Parameters<DataApi['listCloudSpaces']>) =>
    dataApi().listCloudSpaces(...args),
  listCloudProjects: (...args: Parameters<DataApi['listCloudProjects']>) =>
    dataApi().listCloudProjects(...args),
  listCloudTables: (...args: Parameters<DataApi['listCloudTables']>) =>
    dataApi().listCloudTables(...args),
  searchCloudTables: (...args: Parameters<DataApi['searchCloudTables']>) =>
    dataApi().searchCloudTables(...args),
  previewCloudTable: (...args: Parameters<DataApi['previewCloudTable']>) =>
    dataApi().previewCloudTable(...args),
  importCloudTable: (...args: Parameters<DataApi['importCloudTable']>) =>
    dataApi().importCloudTable(...args),
  uploadDataTableToCloud: (...args: Parameters<DataApi['uploadDataTableToCloud']>) =>
    dataApi().uploadDataTableToCloud(...args),
  listCloudDriveFiles: (...args: Parameters<DataApi['listCloudDriveFiles']>) =>
    dataApi().listCloudDriveFiles(...args),
  previewCloudDriveFile: (...args: Parameters<DataApi['previewCloudDriveFile']>) =>
    dataApi().previewCloudDriveFile(...args),
  // ---- host pickers / auth used by the data feature ----
  selectFiles: () => window.electronAPI?.selectFiles?.() ?? Promise.resolve([]),
  selectInputTableSource: (
    ...args: Parameters<NonNullable<ElectronApi['selectInputTableSource']>>
  ) => window.electronAPI?.selectInputTableSource?.(...args) ?? Promise.resolve(null),
  /** Picks an input-table source path, falling back to a file picker. */
  pickInputTableSourcePath: async (
    kind: Parameters<NonNullable<ElectronApi['selectInputTableSource']>>[0]
  ): Promise<string | null> => {
    if (window.electronAPI?.selectInputTableSource) {
      const selection = await window.electronAPI.selectInputTableSource(kind);
      return selection?.path ?? null;
    }
    const files = await window.electronAPI?.selectFiles?.();
    return files?.[0] ?? null;
  },
  hasAuth(): boolean {
    return typeof window.electronAPI?.auth?.login === 'function';
  },
  authLogin: () => {
    const auth = window.electronAPI?.auth;
    if (!auth) {
      throw new Error('Auth IPC bridge is unavailable');
    }
    return auth.login();
  },
};
