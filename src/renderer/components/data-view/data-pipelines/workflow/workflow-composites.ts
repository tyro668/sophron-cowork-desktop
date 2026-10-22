import type { DataWorkflowEdge, DataWorkflowNode } from '../../../../types';

/** Display metadata the jflow compiler stores on every member of a composite step. */
export interface WorkflowCompositeLayout {
  composite: string;
  role: string;
  label: string;
  size: number;
}

export interface WorkflowCompositeInfo {
  id: string;
  label: string;
  memberIds: string[];
  expanded: boolean;
  /** Input handles of the collapsed node (one per distinct upstream). */
  inputs: string[];
}

export interface WorkflowCompositeView {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  /** Keyed by the main (visible) node id. */
  composites: Map<string, WorkflowCompositeInfo>;
  /** Hidden member id → main node id. */
  hiddenToMain: Map<string, string>;
  /** Expanded member id → its composite. */
  memberOf: Map<string, WorkflowCompositeInfo>;
}

export function readCompositeLayout(node: DataWorkflowNode): WorkflowCompositeLayout | null {
  const value = node.config.layout;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const layout = value as Record<string, unknown>;
  if (typeof layout.composite !== 'string' || !layout.composite) return null;
  return {
    composite: layout.composite,
    role: typeof layout.role === 'string' ? layout.role : 'step',
    label: typeof layout.label === 'string' ? layout.label : '',
    size: typeof layout.size === 'number' ? layout.size : 0,
  };
}

const HANDLE_ORDER: Record<string, number> = { input: 0, left: 0, right: 1 };

/**
 * Collapses jflow composite groups (`{stepId}~k` helpers + `{stepId}`) into their main node.
 * Internal edges disappear; boundary edges are re-pointed at the main node. Expanded groups are
 * returned unchanged but annotated so the canvas can frame them and offer "collapse".
 */
export function collapseWorkflowComposites(
  nodes: readonly DataWorkflowNode[],
  edges: readonly DataWorkflowEdge[],
  expanded: ReadonlySet<string>
): WorkflowCompositeView {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const layout = readCompositeLayout(node);
    if (!layout || !byId.has(layout.composite)) continue;
    groups.set(layout.composite, [...(groups.get(layout.composite) ?? []), node.id]);
  }
  const composites = new Map<string, WorkflowCompositeInfo>();
  const hiddenToMain = new Map<string, string>();
  const memberOf = new Map<string, WorkflowCompositeInfo>();
  for (const [mainId, members] of groups) {
    const memberIds = members.includes(mainId) ? members : [...members, mainId];
    if (memberIds.length < 2) continue;
    const main = byId.get(mainId)!;
    const info: WorkflowCompositeInfo = {
      id: mainId,
      label: readCompositeLayout(main)?.label || main.label,
      memberIds,
      expanded: expanded.has(mainId),
      inputs: ['input'],
    };
    composites.set(mainId, info);
    for (const id of memberIds) {
      if (info.expanded) memberOf.set(id, info);
      else if (id !== mainId) hiddenToMain.set(id, mainId);
    }
  }
  if (hiddenToMain.size === 0) {
    return { nodes: [...nodes], edges: [...edges], composites, hiddenToMain, memberOf };
  }
  const groupOf = (id: string) => hiddenToMain.get(id) ?? (composites.has(id) ? id : null);

  // Boundary inputs of each collapsed group, ordered by member then handle.
  const inbound = new Map<string, DataWorkflowEdge[]>();
  const outEdges: DataWorkflowEdge[] = [];
  for (const edge of edges) {
    const sourceGroup = groupOf(edge.sourceNodeId);
    const targetGroup = groupOf(edge.targetNodeId);
    const sourceCollapsed = sourceGroup !== null && !composites.get(sourceGroup)!.expanded;
    const targetCollapsed = targetGroup !== null && !composites.get(targetGroup)!.expanded;
    if (sourceCollapsed && targetCollapsed && sourceGroup === targetGroup) continue;
    const next: DataWorkflowEdge = {
      ...edge,
      sourceNodeId: sourceCollapsed ? sourceGroup! : edge.sourceNodeId,
      sourceHandle:
        sourceCollapsed && edge.sourceNodeId !== sourceGroup ? 'output' : edge.sourceHandle,
    };
    if (targetCollapsed && edge.targetNodeId !== targetGroup) {
      inbound.set(targetGroup!, [...(inbound.get(targetGroup!) ?? []), next]);
      continue;
    }
    if (targetCollapsed) {
      inbound.set(targetGroup!, [...(inbound.get(targetGroup!) ?? []), next]);
      continue;
    }
    outEdges.push(next);
  }
  for (const [mainId, list] of inbound) {
    const info = composites.get(mainId)!;
    const order = (edge: DataWorkflowEdge) => {
      const memberIndex = info.memberIds.indexOf(edge.targetNodeId);
      return memberIndex * 10 + (HANDLE_ORDER[edge.targetHandle ?? 'input'] ?? 0);
    };
    const sorted = [...list].sort((a, b) => order(a) - order(b));
    const sources: string[] = [];
    const kept: DataWorkflowEdge[] = [];
    for (const edge of sorted) {
      const key = `${edge.sourceNodeId}:${edge.sourceHandle ?? 'output'}`;
      if (sources.includes(key)) continue;
      sources.push(key);
      kept.push(edge);
    }
    info.inputs =
      kept.length > 1
        ? kept.map((_, index) => (index === 0 ? 'left' : index === 1 ? 'right' : `in${index}`))
        : ['input'];
    kept.forEach((edge, index) => {
      outEdges.push({ ...edge, targetNodeId: mainId, targetHandle: info.inputs[index] });
    });
  }
  return {
    nodes: nodes.filter((node) => !hiddenToMain.has(node.id)),
    edges: outEdges,
    composites,
    hiddenToMain,
    memberOf,
  };
}
