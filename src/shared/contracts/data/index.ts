/**
 * Cross-process data contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */
import type { DataColumnTypeInfo } from '../../data-field-types';
import type {
  PersonalAnalysisConnectionInput,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  PersonalAnalysisTableListResult,
  PersonalAnalysisTableSearchParams,
} from '../../personal-analysis-types';
import type { DataWorkflowOperatorType } from '../../data-workflow-types';

export type { DataColumnTypeInfo, DataFieldType } from '../../data-field-types';

export type {
  PersonalAnalysisConfig,
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDatasource,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  PersonalAnalysisTableListResult,
  PersonalAnalysisTableSearchParams,
} from '../../personal-analysis-types';

// Data workspace types
export type DataTaskStatus = 'running' | 'completed' | 'stopped' | 'draft' | 'pending' | 'failed';

export type DataTaskStatusCounts = Record<DataTaskStatus, number>;

export interface DataCleaningTask {
  id: string;
  name: string;
  status: DataTaskStatus;
  nodeCount: number;
  sourcePath: string | null;
  sourceDatasetId: string | null;
  outputTable: string | null;
  rowCount: number | null;
  columnCount: number | null;
  error: string | null;
  scheduledFor: number | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
}

export type DataInputTableSourceKind = 'excel' | 'csv' | 'folder';

export type DataInputTableProcessingStrategy = 'auto' | 'customize';

export interface DataInputTableAutoProcessingConfig {
  strategy: 'auto';
}

export type DataNormalizerRuntime =
  | {
      language: 'python';
      pythonVersion?: string;
      environment: 'system' | 'venv';
      executable?: string;
    }
  | { language: 'node'; nodeVersion?: string; environment: 'system' | 'npm'; executable?: string };

export interface DataNormalizerEntrypoint {
  cwd?: string;
  command: string[];
}

export interface DataNormalizerDependencyPrepareConfig {
  steps: Array<{
    cwd?: string;
    command: string[];
  }>;
  preparedRuntime?: string;
  lockFiles: string[];
}

export interface DataNormalizerProjectFile {
  path: string;
  content: string;
}

export type DataNormalizerLanguage = 'python' | 'node';

export type DataNormalizerArtifactVersionStatus = 'draft' | 'published' | 'archived';

export interface DataNormalizerDependencySpec {
  name: string;
  version?: string;
  manager?: 'pip' | 'npm';
  source?: string;
}

export interface DataInputTableNormalizerArtifact {
  id: string;
  name: string;
  description?: string | null;
  sourceKind: DataInputTableSourceKind;
  primaryLanguage: DataNormalizerLanguage;
  activeVersionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataInputTableNormalizerArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  status: DataNormalizerArtifactVersionStatus;
  files: DataNormalizerProjectFile[];
  fileTreeHash: string;
  rulePrompt: string;
  sourceSummaryHash?: string | null;
  entrypoint: DataNormalizerEntrypoint;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  runtime: DataNormalizerRuntime;
  dependencies: DataNormalizerDependencySpec[];
  dependencyLockHash?: string | null;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number | null;
}

export interface DataSaveInputTableNormalizerDraftInput {
  artifactId?: string | null;
  name: string;
  description?: string | null;
  sourceKind: DataInputTableSourceKind;
  primaryLanguage: DataNormalizerLanguage;
  rulePrompt: string;
  files: DataNormalizerProjectFile[];
  fileTreeHash: string;
  sourceSummaryHash?: string | null;
  entrypoint: DataNormalizerEntrypoint;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  runtime: DataNormalizerRuntime;
  dependencies?: DataNormalizerDependencySpec[];
  dependencyLockHash?: string | null;
}

export interface DataInputTableNormalizerVersionSaveResult {
  artifact: DataInputTableNormalizerArtifact;
  version: DataInputTableNormalizerArtifactVersion;
}

export interface DataPublishInputTableNormalizerVersionInput {
  versionId: string;
}

export interface DataDeleteInputTableNormalizerVersionInput {
  versionId: string;
}

export interface DataDeleteInputTableNormalizerVersionResult {
  success: boolean;
}

export interface DataListInputTableNormalizerVersionsInput {
  artifactId: string;
}

export interface DataListInputTableNormalizerVersionsResult {
  versions: DataInputTableNormalizerArtifactVersion[];
}

export interface DataGenerateInputTableNormalizerDraftInput {
  artifactId?: string | null;
  name: string;
  description?: string | null;
  sourcePath: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
  rulePrompt: string;
  selectedSkillNames?: string[];
  modelConfigSetId?: string | null;
  model?: string | null;
  primaryLanguage?: DataNormalizerLanguage;
  progressId?: string;
}

