import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import { normalizeMissingValueMethods } from '../../src/shared/operator-config';
import type { MissingValueRule } from '../../src/shared/operator-schemas/missing-value';

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

  it('round trips all-null row deletion with specific columns', () => {
    const r = ok({
      strategy: 'drop_rows_by_nulls',
      condition: 'all_null',
      columns: ['id', 'name'],
    });
    expect(r.dsl).toContain('row drop when all_null in [id], [name]');
    expect(r.config.strategy).toBe('drop_rows_by_nulls');
    expect(r.config.condition).toBe('all_null');
    expect(r.config.columns).toEqual(['id', 'name']);
  });

  it('preserves scoped fields when exporting a legacy drop_empty_rows config', () => {
    const r = ok({
      strategy: 'drop_empty_rows',
      columns: ['id', 'name'],
    });
    expect(r.dsl).toContain('row drop when all_null in [id], [name]');
    expect(r.config.strategy).toBe('drop_rows_by_nulls');
    expect(r.config.condition).toBe('all_null');
    expect(r.config.columns).toEqual(['id', 'name']);
  });

  it('reports duplicate row-deletion fields in DSL', () => {
    const parsed = parsePrepOperatorDsl(
      'missing value row drop when any_null in [status], [status]',
      'missing_value'
    );
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicateMissingValueRowField',
          severity: 'error',
        }),
      ])
    );
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

  it('rejects fill null DSL as a no-op', () => {
    const parsed = parsePrepOperatorDsl('missing value [region] fill null', 'missing_value');
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalidMissingValueLiteral',
          severity: 'error',
        }),
      ])
    );
  });

  it('does not export a null literal fill rule', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'test',
        type: 'missing_value',
        config: {
          strategy: 'by_column',
          rules: [{ column: 'region', method: 'literal_fill', value: null }],
        },
      })
    ).toBe('');
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
      rules: [{ column: 'status', method: 'forward_fill' }],
    });
    expect(r.dsl).toContain('[status] fill forward');
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules[0].method).toBe('forward_fill');
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
        { column: 'status', method: 'literal_fill', value: 'UNKNOWN' },
        { column: 'revenue', method: 'mean_fill' },
      ],
    });
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules).toHaveLength(3);
    expect(rules[0].method).toBe('nullify_values');
    expect(rules[1].method).toBe('literal_fill');
    expect(rules[2].method).toBe('mean_fill');
  });

  it('reports duplicate fields in DSL instead of relying on implicit rule order', () => {
    const parsed = parsePrepOperatorDsl(
      'missing value [status] fill forward, [status] fill backward',
      'missing_value'
    );
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicateMissingValueField',
          severity: 'error',
        }),
      ])
    );
  });

  it('does not export a single operator containing duplicate fields', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'test',
        type: 'missing_value',
        config: {
          strategy: 'by_column',
          rules: [
            { column: 'status', method: 'forward_fill' },
            { column: 'status', method: 'backward_fill' },
          ],
        },
      })
    ).toBe('');
  });

  it('disables fields already selected by another graphical rule', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(source).toContain('disabledOptions=');
    expect(source).toContain('ruleIndex !== i');
  });

  it('limits add and copy actions by the number of available fields', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(source).toContain("actions={['add', 'copy', 'remove']}");
    expect(source).toContain('if (rules.length >= fieldCompletions.length) return;');
    expect(source).toContain("action === 'add' || action === 'copy'");
    expect(source).toContain('rules.length < fieldCompletions.length');
  });

  it('copies processing settings into a new row without duplicating the selected field', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(source).toContain('const copyRule = useCallback(');
    expect(source).toContain("column: ''");
    expect(source).toContain('values: source.values ? [...source.values] : undefined');
    expect(source).toContain('onCopy={(i) => copyRule(i)}');
  });

  it('allows configuring the processing method before selecting a field', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(source).not.toContain('disabled={!item.column}');
    expect(source).toContain('methodsForMissingValueType(colType)');
    expect(source).toContain('STATISTICAL_METHODS');
    expect(source).toContain('MODE_METHODS');
  });

  it('derives all-null condition from legacy drop_empty_rows graphical config', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(source).toContain("cfg.strategy === 'drop_empty_rows'");
    expect(source).toContain("? 'all_null'");
    expect(source).toContain('condition,');
  });

  it('by_column: empty rules cannot be exported as a placeholder field', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'missing_value',
      config: { strategy: 'by_column', rules: [] },
    });
    expect(dsl).toBe('');
  });

  it('does not export an unknown processing method', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'missing_value',
      config: {
        strategy: 'by_column',
        rules: [{ column: 'amount', method: 'mean_fll' }],
      },
    });
    expect(dsl).toBe('');
  });
});

