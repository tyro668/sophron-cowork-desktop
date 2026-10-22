/**
 * Binder + compiler: jflow AST → existing operator configs (R1, v4 §9.3).
 *
 * A step that needs several operators becomes a composite: auxiliary nodes `{stepId}~k`, the
 * last node keeps `stepId` so downstream edges and run stats hang on a stable id. Temporary
 * columns use the `__` prefix and are dropped by the composite's last node.
 */
import {
  NESTED_AGGREGATE_HINT,
  addOverToRowAggregates,
  rowLevelAggregateProblem,
  splitNestedAggregateStep,
} from './window-rewrite';
import { lookupExpressionFunction } from '../expression/functions';
import { parseExpression } from '../expression/parser';
import {
  expandCalculationDomainExpression,
  normalizeCalculationDomainExpression,
  parseCalculationFunctionDslExpression,
} from '../calculate-field/domain-dsl';
import type {
  Chain,
  Expr,
  FieldExpr,
  Head,
  JflowDiagnostic,
  JflowFile,
  JflowFix,
  ResourceRef,
  SortKey,
  Source,
  Span,
  Step,
  TableExp,
} from './ast';
import { JflowError } from './ast';
import { checkCastItemArgs, checkStepArgs, type StepArgs } from './args';
import { fmtExpr, fmtStep } from './format';

export interface JflowColumn {
  name: string;
  type?: string;
}

export interface ResolvedResource {
  uri: string;
  name: string | null;
  kind: 'raw' | 'result' | 'pipeline' | 'file';
  id?: string;
  columns?: JflowColumn[] | null;
}

export interface JflowCompileOptions {
  /** Resolves @name/@id/@path refs (and supplies columns when known). */
  resolve?: (ref: ResourceRef, role: 'source' | 'write') => ResolvedResource | null;
  /** Looks up an existing result table by name (for @new if_exists). */
  findResultByName?: (name: string) => { id: string; name: string } | null;
}

export interface JflowNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  layout?: { composite: string; role: string };
}

export interface JflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string;
  targetHandle: string;
}

export interface JflowCompileResult {
  /** Columns of the last chain's result (null when unknown). */
  lastColumns?: string[] | null;
  /** Columns of every named relation (sources and lets). */
  relationColumns?: Record<string, string[] | null>;
  nodes: JflowNode[];
  edges: JflowEdge[];
  diagnostics: JflowDiagnostic[];
  /** node id → step text span (every `{stepId}~k` maps to its step). */
  sourceMap: Record<string, Span>;
}

const AGG_CFG = new Set([
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'count_distinct',
  'median',
  'first',
  'last',
  'stddev_samp',
  'stddev_pop',
  'var_samp',
  'var_pop',
  'mode',
  'list',
  'quantile_cont',
  'quantile_disc',
  'approx_count_distinct',
  'approx_quantile',
  'approx_top_k',
  'string_agg',
]);
export const IF_AGG: Record<string, string> = {
  sumif: 'sum',
  avgif: 'avg',
  minif: 'min',
  maxif: 'max',
  countif: 'count',
  countdistinctif: 'count_distinct',
};
const IF_AGG_ALIASES: Record<string, string> = {
  条件求和: 'sumif',
  条件计数: 'countif',
  条件平均: 'avgif',
  条件最小: 'minif',
  条件最大: 'maxif',
  分段: 'bucket',
};

export function canonicalFunction(name: string): string {
  if (IF_AGG_ALIASES[name]) return IF_AGG_ALIASES[name];
  if (IF_AGG[name] || name === 'bucket') return name;
  return lookupExpressionFunction(name)?.name ?? name;
}

function isAggregateCall(e: Expr): boolean {
  if (e.k !== 'call' || e.over) return false;
  const n = canonicalFunction(e.name);
  return Boolean(IF_AGG[n]) || lookupExpressionFunction(n)?.kind === 'aggregate';
}

function walk(e: unknown, visit: (x: Expr) => void): void {
  if (Array.isArray(e)) {
    e.forEach((x) => walk(x, visit));
    return;
  }
  if (!e || typeof e !== 'object') return;
  const obj = e as Record<string, unknown>;
  if (typeof obj.k === 'string') visit(obj as unknown as Expr);
  for (const v of Object.values(obj)) if (v && typeof v === 'object') walk(v, visit);
}

export function hasWindow(e: Expr): boolean {
  let found = false;
  walk(e, (x) => {
    if (x.k === 'call' && x.over) found = true;
  });
  return found;
}

function hasAggregate(e: Expr): boolean {
  let found = false;
  walk(e, (x) => {
    if (isAggregateCall(x)) found = true;
  });
  return found;
}

function fieldRefs(e: Expr): FieldExpr[] {
  const out: FieldExpr[] = [];
  walk(e, (x) => {
    if (x.k === 'field') out.push(x);
  });
  return out;
}

/** bucket(x, (cuts…), (labels…)) → if chain; sumif etc. stay (handled by group lowering). */
function preExpr(e: Expr): Expr {
  const rec = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(rec);
    if (!x || typeof x !== 'object') return x;
    const o = Object.fromEntries(
      Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, rec(v)])
    ) as Expr;
    if (o.k === 'call' && canonicalFunction(o.name) === 'bucket') {
      const [value, cutsE, labelsE] = o.args;
      const items = (l: Expr) => (l.k === 'paren' ? [l.e] : l.k === 'list' ? l.items : [l]);
      const cuts = items(cutsE);
      const labels = items(labelsE);
      if (labels.length !== cuts.length + 1) {
        throw new JflowError(
          'E_COND_BUCKET_LABELS',
          `bucket 档名个数需要是切点数 + 1（${cuts.length + 1}），实际 ${labels.length}`
        );
      }
      const nums = cuts.map((c) => (c.k === 'lit' && c.t === 'num' ? Number(c.v) : NaN));
      if (nums.every((n) => !Number.isNaN(n)) && nums.some((n, i) => i > 0 && n <= nums[i - 1])) {
        throw new JflowError('E_BUCKET_ORDER', 'bucket 切点必须递增');
      }
      const branches: Array<[Expr, Expr]> = [
        [
          { k: 'isnull', e: value, not: false },
          { k: 'lit', t: 'null' },
        ],
        ...cuts.map(
          (c, i) => [{ k: 'bin', op: '<', l: value, r: c } as Expr, labels[i]] as [Expr, Expr]
        ),
      ];
      return { k: 'if', branches, else: labels[labels.length - 1] } as Expr;
    }
    return o;
  };
  return rec(e) as Expr;
}

/** Expression in the config dialect, verified with the app's own expression parser. */
function cx(e: Expr, span?: Span): string {
  const text = fmtExpr(preExpr(e), 'cfg');
  try {
    parseExpression(text);
  } catch (error) {
    // Calculation-domain wrappers (group/compare/ranking/… over (…)) are stored verbatim; the SQL
    // compiler expands them.
    let domainError: unknown = null;
    try {
      if (parseCalculationFunctionDslExpression(text)) {
        expandCalculationDomainExpression(text); // validates arguments
        return normalizeCalculationDomainExpression(text);
      }
    } catch (err) {
      domainError = err;
    }
    const reason = domainError ?? error;
    throw new JflowError(
      'E_EXPR_UNSUPPORTED',
      `表达式不能转换成现有配置：${text}（${reason instanceof Error ? reason.message : String(reason)}）`,
      span
    );
  }
  return text;
}

/** take / sample counts must be positive (percent ≤ 100). */
function checkLimitCount(st: Step): void {
  const n = Number(st.n);
  if (!Number.isFinite(n) || n <= 0 || (st.pct && n > 100))
    throw new JflowError(
      'E_ARG_RANGE',
      st.pct ? '百分比必须在 (0, 100] 之间' : '行数必须大于 0',
      st.span
    );
}

