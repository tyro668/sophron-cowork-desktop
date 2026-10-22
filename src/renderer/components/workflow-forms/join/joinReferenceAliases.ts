/**
 * Join conditions reference columns as `[alias].[field]`, where `alias` is the
 * stable reference name of an upstream `input` (its `config.alias`) —
 * the same names the DSL validator accepts. Node display labels are NOT
 * reference names: they are editable and often generic (输入 / 类型转换).
 */
export interface JoinGraphNode {
  id: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface JoinGraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  targetHandle?: string | null;
}

function aliasOf(node: JoinGraphNode | undefined): string {
  const alias = node?.config?.alias;
  return typeof alias === 'string' ? alias.trim() : '';
}

/** Input-source aliases reachable upstream from (and including) `startNodeId`. */
export function collectUpstreamInputAliases(
  startNodeId: string | undefined,
  nodes: JoinGraphNode[],
  edges: JoinGraphEdge[]
): string[] {
  if (!startNodeId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: string[] = [];
  const seen = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node?.type === 'input') {
      const alias = aliasOf(node);
      if (alias && !result.includes(alias)) result.push(alias);
      continue;
    }
    for (const edge of edges) {
      if (edge.targetNodeId === id) queue.push(edge.sourceNodeId);
    }
  }
  return result;
}

export function refQualifier(value: string | undefined): string {
  const match = /^\[([^\]]+)\]\./.exec(value ?? '');
  return match ? match[1] : '';
}

/**
 * Pick the reference aliases for the join's left/right sides. Prefers the
 * qualifier already used by saved conditions when it is a valid upstream
 * reference, so existing configs resolve unchanged.
 */
export function resolveJoinReferenceAliases(args: {
  leftSourceId?: string;
  rightSourceId?: string;
  nodes: JoinGraphNode[];
  edges: JoinGraphEdge[];
  configRightAlias?: unknown;
  savedLeftRefs?: string[];
}): { leftAliases: string[]; leftAlias: string; rightAlias: string } {
  const leftAliases = collectUpstreamInputAliases(args.leftSourceId, args.nodes, args.edges);
  const savedQualifier = (args.savedLeftRefs ?? [])
    .map(refQualifier)
    .find((q) => q && leftAliases.some((a) => a.toLowerCase() === q.toLowerCase()));
  const leftAlias =
    (savedQualifier && leftAliases.find((a) => a.toLowerCase() === savedQualifier.toLowerCase())) ||
    leftAliases[0] ||
    '';
  const configured = typeof args.configRightAlias === 'string' ? args.configRightAlias.trim() : '';
  const rightAlias =
    configured || collectUpstreamInputAliases(args.rightSourceId, args.nodes, args.edges)[0] || '';
  return { leftAliases, leftAlias, rightAlias };
}
