import type { DataWorkflowEdge, DataWorkflowNode } from '../../../../types';

// These operators keep the input field names unchanged. If their output has
// not been cached yet, the nearest upstream schema is still valid for pickers.
const FIELD_NAME_PRESERVING_TYPES = new Set<DataWorkflowNode['type']>([
  'filter',
  'sort',
  'deduplicate',
  'limit',
  'type_convert',
]);

export function getWorkflowFieldSourceCandidates(
  sourceNode: DataWorkflowNode | null,
  nodes: DataWorkflowNode[],
  edges: DataWorkflowEdge[]
): DataWorkflowNode[] {
  const candidates: DataWorkflowNode[] = [];
  const visited = new Set<string>();
  let current = sourceNode;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    candidates.push(current);
    if (!FIELD_NAME_PRESERVING_TYPES.has(current.type)) break;

    const edge =
      edges.find(
        (item) => item.targetNodeId === current?.id && (item.targetHandle ?? 'input') === 'input'
      ) ?? edges.find((item) => item.targetNodeId === current?.id);
    current = edge ? (nodes.find((item) => item.id === edge.sourceNodeId) ?? null) : null;
  }

  return candidates;
}
