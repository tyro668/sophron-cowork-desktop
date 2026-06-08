import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
  const type = 'missing_value' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormMissingValue — config ↔ DSL', () => {
  it('drop empty rows', () => {
    const r = ok({ strategy: 'drop_empty_rows' });
    expect(r.dsl).toContain('row drop when all_null');
    expect(r.config.strategy).toBe('drop_empty_rows');
  });

  it('drop rows by any null', () => {
    const r = ok({ strategy: 'drop_rows_by_nulls', condition: 'any_null' });
    expect(r.dsl).toContain('row drop when any_null');
    expect(r.config.condition).toBe('any_null');
  });

  it('drop rows by any null with specific columns', () => {
    const r = ok({
      strategy: 'drop_rows_by_nulls',
      condition: 'any_null',
      columns: ['id', 'name'],
    });
    expect(r.dsl).toContain('in [id]');
    expect(r.config.columns).toEqual(['id', 'name']);
  });

  it('by_column: skip', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ column: 'field', method: 'skip' }],
    });
    expect(r.dsl).toContain('skip');
    expect(r.config.rules).toHaveLength(1);
  });

  it('by_column: nullify values', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ column: 'region', method: 'nullify_values', values: ['', 'N/A'] }],
    });
    expect(r.dsl).toContain('nullify values');
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules[0].method).toBe('nullify_values');
  });

  it('by_column: literal fill', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ column: 'region', method: 'literal_fill', value: 'UNKNOWN' }],
    });
    expect(r.dsl).toContain('fill');
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules[0].value).toBe('UNKNOWN');
  });

  it('by_column: mean fill', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ column: 'revenue', method: 'mean_fill' }],
    });
    expect(r.dsl).toContain('fill mean');
  });

  it('by_column: forward fill', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ column: 'event_time', method: 'forward_fill' }],
    });
    expect(r.dsl).toContain('fill forward');
  });

  it('by_column: drop rows for column', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ column: 'page_id', method: 'drop' }],
    });
    expect(r.dsl).toContain('drop rows');
  });

  it('by_column: multiple rules', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [
        { column: 'region', method: 'nullify_values', values: ['', 'N/A'] },
        { column: 'region', method: 'literal_fill', value: 'UNKNOWN' },
        { column: 'revenue', method: 'mean_fill' },
      ],
    });
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules).toHaveLength(3);
    expect(rules[0].method).toBe('nullify_values');
    expect(rules[1].method).toBe('literal_fill');
    expect(rules[2].method).toBe('mean_fill');
  });

  it('by_column: empty rules produces minimal DSL', () => {
    const r = ok({ strategy: 'by_column', rules: [] });
    expect(r.dsl).toBeDefined();
  });
});

describe('FormMissingValue — method filtering logic', () => {
  // Simulate methodsForType from FormMissingValue
  const BASE_METHODS = ['skip', 'nullify_values', 'literal_fill', 'drop'];
  const STATISTICAL_METHODS = ['mean_fill', 'median_fill', 'mode_fill'];
  const ORDERED_METHODS = ['forward_fill', 'backward_fill'];

  function methodsForType(colType: string | undefined): string[] {
    if (!colType) return BASE_METHODS;
    const t = colType.toLowerCase();
    const isNumeric =
      t.includes('int') ||
      t.includes('float') ||
      t.includes('double') ||
      t.includes('decimal') ||
      t.includes('numeric') ||
      t.includes('real') ||
      t.includes('number');
    const isTemporal = t.includes('date') || t.includes('time') || t.includes('timestamp');
    if (isNumeric) return [...BASE_METHODS, ...ORDERED_METHODS, ...STATISTICAL_METHODS];
    if (isTemporal) return [...BASE_METHODS, ...ORDERED_METHODS];
    return BASE_METHODS;
  }

  it('numeric type gets all methods', () => {
    const m = methodsForType('DOUBLE');
    expect(m).toContain('mean_fill');
    expect(m).toContain('median_fill');
    expect(m).toContain('forward_fill');
  });

  it('string type gets only base methods', () => {
    const m = methodsForType('VARCHAR');
    expect(m).not.toContain('mean_fill');
    expect(m).not.toContain('forward_fill');
    expect(m).toContain('literal_fill');
  });

  it('date type gets base + ordered but no statistical', () => {
    const m = methodsForType('DATE');
    expect(m).toContain('forward_fill');
    expect(m).not.toContain('mean_fill');
    expect(m).toContain('literal_fill');
  });

  it('boolean type gets only base', () => {
    const m = methodsForType('BOOLEAN');
    expect(m).not.toContain('mean_fill');
    expect(m).not.toContain('forward_fill');
  });

  it('timestamp type gets base + ordered', () => {
    const m = methodsForType('TIMESTAMP');
    expect(m).toContain('forward_fill');
    expect(m).not.toContain('mean_fill');
  });

  it('unknown type gets base only', () => {
    const m = methodsForType(undefined);
    expect(m).toEqual(BASE_METHODS);
  });
});

describe('FormMissingValue — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { strategy: 'drop_empty_rows' },
      { strategy: 'drop_rows_by_nulls', condition: 'any_null', columns: ['id'] },
      { strategy: 'by_column', rules: [{ column: 'r', method: 'literal_fill', value: 'X' }] },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({
        id: 't',
        type: 'missing_value',
        config,
      });
      const parsed = parsePrepOperatorDsl(dsl1, 'missing_value');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'missing_value',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});
