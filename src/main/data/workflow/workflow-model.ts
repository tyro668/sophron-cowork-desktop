import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
  DataWorkflowOperatorType,
} from '../../../renderer/types';

export type WorkflowLiteral = string | number | boolean | null;

export interface WorkflowSourceLocation {
  functionName: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

export type WorkflowSourceLanguage = 'javascript';

export interface WorkflowOperationProvenance {
  operationId: string;
  language: WorkflowSourceLanguage;
  source: WorkflowSourceLocation;
}

export interface GeneratedWorkflowOperationOrigin extends WorkflowSourceLocation {
  operationId: string;
  operatorIndex: number;
  operationType: WorkflowOperationIr['type'];
}

export type GeneratedWorkflowPlatformOperatorType = Exclude<
  DataWorkflowOperatorType,
  'input_source' | 'join' | 'set_op' | 'output'
>;

/**
 * Structured platform-node draft produced by the AI semantic lowering stage.
 *
 * Prep DSL is intentionally absent: generated workflows execute from native node
 * configs, and compatibility DSL is exported only after the complete node graph
 * has passed platform validation.
 */
export interface GeneratedWorkflowPlatformOperatorDraft {
  type: GeneratedWorkflowPlatformOperatorType;
  config: Record<string, unknown>;
}

export type WorkflowExpressionIr =
  | { kind: 'column'; name: string }
  | { kind: 'literal'; value: WorkflowLiteral }
  | { kind: 'binary'; op: string; left: WorkflowExpressionIr; right: WorkflowExpressionIr }
  | { kind: 'unary'; op: 'is_null' | 'is_not_null' | 'not'; value: WorkflowExpressionIr }
  | {
      kind: 'cast';
      value: WorkflowExpressionIr;
      targetType: string;
      options: { scale?: number };
    }
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
  /** The platform SQL compiler currently guarantees only the first-row policy. */
  keep: 'first';
  orderBy: WorkflowSortKeyIr[];
}

export interface WorkflowMissingValueRule {
  column: string;
  method: 'skip' | 'drop' | 'nullify_values' | 'literal_fill';
  value?: WorkflowLiteral;
  /** The platform node schema accepts textual missing-value markers. */
  values?: string[];
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
) & {
  operationId?: string;
  inputOperationId?: string;
  location?: WorkflowSourceLocation;
};

export interface WorkflowIr {
  irVersion: '1.0';
  kind: 'workflow';
  sourceLanguage: WorkflowSourceLanguage;
  sdkVersion?: string;
  inputSeen: boolean;
  outputSeen: boolean;
  outputOperationId?: string | null;
  operations: WorkflowOperationIr[];
  provenance: WorkflowOperationProvenance[];
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

export interface GeneratedWorkflowIrSemantics {
  workflowIr: WorkflowIr;
  platformOperators: GeneratedWorkflowPlatformOperatorDraft[];
  operationOrigins: GeneratedWorkflowOperationOrigin[];
  requiredColumns: Array<{ name: string; type?: string }>;
  expectedOutputSchema: DataAutomationColumnSnapshot[];
  lineage: DataAutomationLineageEntry[];
}

export interface GeneratedDataTaskWorkflow extends GeneratedWorkflowIrSemantics {
  /** Original generated JavaScript retained for function-level diagnostics and repair. */
  javascriptSource?: string;
  /** AI-side compatibility profile certified against the platform node/SQL runtime. */
  runtimeCompatibilityProfileVersion: string;
  workflowIrSemanticHash: string;
}
