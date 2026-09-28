import { ipcRenderer } from 'electron';
import type {
  DataAnalyzeTaskRequirementResult,
  DataCleaningTask,
  DataColumnTypeInfo,
  DataCreateOutputTableInput,
  DataCreateTaskInput,
  DataDashboard,
  DataDashboardQuery,
  DataDataset,
  DataDeleteInputTableNormalizerVersionInput,
  DataDeleteInputTableNormalizerVersionResult,
  DataGenerateInputTableNormalizerDraftInput,
  DataGenerateInputTableNormalizerDraftResult,
  DataGenerateTaskFromRequirementInput,
  DataGenerateTaskFromRequirementResult,
  DataImportDatasetInput,
  DataInputTableNormalizerDraftProgressEvent,
  DataInputTableNormalizerVersionSaveResult,
  DataInputTablePreview,
  DataInputTableSourceSummary,
  DataListInputTableNormalizerVersionsInput,
  DataListInputTableNormalizerVersionsResult,
  DataExportTableInput,
  DataExportTableResult,
  DataOutputTable,
  DataPreviewDatasetInput,
  DataPreviewInputTableInput,
  DataPreviewInputTableNormalizerVersionInput,
  DataPreviewWorkflowNodeInput,
  DataPublishInputTableNormalizerVersionInput,
  DataRunTaskInput,
  DataSummarizeInputTableSourceInput,
  DataTaskWorkflow,
  DataUpdateDatasetInput,
  DataUpdateOutputTableInput,
  DataUpdateTaskInput,
  DataGroup,
  DataGroupScope,
  DataCreateGroupInput,
  DataRenameGroupInput,
  DataAssignGroupInput,
  DataWorkflowSaveInput,
  ImportCloudTableInput,
  ImportCloudTableResult,
  ListCloudDriveFilesInput,
  ListCloudDriveFilesResult,
  ListCloudProjectsInput,
  ListCloudProjectsResult,
  ListCloudSpacesInput,
  ListCloudSpacesResult,
  ListCloudTablesInput,
  ListCloudTablesResult,
  PreviewCloudDriveFileInput,
  PreviewCloudDriveFileResult,
  PreviewCloudTableInput,
  PreviewCloudTableResult,
  RefreshCloudInputTableInput,
  RefreshCloudInputTableResult,
  RunTaskResult,
  SearchCloudTablesInput,
  SearchCloudTablesResult,
  UploadDataTableToCloudInput,
  UploadDataTableToCloudResult,
  WorkflowNodeRunStat,
  DataTaskRun,
} from '../../shared/contracts';
import type { WorkflowPlanDiagnostic } from '../../shared/workflow-plan';
import type { ElectronApi } from '../../shared/contracts/electron-api';

interface DataCommandIpcError {
  __dataCommandError: true;
  name?: string;
  message: string;
  code?: string;
  details?: unknown;
}

function isDataCommandIpcError(value: unknown): value is DataCommandIpcError {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { __dataCommandError?: unknown }).__dataCommandError === true &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

async function invokeDataCommand<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, payload);
  if (isDataCommandIpcError(result)) {
    throw Object.assign(new Error(result.message), {
      name: result.name || 'DataCommandError',
      code: result.code,
      details: result.details,
    });
  }
  return result as T;
}

