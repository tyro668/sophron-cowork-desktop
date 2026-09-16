import type { PrepOperatorType } from './ast';
import { formatOperator } from './operators/formatter';
import { quoteString } from './syntax/literals';
import { formatFieldName, formatFieldRef, parseFieldRef } from './syntax/fields';

export interface PrepFlowNodeLike {
  id: string;
  type: PrepOperatorType;
  config?: Record<string, unknown>;
}

export interface PrepFlowEdgeLike {
  id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

const BINARY_TYPES = new Set<PrepOperatorType>(['join', 'set_op']);

interface Chain {
  /** Producer node id of the stream this chain reads. */
  inputProducerId: string;
  nodes: PrepFlowNodeLike[];
  /** Name bound to the produced stream; set only when `named`. */
  name: string;
  named: boolean;
  /** Stream names this chain's binary operators read on their right input. */
  rightDeps: string[];
}

/**
 * Exports a workflow graph to Prep DSL. The graph is decomposed into named
 * stream chains (`step <name> = <ref>`); junction streams — fan-out points and
 * join/set_op right inputs — get stable names so every branch is preserved.
 * Graphs the DSL cannot express (cycles, invalid arity, unconnected operators,
 * unformattable configs) abort the export with an explicit error instead of
 * being silently linearized into different semantics.
 */
export function exportPrepWorkflowDsl(
  nodes: PrepFlowNodeLike[],
  edges: PrepFlowEdgeLike[]
): string {
  const sources = nodes.filter((node) => node.type === 'input_source');
  const sourceLines = sources.map((node) => {
    const line = formatInputSource(node);
    if (!line) {
      throw new Error(
        `Cannot export incomplete input_source node${node.id ? ` (${node.id})` : ''}`
      );
    }
    return line;
  });
  if (sources.length === 0) {
    sourceLines.push('input source task as src');
  }

  const { chains, streamNames, rightInputs } = decomposeIntoChains(nodes, edges);
  if (chains.length === 0) {
    return [...sourceLines, '', 'from src', '  | output table "result" mode replace'].join('\n');
  }

  const lines: string[] = [...sourceLines];
  let firstEmitted = true;
  for (const chain of chains) {
    const inputName = streamNames.get(chain.inputProducerId);
    if (!inputName) {
      throw new Error(`Cannot export workflow: chain has no resolvable input stream`);
    }
    // Single-source linear chains keep the compact v1 layout: no header.
    const compactHeader =
      !chain.named &&
      firstEmitted &&
      sources.length === 1 &&
      inputName === (getAlias(sources[0]) ?? 'src');
    if (!compactHeader) {
      lines.push('', chain.named ? `step ${chain.name} = ${inputName}` : `from ${inputName}`);
    }
    for (const node of chain.nodes) {
      lines.push(`  | ${formatOperatorLine(node, inputName, rightInputs)}`);
    }
    firstEmitted = false;
  }

  return lines.join('\n').trim();
}

/**
 * Formats one operator line, resolving join/set_op right inputs and field
 * qualifiers to the stream names this export assigned.
 */
function formatOperatorLine(
  node: PrepFlowNodeLike,
  leftName: string,
  rightInputs: Map<string, string>
): string {
  const config = { ...(node.config ?? {}) };
  delete config.stepName;
  const rightName = rightInputs.get(node.id);
  if (rightName) {
    const oldRightQualifiers = new Set(
      [config.rightInput, config.rightAlias]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => value.toLowerCase())
    );
    config.rightInput = rightName;
    config.rightAlias = rightName;
    rewriteBinaryFieldQualifiers(config, rightName, leftName, oldRightQualifiers);
  }
  const line = formatOperator({ ...node, config });
  if (!line?.trim()) {
    throw new Error(
      `Cannot export incomplete ${node.type} operator${node.id ? ` (${node.id})` : ''}`
    );
  }
  return line;
}

/**
 * Normalizes qualified field refs in a binary operator's config: left-side
 * refs take the chain input stream name, right-side refs take the resolved
 * right stream name.
 */