export interface DataGenerateInputTableNormalizerDraftResult {
  artifact: DataInputTableNormalizerArtifact;
  version: DataInputTableNormalizerArtifactVersion;
  summary: DataInputTableSourceSummary;
}

export type DataInputTableNormalizerDraftProgressPhase =
  | 'source_summary'
  | 'source_analysis'
  | 'code_generation'
  | 'saving'
  | 'complete'
  | 'error';

export interface DataInputTableNormalizerDraftProgressEvent {
  progressId: string;
  phase: DataInputTableNormalizerDraftProgressPhase;
  kind: 'message' | 'delta';
  text: string;
}

export interface DataPreviewInputTableNormalizerVersionInput {
  versionId: string;
  sourcePath: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
  prepareDependencies?: boolean;
  limit?: number;
  offset?: number;
}

export interface DataSummarizeInputTableSourceInput {
  sourcePath: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
  maxFiles?: number;
  maxSheetsPerFile?: number;
  maxRowsPerSheet?: number;
  maxColumnsPerRow?: number;
}

export interface DataInputTableSourceSummary {
  sourcePath: string;
  sourceKind: DataInputTableSourceKind;
  generatedAt: number;
  hash: string;
  fileCount: number;
  sampledFileCount: number;
  truncated: boolean;
  notes: string[];
  files: DataInputTableSourceFileSummary[];
}

export interface DataInputTableSourceFileSummary {
  path: string;
  name: string;
  relativePath: string;
  extension: string;
  kind: 'excel' | 'csv' | 'other';
  sizeBytes: number;
  modifiedAt: number;
  sheets?: DataInputTableExcelSheetSummary[];
  sampleRows?: string[][];
  delimiter?: string;
  warning?: string;
}

export interface DataInputTableExcelSheetSummary {
  name: string;
  range: string | null;
  mergeCount: number;
  mergedCells?: DataInputTableExcelMergedCellSummary[];
  rowCountEstimate: number;
  columnCountEstimate: number;
  headerCandidates: DataInputTableHeaderCandidate[];
  sampleRows: string[][];
}

export interface DataInputTableExcelMergedCellSummary {
  range: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  value: string;
}

export interface DataInputTableHeaderCandidate {
  rowNumber: number;
  nonEmptyCellCount: number;
  values: string[];
}

export interface DataInputTableCustomizeProcessingConfig {
  strategy: 'customize';
  rulePrompt: string;
  selectedSkillNames?: string[];
  modelConfigSetId?: string | null;
  model?: string | null;
  artifactId?: string;
  artifactVersionId?: string;
  artifactVersionStatus?: 'draft' | 'published' | 'archived';
  fileTreeHash?: string;
  dependencyLockHash?: string;
  runtime?: DataNormalizerRuntime;
  entrypoint?: DataNormalizerEntrypoint;
  dependencyPrepare?: DataNormalizerDependencyPrepareConfig;
  projectFiles?: DataNormalizerProjectFile[];
  sourceSummaryHash?: string;
}

export type DataInputTableProcessingConfig =
  | DataInputTableAutoProcessingConfig
  | DataInputTableCustomizeProcessingConfig;

export interface DataInputTableProcessingFields {
  dataProcessing: DataInputTableProcessingConfig;
}

export interface DataInputTableExcelConfig {
  sourceKind: 'excel';
  sheetName: string | null;
  sheetNames: string[];
  headerMode: 'auto' | 'manual';
  headerRow: number;
  dataProcessing?: DataInputTableProcessingConfig;
}

export interface DataInputTableCsvConfig {
  sourceKind: 'csv';
  header: 'auto';
  dataRegion: 'auto';
  encoding: 'auto';
  delimiter: 'auto';
  dataProcessing?: DataInputTableProcessingConfig;
  cloudMirror?: {
    tableId: string;
    sourceVersion?: string;
    contentHash: string;
  };
}

export interface DataInputTableFolderConfig {
  sourceKind: 'folder';
  mergeMode: 'append_same_schema';
  schemaStrategy: 'align_by_name';
  fileRange: 'excel_csv' | 'excel' | 'csv';
  skipEmptyFiles: boolean;
  keepSourceFileName: boolean;
  dataProcessing?: DataInputTableProcessingConfig;
}

export type DataInputTableConfig =
  | DataInputTableExcelConfig
  | DataInputTableCsvConfig
  | DataInputTableFolderConfig;

