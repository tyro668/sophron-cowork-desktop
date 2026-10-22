/**
 * Field rename propagation: when an operator renames a field it produces
 * (rename target, derive / aggregate output name, unnest alias), downstream
 * node configs that *read that field* follow along.
 *
 * References are resolved, not text-matched:
 * - expressions are tokenized; only field tokens (`[x]`, `"x"`, `[t].[x]`) whose
 *   name matches and whose qualifier (if any) names a source on the renamed
 *   field's branch are rewritten — strings and other tables' fields are untouched;
 * - a join only rewrites the side (left/right) the renamed field flows into;
 * - output-name keys (derive targets, aggregate aliases, unpivot name/value
 *   columns…) are never rewritten, and a downstream node that re-defines or
 *   drops the old name stops the propagation on that path.
 */
import { tokenizeExpression } from '../expression-tokenizer';
import { unwrapField } from '../expression/parser';
import { formatFieldName } from '../prep-dsl/syntax/fields';

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

/** Accepts a field qualifier (`[t].[x]` → `t`); unqualified refs always match. */
export type QualifierFilter = (qualifier: string) => boolean;

/**
 * Rewrite field references to `from` inside one expression, using the expression
 * tokenizer so string literals, functions and other tables' fields are untouched.
 */
export function renameExpressionField(
  expression: string,
  from: string,
  to: string,
  acceptsQualifier: QualifierFilter = () => true
): string {
  let tokens;
  try {
    tokens = tokenizeExpression(expression);
  } catch {
    return expression;
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isField = token.type === 'FieldRef';
    const isQuotedIdentifier = token.type === 'StringLiteral' && token.value.startsWith('"');
    if (!isField && !isQuotedIdentifier) continue;
    // A qualifier token (`[t]` in `[t].[x]`) is a source name, not a field.
    if (isField && tokens[index + 1]?.type === 'Dot' && tokens[index + 2]?.type === 'FieldRef') {
      continue;
    }
    const name = isField ? unwrapField(token.value) : token.value.slice(1, -1).replace(/""/g, '"');
    if (name !== from) continue;
    const qualified =
      isField && tokens[index - 1]?.type === 'Dot' && tokens[index - 2]?.type === 'FieldRef';
    if (qualified && !acceptsQualifier(unwrapField(tokens[index - 2].value))) continue;
    const text = isField ? formatFieldName(to) : `"${to.replace(/"/g, '""')}"`;
    edits.push({ start: token.start, end: token.end, text });
  }
  if (edits.length === 0) return expression;
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += expression.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + expression.slice(cursor);
}

/** Keys holding one input field name / a list of input field names / an expression. */
const FIELD_KEYS = new Set(['field', 'source', 'leftTime', 'rightTime']);
const FIELD_LIST_KEYS = new Set(['fields', 'groupBy', 'mergeKeys', 'partitionBy']);
const EXPRESSION_KEYS = new Set(['condition', 'expression', 'having']);
/** Per-operator keys that *define* output names; never rewritten. */
const OUTPUT_KEYS: Record<string, ReadonlySet<string>> = {
  unnest: new Set(['alias', 'withIndex']),
  unpivot: new Set(['nameColumn', 'valueColumn']),
};

export type JoinSide = 'left' | 'right';

interface RenameContext {
  from: string;
  to: string;
  type: string;
  /** Join side the renamed field flows into (join nodes only). */
  side?: JoinSide;
  acceptsQualifier: QualifierFilter;
}

function rewriteConfig(config: Config, ctx: RenameContext): Config | null {
  let changed = false;
  const outputKeys = OUTPUT_KEYS[ctx.type];
  const visit = (value: unknown, key: string | null, parent: Row | null): unknown => {
    if (typeof value === 'string') {
      if (!key || outputKeys?.has(key)) return value;
      // A derive calculation's `field` is the column it defines, not one it reads.
      if (ctx.type === 'derive' && key === 'field' && parent && 'expression' in parent) {
        return value;
      }
      if (EXPRESSION_KEYS.has(key)) {
        const next = renameExpressionField(value, ctx.from, ctx.to, ctx.acceptsQualifier);
        if (next !== value) changed = true;
        return next;
      }
      if (ctx.type === 'join') {
        // Conditions / asof keys: `left` reads the left input, `right` the right one.
        const side =
          key === 'left' || key === 'leftTime'
            ? 'left'
            : key === 'right' || key === 'rightTime'
              ? 'right'
              : null;
        const keepSide =
          key === 'source' && parent && typeof parent.side === 'string' ? parent.side : null;
        const effective = side ?? keepSide;
        if (effective && effective !== ctx.side) return value;
        if (!side && key !== 'source') return value;
      } else if (!FIELD_KEYS.has(key)) {
        return value;
      }
      if (value === ctx.from) {
        changed = true;
        return ctx.to;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === 'string') {
          if (key && FIELD_LIST_KEYS.has(key) && !outputKeys?.has(key) && item === ctx.from) {
            changed = true;
            return ctx.to;
          }
          return item;
        }
        return visit(item, key, parent);
      });
    }
    if (value && typeof value === 'object') {
      const record = value as Row;
      return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, visit(v, k, record)]));
    }
    return value;
  };
  const next = visit(config, null, null) as Config;
  return changed ? next : null;
}