export function createDataApi(): ElectronApi['data'] {
  return {
    getDashboard: (payload?: DataDashboardQuery): Promise<DataDashboard> =>
      ipcRenderer.invoke('data.getDashboard', payload),
    getTask: (id: string): Promise<DataCleaningTask | null> =>
      ipcRenderer.invoke('data.getTask', id),
    createTask: (payload: DataCreateTaskInput): Promise<DataCleaningTask> =>
      ipcRenderer.invoke('data.createTask', payload),
    updateTask: (payload: DataUpdateTaskInput): Promise<DataCleaningTask> =>
      ipcRenderer.invoke('data.updateTask', payload),
    listGroups: (scope: DataGroupScope): Promise<DataGroup[]> =>
      ipcRenderer.invoke('data.listGroups', scope),
    createGroup: (payload: DataCreateGroupInput): Promise<DataGroup> =>
      ipcRenderer.invoke('data.createGroup', payload),
    renameGroup: (payload: DataRenameGroupInput): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.renameGroup', payload),
    deleteGroup: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.deleteGroup', id),
    assignGroup: (payload: DataAssignGroupInput): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.assignGroup', payload),
    runTask: (id: string, payload?: DataRunTaskInput): Promise<DataCleaningTask> =>
      ipcRenderer.invoke('data.runTask', id, payload),
    runTaskWithDiagnostics: (id: string, payload?: DataRunTaskInput): Promise<RunTaskResult> =>
      ipcRenderer.invoke('data.runTaskWithDiagnostics', id, payload),
    getTaskWorkflow: (id: string): Promise<DataTaskWorkflow> =>
      ipcRenderer.invoke('data.getTaskWorkflow', id),
    getTaskNodeStats: (id: string): Promise<WorkflowNodeRunStat[]> =>
      ipcRenderer.invoke('data.getTaskNodeStats', id),
    listTaskRuns: (id: string, limit?: number): Promise<DataTaskRun[]> =>
      ipcRenderer.invoke('data.listTaskRuns', id, limit),
    getTaskRunNodeStats: (id: string, runId: string): Promise<WorkflowNodeRunStat[]> =>
      ipcRenderer.invoke('data.getTaskRunNodeStats', id, runId),
    saveTaskWorkflow: (id: string, payload: DataWorkflowSaveInput): Promise<DataTaskWorkflow> =>
      ipcRenderer.invoke('data.saveTaskWorkflow', id, payload),
    validateTaskWorkflowPlan: (
      id: string,
      payload: DataWorkflowSaveInput
    ): Promise<WorkflowPlanDiagnostic[]> =>
      ipcRenderer.invoke('data.validateTaskWorkflowPlan', id, payload),
    importDataset: (payload: DataImportDatasetInput): Promise<DataDataset> =>
      ipcRenderer.invoke('data.importDataset', payload),
    getInputTable: (id: string): Promise<DataDataset | null> =>
      ipcRenderer.invoke('data.getInputTable', id),
    updateDataset: (payload: DataUpdateDatasetInput): Promise<DataDataset> =>
      ipcRenderer.invoke('data.updateDataset', payload),
    getOutputTable: (id: string): Promise<DataOutputTable | null> =>
      ipcRenderer.invoke('data.getOutputTable', id),
    createOutputTable: (payload?: DataCreateOutputTableInput): Promise<DataOutputTable> =>
      ipcRenderer.invoke('data.createOutputTable', payload),
    updateOutputTable: (payload: DataUpdateOutputTableInput): Promise<DataOutputTable> =>
      ipcRenderer.invoke('data.updateOutputTable', payload),
    previewInputTable: (payload: DataPreviewInputTableInput): Promise<DataInputTablePreview> =>
      ipcRenderer.invoke('data.previewInputTable', payload),
    previewDataset: (payload: DataPreviewDatasetInput): Promise<DataInputTablePreview> =>
      ipcRenderer.invoke('data.previewDataset', payload),
    exportTable: (payload: DataExportTableInput): Promise<DataExportTableResult> =>
      ipcRenderer.invoke('data.exportTable', payload),
    previewWorkflowNode: (payload: DataPreviewWorkflowNodeInput): Promise<DataInputTablePreview> =>
      ipcRenderer.invoke('data.previewWorkflowNode', payload),
    getWorkflowNodeColumns: (payload: DataPreviewWorkflowNodeInput): Promise<string[]> =>
      ipcRenderer.invoke('data.getWorkflowNodeColumns', payload),
    getWorkflowNodeColumnTypes: (
      payload: DataPreviewWorkflowNodeInput
    ): Promise<DataColumnTypeInfo[]> =>
      ipcRenderer.invoke('data.getWorkflowNodeColumnTypes', payload),
    getWorkflowNodeColumnValues: (
      payload: DataPreviewWorkflowNodeInput & { column: string }
    ): Promise<string[]> => ipcRenderer.invoke('data.getWorkflowNodeColumnValues', payload),
    summarizeInputTableSource: (
      payload: DataSummarizeInputTableSourceInput
    ): Promise<DataInputTableSourceSummary> =>
      ipcRenderer.invoke('data.summarizeInputTableSource', payload),
    generateInputTableNormalizerDraft: (
      payload: DataGenerateInputTableNormalizerDraftInput
    ): Promise<DataGenerateInputTableNormalizerDraftResult> =>
      ipcRenderer.invoke('data.generateInputTableNormalizerDraft', payload),
    generateTaskFromRequirement: (
      payload: DataGenerateTaskFromRequirementInput
    ): Promise<DataGenerateTaskFromRequirementResult> =>
      ipcRenderer.invoke('data.generateTaskFromRequirement', payload),
    analyzeTaskRequirement: (
      payload: DataGenerateTaskFromRequirementInput
    ): Promise<DataAnalyzeTaskRequirementResult> =>
      ipcRenderer.invoke('data.analyzeTaskRequirement', payload),
    onInputTableNormalizerDraftProgress: (
      callback: (event: DataInputTableNormalizerDraftProgressEvent) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: DataInputTableNormalizerDraftProgressEvent
      ) => callback(data);
      ipcRenderer.on('data.inputTableNormalizerDraftProgress', listener);
      return () => ipcRenderer.removeListener('data.inputTableNormalizerDraftProgress', listener);
    },
    previewInputTableNormalizerVersion: (
      payload: DataPreviewInputTableNormalizerVersionInput
    ): Promise<{ preview: DataInputTablePreview }> =>
      ipcRenderer.invoke('data.previewInputTableNormalizerVersion', payload),
    publishInputTableNormalizerVersion: (
      payload: DataPublishInputTableNormalizerVersionInput
    ): Promise<DataInputTableNormalizerVersionSaveResult> =>
      ipcRenderer.invoke('data.publishInputTableNormalizerVersion', payload),
    deleteInputTableNormalizerVersion: (
      payload: DataDeleteInputTableNormalizerVersionInput
    ): Promise<DataDeleteInputTableNormalizerVersionResult> =>
      ipcRenderer.invoke('data.deleteInputTableNormalizerVersion', payload),
    listInputTableNormalizerVersions: (
      payload: DataListInputTableNormalizerVersionsInput
    ): Promise<DataListInputTableNormalizerVersionsResult> =>
      ipcRenderer.invoke('data.listInputTableNormalizerVersions', payload),
    deleteTask: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.deleteTask', id),
    deleteDataset: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.deleteDataset', id),
    listCloudSpaces: (payload?: ListCloudSpacesInput): Promise<ListCloudSpacesResult> =>
      invokeDataCommand('data.listCloudSpaces', payload),
    listCloudProjects: (payload: ListCloudProjectsInput): Promise<ListCloudProjectsResult> =>
      invokeDataCommand('data.listCloudProjects', payload),
    listCloudTables: (payload: ListCloudTablesInput): Promise<ListCloudTablesResult> =>
      invokeDataCommand('data.listCloudTables', payload),
    searchCloudTables: (payload: SearchCloudTablesInput): Promise<SearchCloudTablesResult> =>
      invokeDataCommand('data.searchCloudTables', payload),
    previewCloudTable: (payload: PreviewCloudTableInput): Promise<PreviewCloudTableResult> =>
      invokeDataCommand('data.previewCloudTable', payload),
    importCloudTable: (payload: ImportCloudTableInput): Promise<ImportCloudTableResult> =>
      invokeDataCommand('data.importCloudTable', payload),
    refreshCloudInputTable: (
      payload: RefreshCloudInputTableInput
    ): Promise<RefreshCloudInputTableResult> =>
      invokeDataCommand('data.refreshCloudInputTable', payload),
    uploadDataTableToCloud: (
      payload: UploadDataTableToCloudInput
    ): Promise<UploadDataTableToCloudResult> =>
      invokeDataCommand('data.uploadDataTableToCloud', payload),
    listCloudDriveFiles: (payload: ListCloudDriveFilesInput): Promise<ListCloudDriveFilesResult> =>
      invokeDataCommand('data.listCloudDriveFiles', payload),
    previewCloudDriveFile: (
      payload: PreviewCloudDriveFileInput
    ): Promise<PreviewCloudDriveFileResult> =>
      invokeDataCommand('data.previewCloudDriveFile', payload),
  };
}
