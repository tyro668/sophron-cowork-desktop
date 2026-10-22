/**
 * Field rename propagation: when an operator renames a field it produces
 * (rename rename target, derive / aggregate output name, unnest
 * alias), downstream node configs that reference the old name follow along.
 */
type Config = Record<string, unknown>;
type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter((r): r is Row => !!r && typeof r === 'object') : [];

function pairRenames(
  before: unknown,
  after: unknown,
  name: (row: Row) => string | null
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const prev = rows(before);
  const next = rows(after);
  next.forEach((row, index) => {
    const old =
      (typeof row.id === 'string' && prev.find((p) => p.id === row.id)) ||
      (prev.length === next.length ? prev[index] : undefined);
    if (!old) return;
    const a = name(old);
    const b = name(row);
    if (a && b && a !== b) out.push([a, b]);
  });
  return out;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Output-name changes made by an edit of one node's config. */
export function detectFieldRenames(
  type: string,
  before: Config,
  after: Config
): Array<[string, string]> {
  switch (type) {
    case 'rename':
      return pairRenames(before.mappings, after.mappings, (r) => {
        if (r.targetMode === 'rename') return str(r.targetValue);
        const source = str(r.source);
        const value = typeof r.targetValue === 'string' ? r.targetValue : '';
        if (!source) return null;
        return r.targetMode === 'prefix' ? `${value}${source}` : `${source}${value}`;
      });
    case 'derive':
      return pairRenames(before.calculations, after.calculations, (r) =>
        r.action === 'replace' ? null : str(r.field)
      );
    case 'aggregate':
      return pairRenames(before.metrics, after.metrics, (r) => str(r.alias));
    case 'unnest': {
      const a = str(before.alias);
      const b = str(after.alias);
      return a && b && a !== b && before.field === after.field ? [[a, b]] : [];
    }
    default:
      return [];
  }
}

const FIELD_KEYS = new Set(['field', 'source', 'nameColumn', 'valueColumn']);
const FIELD_LIST_KEYS = new Set(['fields', 'groupBy', 'mergeKeys']);
const EXPRESSION_KEYS = new Set(['condition', 'expression', 'left', 'right']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rewrite references to `from` as `to` in one node config (returns null when unchanged). */
export function renameFieldReferences(config: Config, from: string, to: string): Config | null {
  let changed = false;
  const bracket = new RegExp(`\\[${escapeRegExp(from)}\\]`, 'g');
  const visit = (value: unknown, key: string | null): unknown => {
    if (typeof value === 'string') {
      if (key && FIELD_KEYS.has(key) && value === from) {
        changed = true;
        return to;
      }
      if (key && EXPRESSION_KEYS.has(key) && bracket.test(value)) {
        bracket.lastIndex = 0;
        changed = true;
        return value.replace(bracket, `[${to}]`);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (key && FIELD_LIST_KEYS.has(key) && item === from) {
          changed = true;
          return to;
        }
        return visit(item, key && FIELD_LIST_KEYS.has(key) ? null : key);
      });
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Config).map(([k, v]) => [k, visit(v, k)]));
    }
    return value;
  };
  const next = visit(config, null) as Config;
  return changed ? next : null;
}

interface RenameGraph {
  nodes: Array<{ id: string; type: string; config: Config }>;
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
}

/** Apply renames to every node downstream of `nodeId`. */
export function propagateFieldRenames<T extends RenameGraph>(
  graph: T,
  nodeId: string,
  renames: Array<[string, string]>
): T {
  if (renames.length === 0) return graph;
  const downstream = new Set<string>();
  const pending = [nodeId];
  while (pending.length) {
    const id = pending.pop()!;
    for (const edge of graph.edges) {
      if (edge.sourceNodeId === id && !downstream.has(edge.targetNodeId)) {
        downstream.add(edge.targetNodeId);
        pending.push(edge.targetNodeId);
      }
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (!downstream.has(node.id)) return node;
      let config = node.config;
      for (const [from, to] of renames) config = renameFieldReferences(config, from, to) ?? config;
      return config === node.config ? node : { ...node, config };
    }),
  };
}
