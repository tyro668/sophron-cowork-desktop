import type { ComponentType } from 'react';
import type { DataWorkflowNode } from '../../types';

// All operator forms share this interface
export interface OperatorFormProps {
  node: DataWorkflowNode;
  taskId?: string;
  fieldCompletions: string[];
  otherNodes: DataWorkflowNode[];
  sourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  rightSourceNode?: { id: string; type: string; config?: Record<string, unknown> };
  upstreamRowCount?: number;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}

export type OperatorFormComponent = ComponentType<OperatorFormProps>;

export type OperatorFormLoader = () => Promise<{ default: OperatorFormComponent }>;
