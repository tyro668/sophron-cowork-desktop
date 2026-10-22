/**
 * Two-level aggregation helpers: a nested aggregate such as `avg(sum([销售额]))` inside a
 * `group` is not valid SQL. Its meaning is "aggregate per group, then aggregate across the
 * groups", which jflow spells as a group followed by a window value:
 *
 *   | group [门店] (agg [销售额合计] = sum([销售额]))
 *   | derive [平均] = avg([销售额合计]) over ()
 */
import type { Expr, JflowFix, Step } from './ast';
import { fmtExpr, fmtField } from './format';
import { parseJflowExpr } from './parse';
import { lookupExpressionFunction } from '../expression/functions';

const IF_AGG_NAMES = new Set(['sumif', 'countif', 'avgif', 'minif', 'maxif']);

export function isPlainAggregateCall(e: Expr): boolean {
  if (e.k !== 'call' || e.over) return false;
  return (
    IF_AGG_NAMES.has(e.name.toLowerCase()) || lookupExpressionFunction(e.name)?.kind === 'aggregate'
  );
}

function containsAggregate(e: unknown): boolean {
  if (Array.isArray(e)) return e.some(containsAggregate);
  if (!e || typeof e !== 'object') return false;
  const x = e as Expr;
  if (typeof (x as { k?: unknown }).k === 'string' && isPlainAggregateCall(x)) return true;
  return Object.values(e as Record<string, unknown>).some(
    (v) => v && typeof v === 'object' && containsAggregate(v)
  );
}

/** `avg(sum([x]))` → the outer call when one of its arguments is itself an aggregate. */
export function nestedAggregate(
  e: Expr
): { outer: Extract<Expr, { k: 'call' }>; inner: Expr } | null {
  if (e.k !== 'call' || !isPlainAggregateCall(e) || e.args.length !== 1) return null;
  const inner = e.args[0];
  return containsAggregate(inner) ? { outer: e, inner } : null;
}

function innerName(aggName: string, inner: Expr, taken: Set<string>): string {
  let base = `${aggName}_分组值`;
  if (inner.k === 'call' && inner.args.length === 1 && inner.args[0].k === 'field') {
    const fn = inner.name.toLowerCase();
    const suffix: Record<string, string> = {
      sum: '合计',
      avg: '均值',
      count: '计数',
      min: '最小值',
      max: '最大值',
    };
    base = `${inner.args[0].name}${suffix[fn] ?? `_${fn}`}`;
  } else if (inner.k === 'call' && inner.star) {
    base = '记录数';
  }
  let name = base;
  for (let i = 2; taken.has(name); i += 1) name = `${base}${i}`;
  taken.add(name);
  return name;
}

export const NESTED_AGGREGATE_HINT =
  '先在 group 里算出每组的值，再用窗口值在组之间汇总，例如 group [门店] (agg [销售额合计] = sum([销售额])) | derive [平均] = avg([销售额合计]) over ()';

/**
 * Rewrite of a `group` step whose aggs nest aggregates. Each nested agg `[a] = OUTER(INNER)`
 * becomes a group metric `[INNER值] = INNER` plus `derive [a] = OUTER([INNER值]) over ()`.
 * Returns null when nothing is nested.
 */
export function splitNestedAggregateStep(step: Step): JflowFix | null {
  if (step.op !== 'group' || !step.aggs?.length) return null;
  const taken = new Set<string>([
    ...(step.groupKeys ?? []).map((key) => key.name),
    ...step.aggs.map((a) => a.name),
  ]);
  const groupAggs: Array<{ name: string; e: Expr }> = [];
  const derives: Array<{ name: string; e: Expr }> = [];
  for (const agg of step.aggs) {
    const nested = nestedAggregate(agg.e);
    if (!nested) {
      groupAggs.push(agg);
      continue;
    }
    const name = innerName(agg.name, nested.inner, taken);
    groupAggs.push({ name, e: nested.inner });
    derives.push({
      name: agg.name,
      e: {
        ...nested.outer,
        args: [{ k: 'field', name }],
        over: { partition: [], order: [], frame: null },
      },
    });
  }
  if (!derives.length) return null;
  const keys = (step.groupKeys ?? [])
    .map(
      (key) =>
        fmtField(key.name) +
        (key.e ? ` = ${fmtExpr(key.e)}` : '') +
        (key.grain ? ` grain: ${key.grain}` : '')
    )
    .join(', ');
  const group = `| group${keys ? ` ${keys}` : ''} (agg ${groupAggs
    .map((a) => `${fmtField(a.name)} = ${fmtExpr(a.e)}`)
    .join(', ')})`;
  const derive = `| derive ${derives.map((d) => `${fmtField(d.name)} = ${fmtExpr(d.e)}`).join(', ')}`;
  return { title: '拆分为 group + over ()', span: step.span, text: `${group}\n  ${derive}` };
}

