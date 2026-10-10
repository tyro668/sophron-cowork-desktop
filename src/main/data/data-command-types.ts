import type { DataPipelineAuthoringRequest } from '../../shared/data-pipeline-authoring';
import type {
  AgentRuntimeConfig,
  DataAnalyzePipelineRequirementResult,
  DataAutomationColumnSnapshot,
  DataPipeline,
  DataRawTable,
  DataDeleteRawTableNormalizerVersionInput,
  DataDeleteRawTableNormalizerVersionResult,
  DataGenerateRawTableNormalizerDraftInput,
  DataGenerateRawTableNormalizerDraftResult,
  DataGeneratePipelineFromRequirementInput,
  DataGeneratePipelineFromRequirementResult,
  DataRawTableNormalizerArtifact,
  DataRawTableNormalizerArtifactVersion,
  DataRawTableNormalizerDraftProgressEvent,
  DataRawTableNormalizerVersionSaveResult,
  DataRawTableConfig,
  DataListRawTableNormalizerVersionsInput,
  DataListRawTableNormalizerVersionsResult,
  DataRawTablePreview,
  DataPublishRawTableNormalizerVersionInput,
  DataPreviewRawTableNormalizerVersionInput,
  DataRawTableSourceSummary,
  DataRawTableSourceKind,
  DataSummarizeRawTableSourceInput,
  DataResultTable,
  DataPipelineWorkflow,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
} from '../../shared/contracts';
import type { PrepDiagnostic } from '../../shared/prep-dsl';
import type {
  PersonalAnalysisConnectionInput,
  PersonalAnalysisDriveFile,
  PersonalAnalysisDriveFileListResult,
  PersonalAnalysisDriveFileSearchParams,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  PersonalAnalysisTableListResult,
  PersonalAnalysisTableSearchParams,
  PersonalAnalysisUploadResult,
} from '../../shared/personal-analysis-types';

export type DataCommandErrorCode =
  | 'INVALID_ARGUMENT'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_ALREADY_EXISTS'
  | 'AMBIGUOUS_RESOURCE'
  | 'FILE_ACCESS_DENIED'
  | 'GENERATION_FAILED'
  | 'ANALYSIS_REQUIRED'
  | 'ANALYSIS_STALE'
  | 'CONFIRMATION_REQUIRED'
  | 'REQUIREMENT_NOT_SUPPORTED'
  | 'DSL_PARSE_FAILED'
  | 'PLAN_VALIDATION_FAILED'
  | 'VALIDATION_FAILED'
  | 'RUN_FAILED'
  | 'INTERNAL_ERROR';

export class DataCommandError extends Error {
  readonly code: DataCommandErrorCode;
  readonly details?: unknown;

  constructor(code: DataCommandErrorCode, message: string, details?: unknown) {
    super(`[${code}] ${message}`);
    this.name = 'DataCommandError';
    this.code = code;
    this.details = details;
  }
}

