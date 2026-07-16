import type {
  AgentRuntimeConfig,
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
} from '../../renderer/types';
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
  | 'DSL_PARSE_FAILED'
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
};

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
}

export interface WorkflowResult {
  workflow: DataTaskWorkflow;
  diagnostics?: PrepDiagnostic[];
  dryRun?: boolean;
}

export interface ApplyWorkflowDslCommand {
  taskId: string;
  dsl: string;
  inputTableId?: string;
  inputAlias?: string;
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
  mode?: 'replace' | 'append';
  dryRun?: boolean;
}

export interface RunTaskCommand {
  taskId: string;
  mode?: 'temporary' | 'persisted';
  workflowDsl?: string;
  saveWorkflow?: boolean;
  inputTableId?: string;
  inputAlias?: string;
  outputTableId?: string;
  previewRows?: number;
}

export interface RunTaskResult {
  task: DataCleaningTask;
  preview?: DataInputTablePreview;
  diagnostics?: PrepDiagnostic[];
}

export interface RunGeneratedTaskCommand {
  taskId: string;
  workflowDsl: string;
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
  preview?: DataInputTablePreview;
}

export type WorkflowSaveShape = DataWorkflowSaveInput;
