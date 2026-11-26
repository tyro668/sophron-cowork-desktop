import type { DataPipelineWorkflow, DataWorkflowSaveInput } from '../contracts/data';

export function toWorkflowSaveInput(
  workflow: Pick<DataPipelineWorkflow, 'nodes' | 'edges'>
): DataWorkflowSaveInput {
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
