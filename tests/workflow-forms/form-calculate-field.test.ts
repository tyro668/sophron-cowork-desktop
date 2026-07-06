import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import {
  createCalculationRow,
  exprFromParts,
  needsCalculationIdNormalization,
  normalizeCalculationEntries,
  type CalculationRow,
} from '../../src/renderer/components/workflow-forms/shared/calculate-field';

function ok(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'calculate_field', config });
  const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, 'null operator').not.toBeNull();
  return parsed.operator!;
}

describe('FormCalculateField — config ↔ DSL', () => {
  it('single field derivation', () => {
    const r = ok({
      calculations: [{ field: 'margin', expression: '[revenue] - [cost]' }],
    });
    expect(r.config.calculations).toEqual([{ field: 'margin', expression: '[revenue] - [cost]' }]);
  });

  it('multiple calculations', () => {
    const r = ok({
      calculations: [
        { field: 'margin', expression: '[revenue] - [cost]' },
        { field: 'tax', expression: '[revenue] * 0.13' },
      ],
    });
    expect(r.config.calculations).toHaveLength(2);
    expect(r.config.calculations![1].field).toBe('tax');
  });

  it('expression with window function', () => {
    const dsl = 'derive [rn] = row_number() over(partition by [region] order by [amount] desc)';
    const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(parsed.operator!.config.calculations).toHaveLength(1);
    expect(parsed.operator!.config.calculations![0].field).toBe('rn');
    expect(parsed.operator!.config.calculations![0].expression).toContain('over(');
  });

  it('conditional expression', () => {
    const r = ok({
      calculations: [
        { field: 'ratio', expression: 'if [revenue] = 0 then 0 else [profit] / [revenue]' },
      ],
    });
    expect(r.config.calculations![0].expression).toContain('then');
  });

  it('empty calculations produces valid DSL', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'calculate_field',
      config: {},
    });
    expect(dsl).toContain('derive');
    const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('idempotent: single derivation', () => {
    const dsl1 = 'derive [margin] = [revenue] - [cost]';
    const parsed = parsePrepOperatorDsl(dsl1, 'calculate_field');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const dsl2 = exportPrepOperatorDsl({
      id: 'test',
      type: 'calculate_field',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });

  it('idempotent: complex expression with commas', () => {
    const dsl1 = "derive [full_name] = concat([first], ', ', [last])";
    const parsed = parsePrepOperatorDsl(dsl1, 'calculate_field');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const dsl2 = exportPrepOperatorDsl({
      id: 'test',
      type: 'calculate_field',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });
});

describe('FormCalculateField — id normalization', () => {
  it('preserves existing ids', () => {
    const rows = normalizeCalculationEntries([
      { id: 'calc_a', field: 'margin', expression: '[revenue] - [cost]' },
      { id: 'calc_b', field: 'tax', expression: '[revenue] * 0.13' },
    ]);

    expect(rows.map((row) => row.id)).toEqual(['calc_a', 'calc_b']);
    expect(needsCalculationIdNormalization(rows)).toBe(false);
  });

  it('fills missing ids and deduplicates repeats', () => {
    const rows = normalizeCalculationEntries([
      { field: 'margin', expression: '[revenue] - [cost]' },
      { id: 'calc_dup', field: 'tax', expression: '[revenue] * 0.13' },
      { id: 'calc_dup', field: 'profit', expression: '[margin] - [tax]' },
    ]);

    const ids = rows.map((row) => row.id);
    expect(rows).toHaveLength(3);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBe('calc_dup');
    expect(
      needsCalculationIdNormalization([
        { field: 'margin', expression: '[revenue] - [cost]' },
        { id: 'calc_dup', field: 'tax', expression: '[revenue] * 0.13' },
        { id: 'calc_dup', field: 'profit', expression: '[margin] - [tax]' },
      ])
    ).toBe(true);
  });

  it('creates a fresh row id for new rules', () => {
    const row = createCalculationRow();
    expect(typeof row.id).toBe('string');
    expect(row.id.length).toBeGreaterThan(0);
    expect(row.field).toBe('');
    expect(row.expression).toBe('');
  });
});

describe('FormCalculateField — exprFromParts', () => {
  it('count_distinct produces count(DISTINCT ...)', () => {
    const result = exprFromParts({
      id: 't1',
      field: 'unique_customers',
      expression: '',
      type: 'agg',
      fn: 'count_distinct',
      fnArg: '[customer_id]',
      partitionBy: ['region'],
    });
    expect(result).toContain('count(DISTINCT [customer_id])');
    expect(result).not.toContain('count_distinct');
    expect(result).toContain('OVER (PARTITION BY [region])');
  });

  it('regular agg fn produces fn(arg)', () => {
    const result = exprFromParts({
      id: 't2',
      field: 'total',
      expression: '',
      type: 'agg',
      fn: 'sum',
      fnArg: '[amount]',
      partitionBy: ['region'],
    });
    expect(result).toBe('sum([amount]) OVER (PARTITION BY [region])');
  });

  it('row mode returns bare expression', () => {
    const result = exprFromParts({
      id: 't3',
      field: 'margin',
      expression: '[revenue] - [cost]',
      type: 'row',
    });
    expect(result).toBe('[revenue] - [cost]');
  });

  it('window mode includes frame', () => {
    const result = exprFromParts({
      id: 't4',
      field: 'rn',
      expression: '',
      type: 'window',
      fn: 'row_number',
      partitionBy: ['region'],
      orderBy: [{ field: 'amount', direction: 'desc' }],
      frameStart: 'unbounded preceding',
      frameEnd: 'current row',
    });
    expect(result).toContain('OVER (');
    expect(result).toContain('PARTITION BY [region]');
    expect(result).toContain('ORDER BY [amount] desc');
    expect(result).toContain('ROWS BETWEEN unbounded preceding AND current row');
  });

  it('row mode ignores fn/partition even if set', () => {
    const result = exprFromParts({
      id: 't5',
      field: 'x',
      expression: '[a] + [b]',
      type: 'row',
      fn: 'sum',
      partitionBy: ['x'],
    });
    expect(result).toBe('[a] + [b]');
  });

  it('defaults fn to sum and arg to * when absent', () => {
    const result = exprFromParts({
      id: 't6',
      field: 'x',
      expression: '',
      type: 'agg',
      partitionBy: ['dept'],
    });
    expect(result).toBe('sum(*) OVER (PARTITION BY [dept])');
  });

  it('defaults frameEnd to current row', () => {
    const result = exprFromParts({
      id: 't7',
      field: 'moving_avg',
      expression: '',
      type: 'window',
      fn: 'avg',
      fnArg: '[amount]',
      orderBy: [{ field: 'dt', direction: 'asc' }],
      frameStart: 'unbounded preceding',
    });
    expect(result).toContain('current row');
  });
});

describe('FormCalculateField — agg/window DSL round-trip', () => {
  it('agg config round-trips via DSL', () => {
    const config = {
      calculations: [
        {
          field: 'total',
          expression: 'sum([amount]) over(partition by [region])',
          type: 'agg' as const,
          fn: 'sum' as const,
          fnArg: '[amount]',
          partitionBy: ['region'],
        },
      ],
    };
    const dsl = exportPrepOperatorDsl({ id: 'test', type: 'calculate_field', config });
    expect(dsl).toContain('derive');
    const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const calc = parsed.operator!.config.calculations![0];
    expect(calc.field).toBe('total');
    expect(calc.expression).toContain('sum(');
    expect(calc.expression).toContain('over(partition by [region])');
  });

  it('window config round-trips via DSL with frame', () => {
    const config = {
      calculations: [
        {
          field: 'rn',
          expression: 'row_number() over(partition by [region] order by [amount] desc)',
          type: 'window' as const,
          fn: 'row_number' as const,
          partitionBy: ['region'],
          orderBy: [{ field: 'amount', direction: 'desc' as const }],
          frameStart: 'unbounded preceding',
          frameEnd: 'current row',
        },
      ],
    };
    const dsl = exportPrepOperatorDsl({ id: 'test', type: 'calculate_field', config });
    const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const calc = parsed.operator!.config.calculations![0];
    expect(calc.field).toBe('rn');
    expect(calc.expression).toContain('row_number()');
    expect(calc.expression).toContain('over(partition by [region]');
    expect(calc.expression).toContain('order by [amount] desc');
  });

  it('percentage produces [arg] / sum([arg]) OVER (...) — no ORDER BY', () => {
    const result = exprFromParts({
      id: 'p1',
      field: 'pct',
      expression: '',
      type: 'agg',
      fn: 'percentage',
      fnArg: '[amount]',
      partitionBy: ['region'],
    });
    expect(result).toBe('[amount] / sum([amount]) OVER (PARTITION BY [region])');
  });

  it('percentage without partition uses empty OVER clause', () => {
    const result = exprFromParts({
      id: 'p2',
      field: 'pct',
      expression: '',
      type: 'agg',
      fn: 'percentage',
      fnArg: '[amount]',
    });
    expect(result).toBe('[amount] / sum([amount])');
  });

  it('period_mom_value produces value - lag(value, 1)', () => {
    const result = exprFromParts({
      id: 'pm1',
      field: 'mom',
      expression: '',
      type: 'agg',
      fn: 'period_mom_value',
      fnArg: '[amount]',
      partitionBy: ['dept'],
      orderBy: [{ field: 'month', direction: 'asc' }],
    });
    expect(result).toBe('[amount] - lag([amount], 1) OVER (PARTITION BY [dept] ORDER BY [month])');
  });

  it('period_mom_rate produces (value - lag(value, 1)) / lag(value, 1)', () => {
    const result = exprFromParts({
      id: 'pm2',
      field: 'mom_rate',
      expression: '',
      type: 'agg',
      fn: 'period_mom_rate',
      fnArg: '[amount]',
      partitionBy: ['dept'],
      orderBy: [{ field: 'month', direction: 'asc' }],
    });
    expect(result).toBe(
      '([amount] - lag([amount], 1) OVER (PARTITION BY [dept] ORDER BY [month])) / lag([amount], 1) OVER (PARTITION BY [dept] ORDER BY [month])'
    );
  });

  it('period_yoy_value produces value - lag(value, 12)', () => {
    const result = exprFromParts({
      id: 'py1',
      field: 'yoy',
      expression: '',
      type: 'agg',
      fn: 'period_yoy_value',
      fnArg: '[sales]',
      orderBy: [{ field: 'ym', direction: 'asc' }],
    });
    expect(result).toBe('[sales] - lag([sales], 12) OVER (ORDER BY [ym])');
  });

  it('period_yoy_rate produces (value - lag(value, 12)) / lag(value, 12)', () => {
    const result = exprFromParts({
      id: 'py2',
      field: 'yoy_rate',
      expression: '',
      type: 'agg',
      fn: 'period_yoy_rate',
      fnArg: '[sales]',
      orderBy: [{ field: 'ym', direction: 'asc' }],
    });
    expect(result).toBe(
      '([sales] - lag([sales], 12) OVER (ORDER BY [ym])) / lag([sales], 12) OVER (ORDER BY [ym])'
    );
  });

  // ── No-arg functions ──
  it('row_number() — no arguments', () => {
    const result = exprFromParts({
      id: 'n1',
      field: 'rn',
      expression: '',
      type: 'window',
      fn: 'row_number',
      partitionBy: ['region'],
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect(result).toBe('row_number() OVER (PARTITION BY [region] ORDER BY [id])');
  });

  it('rank() — no arguments', () => {
    const result = exprFromParts({
      id: 'n2',
      field: 'r',
      expression: '',
      type: 'window',
      fn: 'rank',
      fnArg: '[amount]',
      orderBy: [{ field: 'amount', direction: 'desc' }],
    });
    expect(result).toBe('rank() OVER (ORDER BY [amount] desc)');
  });

  it('dense_rank() — no arguments', () => {
    const result = exprFromParts({
      id: 'n3',
      field: 'dr',
      expression: '',
      type: 'window',
      fn: 'dense_rank',
      orderBy: [{ field: 'score', direction: 'desc' }],
    });
    expect(result).toBe('dense_rank() OVER (ORDER BY [score] desc)');
  });

  it('percent_rank() — no arguments', () => {
    const result = exprFromParts({
      id: 'n4',
      field: 'pr',
      expression: '',
      type: 'window',
      fn: 'percent_rank',
      orderBy: [{ field: 'amount', direction: 'asc' }],
    });
    expect(result).toBe('percent_rank() OVER (ORDER BY [amount])');
  });

  it('cume_dist() — no arguments', () => {
    const result = exprFromParts({
      id: 'n5',
      field: 'cd',
      expression: '',
      type: 'window',
      fn: 'cume_dist',
      partitionBy: ['region'],
      orderBy: [{ field: 'amount', direction: 'asc' }],
    });
    expect(result).toBe('cume_dist() OVER (PARTITION BY [region] ORDER BY [amount])');
  });

  // ── ntile ──
  it('ntile(4) — integer argument, strips brackets', () => {
    const result = exprFromParts({
      id: 'nt1',
      field: 'bucket',
      expression: '',
      type: 'window',
      fn: 'ntile',
      fnArg: '[4]',
      orderBy: [{ field: 'amount', direction: 'desc' }],
    });
    expect(result).toBe('ntile(4) OVER (ORDER BY [amount] desc)');
  });

  it('ntile(*) defaults to 4', () => {
    const result = exprFromParts({
      id: 'nt2',
      field: 'bucket',
      expression: '',
      type: 'window',
      fn: 'ntile',
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect(result).toBe('ntile(4) OVER (ORDER BY [id])');
  });

  // ── Basic aggregates ──
  it('sum([amount]) OVER (PARTITION BY region)', () => {
    const result = exprFromParts({
      id: 'a1',
      field: 'total',
      expression: '',
      type: 'agg',
      fn: 'sum',
      fnArg: '[amount]',
      partitionBy: ['region'],
    });
    expect(result).toBe('sum([amount]) OVER (PARTITION BY [region])');
  });

  it('min/max/count produce correct DSL', () => {
    for (const fn of ['min', 'max', 'count']) {
      const result = exprFromParts({
        id: 'a',
        field: 'r',
        expression: '',
        type: 'agg',
        fn,
        fnArg: '[amount]',
        partitionBy: ['region'],
      });
      expect(result).toBe(`${fn}([amount]) OVER (PARTITION BY [region])`);
    }
  });

  it('count_distinct produces count(DISTINCT [arg])', () => {
    const result = exprFromParts({
      id: 'a2',
      field: 'cnt',
      expression: '',
      type: 'agg',
      fn: 'count_distinct',
      fnArg: '[customer_id]',
      partitionBy: ['region'],
    });
    expect(result).toBe('count(DISTINCT [customer_id]) OVER (PARTITION BY [region])');
  });

  // ── Statistical aggregates ──
  it('median/stddev/var produce correct DSL', () => {
    for (const fn of ['median', 'stddev', 'var']) {
      const result = exprFromParts({
        id: 's',
        field: 'r',
        expression: '',
        type: 'agg',
        fn,
        fnArg: '[amount]',
        partitionBy: ['region'],
      });
      expect(result).toBe(`${fn}([amount]) OVER (PARTITION BY [region])`);
    }
  });

  it('mode([amount]) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'm1',
      field: 'm',
      expression: '',
      type: 'agg',
      fn: 'mode',
      fnArg: '[amount]',
    });
    expect(result).toBe('mode([amount])');
  });

  it('quantile_cont([amount], 0.5) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'q1',
      field: 'q',
      expression: '',
      type: 'agg',
      fn: 'quantile_cont',
      fnArg: '[amount]',
    });
    expect(result).toBe('quantile_cont([amount])');
  });

  it('product([amount]) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'p1',
      field: 'prod',
      expression: '',
      type: 'agg',
      fn: 'product',
      fnArg: '[amount]',
      partitionBy: ['region'],
    });
    expect(result).toBe('product([amount]) OVER (PARTITION BY [region])');
  });

  // ── Value functions ──
  it('first_value([amount]) OVER (...) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'v1',
      field: 'fv',
      expression: '',
      type: 'window',
      fn: 'first_value',
      fnArg: '[amount]',
      partitionBy: ['region'],
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toBe('first_value([amount]) OVER (PARTITION BY [region] ORDER BY [date])');
  });

  it('last_value([amount]) OVER (...) with frame', () => {
    const result = exprFromParts({
      id: 'v2',
      field: 'lv',
      expression: '',
      type: 'window',
      fn: 'last_value',
      fnArg: '[amount]',
      partitionBy: ['region'],
      orderBy: [{ field: 'date', direction: 'asc' }],
      frameStart: 'unbounded preceding',
      frameEnd: 'unbounded following',
    });
    expect(result).toBe(
      'last_value([amount]) OVER (PARTITION BY [region] ORDER BY [date]) ROWS BETWEEN unbounded preceding AND unbounded following'
    );
  });

  it('nth_value([amount], 2) OVER (...) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'v3',
      field: 'nv',
      expression: '',
      type: 'window',
      fn: 'nth_value',
      fnArg: '[amount]',
      orderBy: [{ field: 'date', direction: 'asc' }],
      frameStart: 'unbounded preceding',
      frameEnd: 'unbounded following',
    });
    expect(result).toBe(
      'nth_value([amount]) OVER (ORDER BY [date]) ROWS BETWEEN unbounded preceding AND unbounded following'
    );
  });

  // ── Offset functions ──
  it('lag([amount]) OVER (...) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'o1',
      field: 'prev',
      expression: '',
      type: 'window',
      fn: 'lag',
      fnArg: '[amount]',
      partitionBy: ['region'],
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toBe('lag([amount]) OVER (PARTITION BY [region] ORDER BY [date])');
  });

  it('lead([amount]) OVER (...) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'o2',
      field: 'next',
      expression: '',
      type: 'window',
      fn: 'lead',
      fnArg: '[amount]',
      partitionBy: ['region'],
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toBe('lead([amount]) OVER (PARTITION BY [region] ORDER BY [date])');
  });
});
