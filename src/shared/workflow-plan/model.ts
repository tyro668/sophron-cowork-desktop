import type { z } from 'zod';
import type { DataWorkflowOperatorType } from '../data-workflow-types';
import type { PrepDiagnostic } from '../prep-dsl/ast';
import type {
  AggregateConfigSchema,
  CalculateFieldConfigSchema,
  DeduplicateConfigSchema,
  FieldMappingConfigSchema,
  FieldSelectConfigSchema,
  ExpectConfigSchema,
  FilterConfigSchema,
  JoinConfigSchema,
  LimitConfigSchema,
  MissingValueConfigSchema,
  PivotConfigSchema,
  SetOpConfigSchema,
  SortConfigSchema,
  TypeConvertConfigSchema,
  UnnestConfigSchema,
  UnpivotConfigSchema,
} from '../operator-schemas';

/**
 * Versioned, strongly-typed workflow plan shared by the human-written Prep DSL
 * and the AI-generated structured plans. Both entry points lower to workflow
 * nodes first, then `buildWorkflowPlan` re-validates each node config through
 * the platform operator schemas so downstream validation operates on a typed
 * config union instead of `Record<string, unknown>`.
 */
export const WORKFLOW_PLAN_VERSION = 'workflow-plan/v1' as const;

/** Operator config types inferred from the authoritative zod schemas. */
export interface WorkflowOperatorConfigMap {
  sort: z.infer<typeof SortConfigSchema>;
  field_select: z.infer<typeof FieldSelectConfigSchema>;
  field_mapping: z.infer<typeof FieldMappingConfigSchema>;
  deduplicate: z.infer<typeof DeduplicateConfigSchema>;
  type_convert: z.infer<typeof TypeConvertConfigSchema>;
  unpivot: z.infer<typeof UnpivotConfigSchema>;
  unnest: z.infer<typeof UnnestConfigSchema>;
  set_op: z.infer<typeof SetOpConfigSchema>;
  aggregate: z.infer<typeof AggregateConfigSchema>;
  calculate_field: z.infer<typeof CalculateFieldConfigSchema>;
  missing_value: z.infer<typeof MissingValueConfigSchema>;
  limit: z.infer<typeof LimitConfigSchema>;
  pivot: z.infer<typeof PivotConfigSchema>;
  join: z.infer<typeof JoinConfigSchema>;
  filter: z.infer<typeof FilterConfigSchema>;
  expect: z.infer<typeof ExpectConfigSchema>;
}

export type WorkflowSchemaOperatorType = keyof WorkflowOperatorConfigMap;

export type WorkflowPlanNode = {
  [T in DataWorkflowOperatorType]: {
    id: string;
    type: T;
    label?: string;
    config: T extends WorkflowSchemaOperatorType
      ? WorkflowOperatorConfigMap[T]
      : Record<string, unknown>;
    x?: number;
    y?: number;
  };
}[DataWorkflowOperatorType];

export interface WorkflowPlanEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowPlan {
  version: typeof WORKFLOW_PLAN_VERSION;
  nodes: WorkflowPlanNode[];
  edges: WorkflowPlanEdge[];
}

export interface WorkflowPlanNodeInput {
  id: string;
  type: string;
  label?: string;
  x?: number;
  y?: number;
  config?: Record<string, unknown>;
}

export interface WorkflowPlanInput {
  nodes: WorkflowPlanNodeInput[];
  edges: WorkflowPlanEdge[];
}

/** Diagnostics emitted by plan validation may carry node context. */
export interface WorkflowPlanDiagnostic extends PrepDiagnostic {
  nodeId?: string;
  nodeType?: string;
}

/** Column shape propagated along the plan graph during schema validation. */
export interface PlanColumn {
  name: string;
  /** Normalized DSL type name (text/integer/float/decimal/date/datetime/boolean/...) when known. */
  type?: string;
}

export interface PlanSchema {
  columns: PlanColumn[];
  /** false when the schema could not be resolved; field checks are skipped. */
  known: boolean;
}
