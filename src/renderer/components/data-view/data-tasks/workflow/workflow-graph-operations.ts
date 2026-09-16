import type { DataTaskWorkflow, DataWorkflowEdge, DataWorkflowNode } from '../../../../types';
import { getOperatorDefinition, hasBinaryInputs } from '../../../../../shared/operators';

export interface WorkflowConnectionInput {
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function canConnectWorkflowNodes(
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[],
  connection: WorkflowConnectionInput,
  excludedEdgeId?: string
): boolean {
  const source = nodes.find((node) => node.id === connection.sourceNodeId);
  const target = nodes.find((node) => node.id === connection.targetNodeId);
  if (!source || !target || source.id === target.id) return false;

  // Edge endpoints come from the operator registry's declared ports.
  const sourceOutputs = getOperatorDefinition(source.type)?.ports.outputs ?? ['output'];
  const targetInputs = getOperatorDefinition(target.type)?.ports.inputs ?? ['input'];
  const sourceHandle = connection.sourceHandle ?? 'output';
  const targetHandle = connection.targetHandle ?? 'input';
  if (!(sourceOutputs as readonly string[]).includes(sourceHandle)) return false;
  if (!(targetInputs as readonly string[]).includes(targetHandle)) return false;

  const remainingEdges = edges.filter((edge) => edge.id !== excludedEdgeId);
  if (
    remainingEdges.some(
      (edge) => edge.targetNodeId === target.id && (edge.targetHandle ?? 'input') === targetHandle
    )
  ) {
    return false;
  }
  if (
    remainingEdges.some(
      (edge) =>
        edge.sourceNodeId === source.id &&
        edge.targetNodeId === target.id &&
        (edge.sourceHandle ?? 'output') === sourceHandle &&
        (edge.targetHandle ?? 'input') === targetHandle
    )
  ) {
    return false;
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of remainingEdges) {
    const targets = outgoing.get(edge.sourceNodeId) ?? [];
    targets.push(edge.targetNodeId);
    outgoing.set(edge.sourceNodeId, targets);
  }
  const pending = [target.id];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (nodeId === source.id) return false;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    pending.push(...(outgoing.get(nodeId) ?? []));
  }
  return true;
}

export function connectWorkflowNodes(
  workflow: DataTaskWorkflow,
  connection: WorkflowConnectionInput,
  edge: DataWorkflowEdge
): DataTaskWorkflow {
  if (!canConnectWorkflowNodes(workflow.nodes, workflow.edges, connection)) return workflow;
  const nextEdge: DataWorkflowEdge = {
    ...edge,
    sourceNodeId: connection.sourceNodeId,
    targetNodeId: connection.targetNodeId,
    sourceHandle: connection.sourceHandle ?? 'output',
    targetHandle: connection.targetHandle ?? 'input',
  };
  // A reject edge names its stream on the expect node; auto-fill when unset.
  // Row-count assertions cannot route rows — reject edges on them are invalid.
  let nodes = workflow.nodes;
  if (nextEdge.sourceHandle === 'reject') {
    const source = nodes.find((node) => node.id === nextEdge.sourceNodeId);
    if (
      source &&
      (
        getOperatorDefinition(source.type)?.ports.outputs as readonly string[] | undefined
      )?.includes('reject') &&
      source.config.kind !== 'row_count' &&
      !source.config.rejectStream
    ) {
      const rejectStream = `${(source.label || 'expect').replace(/[^A-Za-z0-9_]/g, '_')}_rejects`;
      nodes = nodes.map((node) =>
        node.id === source.id
          ? { ...node, config: { ...node.config, rejectStream }, updatedAt: Date.now() }
          : node
      );
    }
  }
  return synchronizeRightInputConfigs({
    ...workflow,
    nodes,
    edges: [...workflow.edges, nextEdge],
  });
}

export function reconnectWorkflowEdge(
  workflow: DataTaskWorkflow,
  edgeId: string,
  connection: WorkflowConnectionInput
): DataTaskWorkflow {
  if (!workflow.edges.some((edge) => edge.id === edgeId)) return workflow;
  if (!canConnectWorkflowNodes(workflow.nodes, workflow.edges, connection, edgeId)) return workflow;
  return synchronizeRightInputConfigs({
    ...workflow,
    edges: workflow.edges.map((edge) =>
      edge.id === edgeId
        ? {
            ...edge,
            sourceNodeId: connection.sourceNodeId,
            targetNodeId: connection.targetNodeId,
            sourceHandle: connection.sourceHandle ?? 'output',
            targetHandle: connection.targetHandle ?? 'input',
          }
        : edge
    ),
  });
}

export function removeWorkflowEdge(workflow: DataTaskWorkflow, edgeId: string): DataTaskWorkflow {
  if (!workflow.edges.some((edge) => edge.id === edgeId)) return workflow;
  return synchronizeRightInputConfigs({
    ...workflow,
    edges: workflow.edges.filter((edge) => edge.id !== edgeId),
  });
}

export function removeWorkflowNode(workflow: DataTaskWorkflow, nodeId: string): DataTaskWorkflow {
  if (!workflow.nodes.some((node) => node.id === nodeId)) return workflow;
  return synchronizeRightInputConfigs({
    ...workflow,
    nodes: workflow.nodes.filter((node) => node.id !== nodeId),
    edges: workflow.edges.filter(
      (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
    ),
  });
}

export function synchronizeRightInputConfigs(workflow: DataTaskWorkflow): DataTaskWorkflow {
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    if (!hasBinaryInputs(node.type)) return node;
    const rightEdge = workflow.edges.find(
      (edge) => edge.targetNodeId === node.id && edge.targetHandle === 'right'
    );
    const rightSource = rightEdge ? nodeById.get(rightEdge.sourceNodeId) : undefined;
    const rightAlias = rightSource
      ? String(rightSource.config.alias ?? rightSource.label ?? '').trim()
      : '';
    const currentRightInput =
      typeof node.config.rightInput === 'string' ? node.config.rightInput : '';
    const currentRightAlias =
      typeof node.config.rightAlias === 'string' ? node.config.rightAlias : '';
    if (rightAlias === currentRightInput && rightAlias === currentRightAlias) return node;

    const config = { ...node.config };
    delete config.rightInput;
    delete config.rightAlias;
    changed = true;
    return {
      ...node,
      config: rightAlias ? { ...config, rightInput: rightAlias, rightAlias } : config,
      updatedAt: Date.now(),
    };
  });
  return changed ? { ...workflow, nodes } : workflow;
}
