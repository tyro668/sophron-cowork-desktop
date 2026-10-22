import type { DataWorkflowOperatorType } from '../data-workflow-types';

export type PrepOperatorType = DataWorkflowOperatorType;

export type PrepDiagnosticSeverity = 'error' | 'warning';

export interface PrepDiagnostic {
  severity: PrepDiagnosticSeverity;
  message: string;
  code?: string;
  params?: Record<string, string | number>;
  line?: number;
  column?: number;
}

export interface PrepFieldRef {
  raw: string;
  source?: string;
  name: string;
}

export interface PrepOperatorAst {
  key?: string;
  type: PrepOperatorType;
  label?: string;
  dsl: string;
  config: Record<string, unknown>;
}

/**
 * A named dataflow chain: `step <name> = <ref>` followed by `| <op>` lines.
 * `input` names the stream the chain reads — a source alias or an earlier step
 * name. `output` operators inside a step terminate the chain into a sink.
 */
export interface PrepStepAst {
  name: string;
  input?: string;
  line?: number;
  /** True for `step <name> = ...`; false for `from`/implicit chains. */
  named: boolean;
  operators: PrepOperatorAst[];
}

export interface PrepWorkflowAst {
  version: 'prep-dsl/v3';
  sources: PrepOperatorAst[];
  mainSource: string;
  /** Structured chains; `operators` is the flat view kept for compatibility. */
  steps: PrepStepAst[];
  operators: PrepOperatorAst[];
  /** All output sinks in document order. */
  outputs: PrepOperatorAst[];
  output?: PrepOperatorAst;
}

export interface PrepParseResult {
  ast: PrepWorkflowAst | null;
  diagnostics: PrepDiagnostic[];
}

export interface PrepOperatorParseResult {
  operator: PrepOperatorAst | null;
  diagnostics: PrepDiagnostic[];
}

export interface PrepWorkflowNodeInput {
  id: string;
  type: PrepOperatorType;
  label: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

export interface PrepWorkflowEdgeInput {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface PrepWorkflowCompileResult {
  nodes: PrepWorkflowNodeInput[];
  edges: PrepWorkflowEdgeInput[];
  diagnostics: PrepDiagnostic[];
  /** Typed, versioned plan built from the compiled nodes (see shared/workflow-plan). */
  plan?: import('../workflow-plan/model').WorkflowPlan;
}

export interface PrepJoinCondition {
  left: string;
  operator: string;
  right: string;
}

export interface PrepAsofJoinConfig {
  leftTime: string;
  operator: '>=' | '<=' | 'nearest';
  rightTime: string;
  direction?: 'backward' | 'forward' | 'nearest';
  tolerance?: string;
  by?: PrepJoinCondition[];
}
