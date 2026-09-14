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

export interface PrepWorkflowAst {
  version: 'prep-dsl/v1';
  sources: PrepOperatorAst[];
  mainSource: string;
  operators: PrepOperatorAst[];
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