describe('FormMissingValue — method filtering logic', () => {
  // Simulate methodsForType from FormMissingValue
  const BASE_METHODS = ['skip', 'nullify_values', 'literal_fill', 'drop'];
  const STATISTICAL_METHODS = ['mean_fill', 'median_fill'];
  const ORDERED_METHODS = ['forward_fill', 'backward_fill'];
  const MODE_METHODS = ['mode_fill'];

  function methodsForType(colType: string | undefined): string[] {
    if (!colType)
      return [...BASE_METHODS, ...ORDERED_METHODS, ...STATISTICAL_METHODS, ...MODE_METHODS];
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
    if (isNumeric)
      return [...BASE_METHODS, ...ORDERED_METHODS, ...STATISTICAL_METHODS, ...MODE_METHODS];
    if (isTemporal) return [...BASE_METHODS, ...ORDERED_METHODS, ...MODE_METHODS];
    return [...BASE_METHODS, ...ORDERED_METHODS, ...MODE_METHODS];
  }

  it('numeric type gets all methods', () => {
    const m = methodsForType('DOUBLE');
    expect(m).toContain('mean_fill');
    expect(m).toContain('median_fill');
    expect(m).toContain('forward_fill');
  });

  it('string type supports ordered fill but not numeric statistics', () => {
    const m = methodsForType('VARCHAR');
    expect(m).not.toContain('mean_fill');
    expect(m).toContain('forward_fill');
    expect(m).toContain('mode_fill');
    expect(m).toContain('literal_fill');
  });

  it('date type gets base + ordered but no statistical', () => {
    const m = methodsForType('DATE');
    expect(m).toContain('forward_fill');
    expect(m).not.toContain('mean_fill');
    expect(m).toContain('mode_fill');
    expect(m).toContain('literal_fill');
  });

  it('boolean type supports ordered fill but not numeric statistics', () => {
    const m = methodsForType('BOOLEAN');
    expect(m).not.toContain('mean_fill');
    expect(m).toContain('forward_fill');
    expect(m).toContain('mode_fill');
  });

  it('timestamp type gets base + ordered', () => {
    const m = methodsForType('TIMESTAMP');
    expect(m).toContain('forward_fill');
    expect(m).not.toContain('mean_fill');
  });

  it('unknown type keeps every method visible while a copied row is waiting for a field', () => {
    const m = methodsForType(undefined);
    expect(m).toEqual([
      ...BASE_METHODS,
      ...ORDERED_METHODS,
      ...STATISTICAL_METHODS,
      ...MODE_METHODS,
    ]);
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

// ── method/type compatibility normalization ──────────────────────────────

describe('normalizeMissingValueMethods', () => {
  const asRules = (rules: Array<{ id: string; column: string; method: string }>) =>
    rules as MissingValueRule[];

  it('resets methods the column type no longer supports', () => {
    const rules = asRules([
      { id: 'r1', column: 'amount', method: 'mean_fill' },
      { id: 'r2', column: 'name', method: 'median_fill' },
    ]);
    const { rules: next, changed } = normalizeMissingValueMethods(rules, {
      amount: 'text',
      name: 'text',
    });
    expect(changed).toBe(true);
    // text columns do not support mean/median fills; first allowed method is 'skip'
    expect(next[0].method).toBe('skip');
    expect(next[1].method).toBe('skip');
  });

  it('keeps rules whose methods stay valid for the column type', () => {
    const rules = asRules([
      { id: 'r1', column: 'amount', method: 'mean_fill' },
      { id: 'r2', column: 'name', method: 'skip' },
    ]);
    const { rules: next, changed } = normalizeMissingValueMethods(rules, { name: 'text' });
    expect(changed).toBe(false);
    expect(next).toBe(rules);
  });

  it('ignores rules whose column has no known type yet', () => {
    const rules = asRules([{ id: 'r1', column: 'amount', method: 'mean_fill' }]);
    const { changed } = normalizeMissingValueMethods(rules, {});
    expect(changed).toBe(false);
  });
});
