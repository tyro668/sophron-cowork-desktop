/**
 * Canonical formatter: AST → jflow text. `case` always prints as if…elseif…else…end.
 * The `cfg` dialect prints expressions the way existing operator configs store them
 * (multi-branch if → case when), so lowered configs pass the existing expression parser.
 */
import type {
  Chain,
  Expr,
  Head,
  JflowFile,
  KeepItem,
  NamedValue,
  ResourceRef,
  SelectItem,
  SortKey,
  Step,
  TableExp,
  TypeRef,
} from './ast';
import type { ArgValue } from './args';

export type Dialect = 'jflow' | 'cfg';

export function fmtField(name: string): string {
  return `[${name.replace(/\]/g, ']]')}]`;
}
export function fmtString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const CMP = new Set(['=', '<>', '<', '<=', '>', '>=']);
const LEVEL: Record<string, number> = {
  or: 1,
  and: 2,
  '||': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};

function level(e: Expr): number {
  switch (e.k) {
    case 'bin':
      return CMP.has(e.op) ? 4 : LEVEL[e.op];
    case 'isnull':
    case 'in':
    case 'between':
    case 'like':
    case 'isdistinct':
      return 4;
    case 'not':
      return 3;
    case 'neg':
      return 8;
    default:
      return 9;
  }
}

export function fmtType(t: TypeRef): string {
  return t.p !== undefined ? `${t.name}(${t.p},${t.s})` : t.name;
}

const DURATION_UNITS: Record<string, string> = {
  ms: 'millisecond',
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  mo: 'month',
  q: 'quarter',
  y: 'year',
};

/** `7d` → `interval 7 'day'` (config / SQL dialect). */
export function durationToInterval(v: string): string {
  const m = /^(\d+(?:\.\d+)?)(ms|mo|[smhdwqy])$/.exec(v);
  return m ? `interval ${m[1]} '${DURATION_UNITS[m[2]]}'` : v;
}

/** `interval 7 'day'` → `7d` (inverse of durationToInterval; unknown units unchanged). */
export function intervalsToDurations(text: string): string {
  const inverse = Object.fromEntries(Object.entries(DURATION_UNITS).map(([k, v]) => [v, k]));
  return text.replace(
    /\binterval\s+(\d+(?:\.\d+)?)\s+'([a-z]+?)s?'/gi,
    (all, n: string, unit: string) =>
      inverse[unit.toLowerCase()] ? `${n}${inverse[unit.toLowerCase()]}` : all
  );
}