function sortKeys(keys: SortKey[], span: Span): Array<Record<string, unknown>> {
  return keys.map((k) => {
    if (k.field.q) throw new JflowError('E_SORT_QUALIFIED', 'sort 键不能带限定名', span);
    const d: Record<string, unknown> = { field: k.field.name, direction: k.desc ? 'desc' : 'asc' };
    if (k.nulls) d.nulls = k.nulls;
    return d;
  });
}

const SIMPLE_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;
type Cols = string[] | null;

interface Rel {
  node: string;
  cols: Cols;
  /** Incremental non-raw source feeding this relation (for E_INCR_REPLACE). */
  incremental: boolean;
}

function globToRegex(glob: string): RegExp {
  return new RegExp(
    `^${glob
      .replace(/[.+^${}()|\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`
  );
}

export function parseResourceUri(uri: string): ResolvedResource | null {
  let m = /^local:(raw|result)\/(.+)$/.exec(uri);
  if (m) return { uri, name: null, kind: m[1] as 'raw' | 'result', id: m[2] };
  m = /^local:pipeline\/(.+)$/.exec(uri);
  if (m) return { uri, name: null, kind: 'pipeline', id: m[1] };
  m = /^file:(.+)$/.exec(uri);
  if (m) return { uri, name: null, kind: 'file', id: m[1] };
  return null;
}

class Compiler {
  nodes: JflowNode[] = [];
  edges: JflowEdge[] = [];
  sourceMap: Record<string, Span> = {};
  diagnostics: JflowDiagnostic[] = [];
  /** step id → display label (`#! label:` pragma). */
  labels = new Map<string, string>();
  /** Columns of the last evaluated chain (editor completion). */
  lastCols: Cols = null;
  env = new Map<string, Rel>();
  colTypes = new Map<string, Map<string, string>>();
  private seq = 0;
  private usedIds = new Set<string>();
  /** Explicit `#! id:` values anywhere in the file; generated ids never take them. */
  private reservedIds = new Set<string>();
  private currentSpan: Span = { start: 0, end: 0 };

  constructor(private readonly options: JflowCompileOptions) {}