function rewriteBinaryFieldQualifiers(
  config: Record<string, unknown>,
  rightName: string,
  leftName: string,
  oldRightQualifiers: Set<string>
): void {
  const rewrite = (value: unknown, name: string): unknown => {
    if (typeof value !== 'string' || !name) return value;
    const ref = parseFieldRef(value);
    if (!ref?.name) return value;
    if (!ref.source) return value;
    return `${formatFieldName(name)}.${formatFieldName(ref.name)}`;
  };
  const conditions = Array.isArray(config.conditions) ? config.conditions : [];
  config.conditions = conditions.map((condition) => {
    if (!condition || typeof condition !== 'object') return condition;
    const item = condition as Record<string, unknown>;
    return {
      ...item,
      left: rewrite(item.left, leftName),
      right: rewrite(item.right, rightName),
    };
  });
  const asof = config.asof;
  if (asof && typeof asof === 'object') {
    const item = { ...(asof as Record<string, unknown>) };
    item.leftTime = rewrite(item.leftTime, leftName);
    item.rightTime = rewrite(item.rightTime, rightName);
    if (Array.isArray(item.by)) {
      item.by = item.by.map((condition) => {
        if (!condition || typeof condition !== 'object') return condition;
        const entry = condition as Record<string, unknown>;
        return {
          ...entry,
          left: rewrite(entry.left, leftName),
          right: rewrite(entry.right, rightName),
        };
      });
    }
    config.asof = item;
  }
  if (Array.isArray(config.keep)) {
    config.keep = config.keep.map((item) => {
      if (!item || typeof item !== 'object' || item.wildcard === true) return item;
      const entry = { ...(item as Record<string, unknown>) };
      const ref = parseFieldRef(String(entry.source ?? ''));
      if (!ref?.name) return entry;
      let side: string;
      if (entry.side === 'right') side = rightName;
      else if (entry.side === 'left') side = leftName;
      else if (ref.source && oldRightQualifiers.has(ref.source.toLowerCase())) side = rightName;
      else if (ref.source === leftName || !ref.source) side = leftName;
      else return entry;
      if (!side) return entry;
      entry.source = `${formatFieldName(side)}.${formatFieldName(ref.name)}`;
      return entry;
    });
  }
}

interface DecomposeResult {
  chains: Chain[];
  /** Producer node id → stream name (source alias or step name). */
  streamNames: Map<string, string>;
  /** Binary node id → resolved right-input stream name. */
  rightInputs: Map<string, string>;
}

