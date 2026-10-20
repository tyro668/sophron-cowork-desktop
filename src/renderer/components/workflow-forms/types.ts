import type { ComponentType } from 'react';
import type { DataWorkflowNode } from '../../types';
import type { DataWorkflowEdge } from '../../../shared/contracts/data';
import type { DataColumnTypeInfo } from '../../../shared/data-field-types';

// All operator forms share this interface
export interface OperatorFormProps {
  node: DataWorkflowNode;
  pipelineId?: string;
  fieldCompletions: string[];
  fieldTypes?: DataColumnTypeInfo[];
  otherNodes: DataWorkflowNode[];
  /** Workflow edges, used to resolve stable upstream reference names (join). */
  workflowEdges?: DataWorkflowEdge[];
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  rightSourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  upstreamRowCount?: number;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}

export type OperatorFormComponent = ComponentType<OperatorFormProps>;

export type OperatorFormLoader = () => Promise<{ default: OperatorFormComponent }>;
