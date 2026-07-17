import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
} from '../../../renderer/types';

export type WorkflowLiteral = string | number | boolean | null;

export interface WorkflowSourceLocation {
  functionName: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

export type WorkflowExpressionIr =
  | { kind: 'column'; name: string }
  | { kind: 'literal'; value: WorkflowLiteral }
  | { kind: 'binary'; op: string; left: WorkflowExpressionIr; right: WorkflowExpressionIr }
  | { kind: 'unary'; op: 'is_null' | 'is_not_null'; value: WorkflowExpressionIr }
  | { kind: 'function'; name: string; args: WorkflowExpressionIr[] };

export interface WorkflowMetricIr {
  fn: string;
  expression: WorkflowExpressionIr | '*';
  alias: string;
}

export interface WorkflowSortKeyIr {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface WorkflowDeduplicateConfig {
  columns: string[];
  keep: 'first' | 'last';
  orderBy: WorkflowSortKeyIr[];
}

export interface WorkflowMissingValueRule {
  column: string;
  method: 'skip' | 'drop' | 'nullify_values' | 'literal_fill';
  value?: WorkflowLiteral;
  values?: WorkflowLiteral[];
}

export type WorkflowMissingValueConfig =
  | { strategy: 'drop_empty_rows' }
  | { strategy: 'by_column'; rules: WorkflowMissingValueRule[] };

export interface WorkflowLimitConfig {
  mode: 'limit' | 'top';
  limit: number;
  unit: 'rows' | 'percent';
  offset: number;
  orderBy: WorkflowSortKeyIr[];
}

export interface WorkflowPivotMetricIr {
  function: string;
  expression: WorkflowExpressionIr | '*';
  alias: string;
}

export interface WorkflowPivotConfig {
  on: string[];
  values: WorkflowLiteral[];
  using: WorkflowPivotMetricIr[];
  groupBy: string[];
}

export interface WorkflowUnpivotConfig {
  mode: 'columns' | 'except';
  columns: string[];
  nameColumn: string;
  valueColumn: string;
  includeNulls: boolean;
}

export interface WorkflowUnnestConfig {
  sourceKind: 'list' | 'json';
  column: string;
  alias: string;
  path?: string;
  withIndex?: string;
  recursive: boolean;
  maxDepth?: number;
  keepParentNames: boolean;
}

export type WorkflowOperationIr = (
  | { type: 'filter'; condition: WorkflowExpressionIr }
  | { type: 'sort'; column: WorkflowExpressionIr; direction: 'asc' | 'desc' }
  | { type: 'drop'; columns: string[] }
  | { type: 'select'; columns: string[] }
  | { type: 'rename'; source: string; target: string }
  | { type: 'derive'; column: string; expression: WorkflowExpressionIr }
  | {
      type: 'convert_type';
      column: string;
      targetType: string;
      options: Record<string, unknown>;
    }
  | { type: 'aggregate'; groupBy: WorkflowExpressionIr[]; metrics: WorkflowMetricIr[] }
  | { type: 'deduplicate'; config: WorkflowDeduplicateConfig }
  | { type: 'missing_value'; config: WorkflowMissingValueConfig }
  | { type: 'limit'; config: WorkflowLimitConfig }
  | { type: 'pivot'; config: WorkflowPivotConfig }
  | { type: 'unpivot'; config: WorkflowUnpivotConfig }
  | { type: 'unnest'; config: WorkflowUnnestConfig }
) & { location?: WorkflowSourceLocation };

export interface WorkflowIr {
  inputSeen: boolean;
  outputSeen: boolean;
  operations: WorkflowOperationIr[];
}

export type GeneratedWorkflowRequiredColumnResolver = (
  name: unknown,
  context?: string
) => GeneratedWorkflowColumnBinding;

export interface GeneratedWorkflowColumnBinding {
  name: string;
  type?: string;
  sourceColumn?: { name: string; type?: string };
  sourceColumns?: Array<{ name: string; type?: string }>;
  expression?: string;
}

export interface GeneratedDataTaskWorkflow {
  /** Original generated JavaScript retained for function-level diagnostics and repair. */
  javascriptSource?: string;
  workflowDsl: string;
  requiredColumns: DataAutomationColumnSnapshot[];
  expectedOutputSchema: DataAutomationColumnSnapshot[];
  lineage: DataAutomationLineageEntry[];
}
