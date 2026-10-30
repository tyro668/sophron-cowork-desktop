/**
 * Cross-process data contracts. Shared by main, preload, and renderer.
 * Must not import from main/, renderer/, or preload/.
 */
import type { DataColumnTypeInfo, DataFieldType } from '../../data-field-types';
import type {
  CloudOutputAction,
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDriveFile,
  PersonalAnalysisDriveFileListResult,
  PersonalAnalysisDriveFileSearchParams,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  PersonalAnalysisTableListResult,
  PersonalAnalysisTableSearchParams,
} from '../../personal-analysis-types';
import type { DataWorkflowOperatorType } from '../../data-workflow-types';

export type { DataColumnTypeInfo, DataFieldType } from '../../data-field-types';

export type {
  CloudOutputAction,
  CloudOutputActionSpec,
  CloudOutputActionTrigger,
  CloudOutputActionType,
  PersonalAnalysisConfig,
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDatasource,
  PersonalAnalysisDriveFile,
  PersonalAnalysisDriveFileListResult,
  PersonalAnalysisDriveFileSearchParams,
  PersonalAnalysisDriveSyncResult,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  PersonalAnalysisTableListResult,
  PersonalAnalysisTableSearchParams,
} from '../../personal-analysis-types';

// Data workspace types
export type DataPipelineStatus =
  'running' | 'completed' | 'stopped' | 'draft' | 'pending' | 'failed';

export type DataPipelineStatusCounts = Record<DataPipelineStatus, number>;

export type DataGroupScope = 'pipeline' | 'raw' | 'result';

export interface DataGroup {
  id: string;
  scope: DataGroupScope;
  name: string;
  createdAt: number;
}

export interface DataPipeline {
  id: string;
  name: string;
  status: DataPipelineStatus;
  groupId: string | null;
  nodeCount: number;
  sourcePath: string | null;
  sourceRawTableId: string | null;
  resultTable: string | null;
  rowCount: number | null;
  columnCount: number | null;
  error: string | null;
  scheduledFor: number | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
}

export type DataRawTableSourceKind = 'excel' | 'csv' | 'folder' | 'cloud';

export type DataRawTableProcessingStrategy = 'auto' | 'customize';