export interface DataDataset {
  id: string;
  name: string;
  sourcePath: string;
  sourceKind: DataInputTableSourceKind;
  inputConfig: DataInputTableConfig;
  fileCount: number;
  relatedTaskNames: string[];
  tableName: string;
  rowCount: number;
  columnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DataOutputTable {
  id: string;
  name: string;
  sourceDatasetId: string | null;
  tableName: string;
  rowCount: number;
  columnCount: number;
  relatedTaskNames: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DataDashboardSummary {
  taskCount: number;
  workflowNodeCount: number;
  runningCount: number;
  todayScheduleCount: number;
  statusCounts: DataTaskStatusCounts;
}

export interface DataDashboard {
  summary: DataDashboardSummary;
  tasks: DataCleaningTask[];
  datasets: DataDataset[];
  outputTables: DataOutputTable[];
  totalTasks: number;
  totalDatasets: number;
  totalOutputTables: number;
}

export interface DataDashboardQuery {
  query?: string;
  includeSummary?: boolean;
  includeTasks?: boolean;
  includeDatasets?: boolean;
  includeOutputTables?: boolean;
  taskOffset?: number;
  taskLimit?: number;
  datasetOffset?: number;
  datasetLimit?: number;
  outputOffset?: number;
  outputLimit?: number;
  datasetSourceKind?: DataInputTableSourceKind | 'all';
}

export interface DataCreateTaskInput {
  name: string;
  sourcePath?: string | null;
  sourceDatasetId?: string | null;
  outputTableId?: string | null;
}

export interface DataUpdateTaskInput {
  id: string;
  name?: string;
}

export interface DataRunTaskInput {
  sourcePath?: string | null;
  workflow?: DataWorkflowSaveInput | null;
  outputMode?: 'persisted' | 'temporary';
}

export interface WorkflowNodeRunStat {
  nodeId: string;
  nodeType: string;
  inputRows: number | null;
  outputRows: number;
  droppedRows?: number;
  rejectedRows?: number;
  sample?: Record<string, unknown>[];
}

export interface RunTaskResult {
  task: DataCleaningTask;
  diagnostics?: unknown[];
  nodeStats?: WorkflowNodeRunStat[];
}

export type DataAutomationLocation = 'cloud' | 'local';

export interface DataAutomationColumnSnapshot {
  name: string;
  type?: string;
}

export interface DataAutomationLineageEntry {
  name: string;
  type?: string;
  sourceColumns: DataAutomationColumnSnapshot[];
  expression?: string;
}

export interface DataAutomationSourceBinding {
  location: DataAutomationLocation;
  tableId: string;
  tableName?: string;
  spaceId?: string;
  spaceName?: string;
  projectId?: string;
  projectName?: string;
  datasourceId?: string;
  folderId?: string;
  columnsSnapshot?: DataAutomationColumnSnapshot[];
  requiredColumns?: DataAutomationColumnSnapshot[];
  updatedAt?: string;
  contentHash?: string;
}

export interface DataAutomationOutputBinding {
  location: DataAutomationLocation;
  writeMode: 'create' | 'replace';
  targetTableId?: string;
  tableName?: string;
  spaceId?: string;
  projectId?: string;
  datasourceId?: string;
  folderId?: string;
  localOutputTableId?: string;
}

export interface DataGenerateTaskFromRequirementInput {
  source: DataAutomationSourceBinding;
  processRequirement: string;
  output: DataAutomationOutputBinding;
  /** Correlates requirement analysis, generation, and repair calls from one UI flow. */
  usageTraceId?: string;
  /** Short-lived backend receipt binding a confirmed analysis to this generation request. */
  analysisId?: string | null;
  modelConfigSetId?: string | null;
  model?: string | null;
  reuseTaskId?: string | null;
  currentVersion?: number | null;
}

export type DataTaskRequirementItemStatus = 'supported' | 'ambiguous' | 'unsupported';

export interface DataTaskRequirementAnalysisItem {
  requirement: string;
  status: DataTaskRequirementItemStatus;
  reason?: string;
  suggestedRequirement?: string;
  operations: string[];
  capabilities?: string[];
}

export interface DataAnalyzeTaskRequirementResult {
  status: 'supported' | 'needs_confirmation' | 'unsupported';
  items: DataTaskRequirementAnalysisItem[];
  analysisId?: string;
  capabilityProfileVersion?: string;
  sourceSummaryHash?: string;
  expiresAt?: number;
}

export interface DataGenerateTaskFromRequirementResult {
  taskId: string;
  taskName: string;
  outputTableId: string;
  outputTableName: string;
  /** Optional compatibility representation for display/export; native nodes are the source of truth. */
  workflowDsl?: string;
  workflowDslAvailable: boolean;
  requiredColumns: DataAutomationColumnSnapshot[];
  expectedOutputSchema: DataAutomationColumnSnapshot[];
  lineage: DataAutomationLineageEntry[];
  columnsSnapshot: DataAutomationColumnSnapshot[];
  sourceSummaryHash: string;
  workflowHash: string;
  version: number;
  generatedAt: number;
}

export interface DataImportDatasetInput {
  filePath: string;
  name?: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
}

export interface DataUpdateDatasetInput {
  id: string;
  filePath?: string;
  name?: string;
  sourceKind?: DataInputTableSourceKind;
  config?: DataInputTableConfig;
}

export interface DataCreateOutputTableInput {
  name?: string;
}

export interface DataUpdateOutputTableInput {
  id: string;
  name?: string;
  sourceDatasetId?: string | null;
}

export interface DataPreviewInputTableInput {
  filePath: string;
  sourceKind: DataInputTableSourceKind;
  config: DataInputTableConfig;
  limit?: number;
  offset?: number;
}

export interface DataPreviewDatasetInput {
  id: string;
  limit?: number;
  offset?: number;
}

export interface DataPreviewWorkflowNodeInput {
  taskId: string;
  nodeId: string;
  nodeType: DataWorkflowOperatorType;
  nodeConfig?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface DataPreviewWorkflowNodeColumnInput extends DataPreviewWorkflowNodeInput {
  column: string;
}

export interface DataInputTablePreview {
  columns: string[];
  columnTypes: DataColumnTypeInfo[];
  rows: Array<Record<string, string | number | boolean | null>>;
  fileCount: number;
  limit: number;
  offset: number;
  totalRows: number;
}

export interface DataInputTableSourceSelection {
  path: string;
  kind: DataInputTableSourceKind;
}

export type { DataWorkflowOperatorType } from '../../data-workflow-types';

export interface DataWorkflowNode {
  id: string;
  taskId: string;
  type: DataWorkflowOperatorType;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface DataWorkflowEdge {
  id: string;
  taskId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: number;
}

export interface DataTaskWorkflow {
  task: DataCleaningTask;
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
}

export interface DataWorkflowNodeInput {
  id: string;
  type: DataWorkflowOperatorType;
  label: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

export interface DataWorkflowEdgeInput {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface DataWorkflowSaveInput {
  nodes: DataWorkflowNodeInput[];
  edges: DataWorkflowEdgeInput[];
}

export type ListCloudSpacesInput = PersonalAnalysisConnectionInput;

export interface ListCloudSpacesResult {
  spaces: PersonalAnalysisSpace[];
}

export interface ListCloudProjectsInput extends PersonalAnalysisConnectionInput {
  spaceId: string;
}

export interface ListCloudProjectsResult {
  projects: PersonalAnalysisProject[];
}

export interface ListCloudTablesInput
  extends PersonalAnalysisConnectionInput, PersonalAnalysisTableSearchParams {
  spaceId: string;
  projectId: string;
}

export type ListCloudTablesResult = PersonalAnalysisTableListResult;

export interface SearchCloudTablesInput
  extends PersonalAnalysisConnectionInput, PersonalAnalysisTableSearchParams {
  keyword: string;
}

export type SearchCloudTablesResult = PersonalAnalysisTableListResult;

export interface PreviewCloudTableInput extends PersonalAnalysisConnectionInput {
  tableId: string;
  limit?: number;
  offset?: number;
}

export interface PreviewCloudTableResult {
  cloudTableId: string;
  downloadedFilePath: string;
  preview: DataInputTablePreview;
}

export interface ImportCloudTableInput extends PersonalAnalysisConnectionInput {
  tableId: string;
  spaceId?: string;
  projectId?: string;
  name?: string;
  previewRows?: number;
}

export interface ImportCloudTableResult {
  inputTable: DataDataset;
  preview?: DataInputTablePreview;
  cloudTableId: string;
  cloudTable?: PersonalAnalysisTable;
  downloadedFilePath: string;
}

export interface UploadDataTableToCloudInput extends PersonalAnalysisConnectionInput {
  tableKind: 'input' | 'output';
  id: string;
  writeMode: 'CREATE' | 'REPLACE';
  datasourceId?: string;
  folderId?: string;
  projectId?: string;
  spaceId?: string;
  tableId?: string;
  tableName?: string;
  fileName?: string;
  maxRows?: number;
  waitForDone?: boolean;
}

export interface UploadDataTableToCloudResult {
  sourceTable: {
    tableKind: 'input' | 'output';
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
  };
  csvBytes: number;
  upload: {
    uploadTaskId: string;
    importTaskId: string;
    tableId: string;
    sheetId?: string;
    status: string;
    table?: PersonalAnalysisTable;
  };
}
