import type { PrepOperatorType } from './ast';
import { formatOperator } from './operators/formatter';

export interface PrepFlowNodeLike {
  id: string;
  type: PrepOperatorType;
  config?: Record<string, unknown>;
}

export interface PrepFlowEdgeLike {
  sourceNodeId: string;
  targetNodeId: string;
  targetHandle?: string | null;
}

export function exportPrepWorkflowDsl(
  nodes: PrepFlowNodeLike[],
  edges: PrepFlowEdgeLike[]
): string {
  const sources = nodes.filter((node) => node.type === 'input_source');
  const operators = sortOperatorsByEdges(
    nodes.filter((node) => node.type !== 'input_source'),
    edges
  );
  const sourceLines = sources.map((source) => source.config?.dsl).filter(isString);
  const mainSource = inferMainSource(sources, operators, edges);
  const operatorLines = operators.map((operator) => {
    const line = formatOperator(operator);
    if (!line?.trim()) {
      throw new Error(
        `Cannot export incomplete ${operator.type} operator${operator.id ? ` (${operator.id})` : ''}`
      );
    }
    return line;
  });

  if (sources.length > 1) {
    return [...sourceLines, '', `from ${mainSource}`, ...operatorLines.map(toPipelineLine)]
      .join('\n')
      .trim();
  }

  const firstSource = sourceLines[0] ?? 'input source task';
  return [firstSource, ...operatorLines.map(toPipelineLine)].join('\n').trim();
}

function sortOperatorsByEdges(
  operators: PrepFlowNodeLike[],
  edges: PrepFlowEdgeLike[]
): PrepFlowNodeLike[] {
  const operatorById = new Map(operators.map((operator) => [operator.id, operator]));
  const originalIndex = new Map(operators.map((operator, index) => [operator.id, index]));
  const indegree = new Map(operators.map((operator) => [operator.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!operatorById.has(edge.sourceNodeId) || !operatorById.has(edge.targetNodeId)) continue;
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    outgoing.set(edge.sourceNodeId, [
      ...(outgoing.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
  }

  const ready = operators.filter((operator) => indegree.get(operator.id) === 0);
  const ordered: PrepFlowNodeLike[] = [];
  while (ready.length > 0) {
    ready.sort(
      (left, right) => (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
    );
    const current = ready.shift();
    if (!current) break;
    ordered.push(current);
    for (const targetId of outgoing.get(current.id) ?? []) {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      const target = operatorById.get(targetId);
      if (nextIndegree === 0 && target) ready.push(target);
    }
  }

  if (ordered.length === operators.length) return ordered;
  const orderedIds = new Set(ordered.map((operator) => operator.id));
  return [...ordered, ...operators.filter((operator) => !orderedIds.has(operator.id))];
}

export function exportPrepOperatorDsl(node: PrepFlowNodeLike): string {
  return formatOperator(node) ?? '';
}

function inferMainSource(
  sources: PrepFlowNodeLike[],
  operators: PrepFlowNodeLike[],
  edges: PrepFlowEdgeLike[]
): string {
  const firstOperator = operators.find((operator) => operator.type !== 'output');
  const sourceId =
    firstOperator &&
    edges.find(
      (edge) =>
        edge.targetNodeId === firstOperator.id &&
        (((firstOperator.type === 'join' || firstOperator.type === 'set_op') &&
          edge.targetHandle === 'left') ||
          (firstOperator.type !== 'join' &&
            firstOperator.type !== 'set_op' &&
            (edge.targetHandle ?? 'input') === 'input'))
    )?.sourceNodeId;
  const source = sources.find((item) => item.id === sourceId) ?? sources[0];
  return getAlias(source) ?? 'source';
}

function getAlias(node: PrepFlowNodeLike | undefined): string | null {
  return typeof node?.config?.alias === 'string' ? node.config.alias : null;
}

function toPipelineLine(line: string): string {
  return `  | ${line}`;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
