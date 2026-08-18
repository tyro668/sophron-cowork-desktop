import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import type { CalculationConfigEntry } from '../../src/renderer/components/workflow-forms/shared/calculate-field';
import {
  createCalculationRow,
  normalizeCalculationEntries,
} from '../../src/renderer/components/workflow-forms/shared/calculate-field';

interface OkResult {
  config: Record<string, unknown> & { calculations?: CalculationConfigEntry[] };
}

function ok(config: Record<string, unknown>): OkResult {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'calculate_field', config });
  const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, 'null operator').not.toBeNull();
  return { config: parsed.operator!.config };
}

describe('FormCalculateField 锟?config 锟?DSL', () => {
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
    const calculations = parsed.operator!.config.calculations as Array<Record<string, unknown>>;
    expect(calculations).toHaveLength(1);
    expect(calculations[0].field).toBe('rn');
    expect(calculations[0].expression).toContain('over(');
  });

  it('conditional expression', () => {
    const r = ok({
      calculations: [
        { field: 'ratio', expression: 'if [revenue] = 0 then 0 else [profit] / [revenue]' },
      ],
    });
    expect(r.config.calculations![0].expression).toContain('then');
  });

  it('empty calculations does not produce DSL', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'calculate_field',
      config: {},
    });
    expect(dsl).toBe('');
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

  it.each([
    'derive [previous_sales] = previous_value([sales], [date]) over(partition by [region])',
    'derive [yoy_sales] = year_over_year_value([sales], [date], "month") over(partition by [region])',
    'derive [year_sales] = year_to_date(sum([sales]), [date], 4) over(partition by [region])',
    'derive [rolling_sales] = rolling_time(avg([sales]), [date], 7, "day") over(partition by [region])',
    'derive [prev_sales] = lag([sales]) over(partition by [region] order by [date])',
    'derive [next_sales] = lead([sales], 2) over(partition by [region] order by [date])',
    'derive [first_sales] = first_value([sales]) over(order by [date])',
    'derive [last_sales] = last_value([sales]) over(partition by [region] order by [date])',
    'derive [nth_sales] = nth_value([sales], 3) over(order by [date])',
    'derive [sales_diff] = offset_difference([sales], 2) over(partition by [region] order by [amount] desc, [date])',
    'derive [sales_rate] = offset_rate([sales], 2) over(partition by [region] order by [date])',
    'derive [group_sales] = group_sum([sales]) over(partition by [region])',
    'derive [group_names] = group_string_agg([name], ", ") over(partition by [region])',
    'derive [cum_sales] = cumulative_sum([sales]) over(partition by [region] order by [date])',
    'derive [mov_sales] = moving_avg([sales]) over(partition by [region] order by [date] rows between 1 preceding and current row)',
    'derive [mov_range] = moving_sum([sales]) over(order by [date] range between interval 7 "day" preceding and current row)',
    'derive [rn] = row_number() over(partition by [region] order by [amount] desc)',
    'derive [ranked] = rank() over(order by [amount] desc, [date])',
    'derive [dense] = dense_rank() over(partition by [region] order by [amount])',
    'derive [pct] = percent_rank() over(order by [amount])',
    'derive [cume] = cume_dist() over(partition by [region] order by [amount])',
    'derive [bucket] = ntile(4) over(order by [amount] desc)',
  ])('round-trips canonical calculation domain DSL: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

    expect(
      exportPrepOperatorDsl({
        id: 'test',
        type: 'calculate_field',
        config: parsed.operator!.config,
      })
    ).toBe(dsl);
  });

  it('normalizes calculation domain function spacing on export', () => {
    const parsed = parsePrepOperatorDsl(
      'derive [x] = year_over_year_value( [sales] , [date] , "month" ) over( partition by [region] )',
      'calculate_field'
    );

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(
      exportPrepOperatorDsl({
        id: 'test',
        type: 'calculate_field',
        config: parsed.operator!.config,
      })
    ).toBe(
      'derive [x] = year_over_year_value([sales], [date], "month") over(partition by [region])'
    );
  });

  it.each([
    'derive [x] = previous_value([sales])',
    'derive [x] = year_over_year_value([sales], [date], "months")',
    'derive [x] = year_to_date([sales], [date])',
    'derive [x] = quarter_to_date(sum([sales]), [date], 4)',
    'derive [x] = rolling_time(sum([sales]), [date], 0, "day")',
    'derive [x] = rolling_time(sum([sales]), [date], 7, "hour")',
    'derive [x] = year_to_date(sum([sales]), [date]) over(order by [date])',
    'derive [x] = year_to_date(sum([sales])), [date])',
    'derive [x] = year_to_date(sum([sales]), [date]) extra',
    'derive [x] = year_to_date(sum([sales]), [date]);',
    'derive [x] = year_to_date(sum([sales]), [date]',
    'derive [x] = cumulative_sum([sales]) over(order by [date] rows between 1 preceding and current row)',
    'derive [x] = moving_avg([sales]) over(order by [date])',
    'derive [x] = moving_avg([sales]) over(order by [date] rows between 1 following and current row)',
    'derive [x] = group_quantile_cont([sales]) over(partition by [region])',
    'derive [x] = group_quantile_cont([sales], 3) over(partition by [region])',
    'derive [x] = group_string_agg([name], ", ") extra',
    'derive [x] = lag([sales]) over(order by [date] rows between 1 preceding and current row)',
    'derive [x] = moving_avg([sales]) over(order by date)',
    'derive [x] = moving_avg([sales]) over(order by [date] rows between 2 preceding and 10 preceding)',
    'derive [x] = rank() over(partition by [region])',
    'derive [x] = rank() over(order by [date] rows between 1 preceding and current row)',
    'derive [x] = ntile() over(order by [date])',
    'derive [x] = ntile(0) over(order by [date])',
    'derive [x] = row_number(2) over(order by [date])',
  ])('rejects invalid calculation domain DSL: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).not.toEqual(
      []
    );
  });

  it.each([
    'derive [x] = year_to_date(sum([sales]), [date]) over(partition by [region] [product])',
    'derive [x] = year_to_date(sum([sales]), [date]) over(partition by , [region])',
    'derive [x] = year_to_date(sum([sales]), [date]) over(partition by [region],)',
    'derive [x] = year_to_date(sum([sales]), [date]) over(partition by [region],, [product])',
    'derive [x] = year_to_date(sum([sales]), [date]) over(partition by [region]',
  ])('rejects malformed domain partition lists: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'calculate_field');

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).not.toEqual(
      []
    );
  });
});
describe('FormCalculateField - id normalization', () => {
  it('preserves existing ids', () => {
    const rows = normalizeCalculationEntries([
      { id: 'calc_a', field: 'margin', expression: '[revenue] - [cost]' },
      { id: 'calc_b', field: 'tax', expression: '[revenue] * 0.13' },
    ]);

    expect(rows.map((row) => row.id)).toEqual(['calc_a', 'calc_b']);
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
  });

  it('creates a fresh row id for new rules', () => {
    const row = createCalculationRow();
    expect(typeof row.id).toBe('string');
    expect(row.id.length).toBeGreaterThan(0);
    expect(row.field).toBe('');
    expect(row.expression).toBe('');
    expect(row.action).toBe('add');
  });

  it('normalizes malformed current fields without crashing the form', () => {
    const malformed = [
      { id: 42, field: null, expression: false, action: 'unsupported' },
    ] as unknown as CalculationConfigEntry[];

    const [row] = normalizeCalculationEntries(malformed, ['amount']);

    expect(row.id).toBeTruthy();
    expect(row.field).toBe('');
    expect(row.expression).toBe('');
    expect(row.action).toBe('add');
  });
});

