/**
 * Reverse exporter: operator graph (configs) → jflow text.
 *
 * Composite steps (`{stepId}~k` + `stepId`) are recognized structurally and merged back into one
 * step; a composite whose shape no longer matches (e.g. edited on the canvas) is exported node by
 * node. Every step carries `#! id:` so re-import keeps the node ids (data_workflow_nodes.id).
 */
import type {
  Chain,
  Expr,
  FieldExpr,
  Flow,
  JflowDiagnostic,
  JflowFile,
  KeepItem,
  NamedValue,
  ResourceRef,
  SortKey,
  Source,
  Step,
  TableExp,
} from './ast';
import { formatJflow, fmtField } from './format';
import { parseJflowExpr } from './parse';
import { unfield } from './parser';

export interface ExportNode {
  id: string;
  type: string;
  label?: string;
  config: Record<string, unknown>;
}

export interface ExportEdge {
  sourceNodeId: string;
  targetNodeId: string;
  targetHandle?: string | null;
}

export interface JflowExportResult {
  text: string;
  file: JflowFile;
  diagnostics: JflowDiagnostic[];
}

class ExportError extends Error {}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>)
    : [];
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function expr(text: string): Expr {
  const r = parseJflowExpr(text);
  if (!r.ast)
    throw new ExportError(`表达式无法转换为 jflow：${text}（${r.diagnostics[0]?.message ?? ''}）`);
  return r.ast;
}

function field(name: string, q?: string): FieldExpr {
  return q === undefined ? { k: 'field', name } : { k: 'field', q, name };
}

/** `[a].[b]` / `[b]` / `b` → {q?, name} */
function fieldRef(text: string): { q?: string; name: string } {
  const t = text.trim();
  const m = /^(\[(?:[^\]]|\]\])*\])\.(\[(?:[^\]]|\]\])*\])$/.exec(t);
  if (m) return { q: unfield(m[1]), name: unfield(m[2]) };
  if (/^\[(?:[^\]]|\]\])*\]$/.test(t)) return { name: unfield(t) };
  return { name: t };
}

function named(step: Step, key: string, value: NamedValue): void {
  step.named[key] = value;
  step.norder.push(key);
}

function enumValue(v: string): NamedValue {
  return { k: 'items', items: [{ k: 'expr', e: { k: 'enum', v }, nulls: null }] };
}
function exprValue(e: Expr): NamedValue {
  return { k: 'items', items: [{ k: 'expr', e, nulls: null }] };
}

function newStep(op: string): Step {
  return { op, named: {}, norder: [], namedSpans: {}, span: { start: 0, end: 0 } };
}

function sortKeysOf(v: unknown): SortKey[] {
  return arr(v).map((k) => ({
    desc: k.direction === 'desc',
    field: field(str(k.field)),
    nulls: k.nulls === 'first' || k.nulls === 'last' ? k.nulls : null,
  }));
}

function isWhole(re: RegExp, s: string): RegExpExecArray | null {
  return re.exec(s.trim());
}

interface Unit {
  /** Node id that downstream edges attach to. */
  out: string;
  members: string[];
  step: Step | null;
  source?: Source;
  /** Main input node id (null for sources). */
  input: string | null;
  /** Additional inputs, referenced by name (join/union/lookup right sides). */
  refs: Array<{ node: string; set: (t: TableExp) => void }>;
  /** Steps emitted before `step` (exporter-only expansions). */
  pre?: Step[];
}