function decomposeIntoChains(
  nodes: PrepFlowNodeLike[],
  edges: PrepFlowEdgeLike[]
): DecomposeResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, PrepFlowEdgeLike[]>();
  const incoming = new Map<string, PrepFlowEdgeLike[]>();
  for (const edge of edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    const edgeRef = edge.id ?? `${edge.sourceNodeId}->${edge.targetNodeId}`;
    if (!source || !target) {
      throw new Error(`Cannot export workflow: edge ${edgeRef} references an unknown node`);
    }
    if (source.id === target.id) {
      throw new Error(`Cannot export workflow: node ${source.id} connects to itself`);
    }
    const sourceHandle = edge.sourceHandle ?? 'output';
    if (sourceHandle === 'reject') {
      if (source.type !== 'expect') {
        throw new Error(
          `Cannot export workflow: edge ${edgeRef} uses reject output on non-expect node ${source.id}`
        );
      }
      if (typeof source.config?.rejectStream !== 'string' || !source.config.rejectStream.trim()) {
        throw new Error(
          `Cannot export workflow: expect node ${source.id} has a reject edge but no configured reject stream`
        );
      }
    } else if (sourceHandle !== 'output') {
      throw new Error(
        `Cannot export workflow: edge ${edgeRef} uses invalid source handle ${edge.sourceHandle}`
      );
    }
    const targetHandle = edge.targetHandle ?? 'input';
    const expected = BINARY_TYPES.has(target.type) ? ['left', 'right'] : ['input'];
    if (!expected.includes(targetHandle)) {
      throw new Error(
        `Cannot export workflow: ${target.type} node ${target.id} expects ${expected.join('/')} input, got ${targetHandle}`
      );
    }
    outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), edge]);
    incoming.set(target.id, [...(incoming.get(target.id) ?? []), edge]);
  }

  for (const node of nodes) {
    const ins = incoming.get(node.id) ?? [];
    const outs = outgoing.get(node.id) ?? [];
    if (node.type === 'input_source') {
      if (ins.length > 0) {
        throw new Error(`Cannot export workflow: input node ${node.id} has incoming edges`);
      }
      continue;
    }
    if (node.type === 'output') {
      if (outs.length > 0) {
        throw new Error(`Cannot export workflow: output node ${node.id} has outgoing edges`);
      }
      if (ins.length !== 1) {
        throw new Error(
          `Cannot export workflow: output node ${node.id} needs exactly one input, got ${ins.length}`
        );
      }
      continue;
    }
    if (ins.length === 0) {
      throw new Error(
        `Cannot export workflow: ${node.type} node ${node.id} is not connected to any input stream`
      );
    }
    if (BINARY_TYPES.has(node.type)) {
      for (const handle of ['left', 'right']) {
        const count = ins.filter((edge) => (edge.targetHandle ?? 'input') === handle).length;
        if (count !== 1) {
          throw new Error(
            `Cannot export workflow: ${node.type} node ${node.id} needs exactly one ${handle} input, got ${count}`
          );
        }
      }
    } else if (ins.length > 1) {
      throw new Error(
        `Cannot export workflow: ${node.type} node ${node.id} has ${ins.length} inputs`
      );
    }
  }

  const ordered = topologicalOrder(nodes, outgoing);
  const junctionStreams = new Set<string>();
  for (const node of nodes) {
    if ((outgoing.get(node.id) ?? []).length > 1) junctionStreams.add(node.id);
    // An authored step name persists as `stepName` on the stream's producing
    // node; keep it a chain boundary so the name (and refs to it) survives.
    if (typeof node.config?.stepName === 'string' && node.config.stepName.trim()) {
      junctionStreams.add(node.id);
    }
    if (BINARY_TYPES.has(node.type)) {
      const rightEdge = (incoming.get(node.id) ?? []).find(
        (edge) => (edge.targetHandle ?? 'input') === 'right'
      );
      if (rightEdge) junctionStreams.add(rightEdge.sourceNodeId);
    }
  }

  const streamNames = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const source of nodes.filter((item) => item.type === 'input_source')) {
    const alias = getAlias(source) ?? 'src';
    streamNames.set(source.id, alias);
    usedNames.add(alias.toLowerCase());
  }
  // `expect ... reject to <name>` declares a named stream on the node's reject
  // handle; consumers reference it like any other step/source stream.
  for (const node of nodes.filter((item) => item.type === 'expect')) {
    const rejectStream =
      typeof node.config?.rejectStream === 'string' ? node.config.rejectStream.trim() : '';
    if (!rejectStream) continue;
    if (usedNames.has(rejectStream.toLowerCase())) {
      throw new Error(
        `Cannot export workflow: expect reject stream ${rejectStream} collides with another stream name`
      );
    }
    streamNames.set(`${node.id}#reject`, rejectStream);
    usedNames.add(rejectStream.toLowerCase());
  }

  const uniqueName = (node: PrepFlowNodeLike, seq: number): string => {
    const persisted =
      typeof node.config?.stepName === 'string' && node.config.stepName.trim()
        ? node.config.stepName.trim()
        : '';
    const base =
      (persisted || `step${seq}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '') ||
      `step${seq}`;
    let candidate = base;
    let suffix = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  const visited = new Set<string>();
  const chains: Chain[] = [];
  let stepSeq = 0;

  for (const node of ordered) {
    if (node.type === 'input_source' || visited.has(node.id)) continue;
    // A chain may only start where its input stream is already named (source or
    // junction producer); other producers belong to an open chain and would
    // have visited this node during the walk.
    const ins = incoming.get(node.id) ?? [];
    const primaryIn = ins.find(
      (edge) => (edge.targetHandle ?? 'input') === (BINARY_TYPES.has(node.type) ? 'left' : 'input')
    );
    if (!primaryIn) {
      throw new Error(`Cannot export workflow: ${node.type} node ${node.id} has no primary input`);
    }

    const chain: Chain = {
      inputProducerId:
        (primaryIn.sourceHandle ?? 'output') === 'reject'
          ? `${primaryIn.sourceNodeId}#reject`
          : primaryIn.sourceNodeId,
      nodes: [],
      name: '',
      named: false,
      rightDeps: [],
    };
    let current: PrepFlowNodeLike | undefined = node;
    while (current) {
      visited.add(current.id);
      chain.nodes.push(current);
      const outs = outgoing.get(current.id) ?? [];
      if (outs.length === 0) break;
      if (junctionStreams.has(current.id)) {
        stepSeq += 1;
        chain.name = uniqueName(current, stepSeq);
        chain.named = true;
        streamNames.set(current.id, chain.name);
        break;
      }
      const next = outs.find((edge) => {
        if ((edge.sourceHandle ?? 'output') !== 'output') return false;
        const target = nodeById.get(edge.targetNodeId)!;
        const handle = BINARY_TYPES.has(target.type) ? 'left' : 'input';
        return (edge.targetHandle ?? 'input') === handle;
      });
      if (!next) break;
      current = nodeById.get(next.targetNodeId);
    }
    chains.push(chain);
  }

  for (const node of nodes) {
    if (node.type !== 'input_source' && !visited.has(node.id)) {
      throw new Error(
        `Cannot export workflow: ${node.type} node ${node.id} is unreachable from an input source`
      );
    }
  }

  // Binary operators learn their right-input stream name for formatting.
  const rightInputs = new Map<string, string>();
  for (const node of nodes) {
    if (!BINARY_TYPES.has(node.type)) continue;
    const rightEdge = (incoming.get(node.id) ?? []).find(
      (edge) => (edge.targetHandle ?? 'input') === 'right'
    );
    const rightName = rightEdge ? streamNames.get(rightEdge.sourceNodeId) : undefined;
    if (!rightName) {
      throw new Error(
        `Cannot export workflow: ${node.type} node ${node.id} has an unresolvable right input`
      );
    }
    rightInputs.set(node.id, rightName);
    const chain = chains.find((candidate) => candidate.nodes.includes(node));
    chain?.rightDeps.push(rightName);
  }

  return { chains: orderChains(chains, streamNames), streamNames, rightInputs };
}

