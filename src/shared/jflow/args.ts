/**
 * Strict per-verb named-argument validation (v4 §9.4). Unknown keys fail with E_ARG_UNKNOWN
 * before anything is converted to operator configs (zod would silently drop them).
 */
import type { Expr, KeepItem, NamedValue, SortKey, Step } from './ast';
import { JflowError } from './ast';

type Spec =
  | 'fields'
  | 'sortlist'
  | 'keep'
  | 'expr'
  | 'bool'
  | 'int'
  | 'str'
  | 'dur'
  | 'names'
  | { enum: string[] };

const E = (...values: string[]): Spec => ({ enum: values });

export const VERB_ARGS: Record<string, Record<string, Spec>> = {
  where: {},
  select: {},
  drop: {},
  derive: {},
  rename: {},
  cast: {},
  fill: {},
  nullify: {},
  drop_empty: { fields: 'fields' },
  sort: {},
  group: {},
  pass: {},
  sql: { inputs: 'names' },
  take: { per: 'fields', sort: 'sortlist', ties: E('include', 'exclude'), offset: 'int' },
  sample: { seed: 'int', per: 'fields' },
  distinct: { by: 'fields', sort: 'sortlist', keep: E('first', 'last') },
  join: {
    keep: 'keep',
    expect: E('one_to_one', 'many_to_one', 'one_to_many', 'many_to_many'),
    suffix: 'str',
    null_aware: 'bool',
    match: 'expr',
    tolerance: 'dur',
  },
  lookup: {},
  union: { by: E('name', 'position'), distinct: 'bool' },
  intersect: { by: E('name', 'position') },
  except: { by: E('name', 'position') },
  split: { mode: E('first', 'all') },
  check: { on_fail: E('error', 'warn', 'reject'), message: 'str' },
  write: {
    mode: E('replace', 'append', 'merge', 'upsert'),
    schema: E('strict', 'extend', 'replace'),
    keys: 'fields',
    if_exists: E('error', 'reuse', 'replace'),
    allow_partial: 'bool',
  },
  pivot: { fill: 'expr' },
  unpivot: { keep_nulls: 'bool' },
  unnest: { keep_empty: 'bool', index: 'fields' },
};

/** Options on one `cast [x] as type …` item. */
export const CAST_ITEM_ARGS: Record<string, Spec> = {
  on_error: E('keep', 'fail', 'null'),
  format: 'str',
};

const MISTAKES: Record<string, string | null> = {
  'take.by': 'sort',
  'take.order': 'sort',
  'take.order_by': 'sort',
  'take.partition': 'per',
  'take.group': 'per',
  'distinct.on': 'by',
  'sort.by': null,
  'join.select': 'keep',
  'join.columns': 'keep',
  'write.strategy': 'mode',
  'check.severity': 'on_fail',
  'cast.scale': null,
};

export type ArgValue =
  | { t: 'enum'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'int'; v: number }
  | { t: 'str'; v: string }
  | { t: 'dur'; v: string }
  | { t: 'fields'; v: string[] }
  | { t: 'names'; v: string[] }
  | { t: 'sortlist'; v: SortKey[] }
  | { t: 'keep'; v: KeepItem[] }
  | { t: 'expr'; v: Expr };

export type StepArgs = Record<string, ArgValue>;

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein(word, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  return best !== undefined && bestScore <= Math.max(2, Math.floor(word.length / 2))
    ? best
    : undefined;
}

function single(v: NamedValue): Expr | null {
  if (v.k !== 'items' || v.items.length !== 1 || v.items[0].k !== 'expr') return null;
  return v.items[0].e;
}

function scalarWord(e: Expr | null): string | null {
  if (!e) return null;
  if (e.k === 'enum') return e.v;
  if (e.k === 'lit') {
    if (e.t === 'null') return 'null';
    if (e.t === 'bool') return String(e.v);
    return String(e.v);
  }
  return null;
}