  reserveIds(file: unknown): void {
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(visit);
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string' && 'span' in record) this.reservedIds.add(record.id);
      Object.values(record).forEach(visit);
    };
    visit(file);
  }

  private stepId(step: { id?: string }): string {
    if (step.id) {
      if (this.usedIds.has(step.id))
        throw new JflowError('E_GRAPH_DUP_ID', `#! id: ${step.id} 重复`);
      this.usedIds.add(step.id);
      return step.id;
    }
    let id: string;
    do {
      this.seq += 1;
      id = `n${this.seq}`;
    } while (this.usedIds.has(id) || this.reservedIds.has(id));
    this.usedIds.add(id);
    return id;
  }

  private node(
    sid: string,
    k: number,
    type: string,
    config: Record<string, unknown>,
    inputs: { input?: string; right?: string },
    role?: string,
    label?: string
  ): string {
    const id = k === 0 ? sid : `${sid}~${k}`;
    if (k !== 0) this.usedIds.add(id);
    const n: JflowNode = {
      id,
      type,
      label: label ?? (k === 0 ? sid : `${sid}·${role ?? k}`),
      x: 0,
      y: 0,
      config,
    };
    if (k !== 0 || role) n.layout = { composite: sid, role: role ?? 'main' };
    this.nodes.push(n);
    this.sourceMap[id] = this.currentSpan;
    const binary = type === 'join' || type === 'set_op';
    if (inputs.input) {
      this.edges.push({
        id: `${inputs.input}->${id}`,
        sourceNodeId: inputs.input,
        targetNodeId: id,
        sourceHandle: 'output',
        targetHandle: binary ? 'left' : 'input',
      });
    }
    if (inputs.right) {
      this.edges.push({
        id: `${inputs.right}->${id}:right`,
        sourceNodeId: inputs.right,
        targetNodeId: id,
        sourceHandle: 'output',
        targetHandle: 'right',
      });
    }
    return id;
  }

  private warn(code: string, message: string, span?: Span) {
    this.diagnostics.push({ code, severity: 'warning', message, span: span ?? this.currentSpan });
  }

  private checkField(name: string, cols: Cols, span: Span, where = ''): void {
    if (name.startsWith('__')) {
      throw new JflowError('E_NAME_RESERVED', `字段名不能以 __ 开头：[${name}]`, span);
    }
    if (cols && !cols.includes(name)) {
      throw new JflowError(
        'E_NAME_FIELD',
        `字段 [${name}] 不存在${where}`,
        span,
        suggest(name, cols)
      );
    }
  }

  private checkExprFields(
    e: Expr,
    cols: Cols,
    span: Span,
    qualifiers?: Record<string, Cols>
  ): void {
    for (const f of fieldRefs(e)) {
      if (f.q !== undefined) {
        if (!qualifiers || !(f.q in qualifiers)) {
          throw new JflowError(
            'E_NAME_QUALIFIER',
            `限定名 [${f.q}] 不存在${qualifiers ? `；可用：${Object.keys(qualifiers).join(', ')}` : ''}`,
            f.span ?? span
          );
        }
        const qc = qualifiers[f.q];
        if (qc && !qc.includes(f.name)) {
          throw new JflowError(
            'E_NAME_FIELD',
            `[${f.q}].[${f.name}] 不存在`,
            f.span ?? span,
            suggest(f.name, qc)
          );
        }
      } else if (cols && !cols.includes(f.name)) {
        throw new JflowError(
          'E_NAME_FIELD',
          `字段 [${f.name}] 不存在`,
          f.span ?? span,
          suggest(f.name, cols)
        );
      }
    }
  }

  // ------------------------------------------------------------ file
  compileFile(f: JflowFile): void {
    if (f.params.length > 0) {
      throw new JflowError('E_NOT_SUPPORTED_R1', 'param 在 R1 中还不能转换成算子配置');
    }
    for (const s of f.sources) this.compileSource(s);
    for (const flow of f.flows) {
      const rel = this.chain(flow.chain);
      this.lastCols = rel.cols;
      if (flow.let) {
        if (this.env.has(flow.let))
          throw new JflowError('E_NAME_DUP', `名字 ${flow.let} 重复定义`, flow.span);
        this.env.set(flow.let, rel);
      }
    }
  }

  private resolve(ref: ResourceRef, role: 'source' | 'write'): ResolvedResource {
    if (ref.form === '@id' && /^local:physical\//.test(ref.arg)) {
      throw new JflowError(
        'E_REF_PHYSICAL',
        'local:physical 只用于迁移，不能手写；请选择结果表',
        ref.span
      );
    }
    const custom = this.options.resolve?.(ref, role);
    if (custom) return custom;
    if (ref.form === '@id') {
      const parsed = parseResourceUri(ref.arg);
      if (!parsed) throw new JflowError('E_REF_NOT_FOUND', `无法识别的资源 ${ref.arg}`, ref.span);
      // With a catalog, local tables must exist: an unknown id is an error, not a guess.
      if (this.options.resolve && (parsed.kind === 'raw' || parsed.kind === 'result')) {
        throw new JflowError(
          'E_REF_NOT_FOUND',
          `找不到${parsed.kind === 'raw' ? '原始表' : '结果表'} ${ref.arg}${ref.snap ? `（${ref.snap}）` : ''}`,
          ref.span,
          ref.snap ? `如果表已重建，可改用 @name('${ref.snap}')` : undefined
        );
      }
      return { ...parsed, name: ref.snap };
    }
    if (ref.form === '@path')
      return { uri: `file:${ref.arg}`, name: ref.arg, kind: 'file', id: ref.arg };
    throw new JflowError('E_REF_NOT_FOUND', `找不到资源 ${ref.form}('${ref.arg}')`, ref.span);
  }

  private compileSource(s: Source): void {
    this.currentSpan = s.span;
    if (this.env.has(s.alias))
      throw new JflowError('E_NAME_DUP', `名字 ${s.alias} 重复定义`, s.span);
    if (s.ref.form === '@new')
      throw new JflowError('E_REF_KIND', '@new 只能用于 write', s.ref.span);
    const r = this.resolve(s.ref, 'source');
    if (Object.keys(s.read).length > 0) {
      throw new JflowError(
        'E_READ_OPTION',
        `R1 的${r.kind}资源不支持读取选项：${Object.keys(s.read).join(', ')}`,
        s.span
      );
    }
    const sid = s.id ?? `src_${s.alias}`;
    if (s.pragmas?.label) this.labels.set(sid, s.pragmas.label);
    if (this.usedIds.has(sid))
      throw new JflowError('E_GRAPH_DUP_ID', `节点 ID ${sid} 重复`, s.span);
    this.usedIds.add(sid);
    const config: Record<string, unknown> = { ref: { uri: r.uri, name: r.name ?? s.ref.snap } };
    if (SIMPLE_ALIAS.test(s.alias)) config.alias = s.alias;
    if (r.kind === 'raw' || r.kind === 'result') {
      config.source = 'rawTable';
      config.rawTableId = r.id;
    } else if (r.kind === 'file') {
      config.source = 'file';
      config.filePath = r.id;
    } else {
      config.source = 'pipeline';
    }
    let incremental = false;
    if (s.incr) {
      if (s.incr.lookback) {
        throw new JflowError('E_NOT_SUPPORTED_R1', 'lookback 在 R1 运行时还未实现', s.span);
      }
      config.incrementalBy = s.incr.field;
      if (config.source === 'rawTable')
        this.warn('W_INCR_IGNORED', 'raw 表上的 incremental 被忽略，始终读全量', s.span);
      else incremental = true;
    }
    if (s.pragmas?.disabled === 'true') config.disabled = true;
    this.node(sid, 0, 'input', config, {}, undefined, s.alias);
    this.env.set(s.alias, {
      node: sid,
      cols: r.columns ? r.columns.map((c) => c.name) : null,
      incremental,
    });
  }

  private chain(c: Chain): Rel {
    let cur = this.head(c.head);
    for (const st of c.steps) cur = this.step(cur, st);
    return cur;
  }

  private head(h: Head): Rel {
    if (h.k === 'name') {
      const rel = this.env.get(h.v);
      if (!rel)
        throw new JflowError(
          'E_NAME_LOCAL',
          `找不到名字 ${h.v}`,
          h.span,
          suggest(h.v, [...this.env.keys()])
        );
      return rel;
    }
    if (h.k === 'chain') return this.chain(h.chain);
    if (h.k === 'setop') {
      const st = h.step;
      const [first, ...rest] = st.tables ?? [];
      if (!first || rest.length === 0)
        throw new JflowError('E_SETOP_ARITY', `${st.op} 至少需要两个输入`, st.span);
      const left = this.head(first.src);
      return this.step(left, { ...st, tables: rest });
    }
    throw new JflowError('E_REF_INLINE', '内联资源引用请先用 source 声明别名', h.ref.span);
  }

  private step(cur: Rel, st: Step): Rel {
    this.currentSpan = st.span;
    const args = checkStepArgs(st);
    const sid = this.stepId(st);
    if (st.pragmas?.label) this.labels.set(sid, st.pragmas.label);
    const fn = (
      this as unknown as Record<string, (c: Rel, s: Step, id: string, a: StepArgs) => Rel>
    )[`L_${st.op}`];
    if (!fn)
      throw new JflowError('E_NOT_SUPPORTED_R1', `${st.op} 在 R1 中还不能转换成算子配置`, st.span);
    return fn.call(this, cur, st, sid, args);
  }

  private rel(node: string, cols: Cols, from: Rel): Rel {
    return { node, cols, incremental: from.incremental };
  }

  // ------------------------------------------------------------ verbs
  /** Bare / nested aggregates in a row-level step: error with a hint and an `over ()` fix. */
  private checkRowAggregates(st: Step, exprs: Expr[]): void {
    const problem = rowLevelAggregateProblem(exprs);
    if (!problem) return;
    let fix: JflowFix | undefined;
    if (problem.code === 'E_AGG_ROW') {
      const fixed: Step = st.cond
        ? { ...st, cond: addOverToRowAggregates(st.cond) }
        : {
            ...st,
            derives: (st.derives ?? []).map((d) => ({ ...d, e: addOverToRowAggregates(d.e) })),
          };
      fix = { title: '加上 over ()（全部行）', span: st.span, text: `| ${fmtStep(fixed).trim()}` };
    }
    throw new JflowError(problem.code, problem.message, st.span, problem.hint, fix);
  }

  L_where(cur: Rel, st: Step, sid: string): Rel {
    const cond = st.cond!;
    this.checkExprFields(cond, cur.cols, st.span);
    this.checkRowAggregates(st, [cond]);
    if (hasWindow(cond)) {
      const a = this.node(
        sid,
        1,
        'derive',
        { calculations: [{ field: '__w', action: 'add', expression: cx(cond, st.span) }] },
        { input: cur.node },
        'window-col'
      );
      const b = this.node(sid, 2, 'filter', { condition: '[__w]' }, { input: a }, 'filter');
      const c = this.node(
        sid,
        0,
        'select',
        { fields: ['__w'], selection: 'exclude' },
        { input: b },
        'drop-temp'
      );
      return this.rel(c, cur.cols, cur);
    }
    return this.rel(
      this.node(sid, 0, 'filter', { condition: cx(cond, st.span) }, { input: cur.node }),
      cur.cols,
      cur
    );
  }

  private expandCols(kv: Record<string, Expr>, cols: Cols, span: Span): string[] {
    if (!cols) throw new JflowError('E_SCHEMA_UNKNOWN', 'cols(...) 需要已知的输入列', span);
    const str = (key: string) => {
      const v = kv[key];
      if (!v) return null;
      if (v.k === 'lit' && v.t === 'str') return v.v;
      if (v.k === 'enum') return v.v;
      throw new JflowError('E_ARG_TYPE', `cols 的 ${key}: 需要字符串`, span);
    };
    for (const key of Object.keys(kv)) {
      if (!['glob', 'regex', 'type'].includes(key)) {
        throw new JflowError(
          'E_ARG_UNKNOWN',
          `cols 不接受参数 ${key}:；允许：glob, regex, type`,
          span
        );
      }
    }
    const glob = str('glob');
    const regex = str('regex');
    const type = str('type');
    let re: RegExp | null = null;
    if (regex !== null) {
      try {
        re = new RegExp(regex);
      } catch {
        throw new JflowError('E_ARG_VALUE', `cols 的 regex: 不是合法正则 ${regex}`, span);
      }
    }
    const types = this.colTypes;
    void types;
    return cols.filter(
      (c) =>
        !c.startsWith('__') &&
        (glob === null || globToRegex(glob).test(c)) &&
        (re === null || re.test(c)) &&
        (type === null || this.columnType(c) === type)
    );
  }

  private columnTypesHint = new Map<string, string>();
  private columnType(name: string): string | undefined {
    return this.columnTypesHint.get(name);
  }

  L_select(cur: Rel, st: Step, sid: string): Rel {
    const names: string[] = [];
    const calcs: Array<Record<string, unknown>> = [];
    const written = new Set<string>();
    for (const it of st.items ?? []) {
      if (it.k === 'cols') names.push(...this.expandCols(it.kv ?? {}, cur.cols, st.span));
      else if (it.k === 'star') {
        throw new JflowError(
          'E_SELECT_STAR',
          'select 里不能写 [x].*（只用于 join keep:）',
          st.span
        );
      } else if (it.k === 'col') {
        if (it.e!.q) throw new JflowError('E_NAME_QUALIFIER', 'select 字段不能带限定名', st.span);
        this.checkField(it.e!.name, cur.cols, st.span);
        names.push(it.e!.name);
      } else {
        const name = it.name!;
        if (name.startsWith('__'))
          throw new JflowError('E_NAME_RESERVED', `字段名不能以 __ 开头：[${name}]`, st.span);
        this.checkExprFields(it.calc!, cur.cols, st.span);
        if (fieldRefs(it.calc!).some((f) => written.has(f.name))) {
          throw new JflowError(
            'E_SELECT_ORDER',
            `select 的计算列同时求值：[${name}] 引用了前面改写过的列，请改用新名字`,
            st.span
          );
        }
        const exists = cur.cols ? cur.cols.includes(name) : undefined;
        const calc: Record<string, unknown> = { field: name, expression: cx(it.calc!, st.span) };
        if (exists !== undefined) calc.action = exists ? 'replace' : 'add';
        calcs.push(calc);
        written.add(name);
        names.push(name);
      }
    }
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length)
      throw new JflowError(
        'E_SELECT_DUP',
        `select 输出列重名：${[...new Set(dup)].join(', ')}`,
        st.span
      );
    if (calcs.length === 0) {
      return this.rel(
        this.node(sid, 0, 'select', { fields: names, selection: 'include' }, { input: cur.node }),
        names,
        cur
      );
    }
    const a = this.node(sid, 1, 'derive', { calculations: calcs }, { input: cur.node }, 'calc');
    return this.rel(
      this.node(sid, 0, 'select', { fields: names, selection: 'include' }, { input: a }, 'project'),
      names,
      cur
    );
  }

  L_drop(cur: Rel, st: Step, sid: string): Rel {
    const names: string[] = [];
    for (const it of st.items ?? []) {
      if (it.k === 'cols') names.push(...this.expandCols(it.kv ?? {}, cur.cols, st.span));
      else {
        this.checkField(it.e!.name, cur.cols, st.span);
        names.push(it.e!.name);
      }
    }
    return this.rel(
      this.node(sid, 0, 'select', { fields: names, selection: 'exclude' }, { input: cur.node }),
      cur.cols ? cur.cols.filter((c) => !names.includes(c)) : null,
      cur
    );
  }

  L_derive(cur: Rel, st: Step, sid: string): Rel {
    this.checkRowAggregates(
      st,
      (st.derives ?? []).map((d) => d.e)
    );
    const cols = cur.cols ? [...cur.cols] : null;
    const calcs = (st.derives ?? []).map((d) => {
      if (d.name.startsWith('__'))
        throw new JflowError('E_NAME_RESERVED', `字段名不能以 __ 开头：[${d.name}]`, st.span);
      this.checkExprFields(d.e, cols, st.span);
      if (cols) {
        const exists = cols.includes(d.name);
        if (d.replace && !exists)
          throw new JflowError('E_FIELD_MISSING', `replace [${d.name}]：字段不存在`, st.span);
        if (!d.replace && exists) {
          throw new JflowError(
            'E_FIELD_EXISTS',
            `[${d.name}] 已存在；改写已有列请写 replace [${d.name}] = …`,
            st.span
          );
        }
        if (!exists) cols.push(d.name);
      }
      return { field: d.name, action: d.replace ? 'replace' : 'add', expression: cx(d.e, st.span) };
    });
    return this.rel(
      this.node(sid, 0, 'derive', { calculations: calcs }, { input: cur.node }),
      cols,
      cur
    );
  }

  L_sort(cur: Rel, st: Step, sid: string): Rel {
    for (const k of st.keys ?? []) this.checkField(k.field.name, cur.cols, st.span);
    return this.rel(
      this.node(sid, 0, 'sort', { orderBy: sortKeys(st.keys ?? [], st.span) }, { input: cur.node }),
      cur.cols,
      cur
    );
  }

  L_take(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    checkLimitCount(st);
    const sort = args.sort?.t === 'sortlist' ? args.sort.v : [];
    for (const k of sort) this.checkField(k.field.name, cur.cols, st.span);
    const ties = args.ties?.t === 'enum' && args.ties.v === 'include';
    if (!args.per) {
      const cfg: Record<string, unknown> = {
        sampling: 'fixed',
        limit: Number(st.n),
        unit: st.pct ? 'percent' : 'rows',
        orderBy: sortKeys(sort, st.span),
        ties,
      };
      if (args.offset?.t === 'int') cfg.offset = args.offset.v;
      return this.rel(this.node(sid, 0, 'limit', cfg, { input: cur.node }), cur.cols, cur);
    }
    if (st.pct) throw new JflowError('E_ARG_COMBO', 'take N% 不能与 per: 一起用', st.span);
    if (args.offset) throw new JflowError('E_ARG_COMBO', 'take per: 不支持 offset:', st.span);
    const per = args.per.t === 'fields' ? args.per.v : [];
    for (const f of per) this.checkField(f, cur.cols, st.span);
    const call: Expr = {
      k: 'call',
      name: ties ? 'rank' : 'row_number',
      args: [],
      named: {},
      distinct: false,
      star: false,
      over: {
        partition: per.map((name) => ({ k: 'field', name }) as Expr),
        order: sort.map((k) => ({ e: k.field, dir: k.desc ? 'desc' : null, nulls: k.nulls })),
        frame: null,
      },
    };
    const a = this.node(
      sid,
      1,
      'derive',
      { calculations: [{ field: '__rn', action: 'add', expression: cx(call, st.span) }] },
      { input: cur.node },
      'rownum'
    );
    const b = this.node(
      sid,
      2,
      'filter',
      { condition: `[__rn] <= ${st.n}` },
      { input: a },
      'filter'
    );
    return this.rel(
      this.node(
        sid,
        0,
        'select',
        { fields: ['__rn'], selection: 'exclude' },
        { input: b },
        'drop-temp'
      ),
      cur.cols,
      cur
    );
  }

  L_sample(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    if (args.per)
      throw new JflowError('E_NOT_SUPPORTED_R1', 'sample per: 在 R1 中还不能转换', st.span);
    checkLimitCount(st);
    const cfg: Record<string, unknown> = {
      sampling: 'random',
      limit: Number(st.n),
      unit: st.pct ? 'percent' : 'rows',
    };
    if (args.seed?.t === 'int') cfg.seed = args.seed.v;
    return this.rel(this.node(sid, 0, 'limit', cfg, { input: cur.node }), cur.cols, cur);
  }

  L_distinct(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    const by = args.by?.t === 'fields' ? args.by.v : [];
    const sort = args.sort?.t === 'sortlist' ? args.sort.v : [];
    for (const f of by) this.checkField(f, cur.cols, st.span);
    const cfg: Record<string, unknown> = {
      fields: by,
      keep: args.keep?.t === 'enum' ? args.keep.v : 'first',
      orderBy: sortKeys(sort, st.span),
      strategy: by.length ? 'by_columns' : 'all_columns',
    };
    return this.rel(this.node(sid, 0, 'deduplicate', cfg, { input: cur.node }), cur.cols, cur);
  }

  L_group(cur: Rel, st: Step, sid: string): Rel {
    const keys = st.groupKeys ?? [];
    let k = 0;
    let src = cur.node;
    const keyExprs = keys.filter((x) => x.e);
    for (const key of keys) {
      if (!key.e) this.checkField(key.name, cur.cols, st.span);
      else this.checkExprFields(key.e, cur.cols, st.span);
    }
    const grains: Record<string, string> = {};
    for (const key of keys) if (key.grain) grains[key.name] = key.grain;
    if (keyExprs.length) {
      k += 1;
      src = this.node(
        sid,
        k,
        'derive',
        {
          calculations: keyExprs.map((x) => {
            const c: Record<string, unknown> = { field: x.name, expression: cx(x.e!, st.span) };
            if (cur.cols) c.action = cur.cols.includes(x.name) ? 'replace' : 'add';
            return c;
          }),
        },
        { input: cur.node },
        'group-keys'
      );
    }
    const simple = (e: Expr): Record<string, unknown> | null => {
      if (e.k !== 'call' || e.over) return null;
      const n = canonicalFunction(e.name);
      if (IF_AGG[n]) {
        const base = IF_AGG[n];
        const cond = e.args[e.args.length - 1];
        const val: Expr = base === 'count' ? { k: 'lit', t: 'num', v: '1' } : e.args[0];
        const expected = base === 'count' ? 1 : 2;
        if (e.args.length !== expected)
          throw new JflowError('E_ARG_COUNT', `${n} 需要 ${expected} 个参数`, st.span);
        return {
          function: base,
          expression: cx({ k: 'if', branches: [[cond, val]], else: null }, st.span),
        };
      }
      if (n === 'count' && e.star) return { function: 'count', expression: '*' };
      if (n === 'count' && e.distinct)
        return { function: 'count_distinct', expression: cx(e.args[0], st.span) };
      if (
        AGG_CFG.has(n) &&
        e.args.length >= 1 &&
        !e.args.some(hasAggregate) &&
        Object.keys(e.named).length === 0
      ) {
        return { function: n, expression: e.args.map((a) => cx(a, st.span)).join(', ') };
      }
      return null;
    };
    const aggs = st.aggs ?? [];
    for (const a of aggs) {
      if (a.name.startsWith('__'))
        throw new JflowError('E_NAME_RESERVED', `字段名不能以 __ 开头：[${a.name}]`, st.span);
      this.checkExprFields(
        a.e,
        cur.cols ? [...cur.cols, ...keys.map((x) => x.name)] : null,
        st.span
      );
      if (!hasAggregate(a.e))
        throw new JflowError('E_AGG_REQUIRED', `agg [${a.name}] 需要聚合函数`, st.span);
    }
    const gb = keys.map((x) => x.name);
    const outCols = [...gb, ...aggs.map((a) => a.name)];
    const base: Record<string, unknown> = { groupBy: gb };
    if (Object.keys(grains).length) base.dateGranularity = grains;
    if (aggs.every((a) => simple(a.e))) {
      const node = this.node(
        sid,
        0,
        'aggregate',
        { ...base, metrics: aggs.map((a) => ({ ...simple(a.e)!, alias: a.name })) },
        { input: src },
        k ? 'aggregate' : undefined
      );
      return this.rel(node, outCols, cur);
    }
    const metrics: Array<Record<string, unknown>> = [];
    const tmp: string[] = [];
    const rep = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(rep);
      if (!x || typeof x !== 'object') return x;
      const e = x as Expr;
      if (e.k && isAggregateCall(e)) {
        const s = simple(e);
        if (!s)
          throw new JflowError(
            'E_AGG_NESTED',
            '不支持嵌套聚合',
            st.span,
            NESTED_AGGREGATE_HINT,
            splitNestedAggregateStep(st) ?? undefined
          );
        const name = `__a${metrics.length + 1}`;
        metrics.push({ ...s, alias: name });
        tmp.push(name);
        return { k: 'field', name } as Expr;
      }
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>).map(([kk, v]) => [kk, rep(v)])
      );
    };
    const posts = aggs.map((a) => ({
      field: a.name,
      action: 'add',
      expression: cx(rep(a.e) as Expr, st.span),
    }));
    k += 1;
    const ag = this.node(
      sid,
      k,
      'aggregate',
      { ...base, metrics },
      { input: src },
      'aggregate-temp'
    );
    k += 1;
    const dv = this.node(sid, k, 'derive', { calculations: posts }, { input: ag }, 'post-agg');
    return this.rel(
      this.node(
        sid,
        0,
        'select',
        { fields: tmp, selection: 'exclude' },
        { input: dv },
        'drop-temp'
      ),
      outCols,
      cur
    );
  }

  private right(te: TableExp): { rel: Rel; alias: string } {
    const rel = this.head(te.src);
    const alias = te.as ?? (te.src.k === 'name' ? te.src.v : null);
    if (!alias)
      throw new JflowError('E_JOIN_ALIAS', '内联的右侧输入需要 as 别名', this.currentSpan);
    return { rel, alias };
  }

  L_join(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    const { rel: r, alias } = this.right(st.table!);
    const kind = st.kind!;
    const on = st.on ?? null;
    const sides: Record<string, Cols> = { left: cur.cols, [alias]: r.cols };
    if (kind === 'cross') {
      if (on) throw new JflowError('E_JOIN_CROSS_ON', 'cross join 不能写 on', st.span);
    } else if (!on) {
      throw new JflowError('E_JOIN_ON', `${kind} join 需要 on`, st.span);
    } else if (on.k === 'keys') {
      for (const key of on.keys) {
        if (cur.cols && !cur.cols.includes(key))
          throw new JflowError(
            'E_JOIN_KEY_SIDE',
            `键 [${key}] 不在左侧`,
            st.span,
            suggest(key, cur.cols)
          );
        if (r.cols && !r.cols.includes(key))
          throw new JflowError(
            'E_JOIN_KEY_SIDE',
            `键 [${key}] 不在右侧 ${alias}`,
            st.span,
            suggest(key, r.cols)
          );
      }
    } else {
      this.checkJoinExpr(on.e, sides, st.span);
    }
    if (args.match?.t === 'expr') this.checkJoinExpr(args.match.v, sides, st.span);
    if (kind === 'semi' || kind === 'anti') {
      if (args.keep)
        throw new JflowError('E_JOIN_SEMI_KEEP', 'semi/anti 只输出左侧列，不能写 keep:', st.span);
      if (args.suffix) throw new JflowError('E_ARG_COMBO', 'semi/anti 不能写 suffix:', st.span);
    }
    if (args.null_aware) {
      if (kind !== 'anti' || !on || on.k !== 'keys' || on.keys.length !== 1) {
        throw new JflowError('E_NULL_AWARE', 'null_aware: true 只用于单键 anti join', st.span);
      }
      if (args.null_aware.t === 'bool' && args.null_aware.v)
        return this.nullAwareAnti(cur, r, on.keys[0], sid);
    }
    if (kind === 'asof')
      throw new JflowError('E_NOT_SUPPORTED_R1', 'asof join 在 R1 中还不能转换成算子配置', st.span);
    const cfg: Record<string, unknown> = { joinType: kind, rightAlias: alias };
    if (on?.k === 'keys')
      cfg.conditions = on.keys.map((key) => ({ left: key, operator: '=', right: key }));
    else if (on) cfg.expression = cx(on.e, st.span);
    if (args.match?.t === 'expr') {
      if (cfg.expression)
        throw new JflowError('E_ARG_COMBO', 'on 条件已是表达式时不能再写 match:', st.span);
      cfg.expression = cx(args.match.v, st.span);
    }
    let outCols: Cols = null;
    if (args.keep?.t === 'keep') {
      const ks: Array<Record<string, unknown>> = [];
      const names: string[] = [];
      const sideOf = (e: FieldExpr): 'left' | 'right' => {
        if (e.q === 'left') return 'left';
        if (e.q !== undefined) {
          if (e.q !== alias)
            throw new JflowError(
              'E_NAME_QUALIFIER',
              `限定名 [${e.q}] 不存在；可用：left, ${alias}`,
              st.span
            );
          return 'right';
        }
        if (cur.cols?.includes(e.name)) return 'left';
        if (r.cols?.includes(e.name)) return 'right';
        if (!cur.cols) return 'left';
        throw new JflowError('E_NAME_FIELD', `字段 [${e.name}] 两侧都不存在`, st.span);
      };
      for (const it of args.keep.v) {
        if (it.k === 'star') {
          if (it.q !== 'left' && it.q !== alias)
            throw new JflowError('E_NAME_QUALIFIER', `[${it.q}].* 限定名不存在`, st.span);
          const side = it.q === 'left' ? 'left' : 'right';
          ks.push({ side, wildcard: true });
          const c = side === 'left' ? cur.cols : r.cols;
          if (c) names.push(...c);
          else outCols = undefined as unknown as Cols;
        } else if (it.k === 'col') {
          const side = sideOf(it.e);
          this.checkExprFields(it.e, null, st.span, sides);
          ks.push({ side, source: it.e.name, alias: it.e.name });
          names.push(it.e.name);
        } else {
          if (it.e.k !== 'field')
            throw new JflowError(
              'E_NOT_SUPPORTED_R1',
              'keep 里的计算表达式在 R1 中还不能转换；请先 derive',
              st.span
            );
          const side = sideOf(it.e);
          this.checkExprFields(it.e, null, st.span, sides);
          ks.push({ side, source: it.e.name, alias: it.name });
          names.push(it.name);
        }
      }
      const dup = names.filter((n, i) => names.indexOf(n) !== i);
      if (dup.length) {
        throw new JflowError(
          'E_JOIN_KEEP_DUP',
          `keep: 输出列重名：${[...new Set(dup)].join(', ')}；请用 [新名] = [别名].[列] 改名`,
          st.span
        );
      }
      cfg.keep = ks;
      if (outCols !== (undefined as unknown as Cols) && cur.cols && r.cols) outCols = names;
      else outCols = null;
    } else if (kind === 'semi' || kind === 'anti') {
      outCols = cur.cols;
    } else if (cur.cols && r.cols) {
      const suffix = args.suffix?.t === 'str' ? args.suffix.v : null;
      outCols = [
        ...cur.cols.map((c) => (r.cols!.includes(c) && !suffix ? `${c}_left` : c)),
        ...r.cols.map((c) => (cur.cols!.includes(c) ? `${c}${suffix ?? '_right'}` : c)),
      ];
    }
    if (args.expect?.t === 'enum') cfg.expect = args.expect.v;
    if (args.suffix?.t === 'str') cfg.conflict = { strategy: 'suffix', rightSuffix: args.suffix.v };
    const node = this.node(sid, 0, 'join', cfg, { input: cur.node, right: r.node });
    return { node, cols: outCols, incremental: cur.incremental || r.incremental };
  }

  private checkJoinExpr(e: Expr, sides: Record<string, Cols>, span: Span) {
    for (const f of fieldRefs(e)) {
      if (f.q === undefined) {
        throw new JflowError(
          'E_NAME_AMBIGUOUS',
          `join 条件里的 [${f.name}] 需要写成 [left].[${f.name}] 或 [别名].[${f.name}]`,
          f.span ?? span
        );
      }
    }
    this.checkExprFields(e, null, span, sides);
  }

  private nullAwareAnti(cur: Rel, r: Rel, key: string, sid: string): Rel {
    const a = this.node(
      sid,
      1,
      'aggregate',
      {
        groupBy: [],
        metrics: [
          { function: 'count', expression: '*', alias: '__n' },
          { function: 'count', expression: `[${key.replace(/\]/g, ']]')}]`, alias: '__nn' },
        ],
      },
      { input: r.node },
      'na-stats'
    );
    const b = this.node(
      sid,
      2,
      'join',
      {
        joinType: 'anti',
        rightAlias: 'na_r',
        conditions: [{ left: key, operator: '=', right: key }],
      },
      { input: cur.node, right: r.node },
      'na-anti'
    );
    const c = this.node(
      sid,
      3,
      'join',
      { joinType: 'cross', rightAlias: 'na_s' },
      { input: b, right: a },
      'na-cross'
    );
    const k = `[${key.replace(/\]/g, ']]')}]`;
    const d = this.node(
      sid,
      4,
      'filter',
      { condition: `[__n] = 0 or ([__nn] = [__n] and ${k} is not null)` },
      { input: c },
      'na-filter'
    );
    const e = this.node(
      sid,
      0,
      'select',
      { fields: ['__n', '__nn'], selection: 'exclude' },
      { input: d },
      'drop-temp'
    );
    return { node: e, cols: cur.cols, incremental: cur.incremental || r.incremental };
  }

  L_union(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    const tabs = st.tables ?? [];
    let acc = cur;
    tabs.forEach((t, i) => {
      const r = this.head(t.src);
      const alias = t.as ?? (t.src.k === 'name' ? t.src.v : `u${i + 1}`);
      const cfg = {
        operation: st.op,
        quantifier: args.distinct?.t === 'bool' && args.distinct.v ? 'distinct' : 'all',
        match: args.by?.t === 'enum' && args.by.v === 'position' ? 'by_position' : 'by_name',
        rightInput: alias,
      };
      const last = i === tabs.length - 1;
      const node = this.node(
        sid,
        last ? 0 : i + 1,
        'set_op',
        cfg,
        { input: acc.node, right: r.node },
        tabs.length > 1 ? `${st.op}-fold` : undefined
      );
      let cols: Cols = null;
      if (acc.cols && r.cols)
        cols =
          cfg.match === 'by_name'
            ? [...acc.cols, ...r.cols.filter((c) => !acc.cols!.includes(c))]
            : acc.cols;
      acc = { node, cols, incremental: acc.incremental || r.incremental };
    });
    return acc;
  }

  L_intersect(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    return this.L_union(cur, st, sid, args);
  }

  L_except(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    return this.L_union(cur, st, sid, args);
  }

  L_lookup(cur: Rel, st: Step, sid: string): Rel {
    const { rel: r, alias } = this.right(st.table!);
    const on = st.lookupOn ?? [];
    for (const key of on) {
      if ((cur.cols && !cur.cols.includes(key)) || (r.cols && !r.cols.includes(key))) {
        throw new JflowError('E_JOIN_KEY_SIDE', `lookup 键 [${key}] 需要两侧都存在`, st.span);
      }
    }
    for (const g of st.get ?? []) {
      if (r.cols && !r.cols.includes(g))
        throw new JflowError(
          'E_NAME_FIELD',
          `[${alias}].[${g}] 不存在`,
          st.span,
          suggest(g, r.cols)
        );
      if (cur.cols?.includes(g))
        throw new JflowError('E_JOIN_KEEP_DUP', `get [${g}] 与左侧列重名`, st.span);
    }
    // Failure-type uniqueness assertion on the dimension keys (E_LOOKUP_DUP_KEY at run time).
    const e = this.node(
      sid,
      1,
      'expect',
      { kind: 'unique', fields: on },
      { input: r.node },
      'dim-unique'
    );
    const node = this.node(
      sid,
      0,
      'join',
      {
        joinType: 'left',
        rightAlias: alias,
        conditions: on.map((key) => ({ left: key, operator: '=', right: key })),
        keep: [
          { side: 'left', wildcard: true },
          ...(st.get ?? []).map((g) => ({ side: 'right', source: g, alias: g })),
        ],
      },
      { input: cur.node, right: e },
      'lookup'
    );
    return {
      node,
      cols: cur.cols ? [...cur.cols, ...(st.get ?? [])] : null,
      incremental: cur.incremental || r.incremental,
    };
  }

  L_check(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    const c = st.check!;
    if (args.on_fail?.t === 'enum' && args.on_fail.v !== 'error') {
      throw new JflowError(
        'E_NOT_SUPPORTED_R1',
        `check on_fail: ${args.on_fail.v} 在 R1 中还不能转换（现有 expect 失败即报错）`,
        st.span
      );
    }
    let cfg: Record<string, unknown>;
    if (c.kind === 'unique') {
      c.fields.forEach((f) => this.checkField(f, cur.cols, st.span));
      cfg = { kind: 'unique', fields: c.fields };
    } else if (c.kind === 'not_null') {
      c.fields.forEach((f) => this.checkField(f, cur.cols, st.span));
      cfg = {
        kind: 'expression',
        expression: c.fields.map((f) => `[${f.replace(/\]/g, ']]')}] is not null`).join(' and '),
      };
    } else if (c.kind === 'rows') {
      cfg = { kind: 'row_count', operator: c.cmp === '<>' ? '!=' : c.cmp, value: c.n };
    } else {
      this.checkExprFields(c.e, cur.cols, st.span);
      cfg = { kind: 'expression', expression: cx(c.e, st.span) };
    }
    if (args.message?.t === 'str') cfg.message = args.message.v;
    return this.rel(this.node(sid, 0, 'expect', cfg, { input: cur.node }), cur.cols, cur);
  }

  L_sql(cur: Rel, st: Step, sid: string): Rel {
    return this.rel(this.node(sid, 0, 'sql', { sql: st.sql }, { input: cur.node }), null, cur);
  }

  L_pass(cur: Rel, _st: Step, sid: string): Rel {
    return this.rel(
      this.node(sid, 0, 'sql', { sql: 'SELECT * FROM input' }, { input: cur.node }, 'pass'),
      cur.cols,
      cur
    );
  }

  L_cast(cur: Rel, st: Step, sid: string): Rel {
    const conversions = (st.casts ?? []).map((item) => {
      this.checkField(item.name, cur.cols, st.span);
      const t = item.type;
      if (
        !['text', 'integer', 'float', 'decimal', 'date', 'datetime', 'boolean'].includes(t.name)
      ) {
        throw new JflowError('E_TYPE_UNKNOWN', `未知类型 ${t.name}`, st.span);
      }
      const d: Record<string, unknown> = { field: item.name, type: t.name };
      if (t.p !== undefined) {
        if (t.name !== 'decimal')
          throw new JflowError('E_TYPE_DECIMAL', '只有 decimal 带参数', st.span);
        if (!(t.p >= 1 && t.p <= 38 && t.s! >= 0 && t.s! <= t.p && t.s! <= 18)) {
          throw new JflowError(
            'E_TYPE_DECIMAL',
            `decimal(${t.p},${t.s}) 不合法：需要 1≤p≤38、0≤s≤min(p,18)`,
            st.span
          );
        }
        d.precision = t.p;
        d.scale = t.s;
      }
      const opts = checkCastItemArgs(item.named, st.span);
      if (opts.on_error?.t === 'enum') d.onError = opts.on_error.v;
      if (opts.format?.t === 'str') d.format = opts.format.v;
      return d;
    });
    return this.rel(this.node(sid, 0, 'cast', { conversions }, { input: cur.node }), cur.cols, cur);
  }

  L_rename(cur: Rel, st: Step, sid: string): Rel {
    const mappings: Array<Record<string, unknown>> = [];
    let cols = cur.cols ? [...cur.cols] : null;
    for (const r of st.renames ?? []) {
      if (r.k === 'as') {
        this.checkField(r.from, cur.cols, st.span);
        mappings.push({ source: r.from, targetMode: 'rename', targetValue: r.to });
        if (cols) cols = cols.map((c) => (c === r.from ? r.to : c));
      } else {
        for (const f of r.fields) {
          this.checkField(f, cur.cols, st.span);
          mappings.push({ source: f, targetMode: r.k, targetValue: r.v });
          if (cols) cols = cols.map((c) => (c === f ? (r.k === 'prefix' ? r.v + c : c + r.v) : c));
        }
      }
    }
    return this.rel(this.node(sid, 0, 'rename', { mappings }, { input: cur.node }), cols, cur);
  }

  L_fill(cur: Rel, st: Step, sid: string): Rel {
    const rules = (st.fills ?? []).map((f) => {
      this.checkField(f.name, cur.cols, st.span);
      if (typeof f.with === 'string') return { field: f.name, method: `${f.with}_fill` };
      const e = f.with;
      if (e.k !== 'lit' || e.t === 'null')
        throw new JflowError(
          'E_NOT_SUPPORTED_R1',
          'fill with 只支持常量或 mean/median/mode/forward/backward',
          st.span
        );
      return { field: f.name, method: 'literal_fill', value: e.t === 'num' ? Number(e.v) : e.v };
    });
    return this.rel(
      this.node(sid, 0, 'missing_value', { strategy: 'by_column', rules }, { input: cur.node }),
      cur.cols,
      cur
    );
  }

  L_nullify(cur: Rel, st: Step, sid: string): Rel {
    const items = st.values?.k === 'list' ? st.values.items : [];
    const values = items.map((e) => {
      if (e.k !== 'lit' || e.t === 'null' || e.t === 'dur')
        throw new JflowError('E_ARG_TYPE', 'nullify values 只能是常量', st.span);
      return e.t === 'num' ? Number(e.v) : e.v;
    });
    const rules = (st.fields ?? []).map((f) => {
      this.checkField(f, cur.cols, st.span);
      return { field: f, method: 'nullify_values', values };
    });
    return this.rel(
      this.node(sid, 0, 'missing_value', { strategy: 'by_column', rules }, { input: cur.node }),
      cur.cols,
      cur
    );
  }

  L_drop_empty(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    const fields = args.fields?.t === 'fields' ? args.fields.v : undefined;
    fields?.forEach((f) => this.checkField(f, cur.cols, st.span));
    const dup = fields?.find((f, i) => fields.indexOf(f) !== i);
    if (dup) throw new JflowError('E_DUP_FIELD', `字段 [${dup}] 重复`, st.span);
    const cfg: Record<string, unknown> = {
      strategy: 'drop_rows_by_nulls',
      rules: [],
      condition: st.which === 'any' ? 'any_null' : 'all_null',
    };
    if (fields) cfg.fields = fields;
    return this.rel(this.node(sid, 0, 'missing_value', cfg, { input: cur.node }), cur.cols, cur);
  }

  L_unpivot(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    (st.fields ?? []).forEach((f) => this.checkField(f, cur.cols, st.span));
    const cfg = {
      fields: st.fields,
      selection: st.exclude ? 'exclude' : 'include',
      nameColumn: st.into![0],
      valueColumn: st.into![1],
      includeNulls: args.keep_nulls?.t === 'bool' ? args.keep_nulls.v : false,
    };
    let cols: Cols = null;
    if (cur.cols) {
      const moved = st.exclude ? cur.cols.filter((c) => !st.fields!.includes(c)) : st.fields!;
      cols = [...cur.cols.filter((c) => !moved.includes(c)), ...st.into!];
    }
    return this.rel(this.node(sid, 0, 'unpivot', cfg, { input: cur.node }), cols, cur);
  }

  L_unnest(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    this.checkField(st.field!, cur.cols, st.span);
    const cfg: Record<string, unknown> = {
      sourceKind: st.json ? 'json' : 'list',
      field: st.field,
      alias: st.as ?? '',
    };
    if (args.index?.t === 'fields') cfg.withIndex = args.index.v[0];
    if (args.keep_empty)
      throw new JflowError('E_NOT_SUPPORTED_R1', 'unnest keep_empty: 在 R1 中还不能转换', st.span);
    return this.rel(this.node(sid, 0, 'unnest', cfg, { input: cur.node }), null, cur);
  }

  L_pivot(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    if (args.fill)
      throw new JflowError('E_NOT_SUPPORTED_R1', 'pivot fill: 在 R1 中还不能转换', st.span);
    const on = (st.axes ?? []).map((a) => {
      this.checkField(a.name, cur.cols, st.span);
      const values =
        a.in && a.in.k === 'list'
          ? a.in.items.map((e) =>
              e.k === 'lit'
                ? e.t === 'num'
                  ? Number(e.v)
                  : e.t === 'null'
                    ? null
                    : e.t === 'bool'
                      ? e.v
                      : e.v
                : fmtExpr(e)
            )
          : [];
      return { field: a.name, values, customValues: [] };
    });
    const using = (st.pivotValues ?? []).map((v) => {
      const call = v.call;
      if (call.k !== 'call')
        throw new JflowError('E_ARG_TYPE', 'pivot values: 需要聚合调用', st.span);
      const fnName = canonicalFunction(call.name);
      const expression = call.star ? '*' : call.args.map((a) => cx(a, st.span)).join(', ');
      const m: Record<string, unknown> = {
        function: call.distinct && fnName === 'count' ? 'count_distinct' : fnName,
        expression,
      };
      if (v.as) m.alias = v.as;
      return m;
    });
    return this.rel(
      this.node(sid, 0, 'pivot', { on, using, groupBy: [] }, { input: cur.node }),
      null,
      cur
    );
  }

  L_split(_cur: Rel, st: Step): Rel {
    throw new JflowError('E_NOT_SUPPORTED_R1', 'split 在 R1 中还不能转换成算子配置', st.span);
  }

  // TODO(jflow R2): cloud resources (`cloud:` URIs) need optimistic concurrency — carry the
  // resolved resource version as `expectedVersion` on write; out of scope for R1 (local only).
  L_write(cur: Rel, st: Step, sid: string, args: StepArgs): Rel {
    const ref = st.ref!;
    const mode = args.mode?.t === 'enum' ? args.mode.v : null;
    if (mode === 'upsert')
      throw new JflowError('E_ARG_VALUE', 'mode: upsert 在 R1 中请写 merge', st.span);
    const cfg: Record<string, unknown> = { destination: 'duckdb_table' };
    if (ref.form === '@new') {
      const existing = this.options.findResultByName?.(ref.arg) ?? null;
      const ifExists = args.if_exists?.t === 'enum' ? args.if_exists.v : 'error';
      if (existing && ifExists === 'error') {
        throw new JflowError(
          'E_WRITE_INTENT',
          `结果表 ${ref.arg} 已存在；写 if_exists: reuse 或改用 @id(...)`,
          st.span
        );
      }
      if (existing) {
        Object.assign(cfg, {
          outputStrategy: 'existing',
          intent: 'bound',
          outputResultTableId: existing.id,
          resultTableId: existing.id,
          table: `output_${existing.id.replace(/-/g, '_')}`,
          resultTableName: existing.name,
          ref: { uri: `local:result/${existing.id}`, name: existing.name },
        });
      } else {
        Object.assign(cfg, { outputStrategy: 'auto', intent: 'new', resultTableName: ref.arg });
      }
      cfg.mode = ifExists === 'replace' ? 'replace' : (mode ?? 'replace');
    } else {
      if (args.if_exists) throw new JflowError('E_ARG_COMBO', 'if_exists: 只用于 @new', st.span);
      if (!mode) throw new JflowError('E_WRITE_MODE', 'write 必须写 mode:', st.span);
      const r = this.resolve(ref, 'write');
      if (r.kind !== 'result')
        throw new JflowError('E_REF_KIND', `${r.kind} 资源不能作为输出`, ref.span);
      Object.assign(cfg, {
        outputStrategy: 'existing',
        intent: 'bound',
        outputResultTableId: r.id,
        resultTableId: r.id,
        table: `output_${String(r.id).replace(/-/g, '_')}`,
        resultTableName: r.name ?? ref.snap ?? undefined,
        ref: { uri: r.uri, name: r.name ?? ref.snap },
        mode,
      });
      if (cfg.resultTableName === undefined) delete cfg.resultTableName;
    }
    if (cfg.mode === 'merge') {
      const keys = args.keys?.t === 'fields' ? args.keys.v : [];
      if (keys.length === 0)
        throw new JflowError('E_WRITE_KEYS', 'mode: merge 需要 keys:', st.span);
      keys.forEach((f) => this.checkField(f, cur.cols, st.span));
      cfg.mergeKeys = keys;
    } else if (args.keys) {
      throw new JflowError('E_ARG_COMBO', 'keys: 只用于 mode: merge', st.span);
    }
    if (args.schema?.t === 'enum') {
      if (args.schema.v === 'replace')
        throw new JflowError(
          'E_NOT_SUPPORTED_R1',
          'schema: replace 在 R1 中还不支持（可用 strict / extend）',
          st.span
        );
      cfg.schemaPolicy = args.schema.v;
    }
    const allowPartial = args.allow_partial?.t === 'bool' && args.allow_partial.v;
    if (allowPartial) cfg.allowPartial = true;
    if (cur.incremental && cfg.mode === 'replace' && !allowPartial) {
      throw new JflowError(
        'E_INCR_REPLACE',
        '增量来源 + mode: replace 会只留下新行；改用 merge，或写 allow_partial: true',
        st.span
      );
    }
    return this.rel(this.node(sid, 0, 'output', cfg, { input: cur.node }), cur.cols, cur);
  }
}

