import type { DataWorkflowEdgeInput, DataWorkflowNodeInput } from '../../../shared/contracts';
import { DataCommandError } from '../data-command-types';

const NODE_X_STEP = 260;

export interface GeneratedWorkflowMergeResult {
  nodes: DataWorkflowNodeInput[];
  edges: DataWorkflowEdgeInput[];
  /** Generated node id -> merged node id (ids are deduplicated against the base graph). */
  nodeIdMap: Map<string, string>;
  /** Output node that the generated chain ultimately feeds, when one exists. */
  terminalOutputNodeId: string | null;
}

/**
 * Splices the standalone generated chain (`input_source → ops… → output`) into an
 * existing workflow at the selected anchor node:
 *
 * - anchor with `output` edges: the chain is inserted between the anchor and its
 *   former successors (their target handles are preserved); the generated source
 *   and output nodes are dropped.
 * - anchor of type `output`: the chain is inserted on the incoming edges (steps
 *   land before the sink); the generated source and output nodes are dropped.
 * - anchor with no `output` successors (open tail): the generated output node is
 *   kept as the chain's sink.
 */
export function mergeGeneratedChainAfterAnchor(
  base: { nodes: DataWorkflowNodeInput[]; edges: DataWorkflowEdgeInput[] },
  anchorNodeId: string,
  generated: { nodes: DataWorkflowNodeInput[]; edges: DataWorkflowEdgeInput[] },
  /** Maps a local id to its task-scoped runtime id (identity for tests). */
  scopeId: (id: string) => string = (id) => id
): GeneratedWorkflowMergeResult {
  const anchor = base.nodes.find((node) => node.id === anchorNodeId);
  if (!anchor) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Cannot find workflow node "${anchorNodeId}" to anchor generation`
    );
  }
  const chain = orderedGeneratedOperators(generated);
  if (chain.length === 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow contains no operators to append'
    );
  }
  const generatedOutput = generated.nodes.find((node) => node.type === 'output') ?? null;

  // Base node ids are already task-scoped at runtime; dedupe candidates in
  // scoped space so a generated `filter_1` does not collide with an existing
  // `<taskId>__filter_1` once save scopes every id.
  const usedNodeIds = new Set(base.nodes.map((node) => scopeId(node.id)));
  const usedEdgeIds = new Set(base.edges.map((edge) => scopeId(edge.id)));
  const nodeIdMap = new Map<string, string>();
  const edgeSeq = { value: 0 };
  const makeEdge = (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle: string | null,
    targetHandle: string | null
  ): DataWorkflowEdgeInput => {
    let candidate = `edge_${sourceNodeId}_${targetNodeId}`;
    while (usedEdgeIds.has(scopeId(candidate))) {
      candidate = `edge_${sourceNodeId}_${targetNodeId}_${(edgeSeq.value += 1)}`;
    }
    usedEdgeIds.add(scopeId(candidate));
    return { id: candidate, sourceNodeId, targetNodeId, sourceHandle, targetHandle };
  };

  const insertBeforeOutput = anchor.type === 'output';
  const nodeX = (index: number) =>
    insertBeforeOutput
      ? anchor.x - NODE_X_STEP * (chain.length - index)
      : anchor.x + NODE_X_STEP * (index + 1);
  const newNodes = chain.map((node, index) => {
    const id = uniqueNodeId(node.id, node.type, usedNodeIds, scopeId);
    nodeIdMap.set(node.id, id);
    const config = { ...(node.config ?? {}) };
    const origin = config.generatedOrigin;
    if (origin && typeof origin === 'object' && !Array.isArray(origin)) {
      config.generatedOrigin = { ...(origin as Record<string, unknown>), nodeId: id };
    }
    return { ...node, id, x: nodeX(index), y: anchor.y, config };
  });
  const headId = newNodes[0].id;
  const tailId = newNodes[newNodes.length - 1].id;

  const isOutputEdge = (edge: DataWorkflowEdgeInput) =>
    edge.sourceNodeId === anchorNodeId && (!edge.sourceHandle || edge.sourceHandle === 'output');
  const anchorOutEdges = base.edges.filter(isOutputEdge);
  const anchorInEdges = base.edges.filter((edge) => edge.targetNodeId === anchorNodeId);

  // Slide the displaced side of the graph sideways so the inserted row of
  // generated nodes lands in a gap instead of overlapping existing nodes.
  const shiftedNodes = base.nodes.map((node) => ({ ...node }));
  const shiftById = new Map(shiftedNodes.map((node) => [node.id, node]));
  const shiftAmount = NODE_X_STEP * chain.length;
  if (insertBeforeOutput) {
    for (const id of reachSet(
      anchorInEdges.map((edge) => edge.sourceNodeId),
      base.edges,
      'up'
    )) {
      const node = shiftById.get(id);
      if (node && node.id !== anchorNodeId) node.x -= shiftAmount;
    }
  } else if (anchorOutEdges.length > 0) {
    for (const id of reachSet(
      anchorOutEdges.map((edge) => edge.targetNodeId),
      base.edges,
      'down'
    )) {
      const node = shiftById.get(id);
      if (node) node.x += shiftAmount;
    }
  }

  const keptOutputNode =
    !insertBeforeOutput && anchorOutEdges.length === 0 ? generatedOutput : null;
  let mergedOutput: DataWorkflowNodeInput | null = null;
  if (keptOutputNode) {
    const id = uniqueNodeId(keptOutputNode.id, keptOutputNode.type, usedNodeIds, scopeId);
    nodeIdMap.set(keptOutputNode.id, id);
    mergedOutput = {
      ...keptOutputNode,
      id,
      x: anchor.x + NODE_X_STEP * (chain.length + 1),
      y: anchor.y,
    };
  }

  // Only copy edges between operators. The sink edge is wired once below;
  // nodeIdMap also contains the retained output for an open tail.
  const operatorIds = new Set(chain.map((node) => node.id));
  const chainEdges = generated.edges
    .filter((edge) => operatorIds.has(edge.sourceNodeId) && operatorIds.has(edge.targetNodeId))
    .map((edge) =>
      makeEdge(
        nodeIdMap.get(edge.sourceNodeId)!,
        nodeIdMap.get(edge.targetNodeId)!,
        edge.sourceHandle ?? 'output',
        edge.targetHandle ?? 'input'
      )
    );

  const edges: DataWorkflowEdgeInput[] = [];
  if (insertBeforeOutput) {
    edges.push(
      ...base.edges.filter((edge) => edge.targetNodeId !== anchorNodeId),
      ...anchorInEdges.map((edge) =>
        makeEdge(edge.sourceNodeId, headId, edge.sourceHandle ?? 'output', 'input')
      ),
      ...chainEdges,
      makeEdge(tailId, anchorNodeId, 'output', 'input')
    );
  } else if (anchorOutEdges.length > 0) {
    edges.push(
      ...base.edges.filter((edge) => !isOutputEdge(edge)),
      makeEdge(anchorNodeId, headId, 'output', 'input'),
      ...chainEdges,
      ...anchorOutEdges.map((edge) =>
        makeEdge(tailId, edge.targetNodeId, 'output', edge.targetHandle ?? 'input')
      )
    );
  } else {
    edges.push(
      ...base.edges,
      makeEdge(anchorNodeId, headId, 'output', 'input'),
      ...chainEdges,
      ...(mergedOutput ? [makeEdge(tailId, mergedOutput.id, 'output', 'input')] : [])
    );
  }

  return {
    nodes: [...shiftedNodes, ...newNodes, ...(mergedOutput ? [mergedOutput] : [])],
    edges,
    nodeIdMap,
    terminalOutputNodeId: mergedOutput
      ? mergedOutput.id
      : insertBeforeOutput
        ? anchorNodeId
        : firstDownstreamOutput(anchorOutEdges, base),
  };
}

/** Generated plan is a strict linear chain source → op1…opN → output; walk its edges. */
function orderedGeneratedOperators(generated: {
  nodes: DataWorkflowNodeInput[];
  edges: DataWorkflowEdgeInput[];
}): DataWorkflowNodeInput[] {
  const byId = new Map(generated.nodes.map((node) => [node.id, node]));
  const nextOf = new Map(generated.edges.map((edge) => [edge.sourceNodeId, edge.targetNodeId]));
  const source = generated.nodes.find((node) => node.type === 'input_source');
  const ordered: DataWorkflowNodeInput[] = [];
  const seen = new Set<string>();
  let cursor = source?.id;
  while (cursor) {
    const nextId = nextOf.get(cursor);
    const next = nextId ? byId.get(nextId) : undefined;
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    if (next.type === 'output') break;
    ordered.push(next);
    cursor = next.id;
  }
  return ordered;
}

/** BFS over edges — 'down' follows source→target, 'up' follows target→source. */
function reachSet(
  startIds: string[],
  edges: DataWorkflowEdgeInput[],
  direction: 'up' | 'down'
): Set<string> {
  const visited = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of edges) {
      if (direction === 'down' && edge.sourceNodeId === id) queue.push(edge.targetNodeId);
      if (direction === 'up' && edge.targetNodeId === id) queue.push(edge.sourceNodeId);
    }
  }
  return visited;
}

function firstDownstreamOutput(
  anchorOutEdges: DataWorkflowEdgeInput[],
  base: { nodes: DataWorkflowNodeInput[]; edges: DataWorkflowEdgeInput[] }
): string | null {
  const byId = new Map(base.nodes.map((node) => [node.id, node]));
  for (const id of reachSet(
    anchorOutEdges.map((edge) => edge.targetNodeId),
    base.edges,
    'down'
  )) {
    if (byId.get(id)?.type === 'output') return id;
  }
  return null;
}

function uniqueNodeId(
  preferredId: string,
  type: string,
  used: Set<string>,
  scopeId: (id: string) => string
): string {
  const pick = (candidate: string): string => {
    const scoped = scopeId(candidate);
    if (used.has(scoped)) return '';
    used.add(scoped);
    return scoped;
  };
  const preferred = pick(preferredId);
  if (preferred) return preferred;
  let index = 1;
  let id = pick(`${type}_${index}`);
  while (!id) {
    index += 1;
    id = pick(`${type}_${index}`);
  }
  return id;
}
