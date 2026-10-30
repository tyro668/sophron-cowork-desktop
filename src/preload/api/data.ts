import { ipcRenderer } from 'electron';
import type {
  DataPipeline,
  DataColumnTypeInfo,
  DataCreateResultTableInput,
  DataCreatePipelineInput,
  DataDashboard,
  DataDashboardQuery,
  DataRawTable,
  DataDeleteRawTableNormalizerVersionInput,
  DataDeleteRawTableNormalizerVersionResult,
  DataGenerateRawTableNormalizerDraftInput,
  DataGenerateRawTableNormalizerDraftResult,
  DataImportRawTableInput,
  DataRawTableNormalizerDraftProgressEvent,
  DataRawTableNormalizerVersionSaveResult,
  DataRawTablePreview,
  DataRawTableSourceSummary,
  DataRawSource,
  DataRawSourceScan,
  DataScanRawSourceInput,
  DataCreateRawSourceInput,
  DataRawSourceCreateResult,
  DataRawSourceRefreshResult,
  DataResolveRawSourceRenamesInput,
  DataResolveRawSourceRenamesResult,
  DataRawSourceRebuildImpact,
  DataRebuildRawSourceInput,
  DataListRawTableNormalizerVersionsInput,
  DataListRawTableNormalizerVersionsResult,
  DataExportTableInput,
  DataExportTableResult,
  DataResultTable,
  DataPreviewRawTableSourceInput,
  DataPreviewRawTableInput,
  DataPreviewRawTableNormalizerVersionInput,
  DataPreviewWorkflowNodeInput,
  DataPublishRawTableNormalizerVersionInput,
  DataRunPipelineInput,
  DataSummarizeRawTableSourceInput,
  DataPipelineWorkflow,
  DataUpdateRawTableInput,
  DataUpdateResultTableInput,
  DataUpdatePipelineInput,
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
  RefreshCloudRawTableInput,
  RefreshCloudRawTableResult,
  RunPipelineResult,
  SearchCloudTablesInput,
  SearchCloudTablesResult,
  UploadDataTableToCloudInput,
  UploadDataTableToCloudResult,
  WorkflowNodeRunStat,
  DataPipelineRun,
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
    getPipeline: (id: string): Promise<DataPipeline | null> =>
      ipcRenderer.invoke('data.getPipeline', id),
    createPipeline: (payload: DataCreatePipelineInput): Promise<DataPipeline> =>
      ipcRenderer.invoke('data.createPipeline', payload),
    updatePipeline: (payload: DataUpdatePipelineInput): Promise<DataPipeline> =>
      ipcRenderer.invoke('data.updatePipeline', payload),
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
    runPipeline: (id: string, payload?: DataRunPipelineInput): Promise<DataPipeline> =>
      ipcRenderer.invoke('data.runPipeline', id, payload),
    runPipelineWithDiagnostics: (
      id: string,
      payload?: DataRunPipelineInput
    ): Promise<RunPipelineResult> =>
      ipcRenderer.invoke('data.runPipelineWithDiagnostics', id, payload),
    getPipelineWorkflow: (id: string): Promise<DataPipelineWorkflow> =>
      ipcRenderer.invoke('data.getPipelineWorkflow', id),
    getPipelineNodeStats: (id: string): Promise<WorkflowNodeRunStat[]> =>
      ipcRenderer.invoke('data.getPipelineNodeStats', id),
    listPipelineRuns: (id: string, limit?: number): Promise<DataPipelineRun[]> =>
      ipcRenderer.invoke('data.listPipelineRuns', id, limit),
    getPipelineRunNodeStats: (id: string, runId: string): Promise<WorkflowNodeRunStat[]> =>
      ipcRenderer.invoke('data.getPipelineRunNodeStats', id, runId),
    savePipelineWorkflow: (
      id: string,
      payload: DataWorkflowSaveInput
    ): Promise<DataPipelineWorkflow> =>
      ipcRenderer.invoke('data.savePipelineWorkflow', id, payload),
    validatePipelineWorkflowPlan: (
      id: string,
      payload: DataWorkflowSaveInput
    ): Promise<WorkflowPlanDiagnostic[]> =>
      ipcRenderer.invoke('data.validatePipelineWorkflowPlan', id, payload),
    importRawTable: (payload: DataImportRawTableInput): Promise<DataRawTable> =>
      ipcRenderer.invoke('data.importRawTable', payload),
    getRawTable: (id: string): Promise<DataRawTable | null> =>
      ipcRenderer.invoke('data.getRawTable', id),
    updateRawTable: (payload: DataUpdateRawTableInput): Promise<DataRawTable> =>
      ipcRenderer.invoke('data.updateRawTable', payload),
    getResultTable: (id: string): Promise<DataResultTable | null> =>
      ipcRenderer.invoke('data.getResultTable', id),
    createResultTable: (payload?: DataCreateResultTableInput): Promise<DataResultTable> =>
      ipcRenderer.invoke('data.createResultTable', payload),
    updateResultTable: (payload: DataUpdateResultTableInput): Promise<DataResultTable> =>
      ipcRenderer.invoke('data.updateResultTable', payload),
    previewRawTableSource: (
      payload: DataPreviewRawTableSourceInput
    ): Promise<DataRawTablePreview> => ipcRenderer.invoke('data.previewRawTableSource', payload),
    previewRawTable: (payload: DataPreviewRawTableInput): Promise<DataRawTablePreview> =>
      ipcRenderer.invoke('data.previewRawTable', payload),
    exportTable: (payload: DataExportTableInput): Promise<DataExportTableResult> =>
      ipcRenderer.invoke('data.exportTable', payload),
    previewWorkflowNode: (payload: DataPreviewWorkflowNodeInput): Promise<DataRawTablePreview> =>
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
    summarizeRawTableSource: (
      payload: DataSummarizeRawTableSourceInput
    ): Promise<DataRawTableSourceSummary> =>
      ipcRenderer.invoke('data.summarizeRawTableSource', payload),
    listRawSources: (): Promise<DataRawSource[]> => ipcRenderer.invoke('data.listRawSources'),
    scanRawSource: (payload: DataScanRawSourceInput): Promise<DataRawSourceScan> =>
      ipcRenderer.invoke('data.scanRawSource', payload),
    createRawSource: (payload: DataCreateRawSourceInput): Promise<DataRawSourceCreateResult> =>
      ipcRenderer.invoke('data.createRawSource', payload),
    resolveRawSourceRenames: (
      input: DataResolveRawSourceRenamesInput
    ): Promise<DataResolveRawSourceRenamesResult> =>
      ipcRenderer.invoke('data.resolveRawSourceRenames', input),
    setRawSourceAutoInclude: (id: string, autoInclude: boolean) =>
      ipcRenderer.invoke('data.setRawSourceAutoInclude', id, autoInclude),
    refreshRawSource: (id: string): Promise<DataRawSourceRefreshResult> =>
      ipcRenderer.invoke('data.refreshRawSource', id),
    getRawSourceRebuildImpact: (id: string): Promise<DataRawSourceRebuildImpact> =>
      ipcRenderer.invoke('data.getRawSourceRebuildImpact', id),
    rebuildRawSource: (payload: DataRebuildRawSourceInput): Promise<DataRawSourceCreateResult> =>
      ipcRenderer.invoke('data.rebuildRawSource', payload),
    deleteRawSource: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('data.deleteRawSource', id),
    generateRawTableNormalizerDraft: (
      payload: DataGenerateRawTableNormalizerDraftInput
    ): Promise<DataGenerateRawTableNormalizerDraftResult> =>
      ipcRenderer.invoke('data.generateRawTableNormalizerDraft', payload),
    cancelRawTableNormalizerDraft: (progressId: string): Promise<{ cancelled: boolean }> =>
      ipcRenderer.invoke('data.cancelRawTableNormalizerDraft', progressId),
    onRawTableNormalizerDraftProgress: (
      callback: (event: DataRawTableNormalizerDraftProgressEvent) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: DataRawTableNormalizerDraftProgressEvent
      ) => callback(data);
      ipcRenderer.on('data.rawTableNormalizerDraftProgress', listener);
      return () => ipcRenderer.removeListener('data.rawTableNormalizerDraftProgress', listener);
    },
    previewRawTableNormalizerVersion: (
      payload: DataPreviewRawTableNormalizerVersionInput
    ): Promise<{ preview: DataRawTablePreview }> =>
      ipcRenderer.invoke('data.previewRawTableNormalizerVersion', payload),
    publishRawTableNormalizerVersion: (
      payload: DataPublishRawTableNormalizerVersionInput
    ): Promise<DataRawTableNormalizerVersionSaveResult> =>
      ipcRenderer.invoke('data.publishRawTableNormalizerVersion', payload),
    deleteRawTableNormalizerVersion: (
      payload: DataDeleteRawTableNormalizerVersionInput
    ): Promise<DataDeleteRawTableNormalizerVersionResult> =>
      ipcRenderer.invoke('data.deleteRawTableNormalizerVersion', payload),
    listRawTableNormalizerVersions: (
      payload: DataListRawTableNormalizerVersionsInput
    ): Promise<DataListRawTableNormalizerVersionsResult> =>
      ipcRenderer.invoke('data.listRawTableNormalizerVersions', payload),
    deletePipeline: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.deletePipeline', id),
    deleteRawTable: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('data.deleteRawTable', id),
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
    importCloudRawTable: (payload: ImportCloudTableInput): Promise<ImportCloudTableResult> =>
      invokeDataCommand('data.importCloudRawTable', payload),
    refreshCloudRawTable: (
      payload: RefreshCloudRawTableInput
    ): Promise<RefreshCloudRawTableResult> =>
      invokeDataCommand('data.refreshCloudRawTable', payload),
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
