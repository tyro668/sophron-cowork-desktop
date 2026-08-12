import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import type { CalculationConfigEntry } from '../../src/renderer/components/workflow-forms/shared/calculate-field';
import {
  createCalculationRow,
  normalizeCalculationEntries,
  normalizeExpressionCalculationEntries,
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
});

describe('FormCalculateField — id normalization', () => {
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

describe('FormCalculateField — unified expression migration', () => {
  it('keeps ordinary expressions and removes legacy structured state', () => {
    expect(
      normalizeExpressionCalculationEntries([
        {
          id: 'calc_margin',
          field: 'margin',
          expression: '[revenue] - [cost]',
          type: 'row',
          scenario: 'group_metrics',
        },
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

  it('materializes a legacy structured window calculation as expression text', () => {
    const [calculation] = normalizeExpressionCalculationEntries([
      {
        id: 'calc_rank',
        field: 'rank',
        expression: '',
        type: 'cross',
        fn: 'dense_rank',
        partitionBy: ['region'],
        orderBy: [{ field: 'amount', direction: 'desc' }],
      },
    ]);

    expect(calculation).toEqual({
      id: 'calc_rank',
      field: 'rank',
      expression: 'dense_rank() OVER (PARTITION BY [region] ORDER BY [amount] desc)',
      action: 'add',
    });
  });

  it('materializes a legacy string aggregation with a valid quoted delimiter', () => {
    const [calculation] = normalizeExpressionCalculationEntries([
      {
        id: 'calc_names',
        field: 'names',
        expression: '',
        type: 'cross',
        fn: 'string_agg',
        fnArg: 'name',
        fnArg2: "it's, ",
        partitionBy: ['region'],
      },
    ]);

    expect(calculation.expression).toBe(
      "string_agg([name], 'it''s, ') OVER (PARTITION BY [region])"
    );
  });

  it('infers missing actions from source fields without overriding explicit actions', () => {
    const calculations = normalizeExpressionCalculationEntries(
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

  it('preserves multiple calculations in list order', () => {
    const calculations = normalizeExpressionCalculationEntries([
      { field: 'margin', expression: '[revenue] - [cost]' },
      { field: 'rank', expression: 'rank() over(order by [revenue] desc)' },
    ]);

    expect(calculations.map(({ field, expression }) => ({ field, expression }))).toEqual([
      { field: 'margin', expression: '[revenue] - [cost]' },
      { field: 'rank', expression: 'rank() over(order by [revenue] desc)' },
    ]);
  });
});