export interface DataCommandListInput {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface ListRawTablesInput extends DataCommandListInput {
  sourceKind?: DataRawTableSourceKind | 'all';
}

export interface ListRawTablesResult {
  rawTables: DataRawTable[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateRawTableCommand {
  name?: string;
  sourceKind?: DataRawTableSourceKind;
  filePath?: string;
  folderPath?: string;
  config?: DataRawTableConfig;
  previewRows?: number;
}

export type CreateRawTableProcessingStrategyCommand =
  | {
      strategy: 'auto';
    }
  | {
      strategy: 'customize';
      rulePrompt: string;
      artifactId?: string | null;
      artifactName?: string;
      artifactDescription?: string | null;
      primaryLanguage?: 'python' | 'node';
      prepareDependencies?: boolean;
    };

export interface CreateRawTableWithProcessingStrategyCommand extends Omit<
  CreateRawTableCommand,
  'config'
> {
  config?: DataRawTableConfig;
  processingStrategy: CreateRawTableProcessingStrategyCommand;
}

export interface CreateRawTableWithProcessingStrategyResult extends RawTableResult {
  processingStrategy: 'auto' | 'customize';
  normalizer?: {
    artifact: DataRawTableNormalizerArtifact;
    draftVersion: DataRawTableNormalizerArtifactVersion;
    publishedVersion: DataRawTableNormalizerArtifactVersion;
    sourceSummary: DataRawTableSourceSummary;
    preview: DataRawTablePreview;
  };
}

export interface UpdateRawTableCommand {
  id: string;
  name?: string;
  sourceKind?: DataRawTableSourceKind;
  filePath?: string;
  folderPath?: string;
  config?: DataRawTableConfig;
  previewRows?: number;
}

export interface RawTableResult {
  rawTable: DataRawTable;
  preview?: DataRawTablePreview;
}

export type SummarizeRawTableSourceCommand = DataSummarizeRawTableSourceInput;

export interface SummarizeRawTableSourceResult {
  summary: DataRawTableSourceSummary;
}

export type GenerateRawTableNormalizerDraftProgressCallback = (
  event: Omit<DataRawTableNormalizerDraftProgressEvent, 'progressId'>
) => void;

export type GenerateRawTableNormalizerDraftCommand = DataGenerateRawTableNormalizerDraftInput & {
  runtimeConfig?: AgentRuntimeConfig;
  onProgress?: GenerateRawTableNormalizerDraftProgressCallback;
};

export type GenerateRawTableNormalizerDraftResult = DataGenerateRawTableNormalizerDraftResult;

export type GeneratePipelineFromRequirementCommand = DataGeneratePipelineFromRequirementInput & {
  runtimeConfig?: AgentRuntimeConfig;
  pipelineName?: string;
  signal?: AbortSignal;
  onActivity?: () => void;
  outputConflictPolicy?: 'reuse' | 'unique' | 'error';
};

export type AnalyzePipelineRequirementCommand = Pick<
  GeneratePipelineFromRequirementCommand,
  | 'source'
  | 'processRequirement'
  | 'requirementConversation'
  | 'usageTraceId'
  | 'runtimeConfig'
  | 'signal'
  | 'onActivity'
  | 'reusePipelineId'
  | 'startFromNodeId'
  | 'workflow'
> & {
  authoringRequest?: DataPipelineAuthoringRequest;
  /** User message that initiated a tool-driven analysis; used to enforce a later confirmation turn. */
  sourceUserMessageId?: string;
};
export interface AnalyzedPipelineRequirement extends DataAnalyzePipelineRequirementResult {
  rawTableId: string;
  rawTableName: string;
  columnsSnapshot: DataAutomationColumnSnapshot[];
  sourceSummaryHash: string;
  capabilityProfileVersion: string;
}
export interface AnalyzePipelineRequirementResult extends AnalyzedPipelineRequirement {
  analysisId: string;
  expiresAt: number;
}

export type GeneratePipelineFromRequirementResult = DataGeneratePipelineFromRequirementResult;

export type PublishRawTableNormalizerVersionCommand = DataPublishRawTableNormalizerVersionInput;

export type PublishRawTableNormalizerVersionResult = DataRawTableNormalizerVersionSaveResult;

export type DeleteRawTableNormalizerVersionCommand = DataDeleteRawTableNormalizerVersionInput;

export type DeleteRawTableNormalizerVersionResult = DataDeleteRawTableNormalizerVersionResult;

export type ListRawTableNormalizerVersionsCommand = DataListRawTableNormalizerVersionsInput;

export type ListRawTableNormalizerVersionsResult = DataListRawTableNormalizerVersionsResult;

export interface ListResultTablesResult {
  resultTables: DataResultTable[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateResultTableCommand {
  name?: string;
  sourceRawTableId?: string;
}

export interface UpdateResultTableCommand {
  id: string;
  name?: string;
  sourceRawTableId?: string | null;
}

export interface ResultTableResult {
  resultTable: DataResultTable;
  preview?: DataRawTablePreview;
}

export interface PreviewTableCommand {
  tableKind: 'raw' | 'result';
  id: string;
  limit?: number;
  offset?: number;
}

export interface PreviewTableResult {
  tableKind: 'raw' | 'result';
  id: string;
  preview: DataRawTablePreview;
}

export type PersonalAnalysisConnectionCommand = PersonalAnalysisConnectionInput;

export type ListCloudSpacesCommand = PersonalAnalysisConnectionCommand;

export interface ListCloudSpacesResult {
  spaces: PersonalAnalysisSpace[];
}

export interface ListCloudProjectsCommand extends PersonalAnalysisConnectionCommand {
  spaceId: string;
}

export interface ListCloudProjectsResult {
  projects: PersonalAnalysisProject[];
}

export interface ListCloudTablesCommand
  extends PersonalAnalysisConnectionCommand, PersonalAnalysisTableSearchParams {
  spaceId: string;
  projectId: string;
}

export type ListCloudTablesResult = PersonalAnalysisTableListResult;

export interface SearchCloudTablesCommand
  extends PersonalAnalysisConnectionCommand, PersonalAnalysisTableSearchParams {
  keyword: string;
}

export type SearchCloudTablesResult = PersonalAnalysisTableListResult;

export interface ImportCloudTableCommand extends PersonalAnalysisConnectionCommand {
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

export interface ImportCloudTableResult extends RawTableResult {
  cloudTableId: string;
  cloudTable?: PersonalAnalysisTable;
  downloadedFilePath: string;
}

export interface RefreshCloudRawTableCommand extends PersonalAnalysisConnectionCommand {
  rawTableId: string;
}

export interface RefreshCloudRawTableResult extends RawTableResult {}

export interface PreviewCloudTableCommand extends PersonalAnalysisConnectionCommand {
  tableId: string;
  limit?: number;
  offset?: number;
}

export interface PreviewCloudTableResult {
  cloudTableId: string;
  downloadedFilePath: string;
  preview: DataRawTablePreview;
}

export interface UploadDataTableToCloudCommand extends PersonalAnalysisConnectionCommand {
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
  upload: PersonalAnalysisUploadResult;
}

export interface ListCloudDriveFilesCommand
  extends PersonalAnalysisConnectionCommand, PersonalAnalysisDriveFileSearchParams {
  spaceId: string;
  projectId: string;
}

export type ListCloudDriveFilesResult = PersonalAnalysisDriveFileListResult;

export interface PreviewCloudDriveFileCommand extends PersonalAnalysisConnectionCommand {
  spaceId: string;
  projectId: string;
  fileId: string;
  sheetName?: string;
}

export interface PreviewCloudDriveFileResult {
  file: PersonalAnalysisDriveFile;
  preview: DataRawTablePreview;
}

export type PreviewRawTableNormalizerVersionCommand = DataPreviewRawTableNormalizerVersionInput;

export interface PreviewRawTableNormalizerVersionResult {
  preview: DataRawTablePreview;
}

export interface ListPipelinesResult {
  pipelines: DataPipeline[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreatePipelineCommand {
  name: string;
  sourcePath?: string | null;
  sourceRawTableId?: string;
  resultTableId?: string;
}

export interface UpdatePipelineCommand {
  id: string;
  name?: string;
}

export interface PipelineResult {
  pipeline: DataPipeline;
}

export interface GetPipelineWorkflowCommand {
  pipelineId: string;
  /**
   * summary (default): pipeline meta + node type/binding lines.
   * graph: full editable node configs and edges.
   * node: single node config plus its touching edges (requires nodeId).
   */
  view?: 'summary' | 'graph' | 'node';
  nodeId?: string;
}

export interface GetWorkflowCapabilityManifestCommand {
  rawTableIds?: string[];
  resultTableIds?: string[];
  /** Restrict returned operator config schemas to these operator types. */
  operatorTypes?: string[];
  /** Manifest sections to include: plan | operators | runtime | bindings. */
  sections?: string[];
}

export interface WorkflowResult {
  workflow: DataPipelineWorkflow;
  diagnostics?: PrepDiagnostic[];
  dryRun?: boolean;
  /** Canonical Prep DSL exported from the applied graph. */
  dsl?: string;
}

export interface ApplyWorkflowDslCommand {
  pipelineId: string;
  dsl: string;
  rawTableId?: string;
  inputAlias?: string;
  /** Multi-source binding: `alias -> rawTableId` for each input_source node. */
  inputResources?: Record<string, string>;
  resultTableId?: string;
  dryRun?: boolean;
}

export interface ApplyWorkflowPlanCommand {
  pipelineId: string;
  /** Constrained typed plan: `{ version: 'workflow-plan/v1', nodes, edges }`. */
  plan: unknown;
  inputResources?: Record<string, string>;
  resultTableId?: string;
  dryRun?: boolean;
}

export interface ExportWorkflowDslCommand {
  pipelineId: string;
}

export interface TextResult {
  text: string;
}

export interface ConfigureInputOperatorCommand {
  pipelineId: string;
  nodeId: string;
  rawTableId: string;
  alias?: string;
  dryRun?: boolean;
}

export interface ApplyOperatorDslCommand {
  pipelineId: string;
  nodeId: string;
  operatorType?: DataWorkflowOperatorType;
  dsl: string;
  dryRun?: boolean;
}

export interface ConfigureOutputOperatorCommand {
  pipelineId: string;
  nodeId: string;
  resultTableId?: string;
  resultTableName?: string;
  outputStrategy?: 'existing' | 'auto';
  mode?: 'replace' | 'append' | 'error_if_exists' | 'merge';
  mergeKeys?: string[];
  schemaPolicy?: 'extend' | 'strict' | 'ignore';
  dryRun?: boolean;
}

export interface RunPipelineCommand {
  pipelineId: string;
  mode?: 'temporary' | 'persisted';
  workflowDsl?: string;
  saveWorkflow?: boolean;
  rawTableId?: string;
  inputAlias?: string;
  inputResources?: Record<string, string>;
  resultTableId?: string;
  previewRows?: number;
}

export interface WorkflowNodeRunStat {
  nodeId: string;
  nodeType: string;
  /** Rows the node consumed; null when the input is not a materialized table. */
  inputRows: number | null;
  /** Per-input-handle row counts for multi-input operators (e.g. join/set_op left+right). */
  inputRowsByHandle?: Record<string, number>;
  /** Rows the node produced on its main output. */
  outputRows: number;
  /** inputRows - outputRows for row-reducing operators (filter/dedup/limit/expect). */
  droppedRows?: number;
  /** Rows routed to an expect node's reject stream. */
  rejectedRows?: number;
  /** Up to 5 sample rows that were dropped or rejected. */
  sample?: Record<string, unknown>[];
  /** Run this stat belongs to; absent on legacy single-batch stats. */
  runId?: string;
}

export interface RunPipelineResult {
  pipeline: DataPipeline;
  /** User-managed output resource ID, never the physical DuckDB table name. */
  resultTableId?: string;
  preview?: DataRawTablePreview;
  diagnostics?: PrepDiagnostic[];
  nodeStats?: WorkflowNodeRunStat[];
}

export interface RunGeneratedPipelineCommand {
  pipelineId: string;
  /**
   * Optional one-off workflow override. Automations should omit this so the
   * pipeline's currently saved workflow remains the source of truth.
   */
  workflowDsl?: string;
  source: DataGeneratePipelineFromRequirementInput['source'];
  output: DataGeneratePipelineFromRequirementInput['output'];
  requiredColumns?: DataGeneratePipelineFromRequirementResult['requiredColumns'];
  expectedOutputSchema?: DataGeneratePipelineFromRequirementResult['expectedOutputSchema'];
  schemaPolicy?: 'strict' | 'required_subset';
  mode?: 'temporary' | 'persisted';
  previewRows?: number;
}

export interface RunGeneratedPipelineResult extends RunPipelineResult {
  rawTableId: string;
  resultTableId: string;
  uploaded?: UploadDataTableToCloudResult;
  tokenUsage: 0;
  workflowHash: string;
  stageDurationsMs: {
    prepare: number;
    compile: number;
    executeAndValidate: number;
    upload: number;
    total: number;
  };
}

export interface GetRunResultCommand {
  pipelineId: string;
  previewRows?: number;
  offset?: number;
}

export interface RunResult {
  pipeline: DataPipeline;
  resultTableId?: string;
  preview?: DataRawTablePreview;
}

export type WorkflowSaveShape = DataWorkflowSaveInput;
