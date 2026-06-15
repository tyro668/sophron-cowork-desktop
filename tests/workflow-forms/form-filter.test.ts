import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function roundTrip(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'filter', config });
  const parsed = parsePrepOperatorDsl(dsl, 'filter');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  return { dsl, parsed, errors };
}

function ok(config: Record<string, unknown>) {
  const { dsl, parsed, errors } = roundTrip(config);
  expect(errors, `DSL errors for filter: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return parsed.operator!;
}

describe('FormFilter — config ↔ DSL', () => {
  it('simple comparison', () => {
    const r = ok({ condition: '[revenue] > 0' });
    expect(r.config.condition).toBe('[revenue] > 0');
  });

  it('string equality', () => {
    const r = ok({ condition: '[region] = "EU"' });
    expect(r.config.condition).toContain('EU');
  });

  it('not equal', () => {
    const r = ok({ condition: '[status] != "TEST"' });
    expect(r.config.condition).toContain('!=');
  });

  it('between two values', () => {
    const r = ok({ condition: '[price] between 10 and 100' });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain('and');
  });

  it('between with dates', () => {
    const r = ok({
      condition: '[order_date] between 2024-01-01 and 2024-12-31',
    });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain('2024-01-01');
  });

  it('AND compound', () => {
    const r = ok({
      condition: '[revenue] > 0 and [region] = "EU"',
    });
    expect(r.config.condition).toContain(' and ');
  });

  it('OR compound', () => {
    const r = ok({
      condition: '[region] = "EU" or [region] = "US"',
    });
    expect(r.config.condition).toContain(' or ');
  });

  it('mixed AND + OR', () => {
    const r = ok({
      condition: '[revenue] > 0 and [region] = "EU" or [status] = "VIP"',
    });
    expect(r.config.condition).toContain(' and ');
    expect(r.config.condition).toContain(' or ');
  });

  it('between + AND compound', () => {
    const r = ok({
      condition: '[price] between 10 and 100 and [region] = "EU"',
    });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain(' and ');
  });

  it('multiple between with AND', () => {
    const r = ok({
      condition: '[a] between 1 and 10 and [b] between 20 and 30',
    });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain(' and ');
  });
});

describe('FormFilter — parseCondition logic', () => {
  // Simulate the parsing logic from FormFilter.tsx
  function parseSingleBetween(expr: string) {
    const m = expr.match(/^\s*\[([^\]]+)\]\s+between\s+(.+?)\s+(?:and|%%PH%%)\s+(.+?)\s*$/i);
    if (!m) return null;
    return { field: m[1], val1: m[2], val2: m[3] };
  }

  function splitConditionAnd(condition: string) {
    // Protect between segments
    const placeholders: string[] = [];
    const protected_ = condition.replace(
      /\[([^\]]+)\]\s+between\s+(.+?)\s+and\s+(.+?)(?=\s*(?:$|and\s|or\s))/gi,
      (_m, field, v1, v2) => {
        const idx = placeholders.length;
        placeholders.push(`[${field}] between ${v1} %%PH%% ${v2}`);
        return `__BETWEEN_${idx}__`;
      }
    );
    const tokens = protected_.split(/(\s+(?:and|or)\s+)/i);
    return tokens;
  }

  it('simple between is not split', () => {
    const tokens = splitConditionAnd('[date_col] between 2024-01-01 and 2024-12-31');
    // Should have only one expression token, no connective tokens
    expect(tokens.filter((t, i) => i % 2 === 0 && t.trim())).toHaveLength(1);
  });

  it('between with AND compound splits correctly', () => {
    const tokens = splitConditionAnd('[price] between 10 and 100 and [region] = "EU"');
    const exprs = tokens.filter((_, i) => i % 2 === 0 && tokens[i].trim());
    expect(exprs.length).toBeGreaterThanOrEqual(1);
  });

  it('parses between back via placeholder', () => {
    const r = parseSingleBetween('[date_col] between 2024-01-01 %%PH%% 2024-12-31');
    expect(r).not.toBeNull();
    expect(r!.field).toBe('date_col');
    expect(r!.val2).toBe('2024-12-31');
  });
});

describe('FormFilter — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { condition: '[revenue] > 0' },
      { condition: '[a] between 1 and 10 and [b] = "x"' },
      { condition: '[x] = "A" or [y] = "B"' },
      { condition: '[date] between 2024-01-01 and 2024-12-31' },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({ id: 't', type: 'filter', config });
      const parsed = parsePrepOperatorDsl(dsl1, 'filter');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'filter',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});

// ── formatConditionValue (type-aware quoting) ────────────────────────

describe('FormFilter — type-aware value formatting', () => {
  function isDslFieldRef(v: string) {
    return /^\[(?:`(?:[^`\\]|\\.)+`|[^\]]+)\](?:\.\[(?:`(?:[^`\\]|\\.)+`|[^\]]+)\])?$/.test(v);
  }
  function unwrap(v: string) {
    if (v.length < 2) return v;
    const f = v[0],
      l = v[v.length - 1];
    if (f !== l || (f !== '"' && f !== "'")) return v;
    if (f === '"') {
      try {
        return JSON.parse(v) as string;
      } catch {
        return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    return v.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  function isNum(v: string) {
    return /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(v);
  }
  function quote(v: string) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function fmt(v: string, colType?: string): string {
    const t = v.trim();
    if (!t) return t;
    if (isDslFieldRef(t)) return t;
    const u = unwrap(t);
    const lower = u.toLowerCase();
    if (lower === 'null') return 'null';
    if (colType === 'boolean' && /^(true|false)$/i.test(u)) return lower;
    if (
      (colType === 'number' ||
        colType === 'double' ||
        colType === 'integer' ||
        colType === 'decimal' ||
        colType === 'float') &&
      isNum(u)
    )
      return u;
    if (!colType && (/^(true|false)$/i.test(u) || isNum(u))) return u;
    return quote(u);
  }

  function build(
    rows: Array<{
      field: string;
      op: string;
      val1: string;
      val2?: string;
      connective?: string;
      colType?: string;
    }>
  ) {
    return rows
      .map((r, i) => {
        const f = (v: string) => fmt(v, r.colType);
        const expr =
          r.op === 'between' && r.val2
            ? `[${r.field}] between ${f(r.val1)} and ${f(r.val2)}`
            : `[${r.field}] ${r.op} ${f(r.val1)}`;
        return i === 0 ? expr : `${r.connective || 'and'} ${expr}`;
      })
      .join(' ');
  }

  it('numeric: numbers unquoted', () => {
    expect(build([{ field: 'a', op: '>', val1: '100', colType: 'double' }])).toBe('[a] > 100');
  });
  it('numeric: strings quoted', () => {
    expect(build([{ field: 'a', op: '=', val1: 'ABC', colType: 'double' }])).toBe('[a] = "ABC"');
  });
  it('text: numbers quoted', () => {
    expect(build([{ field: 'a', op: '=', val1: '123', colType: 'text' }])).toBe('[a] = "123"');
  });
  it('boolean: true/false unquoted', () => {
    expect(build([{ field: 'a', op: '=', val1: 'true', colType: 'boolean' }])).toBe('[a] = true');
  });
  it('field ref preserved', () => {
    expect(build([{ field: 'a', op: '=', val1: '[b]', colType: 'text' }])).toBe('[a] = [b]');
  });
  it('null literal unquoted', () => {
    expect(build([{ field: 'x', op: '=', val1: 'null', colType: 'text' }])).toBe('[x] = null');
  });
  it('between with numeric types', () => {
    expect(
      build([{ field: 'p', op: 'between', val1: '10', val2: '100', colType: 'decimal' }])
    ).toBe('[p] between 10 and 100');
  });
  it('unknown type: number unquoted', () => {
    expect(build([{ field: 'x', op: '=', val1: '42' }])).toBe('[x] = 42');
  });
  it('unknown type: string quoted', () => {
    expect(build([{ field: 'x', op: '=', val1: 'hi' }])).toBe('[x] = "hi"');
  });
  it('already-quoted unwrapped then re-quoted', () => {
    expect(build([{ field: 'x', op: '=', val1: '"hello"', colType: 'text' }])).toBe(
      '[x] = "hello"'
    );
  });
  it('quoteDslString escapes internal quotes', () => {
    expect(quote('he said "hello"')).toBe('"he said \\"hello\\""');
  });
  it('whitespace-only preserved', () => {
    expect(build([{ field: 'x', op: '=', val1: '   ', colType: 'text' }])).toBe('[x] =    ');
  });
});
