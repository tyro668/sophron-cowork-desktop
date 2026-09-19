import type { Edge, Node } from '@xyflow/react';
import type {
  DataTaskWorkflow,
  DataWorkflowNode,
  DataWorkflowSaveInput,
  WorkflowNodeRunStat,
} from '../../../../types';

export const WORKFLOW_NODE_WIDTH = 116;
export const WORKFLOW_NODE_HEIGHT = 36;
export const WORKFLOW_OPERATOR_MIME = 'application/x-sophron-workflow-operator';
export const WORKFLOW_ALIGNMENT_THRESHOLD = 6;
export const WORKFLOW_ALIGNMENT_GUIDE_PADDING = 32;

export type WorkflowFlowNode = Node<
  { workflowNode: DataWorkflowNode; invalid?: boolean; runStat?: WorkflowNodeRunStat },
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

export function toWorkflowSaveInput(workflow: DataTaskWorkflow): DataWorkflowSaveInput {
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

export function getWorkflowSaveInputSignature(workflow: DataTaskWorkflow): string {
  return JSON.stringify(toWorkflowSaveInput(workflow));
}

/**
 * Signature of the subgraph that determines one node's preview: the node
 * itself plus every upstream ancestor (config, types, edge topology). Node
 * positions/labels are excluded — they don't affect preview data. Used to
 * bind a materialized preview to the config that generated it.
 */
export function getWorkflowUpstreamSignature(input: DataWorkflowSaveInput, nodeId: string): string {
  const upstream = new Set<string>([nodeId]);
  const pending = [nodeId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    for (const edge of input.edges) {
      if (edge.targetNodeId === id && !upstream.has(edge.sourceNodeId)) {
        upstream.add(edge.sourceNodeId);
        pending.push(edge.sourceNodeId);
      }
    }
  }
  return JSON.stringify({
    nodes: input.nodes
      .filter((node) => upstream.has(node.id))
      .map((node) => [node.id, node.type, node.config]),
    edges: input.edges
      .filter((edge) => upstream.has(edge.sourceNodeId) && upstream.has(edge.targetNodeId))
      .map((edge) => [edge.sourceNodeId, edge.targetNodeId, edge.sourceHandle, edge.targetHandle]),
  });
}