/** Rewrite references to `from` as `to` in one node config (returns null when unchanged). */
export function renameFieldReferences(
  config: Config,
  from: string,
  to: string,
  options: { type?: string; side?: JoinSide; acceptsQualifier?: QualifierFilter } = {}
): Config | null {
  return rewriteConfig(config, {
    from,
    to,
    type: options.type ?? '',
    side: options.side,
    acceptsQualifier: options.acceptsQualifier ?? (() => true),
  });
}

/** True when the node (after rewriting) no longer passes the old field name downstream. */
function stopsPropagation(type: string, config: Config, from: string, to: string): boolean {
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  switch (type) {
    case 'derive':
      return rows(config.calculations).some((row) => row.field === from);
    case 'rename':
      return rows(config.mappings).some((row) => row.targetValue === from);
    case 'aggregate':
      return (
        rows(config.metrics).some((row) => row.alias === from) ||
        !JSON.stringify(list(config.groupBy)).includes(JSON.stringify(to))
      );
    case 'select':
      return config.selection !== 'exclude'
        ? !list(config.fields).includes(to)
        : list(config.fields).includes(to);
    case 'unnest':
      return config.alias === from || config.withIndex === from;
    case 'unpivot':
      return config.nameColumn === from || config.valueColumn === from;
    case 'sql':
    case 'output':
      return true;
    default:
      return false;
  }
}

interface RenameGraph {
  nodes: Array<{ id: string; type: string; config: Config }>;
  edges: Array<{ sourceNodeId: string; targetNodeId: string; targetHandle?: string | null }>;
}

/** Aliases of the input sources feeding `nodeId` (its own branch). */
function branchSourceAliases(graph: RenameGraph, nodeId: string): Set<string> {
  const aliases = new Set<string>();
  const seen = new Set<string>();
  const pending = [nodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (node?.type === 'input') {
      const alias = str(node.config.alias);
      if (alias) aliases.add(alias);
    }
    for (const edge of graph.edges) if (edge.targetNodeId === id) pending.push(edge.sourceNodeId);
  }
  return aliases;
}

/** Apply renames to every node downstream of `nodeId` that resolves the field to it. */
export function propagateFieldRenames<T extends RenameGraph>(
  graph: T,
  nodeId: string,
  renames: Array<[string, string]>
): T {
  if (renames.length === 0) return graph;
  const aliases = branchSourceAliases(graph, nodeId);
  const acceptsQualifier: QualifierFilter = (qualifier) => aliases.has(qualifier);
  const configs = new Map(graph.nodes.map((node) => [node.id, node.config]));
  for (const [from, to] of renames) {
    const visited = new Set<string>();
    const pending: Array<{ id: string }> = [{ id: nodeId }];
    while (pending.length) {
      const { id } = pending.pop()!;
      for (const edge of graph.edges) {
        if (edge.sourceNodeId !== id) continue;
        const target = graph.nodes.find((node) => node.id === edge.targetNodeId);
        if (!target) continue;
        const side: JoinSide | undefined =
          target.type === 'join' ? (edge.targetHandle === 'right' ? 'right' : 'left') : undefined;
        const visitKey = `${target.id}:${side ?? ''}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);
        const current = configs.get(target.id)!;
        const next =
          renameFieldReferences(current, from, to, {
            type: target.type,
            side,
            acceptsQualifier,
          }) ?? current;
        configs.set(target.id, next);
        if (!stopsPropagation(target.type, next, from, to)) pending.push({ id: target.id });
      }
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const config = configs.get(node.id)!;
      return config === node.config ? node : { ...node, config };
    }),
  };
}
