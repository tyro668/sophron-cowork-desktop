/**
 * Column lineage of a compiled jflow workflow: walks the node graph from its inputs and tracks,
 * per column, which source-table columns it is derived from and the expression that produced it.
 * Covers renames, casts, derived/replaced columns, aggregates, projections, joins (keep lists),
 * pivot/unpivot; row-only steps (where, sort, distinct, take, …) pass columns through unchanged.
 */
import type {
  DataAutomationColumnSnapshot,
  DataAutomationLineageEntry,
  DataWorkflowNodeInput,
} from '../../../shared/contracts/data';
import { extractFieldNamesFromExpression } from './utils';

interface ColumnLineage {
  sources: Map<string, DataAutomationColumnSnapshot>;
  expression?: string;
}
type LineageState = Map<string, ColumnLineage>;

export interface WorkflowLineageGraph {
  nodes: Array<{ id: string; type: string; config?: DataWorkflowNodeInput['config'] }>;
  edges: Array<{ sourceNodeId: string; targetNodeId: string; targetHandle?: string | null }>;
}

type Config = Record<string, unknown>;
const arr = (value: unknown): Config[] =>
  Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Config[]) : [];
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strs = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : [];

function identity(column: DataAutomationColumnSnapshot): ColumnLineage {
  return { sources: new Map([[column.name, column]]) };
}

/** Lineage of `name` in `state`; a column the state does not know is treated as its own source. */
function lookup(state: LineageState, name: string): ColumnLineage {
  return state.get(name) ?? identity({ name });
}

function fromExpression(state: LineageState, expression: string): ColumnLineage {
  const sources = new Map<string, DataAutomationColumnSnapshot>();
  for (const field of extractFieldNamesFromExpression(expression)) {
    for (const [key, column] of lookup(state, field).sources) sources.set(key, column);
  }
  return { sources, expression };
}

function merge(...items: ColumnLineage[]): ColumnLineage {
  const sources = new Map<string, DataAutomationColumnSnapshot>();
  for (const item of items) for (const [key, column] of item.sources) sources.set(key, column);
  return { sources };
}