export function exportJflow(
  nodes: ExportNode[],
  edges: ExportEdge[],
  options: { pipelineName?: string } = {}
): JflowExportResult {
  const diagnostics: JflowDiagnostic[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Strip the shared `{pipelineId}__` scope so pragmas show node keys.
  const prefixMatch = nodes.length ? /^(.*?__)/.exec(nodes[0].id) : null;
  const prefix =
    prefixMatch && nodes.every((n) => n.id.startsWith(prefixMatch[1])) ? prefixMatch[1] : '';
  const key = (id: string) => (prefix ? id.slice(prefix.length) : id);

  const inputs = new Map<string, { main?: string; right?: string }>();
  const consumers = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.sourceNodeId) || !byId.has(e.targetNodeId)) continue;
    const slot = inputs.get(e.targetNodeId) ?? {};
    if (e.targetHandle === 'right') slot.right = e.sourceNodeId;
    else slot.main = e.sourceNodeId;
    inputs.set(e.targetNodeId, slot);
    consumers.set(e.sourceNodeId, [...(consumers.get(e.sourceNodeId) ?? []), e.targetNodeId]);
  }

  // ---- composite groups
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const m = /^(.*)~(\d+)$/.exec(key(n.id));
    const base = m ? m[1] : key(n.id);
    groups.set(base, [...(groups.get(base) ?? []), n.id]);
  }
  const ordered = (ids: string[], base: string) =>
    [...ids].sort((a, b) => {
      const ka = key(a) === base ? Infinity : Number(/~(\d+)$/.exec(key(a))![1]);
      const kb = key(b) === base ? Infinity : Number(/~(\d+)$/.exec(key(b))![1]);
      return ka - kb;
    });

  const units: Unit[] = [];
  const unitOfNode = new Map<string, Unit>();
  const register = (u: Unit) => {
    units.push(u);
    for (const m of u.members) unitOfNode.set(m, u);
  };

  for (const [base, ids] of groups) {
    const members = ordered(ids, base);
    const baseId = prefix + base;
    if (members.length > 1 && byId.has(baseId)) {
      const u = recognizeComposite(base, members);
      if (u) {
        register(u);
        continue;
      }
      diagnostics.push({
        code: 'W_COMPOSITE_SPLIT',
        severity: 'warning',
        message: `复合步骤 ${base} 的结构已改变，按单个节点导出`,
      });
    }
    for (const id of members) register(single(id));
  }

  function single(id: string): Unit {
    const n = byId.get(id)!;
    const c = n.config ?? {};
    const ins = inputs.get(id) ?? {};
    const u: Unit = { out: id, members: [id], step: null, input: ins.main ?? null, refs: [] };
    const label = n.label && n.label !== key(id) ? n.label.replace(/\n/g, ' ') : null;
    const st = (op: string) => {
      const s = newStep(op);
      s.id = key(id);
      if (label) s.pragmas = { label };
      return s;
    };
    try {
      switch (n.type) {
        case 'input': {
          const alias = SIMPLE.test(str(c.alias)) ? str(c.alias) : null;
          const rawId = str(c.rawTableId);
          const source = str(c.source) || (rawId ? 'rawTable' : 'pipeline');
          const refCfg = (c.ref ?? {}) as Record<string, unknown>;
          const uri =
            str(refCfg.uri) ||
            (source === 'rawTable'
              ? `local:raw/${rawId}`
              : source === 'file'
                ? `file:${str(c.filePath)}`
                : 'local:pipeline/self');
          const ref: ResourceRef = {
            form: '@id',
            arg: uri,
            snap: str(refCfg.name) || str(c.rawTableName) || null,
            opts: {},
          };
          const src: Source = {
            alias: alias ?? `src_${key(id).replace(/[^A-Za-z0-9_]/g, '_')}`,
            ref,
            read: {},
            incr: null,
            span: { start: 0, end: 0 },
          };
          if (str(c.incrementalBy)) src.incr = { field: str(c.incrementalBy), lookback: null };
          src.id = key(id);
          if (label) src.pragmas = { label };
          if (c.disabled === true) src.pragmas = { ...(src.pragmas ?? {}), disabled: 'true' };
          u.source = src;
          u.input = null;
          return u;
        }
        case 'filter': {
          const s = st('where');
          s.cond = expr(str(c.condition) || 'true');
          u.step = s;
          break;
        }
        case 'select': {
          const fields = strs(c.fields);
          const s = st(c.selection === 'exclude' ? 'drop' : 'select');
          s.items = fields.map((f) => ({ k: 'col', e: field(f) }));
          u.step = s;
          break;
        }
        case 'derive': {
          const s = st('derive');
          s.derives = arr(c.calculations).map((x) => ({
            name: str(x.field),
            e: expr(str(x.expression)),
            replace: x.action === 'replace',
          }));
          if (arr(c.calculations).some((x) => x.action !== 'add' && x.action !== 'replace')) {
            throw new ExportError('derive 计算项缺少 add/replace，无法确定写法');
          }
          u.step = s;
          break;
        }
        case 'sort': {
          const s = st('sort');
          s.keys = sortKeysOf(c.orderBy);
          u.step = s;
          break;
        }
        case 'limit': {
          if (c.sampling === 'random') {
            const s = st('sample');
            s.n = String(c.limit);
            s.pct = c.unit === 'percent';
            if (typeof c.seed === 'number')
              named(s, 'seed', exprValue({ k: 'lit', t: 'num', v: String(c.seed) }));
            u.step = s;
            break;
          }
          const s = st('take');
          s.n = String(c.limit);
          s.pct = c.unit === 'percent';
          const keys = sortKeysOf(c.orderBy);
          if (keys.length) named(s, 'sort', { k: 'sortlist', keys });
          if (c.ties === true) named(s, 'ties', enumValue('include'));
          if (typeof c.offset === 'number' && c.offset > 0)
            named(s, 'offset', exprValue({ k: 'lit', t: 'num', v: String(c.offset) }));
          u.step = s;
          break;
        }
        case 'aggregate': {
          const s = st('group');
          const grains = (c.dateGranularity ?? {}) as Record<string, string>;
          s.groupKeys = strs(c.groupBy).map((g) => ({
            name: g,
            e: null,
            grain: grains[g] ?? null,
          }));
          s.aggs = arr(c.metrics).map((m) => ({ name: str(m.alias), e: metricExpr(m) }));
          u.step = s;
          break;
        }
        case 'join': {
          const s = st('join');
          const alias = str(c.rightAlias) || null;
          s.kind = str(c.joinType) || 'inner';
          s.table = { src: { k: 'name', v: '?' }, as: alias };
          u.refs.push({
            node: ins.right!,
            set: (t) => {
              const tableName = (t.src as { v?: string }).v;
              s.table = { src: t.src, as: alias && alias !== tableName ? alias : null };
              if (!alias && tableName) requalify(s, RIGHT_PLACEHOLDER, tableName);
            },
          });
          joinOn(s, c, alias);
          joinKeep(s, c, alias, str(byId.get(ins.main ?? '')?.config?.alias) || undefined);
          if (str(c.expect)) named(s, 'expect', enumValue(str(c.expect)));
          u.step = s;
          break;
        }
        case 'set_op': {
          const s = st(str(c.operation) || 'union');
          s.tables = [{ src: { k: 'name', v: '?' }, as: null }];
          u.refs.push({ node: ins.right!, set: (t) => (s.tables = [t]) });
          if (c.match === 'by_position') named(s, 'by', enumValue('position'));
          if (c.quantifier === 'distinct') {
            if (s.op !== 'union') throw new ExportError(`${s.op} distinct 无法表达`);
            named(s, 'distinct', exprValue({ k: 'lit', t: 'bool', v: true }));
          }
          u.step = s;
          break;
        }
        case 'sql': {
          if (str(c.sql).trim() === 'SELECT * FROM input' && /~|^pass/.test('')) {
            u.step = st('pass');
            break;
          }
          if (str(c.sql).includes("'''"))
            throw new ExportError("SQL 中包含 '''，无法写成 sql '''…'''");
          const s = st('sql');
          s.sql = str(c.sql);
          u.step = s;
          break;
        }
        case 'expect': {
          const s = st('check');
          if (c.kind === 'unique') s.check = { kind: 'unique', fields: strs(c.fields) };
          else if (c.kind === 'row_count')
            s.check = { kind: 'rows', cmp: str(c.operator) || '>=', n: Number(c.value ?? 0) };
          else s.check = { kind: 'expr', e: expr(str(c.expression)) };
          if (str(c.message))
            named(s, 'message', exprValue({ k: 'lit', t: 'str', v: str(c.message) }));
          u.step = s;
          break;
        }
        case 'cast': {
          const s = st('cast');
          s.casts = arr(c.conversions).map((x) => {
            const t = str(x.type) || 'text';
            const type =
              t === 'decimal' && typeof x.scale === 'number'
                ? {
                    name: t,
                    p: typeof x.precision === 'number' ? x.precision : Math.max(18, x.scale + 1),
                    s: x.scale,
                  }
                : { name: t };
            const nm: Record<string, Expr> = {};
            if (str(x.onError))
              nm.on_error =
                x.onError === 'null' ? { k: 'lit', t: 'null' } : { k: 'enum', v: str(x.onError) };
            if (str(x.format)) nm.format = { k: 'lit', t: 'str', v: str(x.format) };
            return { name: str(x.field), type, named: nm };
          });
          u.step = s;
          break;
        }
        case 'rename': {
          const s = st('rename');
          s.renames = arr(c.mappings).map((m) =>
            m.targetMode === 'rename'
              ? { k: 'as' as const, from: str(m.source), to: str(m.targetValue) }
              : {
                  k: m.targetMode as 'prefix' | 'suffix',
                  v: str(m.targetValue),
                  fields: [str(m.source)],
                }
          );
          u.step = s;
          break;
        }
        case 'deduplicate': {
          const s = st('distinct');
          const fields = strs(c.fields);
          if (c.strategy !== 'all_columns' && fields.length)
            named(s, 'by', { k: 'fields', v: fields });
          const keys = sortKeysOf(c.orderBy);
          if (keys.length) named(s, 'sort', { k: 'sortlist', keys });
          if (c.keep === 'last') named(s, 'keep', enumValue('last'));
          u.step = s;
          break;
        }
        case 'missing_value': {
          if (c.strategy === 'drop_rows_by_nulls' || c.strategy === 'drop_empty_rows') {
            const s = st('drop_empty');
            s.which = c.condition === 'any_null' ? 'any' : 'all';
            if (strs(c.fields).length) named(s, 'fields', { k: 'fields', v: strs(c.fields) });
            u.step = s;
            break;
          }
          const rules = arr(c.rules);
          if (rules.every((r) => r.method === 'nullify_values') && rules.length) {
            const s = st('nullify');
            const values = JSON.stringify(rules[0].values);
            if (rules.some((r) => JSON.stringify(r.values) !== values))
              throw new ExportError('nullify 各列的取值不同');
            s.fields = rules.map((r) => str(r.field));
            s.values = { k: 'list', items: (rules[0].values as unknown[]).map(literal) };
            u.step = s;
            break;
          }
          const s = st('fill');
          s.fills = rules.map((r) => {
            const method = str(r.method);
            if (method === 'literal_fill') return { name: str(r.field), with: literal(r.value) };
            const m = /^(mean|median|mode|forward|backward)_fill$/.exec(method);
            if (!m) throw new ExportError(`缺失值方法 ${method} 无法表达`);
            return { name: str(r.field), with: m[1] };
          });
          u.step = s;
          break;
        }
        case 'unpivot': {
          const s = st('unpivot');
          s.exclude = c.selection === 'exclude';
          s.fields = strs(c.fields);
          s.into = [str(c.nameColumn) || 'name', str(c.valueColumn) || 'value'];
          if (c.includeNulls === true)
            named(s, 'keep_nulls', exprValue({ k: 'lit', t: 'bool', v: true }));
          u.step = s;
          break;
        }
        case 'unnest': {
          const s = st('unnest');
          s.json = c.sourceKind === 'json';
          s.field = str(c.field);
          s.as = str(c.alias) || null;
          if (str(c.withIndex)) named(s, 'index', { k: 'fields', v: [str(c.withIndex)] });
          if (
            c.keepParentNames === true ||
            c.preserveOrder === true ||
            (str(c.path) && str(c.path) !== '$')
          ) {
            throw new ExportError(
              'unnest 的 keepParentNames/preserveOrder/path 在 jflow R1 中无法表达'
            );
          }
          u.step = s;
          break;
        }
        case 'pivot': {
          const s = st('pivot');
          if (strs(c.groupBy).length) {
            // groupBy = keep only these columns besides the axes/values: a select before the pivot.
            const used = new Set<string>([
              ...strs(c.groupBy),
              ...arr(c.on).map((a) => str(a.field)),
            ]);
            for (const m of arr(c.using))
              for (const f of str(m.expression).matchAll(/\[((?:[^\]]|\]\])+)\]/g))
                used.add(f[1].replace(/\]\]/g, ']'));
            const pre = newStep('select');
            pre.id = `${key(id)}~1`;
            pre.items = [...used].map((f) => ({ k: 'col', e: field(f) }));
            u.pre = [pre];
          }
          s.axes = arr(c.on).map((a) => ({
            name: str(a.field),
            in:
              Array.isArray(a.values) && a.values.length
                ? ({ k: 'list', items: (a.values as unknown[]).map(literal) } as Expr)
                : null,
          }));
          s.pivotValues = arr(c.using).map((m) => ({
            call: metricExpr(m),
            as: str(m.alias) || null,
          }));
          u.step = s;
          break;
        }
        case 'output': {
          const s = st('write');
          const id2 = str(c.outputResultTableId) || str(c.resultTableId);
          const name =
            str((c.ref as Record<string, unknown> | undefined)?.name) ||
            str(c.resultTableName) ||
            null;
          if (id2) s.ref = { form: '@id', arg: `local:result/${id2}`, snap: name, opts: {} };
          else
            s.ref = { form: '@new', arg: name ?? str(c.table) ?? 'result', snap: null, opts: {} };
          if (id2 || str(c.mode) !== 'replace')
            named(s, 'mode', enumValue(str(c.mode) || 'replace'));
          if (strs(c.mergeKeys).length) named(s, 'keys', { k: 'fields', v: strs(c.mergeKeys) });
          if (str(c.schemaPolicy)) named(s, 'schema', enumValue(str(c.schemaPolicy)));
          if (c.allowPartial === true)
            named(s, 'allow_partial', exprValue({ k: 'lit', t: 'bool', v: true }));
          u.step = s;
          break;
        }
        default:
          throw new ExportError(`未知算子 ${n.type}`);
      }
    } catch (error) {
      if (!(error instanceof ExportError)) throw error;
      diagnostics.push({
        code: 'E_EXPORT',
        severity: 'error',
        message: `${n.label ?? key(id)}：${error.message}`,
        stepId: key(id),
      });
      const s = st('pass');
      u.step = s;
    }
    return u;
  }

  function joinOn(s: Step, c: Record<string, unknown>, alias: string | null) {
    const conds = arr(c.conditions);
    const exprText = str(c.expression);
    if (conds.length === 0 && !exprText) {
      s.on = null;
      return;
    }
    const parts = conds.map((x) => ({
      l: fieldRef(str(x.left)),
      r: fieldRef(str(x.right)),
      op: str(x.operator) || '=',
    }));
    if (!exprText && parts.every((p) => p.op === '=' && p.l.name === p.r.name)) {
      s.on = { k: 'keys', keys: parts.map((p) => p.l.name) };
      return;
    }
    const q = alias ?? RIGHT_PLACEHOLDER;
    const terms: Expr[] = parts.map(
      (p) =>
        ({
          k: 'bin',
          op: p.op === '!=' ? '<>' : p.op,
          l: field(p.l.name, 'left'),
          r: field(p.r.name, q),
        }) as Expr
    );
    if (exprText) terms.push(expr(exprText));
    s.on = { k: 'expr', e: terms.reduce((a, b) => ({ k: 'bin', op: 'and', l: a, r: b }) as Expr) };
  }

  function joinKeep(s: Step, c: Record<string, unknown>, alias: string | null, leftAlias?: string) {
    const keep = arr(c.keep);
    const conflict = (c.conflict ?? null) as Record<string, unknown> | null;
    if (keep.length === 0) {
      if (s.kind === 'semi' || s.kind === 'anti') return;
      const custom =
        conflict &&
        ((str(conflict.leftSuffix) && conflict.leftSuffix !== '_left') ||
          (str(conflict.strategy) && conflict.strategy !== 'suffix') ||
          (str(conflict.rightPrefix) &&
            conflict.rightPrefix !== 'right_' &&
            !str(conflict.rightSuffix)));
      if (custom)
        throw new ExportError('join conflict 前缀/左后缀在 jflow R1 中无法表达；请写 keep:');
      if (conflict && str(conflict.rightSuffix) && conflict.rightSuffix !== '_right') {
        named(s, 'suffix', exprValue({ k: 'lit', t: 'str', v: str(conflict.rightSuffix) }));
      }
      return;
    }
    const q = alias ?? RIGHT_PLACEHOLDER;
    const items: KeepItem[] = keep.map((k) => {
      const ref = fieldRef(str(k.source));
      const side =
        k.side === 'left' || k.side === 'right'
          ? k.side
          : ref.q === 'left' || (ref.q !== undefined && ref.q === leftAlias)
            ? 'left'
            : 'right';
      const qual = side === 'left' ? 'left' : q;
      if (k.wildcard === true) return { k: 'star', q: qual };
      const target = str(k.alias) || ref.name;
      const e = field(ref.name, qual);
      return target === ref.name ? { k: 'col', e } : { k: 'alias', name: target, e };
    });
    named(s, 'keep', { k: 'keep', items });
  }

  function recognizeComposite(base: string, members: string[]): Unit | null {
    const ns = members.map((m) => byId.get(m)!);
    const types = ns.map((n) => n.type).join(',');
    const cfg = (i: number) => ns[i].config ?? {};
    const mainIn = (id: string) => inputs.get(id)?.main ?? null;
    const rightIn = (id: string) => inputs.get(id)?.right ?? null;
    const chained = (from: number) =>
      ns.slice(from + 1).every((n, i) => mainIn(n.id) === ns[from + i].id);
    const baseLabel = byId.get(prefix + base)?.label;
    const mk = (op: string, _input: string | null): Step => {
      const s = newStep(op);
      s.id = base;
      if (baseLabel && baseLabel !== base) s.pragmas = { label: baseLabel };
      return s;
    };
    const unit = (step: Step, input: string | null, refs: Unit['refs'] = []): Unit => ({
      out: prefix + base,
      members,
      step,
      input,
      refs,
    });
    try {
      // where with window: derive __w → filter [__w] → select exclude [__w]
      if (types === 'derive,filter,select' && chained(0)) {
        const calcs = arr(cfg(0).calculations);
        if (
          calcs.length === 1 &&
          calcs[0].field === '__w' &&
          str(cfg(1).condition) === '[__w]' &&
          strs(cfg(2).fields).join() === '__w'
        ) {
          const s = mk('where', null);
          s.cond = expr(str(calcs[0].expression));
          return unit(s, mainIn(ns[0].id));
        }
        // take N per: derive __rn → filter [__rn] <= N → select exclude [__rn]
        const m = isWhole(/^\[__rn\] <= (\d+)$/, str(cfg(1).condition));
        if (
          calcs.length === 1 &&
          calcs[0].field === '__rn' &&
          m &&
          strs(cfg(2).fields).join() === '__rn'
        ) {
          const e = expr(str(calcs[0].expression));
          if (e.k !== 'call' || !e.over || (e.name !== 'row_number' && e.name !== 'rank'))
            return null;
          const s = mk('take', null);
          s.n = m[1];
          s.pct = false;
          named(s, 'per', { k: 'fields', v: e.over.partition.map((p) => (p as FieldExpr).name) });
          if (e.over.order.length) {
            named(s, 'sort', {
              k: 'sortlist',
              keys: e.over.order.map((o) => ({
                desc: o.dir === 'desc',
                field: o.e as FieldExpr,
                nulls: o.nulls,
              })),
            });
          }
          if (e.name === 'rank') named(s, 'ties', enumValue('include'));
          return unit(s, mainIn(ns[0].id));
        }
      }
      // select with computed columns: derive → select include
      if (types === 'derive,select' && chained(0) && cfg(1).selection !== 'exclude') {
        const calcs = new Map(
          arr(cfg(0).calculations).map((x) => [str(x.field), expr(str(x.expression))])
        );
        const s = mk('select', null);
        s.items = strs(cfg(1).fields).map((f) =>
          calcs.has(f) ? { k: 'calc', name: f, calc: calcs.get(f)! } : { k: 'col', e: field(f) }
        );
        if (calcs.size && [...calcs.keys()].every((k) => strs(cfg(1).fields).includes(k)))
          return unit(s, mainIn(ns[0].id));
        return null;
      }
      // group with expression keys: derive → aggregate
      if (types === 'derive,aggregate' && chained(0)) {
        const g = single(ns[1].id).step!;
        const calcs = new Map(
          arr(cfg(0).calculations).map((x) => [str(x.field), expr(str(x.expression))])
        );
        if (![...calcs.keys()].every((k) => strs(cfg(1).groupBy).includes(k))) return null;
        g.id = base;
        g.pragmas = baseLabel && baseLabel !== base ? { label: baseLabel } : undefined;
        g.groupKeys = g.groupKeys!.map((k) => ({ ...k, e: calcs.get(k.name) ?? null }));
        return unit(g, mainIn(ns[0].id));
      }
      // complex group: [derive keys →] aggregate(__aN) → derive post → select exclude __aN
      const complexAt = types.endsWith('aggregate,derive,select')
        ? types.split(',').length - 3
        : -1;
      if (
        complexAt >= 0 &&
        (complexAt === 0 || (complexAt === 1 && ns[0].type === 'derive')) &&
        chained(0)
      ) {
        const ag = cfg(complexAt);
        const metrics = new Map(arr(ag.metrics).map((m) => [str(m.alias), metricExpr(m)]));
        const temps = strs(cfg(complexAt + 2).fields);
        if (![...metrics.keys()].every((k) => /^__a\d+$/.test(k) && temps.includes(k))) return null;
        const sub = (x: unknown): unknown => {
          if (Array.isArray(x)) return x.map(sub);
          if (!x || typeof x !== 'object') return x;
          const e = x as Expr;
          if (e.k === 'field' && metrics.has(e.name)) return metrics.get(e.name);
          return Object.fromEntries(
            Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, sub(v)])
          );
        };
        const s = mk('group', null);
        const keyCalcs =
          complexAt === 1
            ? new Map(arr(cfg(0).calculations).map((x) => [str(x.field), expr(str(x.expression))]))
            : new Map<string, Expr>();
        const grains = (ag.dateGranularity ?? {}) as Record<string, string>;
        s.groupKeys = strs(ag.groupBy).map((g) => ({
          name: g,
          e: keyCalcs.get(g) ?? null,
          grain: grains[g] ?? null,
        }));
        s.aggs = arr(cfg(complexAt + 1).calculations).map((x) => ({
          name: str(x.field),
          e: sub(expr(str(x.expression))) as Expr,
        }));
        return unit(s, mainIn(ns[0].id));
      }
      // null-aware anti: aggregate(r) ; join anti(l, r) ; join cross(·, stats) ; filter ; select
      if (types === 'aggregate,join,join,filter,select') {
        const [a, b, c2, d, e] = ns;
        const right = mainIn(a.id);
        const anti = b.config ?? {};
        const conds = arr(anti.conditions);
        if (
          anti.joinType === 'anti' &&
          rightIn(b.id) === right &&
          (c2.config ?? {}).joinType === 'cross' &&
          mainIn(c2.id) === b.id &&
          rightIn(c2.id) === a.id &&
          mainIn(d.id) === c2.id &&
          mainIn(e.id) === d.id &&
          conds.length === 1
        ) {
          const s = mk('join', null);
          s.kind = 'anti';
          s.table = { src: { k: 'name', v: '?' }, as: null };
          s.on = { k: 'keys', keys: [fieldRef(str(conds[0].left)).name] };
          named(s, 'null_aware', exprValue({ k: 'lit', t: 'bool', v: true }));
          return unit(s, mainIn(b.id), [{ node: right!, set: (t) => (s.table = t) }]);
        }
      }
      // lookup: expect unique (dim) → join left keep [left].*, gets
      if (types === 'expect,join') {
        const [e, j] = ns;
        const jc = j.config ?? {};
        const keep = arr(jc.keep);
        if (
          (e.config ?? {}).kind === 'unique' &&
          rightIn(j.id) === e.id &&
          jc.joinType === 'left' &&
          keep[0]?.side === 'left' &&
          keep[0]?.wildcard === true
        ) {
          const s = mk('lookup', null);
          const alias = str(jc.rightAlias) || null;
          s.table = { src: { k: 'name', v: '?' }, as: null };
          s.lookupOn = arr(jc.conditions).map((x) => fieldRef(str(x.left)).name);
          s.get = keep.slice(1).map((k) => fieldRef(str(k.source)).name);
          return unit(s, mainIn(j.id), [
            {
              node: mainIn(e.id)!,
              set: (t) =>
                (s.table = {
                  src: t.src,
                  as: alias && alias !== (t.src as { v?: string }).v ? alias : null,
                }),
            },
          ]);
        }
      }
      // n-way union fold
      if (
        ns.every((n) => n.type === 'set_op') &&
        ns.slice(1).every((n, i) => mainIn(n.id) === ns[i].id)
      ) {
        const op = str(cfg(0).operation) || 'union';
        if (
          !ns.every(
            (n) =>
              (str(n.config.operation) || 'union') === op &&
              n.config.match === cfg(0).match &&
              n.config.quantifier === cfg(0).quantifier
          )
        ) {
          return null;
        }
        const s = mk(op, null);
        s.tables = ns.map(() => ({ src: { k: 'name', v: '?' }, as: null }) as TableExp);
        if (cfg(0).match === 'by_position') named(s, 'by', enumValue('position'));
        if (cfg(0).quantifier === 'distinct')
          named(s, 'distinct', exprValue({ k: 'lit', t: 'bool', v: true }));
        return unit(
          s,
          mainIn(ns[0].id),
          ns.map((n, i) => ({ node: rightIn(n.id)!, set: (t: TableExp) => (s.tables![i] = t) }))
        );
      }
      return null;
    } catch (error) {
      if (error instanceof ExportError) return null;
      throw error;
    }
  }

  // pass-through sql written by `pass`
  for (const u of units) {
    const n = byId.get(u.out)!;
    if (
      u.members.length === 1 &&
      n.type === 'sql' &&
      str(n.config.sql).trim() === 'SELECT * FROM input' &&
      u.step?.op === 'sql'
    ) {
      const s = newStep('pass');
      s.id = u.step.id;
      u.step = s;
    }
  }

  // ---- chains
  const unitConsumers = new Map<Unit, Array<{ u: Unit; asMain: boolean }>>();
  for (const u of units) {
    if (u.input) {
      const p = unitOfNode.get(u.input);
      if (p) unitConsumers.set(p, [...(unitConsumers.get(p) ?? []), { u, asMain: true }]);
    }
    for (const r of u.refs) {
      const p = unitOfNode.get(r.node);
      if (p) unitConsumers.set(p, [...(unitConsumers.get(p) ?? []), { u, asMain: false }]);
    }
  }
  const continues = (u: Unit): boolean => {
    if (!u.input) return false;
    const p = unitOfNode.get(u.input);
    if (!p || p.source) return false;
    const cs = unitConsumers.get(p) ?? [];
    return cs.length === 1 && cs[0].asMain && cs[0].u === u;
  };
  // topological order of units
  const done = new Set<Unit>();
  const order: Unit[] = [];
  const visit = (u: Unit, stack: Set<Unit>) => {
    if (done.has(u)) return;
    if (stack.has(u)) throw new Error('E_GRAPH_CYCLE');
    stack.add(u);
    for (const id of [u.input, ...u.refs.map((r) => r.node)]) {
      const p = id ? unitOfNode.get(id) : undefined;
      if (p) visit(p, stack);
    }
    stack.delete(u);
    done.add(u);
    order.push(u);
  };
  for (const u of units) visit(u, new Set());

  const nameOf = new Map<Unit, string>();
  const usedNames = new Set<string>();
  const uniqueName = (want: string) => {
    let n = want;
    let i = 2;
    while (usedNames.has(n) || RESERVED.has(n)) n = `${want}_${i++}`;
    usedNames.add(n);
    return n;
  };
  const file: JflowFile = {
    header:
      options.pipelineName && NAME.test(options.pipelineName) && !RESERVED.has(options.pipelineName)
        ? { name: options.pipelineName, meta: {} }
        : null,
    params: [],
    sources: [],
    flows: [],
  };
  for (const u of order) {
    if (u.source) {
      u.source.alias = uniqueName(u.source.alias);
      nameOf.set(u, u.source.alias);
      file.sources.push(u.source);
    }
  }
  const refTo = (nodeId: string): TableExp => {
    const p = unitOfNode.get(nodeId);
    const name = p ? nameOf.get(p) : undefined;
    if (!name) throw new Error(`unnamed input ${nodeId}`);
    return { src: { k: 'name', v: name }, as: null };
  };
  for (const end of order) {
    if (end.source) continue;
    const cs = unitConsumers.get(end) ?? [];
    if (cs.length === 1 && cs[0].asMain && continues(cs[0].u)) continue; // not a chain end
    // walk back to chain start
    const seq: Unit[] = [end];
    while (continues(seq[0])) seq.unshift(unitOfNode.get(seq[0].input!)!);
    const first = seq[0];
    const headName = first.input ? nameOf.get(unitOfNode.get(first.input)!) : undefined;
    if (!headName) {
      diagnostics.push({
        code: 'E_EXPORT',
        severity: 'error',
        message: `步骤 ${first.step?.id} 缺少输入`,
      });
      continue;
    }
    for (const u of seq) for (const r of u.refs) r.set(refTo(r.node));
    const chain: Chain = {
      head: { k: 'name', v: headName },
      steps: seq.flatMap((u) => [...(u.pre ?? []), u.step!]),
      span: { start: 0, end: 0 },
    };
    const flow: Flow = { let: null, chain, span: { start: 0, end: 0 } };
    if (cs.length > 0) {
      flow.let = uniqueName(letNameFor(end));
      nameOf.set(end, flow.let);
    }
    file.flows.push(flow);
  }
  // a let used before definition cannot happen: flows are emitted in topological order.
  function letNameFor(u: Unit): string {
    const k = (u.step?.id ?? 'v').replace(/[^A-Za-z0-9_\u4e00-\u9fff]/g, '_');
    return /^[A-Za-z_\u4e00-\u9fff]/.test(k) ? `v_${k}` : `v_${k}`;
  }
  return { text: formatJflow(file), file, diagnostics };
}

