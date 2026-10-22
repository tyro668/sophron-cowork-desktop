import type { Edge, Node } from '@xyflow/react';
import type {
  DataPipelineWorkflow,
  DataWorkflowNode,
  DataWorkflowSaveInput,
} from '../../../../types';

export const WORKFLOW_NODE_WIDTH = 148;
export const WORKFLOW_NODE_HEIGHT = 48;
export const WORKFLOW_OPERATOR_MIME = 'application/x-sophron-workflow-operator';
export const WORKFLOW_ALIGNMENT_THRESHOLD = 6;
export const WORKFLOW_ALIGNMENT_GUIDE_PADDING = 32;

export type WorkflowFlowNode = Node<
  {
    workflowNode: DataWorkflowNode;
    invalid?: boolean;
    /** Set when this node stands for a collapsed jflow composite step. */
    composite?: { label: string; size: number; inputs: string[] };
    /** Main node id of the expanded composite this node belongs to. */
    compositeMember?: string;
    onToggleComposite?: (compositeId: string) => void;
  },
  'operator'
>;
export type WorkflowFlowEdge = Edge<Record<string, never>>;
export type WorkflowInspectorTab = 'config' | 'dsl' | 'data' | 'logs';
export type WorkflowAlignmentLine =
  | { id: string; orientation: 'horizontal'; x1: number; x2: number; y: number }
  | { id: string; orientation: 'vertical'; x: number; y1: number; y2: number };

export interface WorkflowAlignmentGuides {
  horizontal: WorkflowAlignmentLine | null;
  vertical: WorkflowAlignmentLine | null;
}

export const EMPTY_WORKFLOW_ALIGNMENT_GUIDES: WorkflowAlignmentGuides = {
  horizontal: null,
  vertical: null,
};

export function toWorkflowSaveInput(workflow: DataPipelineWorkflow): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      x: node.x,
      y: node.y,
      config: node.config,
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}

export function getWorkflowSaveInputSignature(workflow: DataPipelineWorkflow): string {
  return JSON.stringify(toWorkflowSaveInput(workflow));
}

// The upstream-subgraph signature lives in shared/workflow-plan so the main
// process can stamp node caches with the same value the renderer compares.
export { getWorkflowUpstreamSignature } from '../../../../../shared/workflow-plan';
