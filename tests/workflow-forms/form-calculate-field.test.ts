import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import {
  createCalculationRow,
  needsCalculationIdNormalization,
  normalizeCalculationEntries,
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