const RIGHT_PLACEHOLDER = '\u0001right';

/** Replace a placeholder qualifier (`[right]` before the right table's name is known). */
function requalify(node: unknown, from: string, to: string): void {
  if (Array.isArray(node)) node.forEach((x) => requalify(x, from, to));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o.k === 'field' && o.q === from) o.q = to;
    if (o.k === 'star' && o.q === from) o.q = to;
    for (const v of Object.values(o)) if (v && typeof v === 'object') requalify(v, from, to);
  }
}

const SIMPLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*$/;
const RESERVED = new Set([
  'as',
  'is',
  'not',
  'null',
  'and',
  'or',
  'in',
  'on',
  'get',
  'let',
  'source',
  'with',
  'when',
  'then',
  'else',
  'elseif',
  'end',
  'between',
  'like',
  'ilike',
  'matches',
  'distinct',
  'over',
  'true',
  'false',
  'if',
  'case',
  'pipeline',
  'param',
]);

function literal(v: unknown): Expr {
  if (v === null || v === undefined) return { k: 'lit', t: 'null' };
  if (typeof v === 'number') return { k: 'lit', t: 'num', v: String(v) };
  if (typeof v === 'boolean') return { k: 'lit', t: 'bool', v };
  return { k: 'lit', t: 'str', v: String(v) };
}

