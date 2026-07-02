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
});