function applyNode(
  node: WorkflowLineageGraph['nodes'][number],
  inputs: { input?: LineageState; left?: LineageState; right?: LineageState }
): LineageState {
  const config = (node.config ?? {}) as Config;
  const current = new Map(inputs.input ?? inputs.left ?? []);
  switch (node.type) {
    case 'rename': {
      const next: LineageState = new Map();
      const renames = new Map(
        arr(config.mappings)
          .filter((m) => str(m.targetMode || 'rename') === 'rename' && str(m.targetValue))
          .map((m) => [str(m.source), str(m.targetValue)])
      );
      for (const [name, lineage] of current) next.set(renames.get(name) ?? name, lineage);
      return next;
    }
    case 'cast': {
      for (const conversion of arr(config.conversions)) {
        const field = str(conversion.field);
        if (!field) continue;
        const prior = lookup(current, field);
        current.set(field, {
          sources: prior.sources,
          expression: `cast(${prior.expression ?? `[${field}]`} as ${str(conversion.type)}${typeof conversion.precision === 'number' ? `(${conversion.precision},${conversion.scale ?? 0})` : ''})`,
        });
      }
      return current;
    }
    case 'derive': {
      for (const calculation of arr(config.calculations)) {
        const field = str(calculation.field);
        const expression = str(calculation.expression);
        if (field && expression) current.set(field, fromExpression(current, expression));
      }
      return current;
    }
    case 'aggregate': {
      const next: LineageState = new Map();
      for (const field of strs(config.groupBy)) next.set(field, lookup(current, field));
      for (const metric of arr(config.metrics)) {
        const alias = str(metric.alias);
        if (!alias) continue;
        const expression = str(metric.expression) || '*';
        const base =
          expression === '*' ? { sources: new Map() } : fromExpression(current, expression);
        next.set(alias, {
          sources: base.sources,
          expression: `${str(metric.function)}(${expression})`,
        });
      }
      return next;
    }
    case 'select': {
      const fields = strs(config.fields);
      if (config.selection === 'exclude') {
        for (const field of fields) current.delete(field);
        return current;
      }
      return new Map(fields.map((field) => [field, lookup(current, field)]));
    }
    case 'join': {
      const left = inputs.left ?? new Map();
      const right = inputs.right ?? new Map();
      const keep = arr(config.keep);
      if (!keep.length) return new Map([...right, ...left]);
      const next: LineageState = new Map();
      for (const item of keep) {
        const side = item.side === 'right' ? right : left;
        if (item.wildcard) {
          for (const [name, lineage] of side) next.set(name, lineage);
          continue;
        }
        const source = str(item.source);
        if (source) next.set(str(item.alias) || source, lookup(side, source));
      }
      return next;
    }
    case 'set_op': {
      const next: LineageState = new Map();
      for (const [name, lineage] of inputs.left ?? current)
        next.set(name, merge(lineage, lookup(inputs.right ?? new Map(), name)));
      return next;
    }
    case 'pivot': {
      const keys = strs(config.groupBy);
      const on = arr(config.on).map((axis) => str(axis.field));
      const values = merge(
        ...arr(config.using).map((m) => fromExpression(current, str(m.expression))),
        ...on.map((field) => lookup(current, field))
      );
      const next: LineageState = new Map();
      const rowKeys = keys.length
        ? keys
        : [...current.keys()].filter(
            (name) =>
              !on.includes(name) &&
              !arr(config.using).some((m) =>
                extractFieldNamesFromExpression(str(m.expression)).includes(name)
              )
          );
      for (const key of rowKeys) next.set(key, lookup(current, key));
      next.set('*', values); // pivoted value columns are named after data values
      return next;
    }
    case 'unpivot': {
      const fields = strs(config.fields);
      const next: LineageState = new Map();
      for (const [name, lineage] of current) if (!fields.includes(name)) next.set(name, lineage);
      const melted = merge(...fields.map((field) => lookup(current, field)));
      if (str(config.nameColumn)) next.set(str(config.nameColumn), { sources: new Map() });
      if (str(config.valueColumn)) next.set(str(config.valueColumn), melted);
      return next;
    }
    default:
      return current;
  }
}

/**
 * Lineage of the terminal output's columns. `inputColumns` returns the columns of an input node's
 * source table (empty when unknown — referenced columns then count as their own source).
 */
export function deriveWorkflowLineage(
  graph: WorkflowLineageGraph,
  outputSchema: DataAutomationColumnSnapshot[],
  inputColumns: (node: WorkflowLineageGraph['nodes'][number]) => DataAutomationColumnSnapshot[],
  outputNodeId?: string | null
): DataAutomationLineageEntry[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const states = new Map<string, LineageState>();
  const visiting = new Set<string>();
  const stateOf = (id: string): LineageState => {
    const cached = states.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || visiting.has(id)) return new Map();
    visiting.add(id);
    let state: LineageState;
    if (node.type === 'input') {
      state = new Map(inputColumns(node).map((column) => [column.name, identity(column)]));
    } else {
      const inputs: { input?: LineageState; left?: LineageState; right?: LineageState } = {};
      for (const edge of graph.edges.filter((e) => e.targetNodeId === id)) {
        const handle =
          edge.targetHandle === 'left' || edge.targetHandle === 'right'
            ? edge.targetHandle
            : 'input';
        inputs[handle] = stateOf(edge.sourceNodeId);
      }
      state = applyNode(node, inputs);
    }
    visiting.delete(id);
    states.set(id, state);
    return state;
  };
  const terminal =
    (outputNodeId && byId.get(outputNodeId)) ||
    graph.nodes.find(
      (node) => node.type === 'output' && !graph.edges.some((e) => e.sourceNodeId === node.id)
    );
  const state = terminal ? stateOf(terminal.id) : new Map<string, ColumnLineage>();
  return outputSchema.map((column) => {
    const lineage = state.get(column.name) ?? state.get('*') ?? identity({ name: column.name });
    return {
      ...column,
      sourceColumns: [...lineage.sources.values()],
      ...(lineage.expression ? { expression: lineage.expression } : {}),
    };
  });
}
