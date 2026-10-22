import type { DataWorkflowOperatorType } from '../data-workflow-types';
import type { WorkflowOperatorConfigMap } from '../operators';
import type { WorkflowDiagnostic } from '../workflow-diagnostics';

/**
 * Versioned, strongly-typed workflow plan shared by the human-written Prep DSL
 * and the AI-generated structured plans. Both entry points lower to workflow
 * nodes first, then `buildWorkflowPlan` re-validates each node config through
 * the platform operator schemas so downstream validation operates on a typed
 * config union instead of `Record<string, unknown>`.
 */
export const WORKFLOW_PLAN_VERSION = 'workflow-plan/v1' as const;

/**
 * Per-type config map inferred from the operator registry's zod schemas —
 * covers every `DataWorkflowOperatorType`, including `input`/`output`,
 * so the plan node config union never degrades to `Record<string, unknown>`.
 */
export type { WorkflowOperatorConfigMap } from '../operators';

export type WorkflowSchemaOperatorType = keyof WorkflowOperatorConfigMap;

export type WorkflowPlanNode = {
  [T in DataWorkflowOperatorType]: {
    id: string;
    type: T;
    label?: string;
    config: WorkflowOperatorConfigMap[T];
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
export interface WorkflowPlanDiagnostic extends WorkflowDiagnostic {
  nodeId?: string;
  nodeType?: string;
}

/** Column shape propagated along the plan graph during schema validation. */
export interface PlanColumn {
  name: string;
  /** Exact database type when available, for native query binding (e.g. lists/decimals). */
  storageType?: string;
  /** Normalized DSL type name (text/integer/float/decimal/date/datetime/boolean/...) when known. */
  type?: string;
}

export interface PlanSchema {
  columns: PlanColumn[];
  /** false when the schema could not be resolved; field checks are skipped. */
  known: boolean;
}
