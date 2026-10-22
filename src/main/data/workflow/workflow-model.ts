import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
  DataWorkflowOperatorType,
} from '../../../shared/contracts';

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
  'input' | 'join' | 'set_op' | 'output'
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
  parameters?: WorkflowLiteral[];
}

export interface WorkflowSortKeyIr {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export type WorkflowWindowFrameBound =
  | { type: 'unbounded_preceding' }
  | { type: 'preceding'; offset: number; unit?: WorkflowWindowIntervalUnit }
  | { type: 'current_row' }
  | { type: 'following'; offset: number; unit?: WorkflowWindowIntervalUnit }
  | { type: 'unbounded_following' };

export type WorkflowWindowIntervalUnit =
  | 'microsecond'
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year';

export interface WorkflowWindowFrame {
  type: 'rows' | 'range' | 'groups';
  start: WorkflowWindowFrameBound;
  end: WorkflowWindowFrameBound;
  exclude?: 'current_row' | 'group' | 'ties';
}

export interface WorkflowDeriveWindowConfig {
  column: string;
  function: string;
  expression?: WorkflowExpressionIr | '*';
  parameters?: WorkflowLiteral[];
  offset?: number;
  defaultValue?: WorkflowLiteral;
  buckets?: number;
  nth?: number;
  partitionBy: string[];
  orderBy: WorkflowSortKeyIr[];
  frame?: WorkflowWindowFrame;
}

export interface WorkflowDeduplicateConfig {
  fields: string[];
  keep: 'first' | 'last';
  orderBy: WorkflowSortKeyIr[];
}

export interface WorkflowMissingValueRule {
  field: string;
  method:
    | 'skip'
    | 'drop'
    | 'nullify_values'
    | 'literal_fill'
    | 'mean_fill'
    | 'median_fill'
    | 'mode_fill'
    | 'forward_fill'
    | 'backward_fill';
  value?: Exclude<WorkflowLiteral, null>;
  /** Platform SQL currently certifies textual sentinels for generated workflows. */
  values?: string[];
}

export type WorkflowMissingValueConfig =
  | { strategy: 'drop_empty_rows' }
  | {
      strategy: 'drop_rows_by_nulls';
      fields: string[];
      condition: 'any_null' | 'all_null';
    }
  | { strategy: 'by_column'; rules: WorkflowMissingValueRule[] };

export type WorkflowLimitConfig =
  | {
      sampling: 'fixed';
      limit: number;
      unit: 'rows';
      offset: number;
      orderBy: WorkflowSortKeyIr[];
      ties?: boolean;
      method?: never;
      seed?: never;
    }
  | {
      sampling: 'fixed';
      limit: number;
      unit: 'percent';
      offset: 0;
      orderBy: WorkflowSortKeyIr[];
      ties?: boolean;
      method?: never;
      seed?: never;
    }
  | {
      sampling: 'random';
      limit: number;
      unit: 'rows';
      offset: 0;
      orderBy: [];
      ties?: never;
      method?: 'system';
      seed?: number;
    }
  | {
      sampling: 'random';
      limit: number;
      unit: 'percent';
      offset: 0;
      orderBy: [];
      ties?: never;
      method?: 'system' | 'bernoulli';
      seed?: number;
    };

export interface WorkflowPivotMetricIr {
  function: string;
  expression: WorkflowExpressionIr | '*';
  alias: string;
  parameters?: WorkflowLiteral[];
}

export interface WorkflowPivotAxisIr {
  field: string;
  values: WorkflowLiteral[];
}

export interface WorkflowPivotConfig {
  on: WorkflowPivotAxisIr[];
  using: WorkflowPivotMetricIr[];
  groupBy: string[];
}

export interface WorkflowUnpivotConfig {
  selection: 'include' | 'exclude';
  fields: string[];
  nameColumn: string;
  valueColumn: string;
  includeNulls: boolean;
}

export interface WorkflowUnnestConfig {
  /** Platform list mode accepts native lists and JSON-array strings. */
  sourceKind: 'list';
  field: string;
  alias: string;
  path?: string;
  withIndex?: string;
  keepParentNames: boolean;
  preserveOrder: boolean;
}

export type WorkflowOperationIr = (
  | { type: 'filter'; condition: WorkflowExpressionIr }
  | { type: 'sort'; orderBy: WorkflowSortKeyIr[] }
  | { type: 'select'; fields: string[]; selection?: 'include' | 'exclude' }
  | { type: 'rename'; source: string; target: string }
  | { type: 'derive'; column: string; expression: WorkflowExpressionIr }
  | ({ type: 'derive_window' } & WorkflowDeriveWindowConfig)
  | {
      type: 'cast';
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

export interface GeneratedDataPipelineWorkflow extends GeneratedWorkflowIrSemantics {
  /** Original generated JavaScript retained for function-level diagnostics and repair. */
  javascriptSource?: string;
  /** AI-side compatibility profile certified against the platform node/SQL runtime. */
  runtimeCompatibilityProfileVersion: string;
  workflowIrSemanticHash: string;
}
