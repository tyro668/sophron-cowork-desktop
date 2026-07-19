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
    expect(row.frameStart).toBe('unbounded preceding');
    expect(row.frameEnd).toBe('unbounded following');
    expect(row.frameExclude).toBe('no others');
    expect(row.frameType).toBe('rows');
  });

  it('normalizes frameType — preserves range/groups', () => {
    const rows = normalizeCalculationEntries([
      { field: 'a', expression: '[x]', frameType: 'range' },
      { field: 'b', expression: '[y]', frameType: 'groups' },
    ]);
    expect(rows[0].frameType).toBe('range');
    expect(rows[1].frameType).toBe('groups');
  });

  it('normalizes frameType — rows is preserved', () => {
    const rows = normalizeCalculationEntries([
      { field: 'a', expression: '[x]', frameType: 'rows' },
    ]);
    expect(rows[0].frameType).toBe('rows');
  });

  it('normalizes frameType — missing becomes undefined', () => {
    const rows = normalizeCalculationEntries([{ field: 'a', expression: '[x]' }]);
    expect(rows[0].frameType).toBeUndefined();
  });

  it('normalizes frameExclude — preserves current row/group/ties', () => {
    const rows = normalizeCalculationEntries([
      { field: 'a', expression: '[x]', frameExclude: 'current row' },
      { field: 'b', expression: '[y]', frameExclude: 'group' },
      { field: 'c', expression: '[z]', frameExclude: 'ties' },
    ]);
    expect(rows[0].frameExclude).toBe('current row');
    expect(rows[1].frameExclude).toBe('group');
    expect(rows[2].frameExclude).toBe('ties');
  });

  it('normalizes frameExclude — no others / missing becomes undefined', () => {
    const rows = normalizeCalculationEntries([
      { field: 'a', expression: '[x]', frameExclude: 'no others' },
      { field: 'b', expression: '[y]' },
    ]);
    expect(rows[0].frameExclude).toBeUndefined();
    expect(rows[1].frameExclude).toBeUndefined();
  });

  it('normalizes frameStart/frameEnd — preserves strings', () => {
    const rows = normalizeCalculationEntries([
      { field: 'a', expression: '[x]', frameStart: 'unbounded preceding', frameEnd: 'current row' },
      {
        field: 'b',
        expression: '[y]',
        frameStart: 'INTERVAL 7 DAYS PRECEDING',
        frameEnd: 'unbounded following',
      },
    ]);
    expect(rows[0].frameStart).toBe('unbounded preceding');
    expect(rows[0].frameEnd).toBe('current row');
    expect(rows[1].frameStart).toBe('INTERVAL 7 DAYS PRECEDING');
    expect(rows[1].frameEnd).toBe('unbounded following');
  });

  it('normalizes fiscalStartMonth — preserves valid values', () => {
    const rows = normalizeCalculationEntries([
      { field: 'a', expression: '[x]', fiscalStartMonth: 4 },
      { field: 'b', expression: '[y]', fiscalStartMonth: 1 },
    ]);
    expect(rows[0].fiscalStartMonth).toBe(4);
    expect(rows[1].fiscalStartMonth).toBe(1);
  });

  it('normalizes fiscalStartMonth — out of range becomes undefined', () => {
    const rows = normalizeCalculationEntries([
      { field: 'a', expression: '[x]', fiscalStartMonth: 0 },
      { field: 'b', expression: '[y]', fiscalStartMonth: 13 },
    ]);
    expect(rows[0].fiscalStartMonth).toBeUndefined();
    expect(rows[1].fiscalStartMonth).toBeUndefined();
  });

  it('normalizes fiscalStartMonth — missing becomes undefined', () => {
    const rows = normalizeCalculationEntries([{ field: 'a', expression: '[x]' }]);
    expect(rows[0].fiscalStartMonth).toBeUndefined();
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

  it('cross mode sorted scenario includes ROWS BETWEEN', () => {
    const result = exprFromParts({
      id: 't8',
      field: 'running_sum',
      expression: '',
      type: 'cross',
      fn: 'sum',
      fnArg: '[amount]',
      orderBy: [{ field: 'id', direction: 'asc' }],
      frameStart: '1 preceding',
      frameEnd: 'current row',
    });
    expect(result).toContain('ROWS BETWEEN 1 preceding AND current row');
    expect(result).toContain('ORDER BY [id]');
    expect(result).toContain('sum([amount])');
  });

  it('range frame type produces RANGE BETWEEN', () => {
    const result = exprFromParts({
      id: 'ft1',
      field: 'range_sum',
      expression: '',
      type: 'cross',
      fn: 'sum',
      fnArg: '[amount]',
      orderBy: [{ field: 'price', direction: 'asc' }],
      frameType: 'range',
      frameStart: '100 preceding',
      frameEnd: '200 following',
    });
    expect(result).toContain('RANGE BETWEEN 100 preceding AND 200 following');
    expect(result).toContain('ORDER BY [price]');
  });

  it('groups frame type produces GROUPS BETWEEN', () => {
    const result = exprFromParts({
      id: 'ft2',
      field: 'group_avg',
      expression: '',
      type: 'cross',
      fn: 'avg',
      fnArg: '[score]',
      orderBy: [{ field: 'cat', direction: 'asc' }],
      frameType: 'groups',
      frameStart: '1 preceding',
      frameEnd: '1 following',
    });
    expect(result).toContain('GROUPS BETWEEN 1 preceding AND 1 following');
  });

  it('default frameType (undefined) produces ROWS BETWEEN', () => {
    const result = exprFromParts({
      id: 'ft3',
      field: 'rn',
      expression: '',
      type: 'window',
      fn: 'row_number',
      orderBy: [{ field: 'id', direction: 'asc' }],
      frameType: undefined,
      frameStart: 'unbounded preceding',
      frameEnd: 'current row',
    });
    expect(result).toContain('ROWS BETWEEN unbounded preceding AND current row');
  });

  it('INTERVAL format in frameStart passes through', () => {
    const result = exprFromParts({
      id: 'ft4',
      field: 'moving_avg',
      expression: '',
      type: 'cross',
      fn: 'avg',
      fnArg: '[mwh]',
      orderBy: [{ field: 'date', direction: 'asc' }],
      frameType: 'range',
      frameStart: 'INTERVAL 7 DAYS PRECEDING',
      frameEnd: 'current row',
    });
    expect(result).toContain('RANGE BETWEEN INTERVAL 7 DAYS PRECEDING AND current row');
  });

  it('EXCLUDE CURRENT ROW generates EXCLUDE clause', () => {
    const result = exprFromParts({
      id: 'ex1',
      field: 'neighbor_avg',
      expression: '',
      type: 'window',
      fn: 'avg',
      fnArg: '[score]',
      orderBy: [{ field: 'id', direction: 'asc' }],
      frameStart: '1 preceding',
      frameEnd: '1 following',
      frameExclude: 'current row',
    });
    expect(result).toContain('EXCLUDE CURRENT ROW');
    expect(result).toMatch(/ROWS BETWEEN.*EXCLUDE/);
  });

  it('EXCLUDE GROUP generates EXCLUDE clause', () => {
    const result = exprFromParts({
      id: 'ex2',
      field: 'grouped_avg',
      expression: '',
      type: 'window',
      fn: 'avg',
      fnArg: '[score]',
      orderBy: [{ field: 'cat', direction: 'asc' }],
      frameStart: 'unbounded preceding',
      frameEnd: 'unbounded following',
      frameExclude: 'group',
    });
    expect(result).toContain('EXCLUDE GROUP');
  });

  it('EXCLUDE TIES generates EXCLUDE clause', () => {
    const result = exprFromParts({
      id: 'ex3',
      field: 'ties_avg',
      expression: '',
      type: 'window',
      fn: 'avg',
      fnArg: '[score]',
      orderBy: [{ field: 'cat', direction: 'asc' }],
      frameStart: '1 preceding',
      frameEnd: '1 following',
      frameExclude: 'ties',
    });
    expect(result).toContain('EXCLUDE TIES');
  });

  it('EXCLUDE NO OTHERS does not generate EXCLUDE clause', () => {
    const result = exprFromParts({
      id: 'ex4',
      field: 'plain_avg',
      expression: '',
      type: 'window',
      fn: 'avg',
      fnArg: '[score]',
      orderBy: [{ field: 'id', direction: 'asc' }],
      frameStart: '1 preceding',
      frameEnd: '1 following',
      frameExclude: 'no others',
    });
    expect(result).not.toContain('EXCLUDE');
  });

  it('EXCLUDE undefined does not generate EXCLUDE clause', () => {
    const result = exprFromParts({
      id: 'ex5',
      field: 'plain_avg',
      expression: '',
      type: 'window',
      fn: 'avg',
      fnArg: '[score]',
      orderBy: [{ field: 'id', direction: 'asc' }],
      frameStart: '1 preceding',
      frameEnd: '1 following',
    });
    expect(result).not.toContain('EXCLUDE');
  });

  it('RANGE + INTERVAL + EXCLUDE CURRENT ROW full expression', () => {
    const result = exprFromParts({
      id: 'combo1',
      field: 'date_moving_avg',
      expression: '',
      type: 'cross',
      fn: 'avg',
      fnArg: '[mwh]',
      partitionBy: ['plant'],
      orderBy: [{ field: 'date', direction: 'asc' }],
      frameType: 'range',
      frameStart: 'INTERVAL 7 DAYS PRECEDING',
      frameEnd: 'current row',
      frameExclude: 'current row',
    });
    expect(result).toBe(
      'avg([mwh]) OVER (PARTITION BY [plant] ORDER BY [date] RANGE BETWEEN INTERVAL 7 DAYS PRECEDING AND current row EXCLUDE CURRENT ROW)'
    );
  });

  it('GROUPS + EXCLUDE TIES full expression', () => {
    const result = exprFromParts({
      id: 'combo2',
      field: 'group_moving_avg',
      expression: '',
      type: 'cross',
      fn: 'avg',
      fnArg: '[score]',
      partitionBy: ['dept'],
      orderBy: [{ field: 'level', direction: 'asc' }],
      frameType: 'groups',
      frameStart: '1 preceding',
      frameEnd: '1 following',
      frameExclude: 'ties',
    });
    expect(result).toBe(
      'avg([score]) OVER (PARTITION BY [dept] ORDER BY [level] GROUPS BETWEEN 1 preceding AND 1 following EXCLUDE TIES)'
    );
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

  it('percentage without partition uses OVER ()', () => {
    const result = exprFromParts({
      id: 'p2',
      field: 'pct',
      expression: '',
      type: 'agg',
      fn: 'percentage',
      fnArg: '[amount]',
    });
    expect(result).toBe('[amount] / sum([amount]) OVER ()');
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

  it('offset_diff produces value - lag(value, N) with custom N', () => {
    const result = exprFromParts({
      id: 'od1',
      field: 'diff',
      expression: '',
      type: 'agg',
      fn: 'offset_diff',
      fnArg: '[amount]',
      fnArg2: '3',
      partitionBy: ['dept'],
      orderBy: [{ field: 'month', direction: 'asc' }],
    });
    expect(result).toBe('[amount] - lag([amount], 3) OVER (PARTITION BY [dept] ORDER BY [month])');
  });

  it('offset_rate produces (value - lag(value, N)) / lag(value, N) with custom N', () => {
    const result = exprFromParts({
      id: 'or1',
      field: 'rate',
      expression: '',
      type: 'agg',
      fn: 'offset_rate',
      fnArg: '[sales]',
      fnArg2: '6',
      orderBy: [{ field: 'month', direction: 'asc' }],
    });
    expect(result).toBe(
      '([sales] - lag([sales], 6) OVER (ORDER BY [month])) / lag([sales], 6) OVER (ORDER BY [month])'
    );
  });

  it('offset_diff defaults to N=1 when fnArg2 is empty', () => {
    const result = exprFromParts({
      id: 'od2',
      field: 'diff',
      expression: '',
      type: 'agg',
      fn: 'offset_diff',
      fnArg: '[amount]',
      orderBy: [{ field: 'month', direction: 'asc' }],
    });
    expect(result).toBe('[amount] - lag([amount], 1) OVER (ORDER BY [month])');
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
  it('ntile(4) — integer argument', () => {
    const result = exprFromParts({
      id: 'nt1',
      field: 'bucket',
      expression: '',
      type: 'window',
      fn: 'ntile',
      fnArg: '4',
      orderBy: [{ field: 'amount', direction: 'desc' }],
    });
    expect(result).toBe('ntile(4) OVER (ORDER BY [amount] desc)');
  });

  it('ntile with empty arg produces ntile()', () => {
    const result = exprFromParts({
      id: 'nt2',
      field: 'bucket',
      expression: '',
      type: 'window',
      fn: 'ntile',
      orderBy: [{ field: 'id', direction: 'asc' }],
    });
    expect(result).toBe('ntile() OVER (ORDER BY [id])');
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
    const sqlMap: Record<string, string> = { var: 'var_pop' };
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
      const sqlFn = sqlMap[fn] || fn;
      expect(result).toBe(`${sqlFn}([amount]) OVER (PARTITION BY [region])`);
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
    expect(result).toBe('mode([amount]) OVER ()');
  });

  it('quantile_cont([amount], 0.5) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'q1',
      field: 'q',
      expression: '',
      type: 'agg',
      fn: 'quantile_cont',
      fnArg: '[amount]',
      fnArg2: '0.5',
    });
    expect(result).toBe('quantile_cont([amount], 0.5) OVER ()');
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

  // ── String / Boolean functions ──
  it('string_agg([col]) OVER (PARTITION BY ...) produces correct DSL', () => {
    const result = exprFromParts({
      id: 's1',
      field: 'concatenated',
      expression: '',
      type: 'agg',
      fn: 'string_agg',
      fnArg: '[col]',
      partitionBy: ['region'],
    });
    expect(result).toBe('string_agg([col]) OVER (PARTITION BY [region])');
  });

  it('bool_and([flag]) OVER (PARTITION BY ...) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'b1',
      field: 'all_ok',
      expression: '',
      type: 'agg',
      fn: 'bool_and',
      fnArg: '[flag]',
      partitionBy: ['region'],
    });
    expect(result).toBe('bool_and([flag]) OVER (PARTITION BY [region])');
  });

  it('bool_or([flag]) OVER (PARTITION BY ...) produces correct DSL', () => {
    const result = exprFromParts({
      id: 'b2',
      field: 'any_ok',
      expression: '',
      type: 'agg',
      fn: 'bool_or',
      fnArg: '[flag]',
      partitionBy: ['region'],
    });
    expect(result).toBe('bool_or([flag]) OVER (PARTITION BY [region])');
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
      'last_value([amount]) OVER (PARTITION BY [region] ORDER BY [date] ROWS BETWEEN unbounded preceding AND unbounded following)'
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
      fnArg2: '2',
      orderBy: [{ field: 'date', direction: 'asc' }],
      frameStart: 'unbounded preceding',
      frameEnd: 'unbounded following',
    });
    expect(result).toBe(
      'nth_value([amount], 2) OVER (ORDER BY [date] ROWS BETWEEN unbounded preceding AND unbounded following)'
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

  // ── Time intelligence ──
  it('ytd_sum generates year partition', () => {
    const result = exprFromParts({
      id: 'ti1',
      field: 'ytd',
      expression: '',
      type: 'cross',
      fn: 'ytd_sum',
      fnArg: '[sales]',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('PARTITION BY year([date])');
    expect(result).toContain('sum([sales])');
    expect(result).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
  });

  it('qtd_avg generates year and quarter partition', () => {
    const result = exprFromParts({
      id: 'ti2',
      field: 'qtd',
      expression: '',
      type: 'cross',
      fn: 'qtd_avg',
      fnArg: '[sales]',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('PARTITION BY year([date]), quarter([date])');
    expect(result).toContain('avg([sales])');
  });

  it('mtd_count generates year and month partition', () => {
    const result = exprFromParts({
      id: 'ti3',
      field: 'mtd',
      expression: '',
      type: 'cross',
      fn: 'mtd_count',
      fnArg: '[sales]',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('PARTITION BY year([date]), month([date])');
    expect(result).toContain('count([sales])');
  });

  it('wtd_sum generates year and week partition', () => {
    const result = exprFromParts({
      id: 'ti4',
      field: 'wtd',
      expression: '',
      type: 'cross',
      fn: 'wtd_sum',
      fnArg: '[sales]',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('PARTITION BY year([date]), week([date])');
  });

  it('rolling_year_sum generates RANGE BETWEEN INTERVAL', () => {
    const result = exprFromParts({
      id: 'ti5',
      field: 'ry',
      expression: '',
      type: 'cross',
      fn: 'rolling_year_sum',
      fnArg: '[sales]',
      fnArg2: '3',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('RANGE BETWEEN INTERVAL 3 YEAR PRECEDING AND CURRENT ROW');
    expect(result).not.toContain('PARTITION BY');
  });

  it('rolling_day_sum generates RANGE BETWEEN INTERVAL N DAY', () => {
    const result = exprFromParts({
      id: 'ti6',
      field: 'rd',
      expression: '',
      type: 'cross',
      fn: 'rolling_day_sum',
      fnArg: '[sales]',
      fnArg2: '7',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('RANGE BETWEEN INTERVAL 7 DAY PRECEDING AND CURRENT ROW');
  });

  it('rolling_week_avg generates RANGE BETWEEN INTERVAL N WEEK', () => {
    const result = exprFromParts({
      id: 'ti7',
      field: 'rw',
      expression: '',
      type: 'cross',
      fn: 'rolling_week_avg',
      fnArg: '[sales]',
      fnArg2: '4',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('RANGE BETWEEN INTERVAL 4 WEEK PRECEDING AND CURRENT ROW');
  });

  it('ytd_min works with min aggregate', () => {
    const result = exprFromParts({
      id: 'ti8',
      field: 'ymin',
      expression: '',
      type: 'cross',
      fn: 'ytd_min',
      fnArg: '[amount]',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('min([amount])');
    expect(result).toContain('PARTITION BY year([date])');
  });

  it('ytd_max works with max aggregate', () => {
    const result = exprFromParts({
      id: 'ti9',
      field: 'ymax',
      expression: '',
      type: 'cross',
      fn: 'ytd_max',
      fnArg: '[amount]',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('max([amount])');
  });

  it('ytd_distinct_count generates count(DISTINCT ...)', () => {
    const result = exprFromParts({
      id: 'ti10',
      field: 'yuniq',
      expression: '',
      type: 'cross',
      fn: 'ytd_distinct_count',
      fnArg: '[customer_id]',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('count(DISTINCT [customer_id])');
    expect(result).not.toContain('distinct_count(');
  });

  it('fiscal year YTD uses CASE WHEN month >= N', () => {
    const result = exprFromParts({
      id: 'ti11',
      field: 'fy',
      expression: '',
      type: 'cross',
      fn: 'ytd_sum',
      fnArg: '[sales]',
      orderBy: [{ field: 'date', direction: 'asc' }],
      fiscalStartMonth: 4,
    });
    expect(result).toContain(
      'CASE WHEN month([date]) >= 4 THEN year([date]) ELSE year([date]) - 1 END'
    );
    expect(result).not.toContain('PARTITION BY year([');
  });

  it('fiscal year start month 1 behaves as regular YTD', () => {
    const result = exprFromParts({
      id: 'ti12',
      field: 'fy2',
      expression: '',
      type: 'cross',
      fn: 'ytd_sum',
      fnArg: '[sales]',
      orderBy: [{ field: 'date', direction: 'asc' }],
      fiscalStartMonth: 1,
    });
    expect(result).toContain('PARTITION BY year([date])');
    expect(result).not.toContain('CASE');
  });

  it('ytd includes extra partition fields', () => {
    const result = exprFromParts({
      id: 'ti13',
      field: 'ytd_cat',
      expression: '',
      type: 'cross',
      fn: 'ytd_sum',
      fnArg: '[sales]',
      partitionBy: ['category'],
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('PARTITION BY year([date]), [category]');
  });

  it('rolling_year ignores fiscalStartMonth', () => {
    const result = exprFromParts({
      id: 'ti14',
      field: 'ryf',
      expression: '',
      type: 'cross',
      fn: 'rolling_year_sum',
      fnArg: '[sales]',
      fnArg2: '2',
      orderBy: [{ field: 'date', direction: 'asc' }],
      fiscalStartMonth: 4,
    });
    // rolling is not affected by fiscal start month
    expect(result).toContain('RANGE BETWEEN INTERVAL 2 YEAR PRECEDING');
    expect(result).not.toContain('CASE');
  });

  it('rolling_month_sum generates RANGE BETWEEN INTERVAL N MONTH', () => {
    const result = exprFromParts({
      id: 'ti15',
      field: 'rm',
      expression: '',
      type: 'cross',
      fn: 'rolling_month_sum',
      fnArg: '[sales]',
      fnArg2: '6',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('RANGE BETWEEN INTERVAL 6 MONTH PRECEDING AND CURRENT ROW');
  });

  it('rolling_year_sum with partitionBy adds extra partition', () => {
    const result = exprFromParts({
      id: 'ti16',
      field: 'ryp',
      expression: '',
      type: 'cross',
      fn: 'rolling_year_sum',
      fnArg: '[sales]',
      fnArg2: '2',
      partitionBy: ['category'],
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('RANGE BETWEEN INTERVAL 2 YEAR PRECEDING');
    expect(result).toContain('PARTITION BY [category]');
  });

  it('ytd_sum without orderBy falls back to OVER ()', () => {
    const result = exprFromParts({
      id: 'ti17',
      field: 'ytd_no',
      expression: '',
      type: 'cross',
      fn: 'ytd_sum',
      fnArg: '[sales]',
    });
    expect(result).toBe('sum([sales]) OVER ()');
  });

  it('rolling_year_distinct_count generates count(DISTINCT ...)', () => {
    const result = exprFromParts({
      id: 'ti18',
      field: 'rydc',
      expression: '',
      type: 'cross',
      fn: 'rolling_year_distinct_count',
      fnArg: '[customer_id]',
      fnArg2: '2',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('count(DISTINCT [customer_id])');
    expect(result).toContain('RANGE BETWEEN INTERVAL 2 YEAR PRECEDING');
  });

  it('ytd_count with * produces count(*)', () => {
    const result = exprFromParts({
      id: 'ti19',
      field: 'ytd_star',
      expression: '',
      type: 'cross',
      fn: 'ytd_count',
      orderBy: [{ field: 'date', direction: 'asc' }],
    });
    expect(result).toContain('count(*)');
    expect(result).toContain('PARTITION BY year([date])');
  });
});