export function suggest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    // similarity by common characters (works for CJK names too)
    const a = new Set(name);
    const shared = [...new Set(c)].filter((ch) => a.has(ch)).length;
    const score = shared / Math.max(name.length, c.length);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best && bestScore >= 0.4 ? `[${best}]` : undefined;
}

/** Lays nodes out left-to-right by depth so an imported graph is readable on the canvas. */
function layout(nodes: JflowNode[], edges: JflowEdge[]): void {
  const depth = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const e of edges)
    incoming.set(e.targetNodeId, [...(incoming.get(e.targetNodeId) ?? []), e.sourceNodeId]);
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    depth.set(id, 0);
    const v = Math.max(-1, ...(incoming.get(id) ?? []).map(d)) + 1;
    depth.set(id, v);
    return v;
  };
  const rows = new Map<number, number>();
  for (const n of nodes) {
    const x = d(n.id);
    const y = rows.get(x) ?? 0;
    rows.set(x, y + 1);
    n.x = 80 + x * 240;
    n.y = 80 + y * 130;
  }
}

export function compileJflow(
  file: JflowFile,
  options: JflowCompileOptions = {}
): JflowCompileResult {
  const c = new Compiler(options);
  try {
    c.reserveIds(file);
    c.compileFile(file);
  } catch (error) {
    if (!(error instanceof JflowError)) throw error;
    c.diagnostics.push({
      code: error.code,
      severity: 'error',
      message: error.detail,
      span: error.span,
      hint: error.hint,
      ...(error.fix ? { fix: error.fix } : {}),
    });
    return {
      nodes: [],
      edges: [],
      diagnostics: c.diagnostics,
      sourceMap: {},
      lastColumns: c.lastCols,
      relationColumns: Object.fromEntries([...c.env].map(([k, v]) => [k, v.cols])),
    };
  }
  for (const n of c.nodes) {
    const base = n.layout?.composite ?? n.id;
    const label = c.labels.get(base);
    if (label)
      n.label = n.id === base ? label : `${label}·${n.layout?.role ?? n.id.slice(base.length + 1)}`;
  }
  const relationColumns: Record<string, string[] | null> = {};
  for (const [name, rel] of c.env) relationColumns[name] = rel.cols;
  layout(c.nodes, c.edges);
  return {
    nodes: c.nodes,
    edges: c.edges,
    diagnostics: c.diagnostics,
    sourceMap: c.sourceMap,
    lastColumns: c.lastCols,
    relationColumns,
  };
}

export type { Source };