export interface DataRawTableAutoProcessingConfig {
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

/** 来源 of a normalizer version: generated from the rule, or edited in the repo folder. */
export type DataNormalizerVersionSource = 'rule' | 'manual' | 'ai_repair';

export interface DataNormalizerDependencySpec {
  name: string;
  version?: string;
  manager?: 'pip' | 'npm';
  source?: string;
}

export interface DataRawTableNormalizerArtifact {
  id: string;
  name: string;
  description?: string | null;
  sourceKind: DataRawTableSourceKind;
  primaryLanguage: DataNormalizerLanguage;
  activeVersionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataRawTableNormalizerArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  status: DataNormalizerArtifactVersionStatus;
  source: DataNormalizerVersionSource;
  /** Commit in the normalizer's git repo; `files` and `tree` are read from it. */
  commit: string;
  files: DataNormalizerProjectFile[];
  /** Git blob oid per file path, for diffs and changed markers between versions. */
  tree: Record<string, string>;
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

export interface DataSaveRawTableNormalizerDraftInput {
  artifactId?: string | null;
  name: string;
  description?: string | null;
  sourceKind: DataRawTableSourceKind;
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

export interface DataRawTableNormalizerVersionSaveResult {
  artifact: DataRawTableNormalizerArtifact;
  version: DataRawTableNormalizerArtifactVersion;
}

export interface DataPublishRawTableNormalizerVersionInput {
  versionId: string;
}

export interface DataDeleteRawTableNormalizerVersionInput {
  versionId: string;
}

export interface DataDeleteRawTableNormalizerVersionResult {
  success: boolean;
}

export interface DataListRawTableNormalizerVersionsInput {
  artifactId: string;
}

export interface DataListRawTableNormalizerVersionsResult {
  versions: DataRawTableNormalizerArtifactVersion[];
}

export interface DataGenerateRawTableNormalizerDraftInput {
  artifactId?: string | null;
  name: string;
  description?: string | null;
  sourcePath: string;
  sourceKind?: DataRawTableSourceKind;
  config?: DataRawTableConfig;
  rulePrompt: string;
  selectedSkillNames?: string[];
  modelConfigSetId?: string | null;
  model?: string | null;
  primaryLanguage?: DataNormalizerLanguage;
  progressId?: string;
  /** 交给 AI 修复: a follow-up turn that edits `baseVersionId`'s files instead of regenerating. */
  fix?: DataNormalizerFixInput;
}

/** A preview failure handed to the model as a fix turn on the current draft. */
export interface DataNormalizerFixInput {
  baseVersionId: string;
  /** Raw preview error (the main process strips prefixes, paths and secrets). */
  error: string;
  note?: string;
  durationMs?: number;
  round?: number;
  maxRounds?: number;
  previousAttempts?: string[];
}

export interface DataGenerateRawTableNormalizerDraftResult {
  artifact: DataRawTableNormalizerArtifact;
  version: DataRawTableNormalizerArtifactVersion;
  summary: DataRawTableSourceSummary;
  /** Fix turns: files the model changed, its one-line explanation, and whether the AI 修复 draft was overwritten. */
  changedFiles?: string[];
  fixSummary?: string;
  replaced?: boolean;
}

export type DataRawTableNormalizerDraftProgressPhase =
  | 'source_summary'
  | 'source_analysis'
  | 'code_generation'
  | 'verify'
  | 'saving'
  | 'complete'
  | 'error';

export interface DataRawTableNormalizerDraftProgressEvent {
  progressId: string;
  phase: DataRawTableNormalizerDraftProgressPhase;
  kind: 'message' | 'delta';
  text: string;
}

export interface DataPreviewRawTableNormalizerVersionInput {
  versionId: string;
  sourcePath: string;
  sourceKind?: DataRawTableSourceKind;
  config?: DataRawTableConfig;
  prepareDependencies?: boolean;
  limit?: number;
  offset?: number;
}

export interface DataSummarizeRawTableSourceInput {
  sourcePath: string;
  sourceKind?: DataRawTableSourceKind;
  config?: DataRawTableConfig;
  maxFiles?: number;
  maxSheetsPerFile?: number;
  maxRowsPerSheet?: number;
  maxColumnsPerRow?: number;
}

export interface DataRawTableSourceSummary {
  sourcePath: string;
  sourceKind: DataRawTableSourceKind;
  generatedAt: number;
  hash: string;
  fileCount: number;
  sampledFileCount: number;
  truncated: boolean;
  notes: string[];
  files: DataRawTableSourceFileSummary[];
}

export interface DataRawTableSourceFileSummary {
  path: string;
  name: string;
  relativePath: string;
  extension: string;
  kind: 'excel' | 'csv' | 'other';
  sizeBytes: number;
  modifiedAt: number;
  sheets?: DataRawTableExcelSheetSummary[];
  sampleRows?: string[][];
  delimiter?: string;
  warning?: string;
}

export interface DataRawTableExcelSheetSummary {
  name: string;
  range: string | null;
  mergeCount: number;
  mergedCells?: DataRawTableExcelMergedCellSummary[];
  rowCountEstimate: number;
  columnCountEstimate: number;
  headerCandidates: DataRawTableHeaderCandidate[];
  sampleRows: string[][];
}

export interface DataRawTableExcelMergedCellSummary {
  range: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  value: string;
}

export interface DataRawTableHeaderCandidate {
  rowNumber: number;
  nonEmptyCellCount: number;
  values: string[];
}

export interface DataRawTableCustomizeProcessingConfig {
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
  sourceSummaryHash?: string;
}

export type DataRawTableProcessingConfig =
  DataRawTableAutoProcessingConfig | DataRawTableCustomizeProcessingConfig;

export interface DataRawTableProcessingFields {
  dataProcessing: DataRawTableProcessingConfig;
}

export interface DataRawTableColumnTypeOverride {
  name: string;
  type: DataFieldType;
}

export interface DataRawTableExcelConfig {
  sourceKind: 'excel';
  sheetName: string | null;
  sheetNames: string[];
  headerMode: 'auto' | 'manual';
  headerRow: number;
  /** Per-column target types applied when rows are materialized into DuckDB. */
  columnTypeOverrides?: DataRawTableColumnTypeOverride[];
  dataProcessing?: DataRawTableProcessingConfig;
  /** When set, these sheets are stacked into one table with a `_sheet` system column. */
  mergeSheets?: string[];
  /** Merged sheets that were missing at the last refresh (the table keeps the last import). */
  missingMergeSheets?: string[];
}

export interface DataRawTableCsvConfig {
  sourceKind: 'csv';
  header: 'auto';
  dataRegion: 'auto';
  /** 'auto' detects UTF-8 (with/without BOM) and falls back to GBK/GB18030. */
  encoding: 'auto' | 'utf-8' | 'gbk';
  delimiter: 'auto';
  /** Per-column target types applied when the file is read into DuckDB. */
  columnTypeOverrides?: DataRawTableColumnTypeOverride[];
  dataProcessing?: DataRawTableProcessingConfig;
  /** Legacy Csv imports; new cloud imports use DataRawTableCloudConfig. */
  cloudMirror?: DataRawTableCloudSource;
}

export interface DataRawTableCloudSource {
  automationSyncKey?: string;
  tableId: string;
  spaceId?: string;
  projectId?: string;
  spaceName?: string;
  projectName?: string;
  tableKind?: 'base' | 'analysis';
  tableName?: string;
  /** Cloud table `updatedAt` captured at the last successful sync. */
  sourceVersion?: string;
  /** Epoch ms of the last successful cloud import/sync. */
  syncedAt?: number;
  contentHash: string;
}

export interface DataRawTableCloudConfig {
  sourceKind: 'cloud';
  cloudMirror: DataRawTableCloudSource;
  dataProcessing?: DataRawTableProcessingConfig;
}

export interface DataRawTableFolderConfig {
  sourceKind: 'folder';
  mergeMode: 'append_same_schema';
  schemaStrategy: 'align_by_name';
  fileRange: 'excel_csv' | 'excel' | 'csv';
  skipEmptyFiles: boolean;
  keepSourceFileName: boolean;
  /** Which sheet of a multi-sheet Excel file is read; files without it are excluded. */
  sheetSelector?: DataRawSheetSelector;
  /** Relative paths the user (or the compatibility check) left out of the merge. */
  excludedFiles?: string[];
  /** Result of the last merge: what was filled with nulls and what was left out. */
  mergeReport?: DataRawFolderMergeReport;
  /** Per-column target types applied to every imported file. */
  columnTypeOverrides?: DataRawTableColumnTypeOverride[];
  dataProcessing?: DataRawTableProcessingConfig;
}

export type DataRawTableConfig =
  | DataRawTableExcelConfig
  | DataRawTableCsvConfig
  | DataRawTableFolderConfig
  | DataRawTableCloudConfig;

/** Sheet choice for Excel files inside a folder source. Index is 1-based. */
export type DataRawSheetSelector = { by: 'name'; name: string } | { by: 'index'; index: number };

export interface DataRawFolderMergeReport {
  includedFiles: string[];
  missingSheetFiles: string[];
  typeConflictFiles: Array<{ file: string; columns: string[] }>;
  filledColumns: Array<{ name: string; missingInFiles: string[] }>;
}

/**
 * How a raw-table source turns into tables. A source (file or folder) owns 1..N raw tables.
 * - excel_single: one chosen sheet → one table
 * - excel_per_sheet: each chosen sheet → its own table
 * - excel_merge_sheets: chosen sheets stacked into one table (`_sheet` column)
 * - folder_merge: all files appended into one table (`_来源文件` column)
 * - folder_per_file: one table per file
 * - single: a CSV file or a cloud table (always one table)
 */
export type DataRawSourceBuildMode =
  | 'excel_single'
  | 'excel_per_sheet'
  | 'excel_merge_sheets'
  | 'folder_merge'
  | 'folder_per_file'
  | 'single'
  /** A table mirrored from the cloud space; refreshed by cloud sync, never rebuilt. */
  | 'cloud_table';

export type DataRawSourceKind = 'excel' | 'csv' | 'folder' | 'cloud';

export type DataRawSourceMemberStatus = 'ok' | 'missing';

export interface DataRawSourceConfig {
  sheetSelector?: DataRawSheetSelector;
  /** Folder per-file mode: per-file sheet override, keyed by relative path. */
  fileSheetOverrides?: Record<string, string>;
  excludedFiles?: string[];
  fileRange?: DataRawTableFolderConfig['fileRange'];
  /** New sheets / files found on refresh become tables automatically. */
  autoInclude: boolean;
  /** Excel per-sheet / merge: the sheets the user picked. */
  sheets?: string[];
  /** Sheets / files present at the last scan, so refresh can tell what is new. */
  knownMembers?: string[];
  lastScannedAt?: number | null;
}

export interface DataRawSource {
  id: string;
  name: string;
  sourcePath: string;
  sourceKind: DataRawSourceKind;
  buildMode: DataRawSourceBuildMode;
  config: DataRawSourceConfig;
  /** Member raw-table ids, in creation order. */
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DataScanRawSourceInput {
  sourcePath: string;
  sheetSelector?: DataRawSheetSelector;
  fileSheetOverrides?: Record<string, string>;
  fileRange?: DataRawTableFolderConfig['fileRange'];
}

export interface DataRawSourceSheetScan {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  /** Sheet has no tabular data (only free text or empty). */
  empty: boolean;
}

export type DataRawSourceFileStatus =
  'ready' | 'missing_sheet' | 'type_conflict' | 'skipped' | 'unreadable';

export interface DataRawSourceFileScan {
  path: string;
  relativePath: string;
  kind: 'excel' | 'csv';
  status: DataRawSourceFileStatus;
  /** Why the file is skipped / unreadable / conflicting. */
  reason?: string;
  sheetNames: string[];
  usedSheet: string | null;
  rowCount: number;
  columns: string[];
  conflictColumns?: string[];
}

export interface DataRawSourceScan {
  sourcePath: string;
  kind: 'excel' | 'csv' | 'folder';
  name: string;
  sizeBytes: number;
  sheets: DataRawSourceSheetScan[];
  files: DataRawSourceFileScan[];
  /** Folder merge estimate over the `ready` files. */
  merge: {
    fileCount: number;
    rowCount: number;
    filledColumns: Array<{ name: string; missingInFiles: string[] }>;
  } | null;
}

export interface DataRawSourceMemberPlan {
  /** Sheet name (excel modes) or relative file path (folder per-file). */
  key: string;
  name?: string;
  /** Folder per-file: sheet to read for this file (overrides the selector). */
  sheetName?: string;
  headerRow?: number;
}

export interface DataCreateRawSourceInput {
  sourcePath: string;
  name?: string;
  buildMode: DataRawSourceBuildMode;
  /** excel_single / excel_per_sheet / folder_per_file: the tables to create. */
  members?: DataRawSourceMemberPlan[];
  /** excel_merge_sheets: sheets to stack. */
  sheets?: string[];
  /** excel_merge_sheets / folder_merge: name of the single table. */
  tableName?: string;
  sheetSelector?: DataRawSheetSelector;
  fileSheetOverrides?: Record<string, string>;
  excludedFiles?: string[];
  fileRange?: DataRawTableFolderConfig['fileRange'];
  autoInclude?: boolean;
}

export interface DataRawSourceCreateResult {
  source: DataRawSource;
  tables: DataRawTable[];
  /** Files / sheets that were not turned into tables, with the reason. */
  skipped: Array<{ key: string; reason: string }>;
}

export interface DataRawSourceRebuildImpact {
  sourceId: string;
  tables: Array<{ id: string; name: string; rowCount: number; pipelineNames: string[] }>;
}

export interface DataRebuildRawSourceInput extends DataCreateRawSourceInput {
  sourceId: string;
  /** Must be true: the user confirmed deleting the existing tables. */
  confirmDeleteExistingTables: boolean;
}

/** A missing member that looks like a renamed sheet / file (fingerprint match). */
export interface DataRawSourceRenameCandidate {
  tableId: string;
  tableName: string;
  oldKey: string;
  newKey: string;
  /** 0..1 — column names + types + first 50 rows. */
  similarity: number;
}

export interface DataRawSourceChangeItem {
  id: string;
  name: string;
  key: string | null;
  pipelineNames: string[];
}

export interface DataRawSourceRefreshResult {
  source: DataRawSource;
  refreshed: string[];
  added: string[];
  missing: string[];
  failed: Array<{ id: string; error: string }>;
  /** Suspected renames; their tables keep the last import but are flagged missing until the user decides. */
  renames: DataRawSourceRenameCandidate[];
  addedItems: DataRawSourceChangeItem[];
  missingItems: DataRawSourceChangeItem[];
  unchangedNames: string[];
}

export interface DataResolveRawSourceRenamesInput {
  sourceId: string;
  decisions: Array<{ tableId: string; newKey: string; action: 'rename' | 'new' }>;
}

export interface DataResolveRawSourceRenamesResult {
  source: DataRawSource;
  renamed: string[];
  added: string[];
  missing: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface DataRawTable {
  id: string;
  name: string;
  groupId: string | null;
  /** Owning raw-table source (every input table belongs to exactly one). */
  sourceId?: string | null;
  /** Sheet name or relative file path inside the source. */
  memberKey?: string | null;
  memberStatus?: DataRawSourceMemberStatus;
  /** Runtime source; for cloud tables this is a private cache path, never a UI source binding. */
  sourcePath: string;
  sourceKind: DataRawTableSourceKind;
  inputConfig: DataRawTableConfig;
  fileCount: number;
  relatedPipelineNames: string[];
  tableName: string;
  rowCount: number;
  columnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DataResultTable {
  id: string;
  name: string;
  groupId: string | null;
  sourceRawTableId: string | null;
  tableName: string;
  rowCount: number;
  columnCount: number;
  relatedPipelineNames: string[];
  relatedPipelineIds: string[];
  createdAt: number;
  updatedAt: number;
  /** Legacy metadata, retained only for pre-automation migration compatibility. */
  cloudAction?: CloudOutputAction | null;
}

/** File export formats supported by `data.exportTable`. */
export type DataTableExportFormat = 'csv' | 'xlsx';

export interface DataExportTableInput {
  tableKind: 'raw' | 'result';
  id: string;
  format: DataTableExportFormat;
}

export interface DataExportTableResult {
  success: boolean;
  path?: string;
  /** 'cancelled' when the user dismissed the save dialog. */
  error?: string;
}

export interface DataDashboardSummary {
  pipelineCount: number;
  workflowNodeCount: number;
  runningCount: number;
  todayScheduleCount: number;
  statusCounts: DataPipelineStatusCounts;
}

export interface DataDashboard {
  summary: DataDashboardSummary;
  pipelines: DataPipeline[];
  rawTables: DataRawTable[];
  resultTables: DataResultTable[];
  groups: DataGroup[];
  totalPipelines: number;
  totalRawTables: number;
  totalResultTables: number;
  /** Total row count per group key (`g:<id>` or `ungrouped`). Used for per-group "load all". */
  pipelineGroupCounts: Record<string, number>;
  rawTableGroupCounts: Record<string, number>;
  outputGroupCounts: Record<string, number>;
}

export interface DataDashboardQuery {
  query?: string;
  includeSummary?: boolean;
  includePipelines?: boolean;
  includeRawTables?: boolean;
  includeResultTables?: boolean;
  pipelineOffset?: number;
  pipelineLimit?: number;
  rawTableOffset?: number;
  rawTableLimit?: number;
  outputOffset?: number;
  outputLimit?: number;
  rawTableSourceKind?: DataRawTableSourceKind | 'all';
  /** When set, only fetch rows for this group (null = ungrouped). Used for "load all". */
  pipelineGroupId?: string | null;
  rawTableGroupId?: string | null;
  outputGroupId?: string | null;
  /** Max rows to fetch per group for the initial grouped load. */
  pipelinePerGroupLimit?: number;
  rawTablePerGroupLimit?: number;
  outputPerGroupLimit?: number;
}

export interface DataCreatePipelineInput {
  name: string;
  sourcePath?: string | null;
  sourceRawTableId?: string | null;
  resultTableId?: string | null;
}

export interface DataUpdatePipelineInput {
  id: string;
  name?: string;
}

export interface DataCreateGroupInput {
  scope: DataGroupScope;
  name: string;
}

export interface DataRenameGroupInput {
  id: string;
  name: string;
}

export interface DataAssignGroupInput {
  scope: DataGroupScope;
  ids: string[];
  /** null returns the rows to the ungrouped section. */
  groupId: string | null;
}

export interface DataRunPipelineInput {
  sourcePath?: string | null;
  workflow?: DataWorkflowSaveInput | null;
  outputMode?: 'persisted' | 'temporary';
}

export interface WorkflowNodeRunStat {
  nodeId: string;
  nodeType: string;
  inputRows: number | null;
  /** Per-input-handle row counts for multi-input operators (e.g. join/set_op left+right). */
  inputRowsByHandle?: Record<string, number>;
  outputRows: number;
  droppedRows?: number;
  rejectedRows?: number;
  sample?: Record<string, unknown>[];
  /** Run this stat belongs to; absent on legacy single-batch stats. */
  runId?: string;
}

export type DataPipelineRunTrigger = 'run' | 'trial';
export type DataPipelineRunStatus = 'running' | 'completed' | 'failed';

/** One recorded pipeline execution (trial and persisted runs share the table). */
export interface DataPipelineRun {
  id: string;
  pipelineId: string;
  /** Per-pipeline monotonically increasing run number, starting at 1. */
  seq: number;
  trigger: DataPipelineRunTrigger;
  status: DataPipelineRunStatus;
  /** Execution signature of the workflow version that ran. */
  workflowSignature: string | null;
  /** Rows read across input nodes; null when no stats were collected. */
  inputRows: number | null;
  /** Rows written across output nodes; null when no stats were collected. */
  outputRows: number | null;
  error: string | null;
  /** Node that failed (from the executor's workflowOrigin), when known. */
  failedNodeId: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface RunPipelineResult {
  pipeline: DataPipeline;
  diagnostics?: unknown[];
  nodeStats?: WorkflowNodeRunStat[];
  /**
   * Temporary runs cannot persist run stats, so a failed temporary run is
   * returned as a structured result instead of a bare rejection — `nodeStats`
   * carries the stats/samples collected before the failure.
   */
  failure?: { message: string };
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
  /** Set when the column is a window value, e.g. `avg · 按 区域` for `avg([x]) over (by: [区域])`. */
  window?: string;
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
  localResultTableId?: string;
}

export interface DataPipelineRequirementConversationEntry {
  role: 'user' | 'assistant';
  text: string;
}

export interface DataGeneratePipelineFromRequirementInput {
  source: DataAutomationSourceBinding;
  processRequirement: string;
  output: DataAutomationOutputBinding;
  /**
   * Earlier requirement↔analysis turns (user messages plus the analysis feedback
   * they produced), in order. Gives the analyzer context so a short follow-up
   * message can be mapped back to the question it answers. Analysis only.
   */
  requirementConversation?: DataPipelineRequirementConversationEntry[];
  /** Correlates requirement analysis, generation, and repair calls from one UI flow. */
  usageTraceId?: string;
  /** Short-lived backend receipt binding a confirmed analysis to this generation request. */
  analysisId?: string | null;
  modelConfigSetId?: string | null;
  model?: string | null;
  reusePipelineId?: string | null;
  currentVersion?: number | null;
  /** Selected canvas node the generated steps continue from; the result merges into the workflow instead of replacing it. */
  startFromNodeId?: string | null;
  /** Live canvas draft — supplies the anchor node's output schema and the merge base (unsaved edits included). */
  workflow?: DataWorkflowSaveInput | null;
}

export type DataPipelineRequirementItemStatus = 'supported' | 'ambiguous' | 'unsupported';

export interface DataPipelineRequirementAnalysisItem {
  requirement: string;
  status: DataPipelineRequirementItemStatus;
  reason?: string;
  suggestedRequirement?: string;
  operations: string[];
  capabilities?: string[];
}

export interface DataAnalyzePipelineRequirementResult {
  status: 'supported' | 'needs_confirmation' | 'unsupported';
  items: DataPipelineRequirementAnalysisItem[];
  analysisId?: string;
  capabilityProfileVersion?: string;
  sourceSummaryHash?: string;
  expiresAt?: number;
}

export interface DataGeneratePipelineFromRequirementResult {
  pipelineId: string;
  pipelineName: string;
  resultTableId: string;
  resultTableName: string;
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

export interface DataImportRawTableInput {
  filePath: string;
  name?: string;
  sourceKind?: DataRawTableSourceKind;
  config?: DataRawTableConfig;
  /** Attach to this source instead of creating a single-table source. Internal. */
  sourceId?: string;
  memberKey?: string | null;
}

export interface DataUpdateRawTableInput {
  id: string;
  filePath?: string;
  name?: string;
  sourceKind?: DataRawTableSourceKind;
  config?: DataRawTableConfig;
}

export interface DataCreateResultTableInput {
  name?: string;
}

export interface DataUpdateResultTableInput {
  id: string;
  name?: string;
  sourceRawTableId?: string | null;
}

export interface DataPreviewRawTableSourceInput {
  filePath: string;
  sourceKind: DataRawTableSourceKind;
  config: DataRawTableConfig;
  limit?: number;
  offset?: number;
}

export interface DataPreviewRawTableInput {
  id: string;
  limit?: number;
  offset?: number;
}

export interface DataPreviewWorkflowNodeInput {
  pipelineId: string;
  nodeId: string;
  nodeType: DataWorkflowOperatorType;
  nodeConfig?: Record<string, unknown>;
  /**
   * Live (possibly unsaved) canvas graph. When present, schema inference uses
   * it instead of the saved workflow so field/type lookups reflect draft edits.
   */
  workflow?: DataWorkflowSaveInput | null;
  limit?: number;
  offset?: number;
}

export interface DataPreviewWorkflowNodeColumnInput extends DataPreviewWorkflowNodeInput {
  column: string;
}

export interface DataRawTablePreview {
  columns: string[];
  columnTypes: DataColumnTypeInfo[];
  rows: Array<Record<string, string | number | boolean | null>>;
  fileCount: number;
  limit: number;
  offset: number;
  totalRows: number;
  /** Epoch ms the materialized table was generated at (cache created_at). */
  generatedAt?: number | null;
  /** Upstream-subgraph signature the materialized table was produced under. */
  workflowSignature?: string | null;
}

export interface DataRawTableSourceSelection {
  path: string;
  kind: DataRawTableSourceKind;
}

export type { DataWorkflowOperatorType } from '../../data-workflow-types';

export interface DataWorkflowNode {
  id: string;
  pipelineId: string;
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
  pipelineId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: number;
}

export interface DataPipelineWorkflow {
  pipeline: DataPipeline;
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
  preview: DataRawTablePreview;
}

export interface ImportCloudTableInput extends PersonalAnalysisConnectionInput {
  /** Rebind this input table instead of creating another one. */
  rawTableId?: string;
  tableId: string;
  spaceId?: string;
  projectId?: string;
  /** Display names kept for provenance display; ids remain authoritative. */
  spaceName?: string;
  projectName?: string;
  name?: string;
  previewRows?: number;
}

export interface ImportCloudTableResult {
  rawTable: DataRawTable;
  preview?: DataRawTablePreview;
  cloudTableId: string;
  cloudTable?: PersonalAnalysisTable;
  downloadedFilePath: string;
}

export interface RefreshCloudRawTableInput extends PersonalAnalysisConnectionInput {
  rawTableId: string;
}

export interface RefreshCloudRawTableResult {
  rawTable: DataRawTable;
}

export interface UploadDataTableToCloudInput extends PersonalAnalysisConnectionInput {
  tableKind: 'raw' | 'result';
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
    tableKind: 'raw' | 'result';
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
  };
  csvBytes: number;
  upload: {
    uploadPipelineId: string;
    importPipelineId: string;
    tableId: string;
    sheetId?: string;
    status: string;
    table?: PersonalAnalysisTable;
  };
}

export interface ListCloudDriveFilesInput
  extends PersonalAnalysisConnectionInput, PersonalAnalysisDriveFileSearchParams {
  spaceId: string;
  projectId: string;
}

export type ListCloudDriveFilesResult = PersonalAnalysisDriveFileListResult;

export interface PreviewCloudDriveFileInput extends PersonalAnalysisConnectionInput {
  spaceId: string;
  projectId: string;
  fileId: string;
  sheetName?: string;
}

export interface PreviewCloudDriveFileResult {
  file: PersonalAnalysisDriveFile;
  preview: DataRawTablePreview;
}
