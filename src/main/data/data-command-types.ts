import type {
  AgentRuntimeConfig,
  DataAnalyzeTaskRequirementResult,
  DataAutomationColumnSnapshot,
  DataCleaningTask,
  DataDataset,
  DataDeleteInputTableNormalizerVersionInput,
  DataDeleteInputTableNormalizerVersionResult,
  DataGenerateInputTableNormalizerDraftInput,
  DataGenerateInputTableNormalizerDraftResult,
  DataGenerateTaskFromRequirementInput,
  DataGenerateTaskFromRequirementResult,
  DataInputTableNormalizerArtifact,
  DataInputTableNormalizerArtifactVersion,
  DataInputTableNormalizerDraftProgressEvent,
  DataInputTableNormalizerVersionSaveResult,
  DataInputTableConfig,
  DataListInputTableNormalizerVersionsInput,
  DataListInputTableNormalizerVersionsResult,
  DataInputTablePreview,
  DataPublishInputTableNormalizerVersionInput,
  DataPreviewInputTableNormalizerVersionInput,
  DataInputTableSourceSummary,
  DataInputTableSourceKind,
  DataSummarizeInputTableSourceInput,
  DataOutputTable,
  DataTaskWorkflow,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
} from '../../shared/contracts';
import type { PrepDiagnostic } from '../../shared/prep-dsl';
import type {
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

export interface ListInputTablesInput extends DataCommandListInput {
  sourceKind?: DataInputTableSourceKind | 'all';
}

export interface ListInputTablesResult {
  inputTables: DataDataset[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateInputTableCommand {
  name?: string;
  sourceKind?: DataInputTableSourceKind;
  filePath?: string;
  folderPath?: string;
  config?: DataInputTableConfig;
  previewRows?: number;
}

export type CreateInputTableProcessingStrategyCommand =
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

export interface CreateInputTableWithProcessingStrategyCommand extends Omit<
  CreateInputTableCommand,
  'config'
> {
  config?: DataInputTableConfig;
  processingStrategy: CreateInputTableProcessingStrategyCommand;
}

export interface CreateInputTableWithProcessingStrategyResult extends InputTableResult {
  processingStrategy: 'auto' | 'customize';
  normalizer?: {
    artifact: DataInputTableNormalizerArtifact;
    draftVersion: DataInputTableNormalizerArtifactVersion;
    publishedVersion: DataInputTableNormalizerArtifactVersion;
    sourceSummary: DataInputTableSourceSummary;
    preview: DataInputTablePreview;
  };
}

export interface UpdateInputTableCommand {
  id: string;
  name?: string;
  sourceKind?: DataInputTableSourceKind;
  filePath?: string;
  folderPath?: string;
  config?: DataInputTableConfig;
  previewRows?: number;
}

export interface InputTableResult {
  inputTable: DataDataset;
  preview?: DataInputTablePreview;
}

export type SummarizeInputTableSourceCommand = DataSummarizeInputTableSourceInput;

export interface SummarizeInputTableSourceResult {
  summary: DataInputTableSourceSummary;
}

export type GenerateInputTableNormalizerDraftProgressCallback = (
  event: Omit<DataInputTableNormalizerDraftProgressEvent, 'progressId'>
) => void;

export type GenerateInputTableNormalizerDraftCommand =
  DataGenerateInputTableNormalizerDraftInput & {
    runtimeConfig?: AgentRuntimeConfig;
    onProgress?: GenerateInputTableNormalizerDraftProgressCallback;
  };

export type GenerateInputTableNormalizerDraftResult = DataGenerateInputTableNormalizerDraftResult;

export type GenerateTaskFromRequirementCommand = DataGenerateTaskFromRequirementInput & {
  runtimeConfig?: AgentRuntimeConfig;
  taskName?: string;
  signal?: AbortSignal;
  outputConflictPolicy?: 'reuse' | 'unique' | 'error';
};

export type AnalyzeTaskRequirementCommand = Pick<
  GenerateTaskFromRequirementCommand,
  'source' | 'processRequirement' | 'usageTraceId' | 'runtimeConfig' | 'signal'
> & {
  /** User message that initiated a tool-driven analysis; used to enforce a later confirmation turn. */
  sourceUserMessageId?: string;
};
export interface AnalyzedTaskRequirement extends DataAnalyzeTaskRequirementResult {
  inputTableId: string;
  inputTableName: string;
  columnsSnapshot: DataAutomationColumnSnapshot[];
  sourceSummaryHash: string;
  capabilityProfileVersion: string;
}
export interface AnalyzeTaskRequirementResult extends AnalyzedTaskRequirement {
  analysisId: string;
  expiresAt: number;
}

export type GenerateTaskFromRequirementResult = DataGenerateTaskFromRequirementResult;

export type PublishInputTableNormalizerVersionCommand = DataPublishInputTableNormalizerVersionInput;

export type PublishInputTableNormalizerVersionResult = DataInputTableNormalizerVersionSaveResult;

export type DeleteInputTableNormalizerVersionCommand = DataDeleteInputTableNormalizerVersionInput;

export type DeleteInputTableNormalizerVersionResult = DataDeleteInputTableNormalizerVersionResult;

export type ListInputTableNormalizerVersionsCommand = DataListInputTableNormalizerVersionsInput;

export type ListInputTableNormalizerVersionsResult = DataListInputTableNormalizerVersionsResult;

export interface ListOutputTablesResult {
  outputTables: DataOutputTable[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateOutputTableCommand {
  name?: string;
  sourceInputTableId?: string;
}

export interface UpdateOutputTableCommand {
  id: string;
  name?: string;
  sourceInputTableId?: string | null;
}

export interface OutputTableResult {
  outputTable: DataOutputTable;
  preview?: DataInputTablePreview;
}

export interface PreviewTableCommand {
  tableKind: 'input' | 'output';
  id: string;
  limit?: number;
  offset?: number;
}

export interface PreviewTableResult {
  tableKind: 'input' | 'output';
  id: string;
  preview: DataInputTablePreview;
}

export interface PersonalAnalysisConnectionCommand {
  apiOrigin?: string;
  apiKey?: string;
  accessToken?: string;
}

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
  tableId: string;
  spaceId?: string;
  projectId?: string;
  name?: string;
  previewRows?: number;
}

export interface ImportCloudTableResult extends InputTableResult {
  cloudTableId: string;
  cloudTable?: PersonalAnalysisTable;
  downloadedFilePath: string;
}

export interface PreviewCloudTableCommand extends PersonalAnalysisConnectionCommand {
  tableId: string;
  limit?: number;
  offset?: number;
}

export interface PreviewCloudTableResult {
  cloudTableId: string;
  downloadedFilePath: string;
  preview: DataInputTablePreview;
}

export interface UploadDataTableToCloudCommand extends PersonalAnalysisConnectionCommand {
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
  upload: PersonalAnalysisUploadResult;
}

export type PreviewInputTableNormalizerVersionCommand = DataPreviewInputTableNormalizerVersionInput;

export interface PreviewInputTableNormalizerVersionResult {
  preview: DataInputTablePreview;
}

export interface ListTasksResult {
  tasks: DataCleaningTask[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateTaskCommand {
  name: string;
  sourcePath?: string | null;
  sourceInputTableId?: string;
  outputTableId?: string;
}

export interface UpdateTaskCommand {
  id: string;
  name?: string;
}

export interface TaskResult {
  task: DataCleaningTask;
}

export interface GetTaskWorkflowCommand {
  taskId: string;
  /**
   * summary (default): task meta + node type/binding lines.
   * graph: full editable node configs and edges.
   * node: single node config plus its touching edges (requires nodeId).
   */
  view?: 'summary' | 'graph' | 'node';
  nodeId?: string;
}

export interface GetWorkflowCapabilityManifestCommand {
  inputTableIds?: string[];
  outputTableIds?: string[];
  /** Restrict returned operator config schemas to these operator types. */
  operatorTypes?: string[];
  /** Manifest sections to include: plan | operators | runtime | bindings. */
  sections?: string[];
}

export interface WorkflowResult {
  workflow: DataTaskWorkflow;
  diagnostics?: PrepDiagnostic[];
  dryRun?: boolean;
  /** Canonical Prep DSL exported from the applied graph. */
  dsl?: string;
}

export interface ApplyWorkflowDslCommand {
  taskId: string;
  dsl: string;
  inputTableId?: string;
  inputAlias?: string;
  /** Multi-source binding: `alias -> inputTableId` for each input_source node. */
  inputResources?: Record<string, string>;
  outputTableId?: string;
  dryRun?: boolean;
}

export interface ApplyWorkflowPlanCommand {
  taskId: string;
  /** Constrained typed plan: `{ version: 'workflow-plan/v1', nodes, edges }`. */
  plan: unknown;
  inputResources?: Record<string, string>;
  outputTableId?: string;
  dryRun?: boolean;
}

export interface ExportWorkflowDslCommand {
  taskId: string;
}

export interface TextResult {
  text: string;
}

export interface ConfigureInputOperatorCommand {
  taskId: string;
  nodeId: string;
  inputTableId: string;
  alias?: string;
  incrementalBy?: string;
  dryRun?: boolean;
}

export interface ApplyOperatorDslCommand {
  taskId: string;
  nodeId: string;
  operatorType?: DataWorkflowOperatorType;
  dsl: string;
  dryRun?: boolean;
}

export interface ConfigureOutputOperatorCommand {
  taskId: string;
  nodeId: string;
  outputTableId?: string;
  outputTableName?: string;
  outputStrategy?: 'existing' | 'auto';
  mode?: 'replace' | 'append' | 'error_if_exists' | 'merge';
  mergeKeys?: string[];
  schemaPolicy?: 'extend' | 'strict' | 'ignore';
  dryRun?: boolean;
}

export interface RunTaskCommand {
  taskId: string;
  mode?: 'temporary' | 'persisted';
  workflowDsl?: string;
  saveWorkflow?: boolean;
  inputTableId?: string;
  inputAlias?: string;
  inputResources?: Record<string, string>;
  outputTableId?: string;
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
}

export interface RunTaskResult {
  task: DataCleaningTask;
  /** User-managed output resource ID, never the physical DuckDB table name. */
  outputTableId?: string;
  preview?: DataInputTablePreview;
  diagnostics?: PrepDiagnostic[];
  nodeStats?: WorkflowNodeRunStat[];
}

export interface RunGeneratedTaskCommand {
  taskId: string;
  /**
   * Optional one-off workflow override. Automations should omit this so the
   * task's currently saved workflow remains the source of truth.
   */
  workflowDsl?: string;
  source: DataGenerateTaskFromRequirementInput['source'];
  output: DataGenerateTaskFromRequirementInput['output'];
  requiredColumns?: DataGenerateTaskFromRequirementResult['requiredColumns'];
  expectedOutputSchema?: DataGenerateTaskFromRequirementResult['expectedOutputSchema'];
  schemaPolicy?: 'strict' | 'required_subset';
  mode?: 'temporary' | 'persisted';
  previewRows?: number;
}

export interface RunGeneratedTaskResult extends RunTaskResult {
  inputTableId: string;
  outputTableId: string;
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
  taskId: string;
  previewRows?: number;
  offset?: number;
}

export interface RunResult {
  task: DataCleaningTask;
  outputTableId?: string;
  preview?: DataInputTablePreview;
}

export type WorkflowSaveShape = DataWorkflowSaveInput;