export function fmtExpr(e: Expr, dialect: Dialect = 'jflow'): string {
  const X = (x: Expr) => fmtExpr(x, dialect);
  const P = (x: Expr, need: number) => (level(x) < need ? `(${X(x)})` : X(x));
  switch (e.k) {
    case 'field':
      return (e.q ? `${fmtField(e.q)}.` : '') + fmtField(e.name);
    case 'lit':
      if (e.t === 'str') return fmtString(e.v);
      if (e.t === 'dur' && dialect === 'cfg') return durationToInterval(e.v);
      if (e.t === 'num' || e.t === 'dur') return e.v;
      if (e.t === 'bool') return e.v ? 'true' : 'false';
      return 'null';
    case 'param':
      return `$${e.v}`;
    case 'enum':
      return e.v;
    case 'paren':
      return `(${X(e.e)})`;
    case 'list':
      return `(${e.items.map(X).join(', ')})`;
    case 'typed':
      return `${e.type} ${fmtString(e.v)}`;
    case 'not':
      return `not ${P(e.e, 4)}`;
    case 'neg':
      return `-${P(e.e, 9)}`;
    case 'bin': {
      const L = level(e);
      if (L === 4) return `${P(e.l, 5)} ${e.op} ${P(e.r, 5)}`;
      return `${P(e.l, L)} ${e.op} ${P(e.r, L + 1)}`;
    }
    case 'isnull':
      return `${P(e.e, 5)}${e.not ? ' is not null' : ' is null'}`;
    case 'isdistinct':
      return `${P(e.l, 5)}${e.not ? ' is not distinct from ' : ' is distinct from '}${P(e.r, 5)}`;
    case 'in': {
      const r =
        e.list.k === 'param'
          ? `$${e.list.v}`
          : `(${(e.list as { items: Expr[] }).items.map(X).join(', ')})`;
      return `${P(e.e, 5)}${e.not ? ' not in ' : ' in '}${r}`;
    }
    case 'between':
      return `${P(e.e, 5)}${e.not ? ' not between ' : ' between '}${P(e.lo, 5)} and ${P(e.hi, 5)}`;
    case 'like':
      return `${P(e.l, 5)}${e.not ? ' not ' : ' '}${e.op} ${P(e.r, 5)}`;
    case 'cast':
      return `${e.try ? 'try_cast' : 'cast'}(${X(e.e)} as ${fmtType(e.type)})`;
    case 'if': {
      if (dialect === 'cfg' && e.branches.length > 1) {
        return (
          'case' +
          e.branches.map(([c, v]) => ` when ${X(c)} then ${X(v)}`).join('') +
          (e.else ? ` else ${X(e.else)}` : '') +
          ' end'
        );
      }
      let s = '';
      e.branches.forEach(([c, v], i) => {
        s += `${i === 0 ? 'if ' : ' elseif '}${X(c)} then ${X(v)}`;
      });
      if (e.else) s += ` else ${X(e.else)}`;
      return `${s} end`;
    }
    case 'call': {
      const args: string[] = [];
      if (e.star) args.push('*');
      e.args.forEach((x, i) => args.push(`${e.distinct && i === 0 ? 'distinct ' : ''}${X(x)}`));
      for (const [n, v] of Object.entries(e.named)) args.push(`${n}: ${X(v)}`);
      let s = `${e.name}(${args.join(', ')})`;
      if (e.over) {
        const o = e.over;
        const parts: string[] = [];
        if (o.partition.length) parts.push(`partition by ${o.partition.map(X).join(', ')}`);
        if (o.order.length) {
          parts.push(
            `order by ${o.order
              .map(
                (key) =>
                  X(key.e) +
                  (key.dir ? ` ${key.dir}` : '') +
                  (key.nulls ? ` nulls ${key.nulls}` : '')
              )
              .join(', ')}`
          );
        }
        if (o.frame) {
          const bs = o.frame.bounds.map((b) =>
            b.k === 'unbounded'
              ? `unbounded ${b.side}`
              : b.k === 'current'
                ? 'current row'
                : `${X(b.e)} ${b.side}`
          );
          parts.push(
            o.frame.unit +
              (bs.length === 2 ? ` between ${bs.join(' and ')}` : ` ${bs[0]}`) +
              (o.frame.exclude ? ` exclude ${o.frame.exclude}` : '')
          );
        }
        s += ` over(${parts.join(' ')})`;
      }
      return s;
    }
  }
}

function fmtSortKey(k: SortKey): string {
  return (k.desc ? '-' : '') + fmtExpr(k.field) + (k.nulls ? ` nulls: ${k.nulls}` : '');
}

function fmtKeep(i: KeepItem): string {
  if (i.k === 'star') return `${fmtField(i.q)}.*`;
  if (i.k === 'col') return fmtExpr(i.e);
  return `${fmtField(i.name)} = ${fmtExpr(i.e)}`;
}

export function fmtNamedValue(v: NamedValue): string {
  switch (v.k) {
    case 'fields':
      return v.v.map(fmtField).join(', ');
    case 'sortlist':
      return v.keys.map(fmtSortKey).join(', ');
    case 'keep':
      return v.items.map(fmtKeep).join(', ');
    case 'items':
      return v.items
        .map((it) =>
          it.k === 'star'
            ? `${fmtField(it.q)}.*`
            : it.k === 'alias'
              ? `${fmtField(it.name)} = ${fmtExpr(it.e)}`
              : fmtExpr(it.e) + (it.nulls ? ` nulls: ${it.nulls}` : '')
        )
        .join(', ');
  }
}

export function argToNamedValue(a: ArgValue): NamedValue {
  switch (a.t) {
    case 'fields':
      return { k: 'fields', v: a.v };
    case 'names':
      return {
        k: 'items',
        items: a.v.map((v) => ({ k: 'expr', e: { k: 'enum', v }, nulls: null })),
      };
    case 'sortlist':
      return { k: 'sortlist', keys: a.v };
    case 'keep':
      return { k: 'keep', items: a.v };
    case 'expr':
      return { k: 'items', items: [{ k: 'expr', e: a.v, nulls: null }] };
    case 'enum':
      return { k: 'items', items: [{ k: 'expr', e: { k: 'enum', v: a.v }, nulls: null }] };
    case 'bool':
      return {
        k: 'items',
        items: [{ k: 'expr', e: { k: 'lit', t: 'bool', v: a.v }, nulls: null }],
      };
    case 'int':
      return {
        k: 'items',
        items: [{ k: 'expr', e: { k: 'lit', t: 'num', v: String(a.v) }, nulls: null }],
      };
    case 'str':
      return { k: 'items', items: [{ k: 'expr', e: { k: 'lit', t: 'str', v: a.v }, nulls: null }] };
    case 'dur':
      return { k: 'items', items: [{ k: 'expr', e: { k: 'lit', t: 'dur', v: a.v }, nulls: null }] };
  }
}