/** Apply a fix to the document it was computed for. */
export function applyJflowFix(doc: string, fix: JflowFix): string {
  const start = Math.max(0, Math.min(fix.span.start, doc.length));
  const end = Math.max(start, Math.min(fix.span.end, doc.length));
  const hasPipe = doc.slice(start, end).trimStart().startsWith('|');
  const text = hasPipe ? fix.text : fix.text.replace(/^\|\s*/, '');
  return doc.slice(0, start) + text + doc.slice(end);
}

/**
 * Row-level expressions (derive / where): a bare aggregate has no rows to aggregate over.
 * Returns the problem with a hint and, for bare aggregates, a fix that adds `over ()`.
 * Calculation-domain wrappers (group(…), accumulate(…) …) and window calls are left alone.
 */
export function rowLevelAggregateProblem(
  exprs: Expr[]
): { code: 'E_AGG_NESTED' | 'E_AGG_ROW'; message: string; hint: string } | null {
  type Problem = { code: 'E_AGG_NESTED' | 'E_AGG_ROW'; message: string; hint: string };
  let found = null as Problem | null;
  const visitAny = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visitAny);
    else if (v && typeof v === 'object' && 'k' in (v as object)) visit(v as Expr);
  };
  const visit = (e: Expr): void => {
    if (found) return;
    if (e.k === 'call') {
      if (e.over) return;
      if (isPlainAggregateCall(e)) {
        if (nestedAggregate(e)) {
          found = { code: 'E_AGG_NESTED', message: '不支持嵌套聚合', hint: NESTED_AGGREGATE_HINT };
        } else {
          const text = fmtExpr(e);
          found = {
            code: 'E_AGG_ROW',
            message: `行级计算里的 ${text} 需要窗口`,
            hint: `写成 ${text} over ()（全部行）或 ${text} over (by: [分组字段])；要按组汇总请用 group`,
          };
        }
        return;
      }
      if (!lookupExpressionFunction(e.name)) return;
    }
    Object.values(e as Record<string, unknown>).forEach(visitAny);
  };
  exprs.forEach(visit);
  return found;
}

/** Same expressions with every bare (non-nested) row-level aggregate given `over ()`. */
export function addOverToRowAggregates(e: Expr): Expr {
  const rec = (x: Expr): Expr => {
    if (x.k === 'call') {
      if (x.over) return x;
      if (isPlainAggregateCall(x) && !nestedAggregate(x)) {
        return { ...x, over: { partition: [], order: [], frame: null } };
      }
      if (!lookupExpressionFunction(x.name)) return x;
    }
    const any = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(any)
        : v && typeof v === 'object' && 'k' in (v as object)
          ? rec(v as Expr)
          : v;
    return Object.fromEntries(Object.entries(x).map(([key, v]) => [key, any(v)])) as Expr;
  };
  return rec(e);
}

export interface ExpressionAggregateIssue {
  code: 'E_AGG_NESTED' | 'E_AGG_ROW';
  message: string;
  hint: string;
  /** Rewritten expression (row context, bare aggregates → `over ()`). */
  fixText?: string;
}

/**
 * Lint for form expression inputs. `row`: derive / filter expressions (bare aggregates need a
 * window, nested ones need a group). `metric`: the argument of an aggregate metric, where any
 * aggregate is nested.
 */
export function expressionAggregateIssue(
  text: string,
  context: 'row' | 'metric'
): ExpressionAggregateIssue | null {
  if (!text.trim()) return null;
  let ast: Expr | null;
  try {
    ast = parseJflowExpr(text).ast;
  } catch {
    return null;
  }
  if (!ast) return null;
  if (context === 'metric') {
    return containsAggregate(ast)
      ? { code: 'E_AGG_NESTED', message: '不支持嵌套聚合', hint: NESTED_AGGREGATE_HINT }
      : null;
  }
  const problem = rowLevelAggregateProblem([ast]);
  if (!problem) return null;
  return problem.code === 'E_AGG_ROW'
    ? { ...problem, fixText: fmtExpr(addOverToRowAggregates(ast), 'cfg') }
    : problem;
}