/**
 * Emits chains in dependency order: a chain can only be written after the
 * streams it reads (input and right inputs) are defined. Chains are otherwise
 * kept in build order for stability.
 */
function orderChains(chains: Chain[], streamNames: Map<string, string>): Chain[] {
  const producedName = new Map<Chain, string>();
  for (const chain of chains) {
    const producer = [...chain.nodes].reverse().find((n) => n.type !== 'output');
    if (producer && streamNames.has(producer.id)) {
      producedName.set(chain, streamNames.get(producer.id)!);
    }
  }
  const depNames = new Map<Chain, Set<string>>();
  for (const chain of chains) {
    const names = new Set<string>(chain.rightDeps);
    const inputName = streamNames.get(chain.inputProducerId);
    if (inputName) names.add(inputName);
    depNames.set(chain, names);
  }

  const remaining = new Set(chains);
  const emittedNames = new Set<string>();
  const ordered: Chain[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((chain) =>
      [...depNames.get(chain)!].every(
        (name) => emittedNames.has(name) || !isChainProduced(name, producedName)
      )
    );
    if (ready.length === 0) {
      throw new Error('Cannot export workflow: stream dependencies form a cycle');
    }
    // Preserve build order among ready chains.
    const next = chains.find((chain) => ready.includes(chain))!;
    ordered.push(next);
    remaining.delete(next);
    const produced = producedName.get(next);
    if (produced) emittedNames.add(produced);
  }
  return ordered;
}

function isChainProduced(name: string, producedName: Map<Chain, string>): boolean {
  for (const produced of producedName.values()) {
    if (produced === name) return true;
  }
  return false;
}

function topologicalOrder(
  nodes: PrepFlowNodeLike[],
  outgoing: Map<string, PrepFlowEdgeLike[]>
): PrepFlowNodeLike[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  for (const node of nodes) indegree.set(node.id, 0);
  for (const edges of outgoing.values()) {
    for (const edge of edges) {
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    }
  }
  const originalIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const ready = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0);
  const ordered: PrepFlowNodeLike[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0));
    const current = ready.shift()!;
    ordered.push(current);
    for (const edge of outgoing.get(current.id) ?? []) {
      const next = (indegree.get(edge.targetNodeId) ?? 0) - 1;
      indegree.set(edge.targetNodeId, next);
      if (next === 0) {
        const target = nodeById.get(edge.targetNodeId);
        if (target) ready.push(target);
      }
    }
  }
  if (ordered.length !== nodes.length) {
    throw new Error('Cannot export workflow: the graph contains a cycle');
  }
  return ordered;
}

function formatInputSource(node: PrepFlowNodeLike): string | null {
  const config = node.config ?? {};
  const hasStructured = Boolean(
    stringValue(config.datasetId) ||
    stringValue(config.filePath) ||
    stringValue(config.alias) ||
    stringValue(config.source) ||
    stringValue(config.name)
  );
  if (!hasStructured && isString(config.dsl)) return config.dsl;
  const alias = getAlias(node) ?? 'src';
  const source = isString(config.source)
    ? config.source
    : isString(config.datasetId)
      ? 'dataset'
      : isString(config.filePath)
        ? 'file'
        : 'task';
  const incremental = isString(config.incrementalBy)
    ? ` incremental by ${formatFieldRef(config.incrementalBy)}`
    : '';
  if (source === 'dataset') {
    const datasetId = stringValue(config.datasetId) ?? stringValue(config.name);
    return datasetId
      ? `input source dataset ${quoteString(datasetId)}${incremental} as ${alias}`
      : null;
  }
  if (source === 'file') {
    const filePath = stringValue(config.filePath);
    return filePath ? `input source file ${quoteString(filePath)}${incremental} as ${alias}` : null;
  }
  return `input source task${incremental} as ${alias}`;
}

export function exportPrepOperatorDsl(node: PrepFlowNodeLike): string {
  return formatOperator(node) ?? '';
}

function getAlias(node: PrepFlowNodeLike | undefined): string | null {
  return typeof node?.config?.alias === 'string' ? node.config.alias : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
