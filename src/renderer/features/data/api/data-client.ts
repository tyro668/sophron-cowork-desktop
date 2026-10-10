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
  listAutomations: (...args: Parameters<ElectronApi['automation']['list']>) =>
    window.electronAPI.automation.list(...args),
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

  // ---- dashboard / pipelines ----
  getDashboard: (...args: Parameters<DataApi['getDashboard']>) => dataApi().getDashboard(...args),
  getPipeline: (...args: Parameters<DataApi['getPipeline']>) => dataApi().getPipeline(...args),
  createPipeline: (...args: Parameters<DataApi['createPipeline']>) =>
    dataApi().createPipeline(...args),
  updatePipeline: (...args: Parameters<DataApi['updatePipeline']>) =>
    dataApi().updatePipeline(...args),
  listGroups: (...args: Parameters<DataApi['listGroups']>) => dataApi().listGroups(...args),
  createGroup: (...args: Parameters<DataApi['createGroup']>) => dataApi().createGroup(...args),
  renameGroup: (...args: Parameters<DataApi['renameGroup']>) => dataApi().renameGroup(...args),
  deleteGroup: (...args: Parameters<DataApi['deleteGroup']>) => dataApi().deleteGroup(...args),
  assignGroup: (...args: Parameters<DataApi['assignGroup']>) => dataApi().assignGroup(...args),
  deletePipeline: (...args: Parameters<DataApi['deletePipeline']>) =>
    dataApi().deletePipeline(...args),
  runPipeline: (...args: Parameters<DataApi['runPipeline']>) => dataApi().runPipeline(...args),
  runPipelineWithDiagnostics: (...args: Parameters<DataApi['runPipelineWithDiagnostics']>) =>
    dataApi().runPipelineWithDiagnostics(...args),

  // ---- workflow ----
  getPipelineWorkflow: (...args: Parameters<DataApi['getPipelineWorkflow']>) =>
    dataApi().getPipelineWorkflow(...args),
  getPipelineNodeStats: (...args: Parameters<DataApi['getPipelineNodeStats']>) =>
    dataApi().getPipelineNodeStats(...args),
  listPipelineRuns: (...args: Parameters<DataApi['listPipelineRuns']>) =>
    dataApi().listPipelineRuns(...args),
  getPipelineRunNodeStats: (...args: Parameters<DataApi['getPipelineRunNodeStats']>) =>
    dataApi().getPipelineRunNodeStats(...args),
  savePipelineWorkflow: (...args: Parameters<DataApi['savePipelineWorkflow']>) =>
    dataApi().savePipelineWorkflow(...args),
  validatePipelineWorkflowPlan: (...args: Parameters<DataApi['validatePipelineWorkflowPlan']>) =>
    dataApi().validatePipelineWorkflowPlan(...args),
  previewWorkflowNode: (...args: Parameters<DataApi['previewWorkflowNode']>) =>
    dataApi().previewWorkflowNode(...args),
  getWorkflowNodeColumns: (...args: Parameters<DataApi['getWorkflowNodeColumns']>) =>
    dataApi().getWorkflowNodeColumns(...args),
  getWorkflowNodeColumnTypes: (...args: Parameters<DataApi['getWorkflowNodeColumnTypes']>) =>
    dataApi().getWorkflowNodeColumnTypes(...args),
  getWorkflowNodeColumnValues: (...args: Parameters<DataApi['getWorkflowNodeColumnValues']>) =>
    dataApi().getWorkflowNodeColumnValues(...args),

  // ---- input tables ----
  importRawTable: (...args: Parameters<DataApi['importRawTable']>) =>
    dataApi().importRawTable(...args),
  getRawTable: (...args: Parameters<DataApi['getRawTable']>) => dataApi().getRawTable(...args),
  updateRawTable: (...args: Parameters<DataApi['updateRawTable']>) =>
    dataApi().updateRawTable(...args),
  deleteRawTable: (...args: Parameters<DataApi['deleteRawTable']>) =>
    dataApi().deleteRawTable(...args),
  previewRawTable: (...args: Parameters<DataApi['previewRawTable']>) =>
    dataApi().previewRawTable(...args),
  exportTable: (...args: Parameters<DataApi['exportTable']>) => dataApi().exportTable(...args),
  previewRawTableSource: (...args: Parameters<DataApi['previewRawTableSource']>) =>
    dataApi().previewRawTableSource(...args),
  summarizeRawTableSource: (...args: Parameters<DataApi['summarizeRawTableSource']>) =>
    dataApi().summarizeRawTableSource(...args),

  // ---- output tables ----
  getResultTable: (...args: Parameters<DataApi['getResultTable']>) =>
    dataApi().getResultTable(...args),
  createResultTable: (...args: Parameters<DataApi['createResultTable']>) =>
    dataApi().createResultTable(...args),
  updateResultTable: (...args: Parameters<DataApi['updateResultTable']>) =>
    dataApi().updateResultTable(...args),

  // ---- normalizer ----
  generateRawTableNormalizerDraft: (
    ...args: Parameters<DataApi['generateRawTableNormalizerDraft']>
  ) => dataApi().generateRawTableNormalizerDraft(...args),
  listRawTableNormalizerVersions: (
    ...args: Parameters<DataApi['listRawTableNormalizerVersions']>
  ) => dataApi().listRawTableNormalizerVersions(...args),
  previewRawTableNormalizerVersion: (
    ...args: Parameters<DataApi['previewRawTableNormalizerVersion']>
  ) => dataApi().previewRawTableNormalizerVersion(...args),
  publishRawTableNormalizerVersion: (
    ...args: Parameters<DataApi['publishRawTableNormalizerVersion']>
  ) => dataApi().publishRawTableNormalizerVersion(...args),
  deleteRawTableNormalizerVersion: (
    ...args: Parameters<DataApi['deleteRawTableNormalizerVersion']>
  ) => dataApi().deleteRawTableNormalizerVersion(...args),
  onRawTableNormalizerDraftProgress: (
    ...args: Parameters<DataApi['onRawTableNormalizerDraftProgress']>
  ) => dataApi().onRawTableNormalizerDraftProgress(...args),

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
  importCloudRawTable: (...args: Parameters<DataApi['importCloudRawTable']>) =>
    dataApi().importCloudRawTable(...args),
  refreshCloudRawTable: (...args: Parameters<DataApi['refreshCloudRawTable']>) =>
    dataApi().refreshCloudRawTable(...args),
  uploadDataTableToCloud: (...args: Parameters<DataApi['uploadDataTableToCloud']>) =>
    dataApi().uploadDataTableToCloud(...args),
  listCloudDriveFiles: (...args: Parameters<DataApi['listCloudDriveFiles']>) =>
    dataApi().listCloudDriveFiles(...args),
  previewCloudDriveFile: (...args: Parameters<DataApi['previewCloudDriveFile']>) =>
    dataApi().previewCloudDriveFile(...args),
  // ---- host pickers / auth used by the data feature ----
  selectFiles: () => window.electronAPI?.selectFiles?.() ?? Promise.resolve([]),
  selectRawTableSource: (...args: Parameters<NonNullable<ElectronApi['selectRawTableSource']>>) =>
    window.electronAPI?.selectRawTableSource?.(...args) ?? Promise.resolve(null),
  /** Picks an raw-table source path, falling back to a file picker. */
  pickRawTableSourcePath: async (
    kind: Parameters<NonNullable<ElectronApi['selectRawTableSource']>>[0]
  ): Promise<string | null> => {
    if (kind === 'cloud') return null;
    if (window.electronAPI?.selectRawTableSource) {
      const selection = await window.electronAPI.selectRawTableSource(kind);
      return selection?.path ?? null;
    }
    const files = await window.electronAPI?.selectFiles?.();
    return files?.[0] ?? null;
  },
  hasAuth(): boolean {
    return typeof window.electronAPI?.auth?.login === 'function';
  },
  authGetStatus: () => window.electronAPI.auth.getStatus(),
  authLogin: () => {
    const auth = window.electronAPI?.auth;
    if (!auth) {
      throw new Error('Auth IPC bridge is unavailable');
    }
    return auth.login();
  },
};
