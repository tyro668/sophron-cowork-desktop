import type {
  DataCleaningTask,
  DataDataset,
  DataInputTableConfig,
  DataInputTablePreview,
  DataInputTableSourceKind,
  DataOutputTable,
  DataTaskWorkflow,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
} from '../../renderer/types';
import type { PrepDiagnostic } from '../../shared/prep-dsl';

export type DataCommandErrorCode =
  | 'INVALID_ARGUMENT'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_ALREADY_EXISTS'
  | 'AMBIGUOUS_RESOURCE'
  | 'FILE_ACCESS_DENIED'
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