function normalize(
  op: string,
  key: string,
  spec: Spec,
  v: NamedValue,
  span: Step['span']
): ArgValue {
  const typeError = (what: string) =>
    new JflowError('E_ARG_TYPE', `${op} 的 ${key}: 需要${what}`, span);
  if (typeof spec === 'object') {
    const word = scalarWord(single(v));
    if (word === null || !spec.enum.includes(word)) {
      throw new JflowError(
        'E_ARG_VALUE',
        `${op} 的 ${key}: 只能是 ${[...spec.enum].sort().join('/')}，实际是 ${word ?? '表达式'}`,
        span
      );
    }
    return { t: 'enum', v: word };
  }
  if (v.k !== 'items') throw typeError('合法的值');
  const items = v.items;
  switch (spec) {
    case 'bool': {
      const e = single(v);
      if (!e || e.k !== 'lit' || e.t !== 'bool') throw typeError(' true/false');
      return { t: 'bool', v: e.v as boolean };
    }
    case 'int': {
      const e = single(v);
      if (!e || e.k !== 'lit' || e.t !== 'num' || !/^\d+$/.test(String(e.v)))
        throw typeError('整数');
      return { t: 'int', v: Number(e.v) };
    }
    case 'str': {
      const e = single(v);
      if (!e || e.k !== 'lit' || e.t !== 'str') throw typeError('字符串');
      return { t: 'str', v: String(e.v) };
    }
    case 'dur': {
      const e = single(v);
      if (!e || e.k !== 'lit' || e.t !== 'dur') throw typeError('时长（如 1h）');
      return { t: 'dur', v: String(e.v) };
    }
    case 'expr': {
      const e = single(v);
      if (!e) throw typeError('一个表达式');
      return { t: 'expr', v: e };
    }
    case 'names': {
      const names = items.map((it) => (it.k === 'expr' && it.e.k === 'enum' ? it.e.v : null));
      if (names.some((n) => n === null)) throw typeError('名字列表');
      return { t: 'names', v: names as string[] };
    }
    case 'fields': {
      const out: string[] = [];
      for (const it of items) {
        if (it.k !== 'expr' || it.e.k !== 'field' || it.e.q || it.nulls)
          throw typeError('字段列表');
        out.push(it.e.name);
      }
      return { t: 'fields', v: out };
    }
    case 'sortlist': {
      const keys: SortKey[] = [];
      for (const it of items) {
        if (it.k !== 'expr') throw typeError('排序键');
        const e = it.e;
        if (e.k === 'field' && !e.q) keys.push({ desc: false, field: e, nulls: it.nulls });
        else if (e.k === 'neg' && e.e.k === 'field' && !e.e.q)
          keys.push({ desc: true, field: e.e, nulls: it.nulls });
        else throw typeError('排序键（[字段] 或 -[字段]）');
      }
      return { t: 'sortlist', v: keys };
    }
    case 'keep': {
      const out: KeepItem[] = [];
      for (const it of items) {
        if (it.k === 'star') out.push({ k: 'star', q: it.q });
        else if (it.k === 'alias') out.push({ k: 'alias', name: it.name, e: it.e });
        else if (it.e.k === 'field' && !it.nulls) out.push({ k: 'col', e: it.e });
        else throw typeError('投影列表');
      }
      return { t: 'keep', v: out };
    }
  }
}

/** Validates and normalizes a step's named args by the verb's table. Throws JflowError. */
export function checkStepArgs(step: Step): StepArgs {
  const op = step.op;
  const allowed = VERB_ARGS[op] ?? {};
  const out: StepArgs = {};
  for (const key of step.norder) {
    const span = step.namedSpans[key] ?? step.span;
    const spec = allowed[key];
    if (!spec) {
      const mistake = MISTAKES[`${op}.${key}`];
      const hint = mistake === undefined ? closest(key, Object.keys(allowed)) : mistake;
      throw new JflowError(
        'E_ARG_UNKNOWN',
        `${op} 不接受参数 ${key}:；允许：${Object.keys(allowed).sort().join(', ') || '（无）'}`,
        span,
        hint ? `${hint}:` : undefined
      );
    }
    out[key] = normalize(op, key, spec, step.named[key], span);
  }
  return out;
}

export function checkCastItemArgs(named: Record<string, Expr>, span: Step['span']): StepArgs {
  const out: StepArgs = {};
  for (const [key, e] of Object.entries(named)) {
    const spec = CAST_ITEM_ARGS[key];
    if (!spec) {
      throw new JflowError(
        'E_ARG_UNKNOWN',
        `cast 项不接受参数 ${key}:；允许：${Object.keys(CAST_ITEM_ARGS).join(', ')}`,
        span,
        key === 'scale' || key === 'precision'
          ? '写成 decimal(p,s)'
          : closest(key, Object.keys(CAST_ITEM_ARGS))
      );
    }
    out[key] = normalize(
      'cast',
      key,
      spec,
      { k: 'items', items: [{ k: 'expr', e, nulls: null }] },
      span
    );
  }
  return out;
}