describe('FormCalculateField - unified expression migration', () => {
  it('keeps ordinary expressions and infers missing actions', () => {
    expect(
      normalizeCalculationEntries([
        { id: 'calc_margin', field: 'margin', expression: '[revenue] - [cost]' },
      ])
    ).toEqual([
      {
        id: 'calc_margin',
        field: 'margin',
        expression: '[revenue] - [cost]',
        action: 'add',
      },
    ]);
  });

  it('infers missing actions from source fields without overriding explicit actions', () => {
    const calculations = normalizeCalculationEntries(
      [
        { field: 'Amount', expression: '[Amount] * 2' },
        { field: 'margin', expression: '[revenue] - [cost]' },
        { field: 'Revenue', expression: '[Revenue] * 1.1', action: 'add' },
      ],
      ['amount', 'revenue', 'cost']
    );

    expect(calculations.map((calculation) => calculation.action)).toEqual([
      'replace',
      'add',
      'add',
    ]);
  });

  it('restores the canonical source field casing when replacing', () => {
    const [calculation] = normalizeCalculationEntries(
      [{ field: 'AMOUNT', expression: '[amount] * 2' }],
      ['Amount']
    );
    expect(calculation.action).toBe('replace');
    expect(calculation.field).toBe('Amount');
  });

  it('keeps an explicit field casing when the target does not match a source field', () => {
    const [calculation] = normalizeCalculationEntries(
      [{ field: 'GROSS_MARGIN', expression: '[revenue] - [cost]' }],
      ['revenue', 'cost']
    );
    expect(calculation.action).toBe('add');
    expect(calculation.field).toBe('GROSS_MARGIN');
  });

  it('preserves multiple calculations in list order', () => {
    const calculations = normalizeCalculationEntries([
      { field: 'margin', expression: '[revenue] - [cost]' },
      { field: 'rank', expression: 'rank() over(order by [revenue] desc)' },
    ]);

    expect(calculations.map(({ field, expression }) => ({ field, expression }))).toEqual([
      { field: 'margin', expression: '[revenue] - [cost]' },
      { field: 'rank', expression: 'rank() over(order by [revenue] desc)' },
    ]);
  });
});