function fmtNamed(s: Step): string {
  return s.norder.map((key) => ` ${key}: ${fmtNamedValue(s.named[key])}`).join('');
}

export function fmtRef(r: ResourceRef): string {
  const a = [fmtString(r.arg), ...(r.snap ? [fmtString(r.snap)] : [])];
  for (const [key, v] of Object.entries(r.opts)) a.push(`${key}: ${fmtExpr(v)}`);
  return `${r.form}(${a.join(', ')})`;
}

function fmtTable(t: TableExp, indent: string): string {
  return fmtHead(t.src, indent) + (t.as ? ` as ${t.as}` : '');
}

function fmtHead(h: Head, indent: string): string {
  if (h.k === 'name') return h.v;
  if (h.k === 'ref') return fmtRef(h.ref);
  if (h.k === 'chain') return `(${fmtChain(h.chain, ' ', indent)})`;
  return fmtStep(h.step, indent);
}

function fmtSelectItem(it: SelectItem): string {
  if (it.k === 'col') return fmtExpr(it.e!);
  if (it.k === 'calc') return `${fmtField(it.name!)} = ${fmtExpr(it.calc!)}`;
  if (it.k === 'star') return `${fmtField(it.q!)}.*`;
  return `cols(${Object.entries(it.kv ?? {})
    .map(([key, v]) => `${key}: ${fmtExpr(v)}`)
    .join(', ')})`;
}

export function fmtStep(s: Step, indent = '  '): string {
  const op = s.op;
  let b = op;
  switch (op) {
    case 'where':
      b += ` ${fmtExpr(s.cond!)}`;
      break;
    case 'select':
    case 'drop':
      b += ` ${(s.items ?? []).map(fmtSelectItem).join(', ')}`;
      break;
    case 'derive':
      b += ` ${(s.derives ?? [])
        .map((d) => `${d.replace ? 'replace ' : ''}${fmtField(d.name)} = ${fmtExpr(d.e)}`)
        .join(', ')}`;
      break;
    case 'sort':
      b += ` ${(s.keys ?? []).map(fmtSortKey).join(', ')}`;
      break;
    case 'take':
    case 'sample':
      b += ` ${s.n}${s.pct ? '%' : ''}`;
      break;
    case 'group': {
      const keys = (s.groupKeys ?? [])
        .map(
          (key) =>
            fmtField(key.name) +
            (key.e ? ` = ${fmtExpr(key.e)}` : '') +
            (key.grain ? ` grain: ${key.grain}` : '')
        )
        .join(', ');
      b += `${keys ? ` ${keys}` : ''} (agg ${(s.aggs ?? []).map((a) => `${fmtField(a.name)} = ${fmtExpr(a.e)}`).join(', ')})`;
      break;
    }
    case 'join':
      b += ` ${s.kind} ${fmtTable(s.table!, indent)}`;
      if (s.on)
        b += ` on ${s.on.k === 'keys' ? s.on.keys.map(fmtField).join(', ') : fmtExpr(s.on.e)}`;
      break;
    case 'lookup':
      b += ` ${fmtTable(s.table!, indent)} on ${(s.lookupOn ?? []).map(fmtField).join(', ')} get ${(s.get ?? []).map(fmtField).join(', ')}`;
      break;
    case 'union':
    case 'intersect':
    case 'except':
      b += ` ${(s.tables ?? []).map((t) => fmtTable(t, indent)).join(', ')}`;
      break;
    case 'check': {
      const c = s.check!;
      if (c.kind === 'unique' || c.kind === 'not_null')
        b += ` ${c.kind} ${c.fields.map(fmtField).join(', ')}`;
      else if (c.kind === 'rows') b += ` rows ${c.cmp} ${c.n}`;
      else b += ` ${fmtExpr(c.e)}`;
      break;
    }
    case 'sql':
      b += ` '''${s.sql}'''`;
      break;
    case 'write':
      b += ` ${fmtRef(s.ref!)}`;
      break;
    case 'cast':
      b += ` ${(s.casts ?? [])
        .map(
          (c) =>
            `${fmtField(c.name)} as ${fmtType(c.type)}` +
            Object.entries(c.named)
              .map(([key, v]) => ` ${key}: ${fmtExpr(v)}`)
              .join('')
        )
        .join(', ')}`;
      break;
    case 'fill':
      b += ` ${(s.fills ?? [])
        .map(
          (f) => `${fmtField(f.name)} with ${typeof f.with === 'string' ? f.with : fmtExpr(f.with)}`
        )
        .join(', ')}`;
      break;
    case 'nullify':
      b += ` ${(s.fields ?? []).map(fmtField).join(', ')} values ${fmtExpr(s.values!)}`;
      break;
    case 'drop_empty':
      b += ` ${s.which}`;
      break;
    case 'rename':
      b += ` ${(s.renames ?? [])
        .map((r) =>
          r.k === 'as'
            ? `${fmtField(r.from)} as ${fmtField(r.to)}`
            : `${r.k} ${fmtString(r.v)}(${r.fields.map(fmtField).join(', ')})`
        )
        .join(', ')}`;
      break;
    case 'unnest':
      b += `${s.json ? ' json' : ''} ${fmtField(s.field!)}${s.as ? ` as ${fmtField(s.as)}` : ''}`;
      break;
    case 'pivot':
      b += ` ${(s.axes ?? []).map((a) => fmtField(a.name) + (a.in ? ` in ${fmtExpr(a.in)}` : '')).join(', ')} values: ${(
        s.pivotValues ?? []
      )
        .map((v) => fmtExpr(v.call) + (v.as ? ` as ${fmtField(v.as)}` : ''))
        .join(', ')}`;
      break;
    case 'unpivot':
      b += `${s.exclude ? ' exclude' : ''} ${(s.fields ?? []).map(fmtField).join(', ')} into: (${fmtField(s.into![0])}, ${fmtField(s.into![1])})`;
      break;
    case 'split':
      b += ` ${(s.branches ?? []).map((x) => `${x.name} when ${fmtExpr(x.cond)}`).join(', ')}${s.else ? `, else ${s.else}` : ''}`;
      break;
    default:
      break;
  }
  return b + fmtNamed(s);
}