/** Aggregate metric config → call expression (sum([x]), count(*), count(distinct [x]), …). */
function metricExpr(m: Record<string, unknown>): Expr {
  const fn = str(m.function) || 'sum';
  const text = str(m.expression).trim();
  if (text === '*')
    return {
      k: 'call',
      name: 'count',
      args: [],
      named: {},
      distinct: false,
      star: true,
      over: null,
    };
  const r = parseJflowExpr(`f(${text})`);
  const args = r.ast && r.ast.k === 'call' ? r.ast.args : [expr(text)];
  // sum(if c then x end) → sumif(x, c); count(if c then 1 end) → countif(c)
  const ifAgg: Record<string, string> = {
    sum: 'sumif',
    avg: 'avgif',
    min: 'minif',
    max: 'maxif',
    count: 'countif',
    count_distinct: 'countdistinctif',
  };
  if (
    args.length === 1 &&
    args[0].k === 'if' &&
    args[0].branches.length === 1 &&
    !args[0].else &&
    ifAgg[fn]
  ) {
    const [cond, val] = args[0].branches[0];
    if (fn === 'count') {
      if (val.k === 'lit' && val.t === 'num' && val.v === '1') {
        return {
          k: 'call',
          name: 'countif',
          args: [cond],
          named: {},
          distinct: false,
          star: false,
          over: null,
        };
      }
    } else {
      return {
        k: 'call',
        name: ifAgg[fn],
        args: [val, cond],
        named: {},
        distinct: false,
        star: false,
        over: null,
      };
    }
  }
  if (fn === 'count_distinct')
    return { k: 'call', name: 'count', args, named: {}, distinct: true, star: false, over: null };
  return { k: 'call', name: fn, args, named: {}, distinct: false, star: false, over: null };
}

export { fmtField };