function pragmaLines(
  s: { id?: string; pragmas?: Record<string, string>; doc?: string[] },
  indent: string
): string {
  const out: string[] = [];
  for (const d of s.doc ?? []) out.push(`${indent}## ${d}`);
  const pragmas = { ...(s.pragmas ?? {}) };
  if (s.id) pragmas.id = s.id;
  for (const [key, v] of Object.entries(pragmas)) out.push(`${indent}#! ${key}: ${v}`);
  return out.length ? `${out.join('\n')}\n` : '';
}

export function fmtChain(c: Chain, sep = '\n  ', indent = '  '): string {
  const inline = sep === ' ';
  return (
    fmtHead(c.head, indent) +
    c.steps
      .map(
        (s) => (inline ? ' ' : `\n${pragmaLines(s, indent)}${indent}`) + `| ${fmtStep(s, indent)}`
      )
      .join('')
  );
}

export function formatJflow(f: JflowFile): string {
  // Sections are separated by exactly one blank line; text inside ''' raw strings is untouched.
  const sections: string[] = [];
  if (f.header) {
    const meta = Object.entries(f.header.meta);
    sections.push(
      `pipeline ${f.header.name}` +
        (meta.length ? ` (${meta.map(([key, v]) => `${key}: ${fmtExpr(v)}`).join(', ')})` : '')
    );
  }
  const decls: string[] = [];
  for (const p of f.params)
    decls.push(
      `param $${p.name}: ${fmtType(p.type)}${p.default ? ` = ${fmtExpr(p.default)}` : ''}`
    );
  for (const s of f.sources) {
    const read = Object.entries(s.read);
    decls.push(
      pragmaLines(s, '') +
        `source ${s.alias} = ${fmtRef(s.ref)}` +
        (read.length
          ? ` with (${read.map(([key, v]) => `${key}: ${fmtExpr(v)}`).join(', ')})`
          : '') +
        (s.incr
          ? ` incremental: ${fmtField(s.incr.field)}${s.incr.lookback ? ` lookback: ${s.incr.lookback}` : ''}`
          : '')
    );
  }
  if (decls.length) sections.push(decls.join('\n'));
  for (const fl of f.flows) {
    sections.push(pragmaLines(fl, '') + (fl.let ? `let ${fl.let} = ` : '') + fmtChain(fl.chain));
  }
  return `${sections.map((x) => x.replace(/\s+$/, '')).join('\n\n')}\n`;
}
