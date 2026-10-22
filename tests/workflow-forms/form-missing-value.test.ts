import { describe, expect, it } from 'vitest';
import { exportStep, parseStep } from '../helpers/jflow-step';
import { normalizeMissingValueMethods } from '../../src/shared/operator-config';
import type { MissingValueRule } from '../../src/shared/operator-schemas/missing-value';

function ok(config: Record<string, unknown>) {
  const type = 'missing_value' as const;
  const dsl = exportStep({ id: 'test', type, config });
  const parsed = parseStep(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormMissingValue — config ↔ DSL', () => {
  it('drop empty rows', () => {
    const r = ok({ strategy: 'drop_empty_rows' });
    expect(r.dsl).toBe('drop_empty all');
    // jflow canonical form: all-null across every column.
    expect(r.config.strategy).toBe('drop_rows_by_nulls');
    expect(r.config.condition).toBe('all_null');
  });

  it('drop rows by any null', () => {
    const r = ok({ strategy: 'drop_rows_by_nulls', condition: 'any_null' });
    expect(r.dsl).toContain('drop_empty any');
    expect(r.config.condition).toBe('any_null');
  });

  it('drop rows by any null with specific columns', () => {
    const r = ok({
      strategy: 'drop_rows_by_nulls',
      condition: 'any_null',
      fields: ['id', 'name'],
    });
    expect(r.dsl).toContain('drop_empty any fields: [id], [name]');
    expect(r.config.fields).toEqual(['id', 'name']);
  });

  it('round trips all-null row deletion with specific columns', () => {
    const r = ok({
      strategy: 'drop_rows_by_nulls',
      condition: 'all_null',
      fields: ['id', 'name'],
    });
    expect(r.dsl).toContain('drop_empty all fields: [id], [name]');
    expect(r.config.strategy).toBe('drop_rows_by_nulls');
    expect(r.config.condition).toBe('all_null');
    expect(r.config.fields).toEqual(['id', 'name']);
  });

  it('preserves scoped fields when exporting a legacy drop_empty_rows config', () => {
    const r = ok({
      strategy: 'drop_empty_rows',
      fields: ['id', 'name'],
    });
    expect(r.dsl).toContain('drop_empty all fields: [id], [name]');
    expect(r.config.strategy).toBe('drop_rows_by_nulls');
    expect(r.config.condition).toBe('all_null');
    expect(r.config.fields).toEqual(['id', 'name']);
  });

  it('reports duplicate row-deletion fields in DSL', () => {
    const parsed = parseStep('drop_empty any fields: [status], [status]', 'missing_value');
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'E_DUP_FIELD',
          severity: 'error',
        }),
      ])
    );
  });

  it('by_column: skip-only rules are a no-op and cannot be exported as a step', () => {
    expect(
      exportStep({
        id: 'test',
        type: 'missing_value',
        config: { strategy: 'by_column', rules: [{ field: 'field', method: 'skip' }] },
      })
    ).toBe('');
  });

  it('by_column: nullify values', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ field: 'region', method: 'nullify_values', values: ['', 'N/A'] }],
    });
    expect(r.dsl).toContain(`nullify [region] values ('', 'N/A')`);
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules[0].method).toBe('nullify_values');
  });

  it('by_column: literal fill', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ field: 'region', method: 'literal_fill', value: 'UNKNOWN' }],
    });
    expect(r.dsl).toContain('fill');
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules[0].value).toBe('UNKNOWN');
  });

  it('rejects fill null DSL as a no-op', () => {
    const parsed = parseStep('fill [region] with null', 'missing_value');
    expect(parsed.diagnostics.some((item) => item.severity === 'error')).toBe(true);
  });

  it('does not export a null literal fill rule', () => {
    expect(
      exportStep({
        id: 'test',
        type: 'missing_value',
        config: {
          strategy: 'by_column',
          rules: [{ field: 'region', method: 'literal_fill', value: null }],
        },
      })
    ).toBe('');
  });

  it('by_column: mean fill', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ field: 'revenue', method: 'mean_fill' }],
    });
    expect(r.dsl).toContain('fill [revenue] with mean');
  });

  it('by_column: forward fill', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ field: 'status', method: 'forward_fill' }],
    });
    expect(r.dsl).toContain('fill [status] with forward');
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules[0].method).toBe('forward_fill');
  });

  it('by_column: drop rows for column', () => {
    const r = ok({
      strategy: 'by_column',
      rules: [{ field: 'page_id', method: 'drop' }],
    });
    expect(r.dsl).toBe('drop_empty any fields: [page_id]');
  });

  it('by_column: mixed rule kinds need one node per kind in jflow', () => {
    expect(
      exportStep({
        id: 'test',
        type: 'missing_value',
        config: {
          strategy: 'by_column',
          rules: [
            { field: 'region', method: 'nullify_values', values: ['', 'N/A'] },
            { field: 'status', method: 'literal_fill', value: 'UNKNOWN' },
          ],
        },
      })
    ).toBe('');
    const r = ok({
      strategy: 'by_column',
      rules: [
        { field: 'status', method: 'literal_fill', value: 'UNKNOWN' },
        { field: 'revenue', method: 'mean_fill' },
      ],
    });
    const rules = r.config.rules as Array<Record<string, unknown>>;
    expect(rules.map((rule) => rule.method)).toEqual(['literal_fill', 'mean_fill']);
  });

  it('a nullify followed by a fill on the same field is two steps', () => {
    const parsed = parseStep(
      `nullify [status] values ('N/A') | fill [status] with 'UNKNOWN'`,
      'missing_value'
    );
    expect(parsed.diagnostics.map((item) => item.code)).toContain('E_STEP_COMPOSITE');
  });

  it('exports sequential rules for the same field', () => {
    expect(
      exportStep({
        id: 'test',
        type: 'missing_value',
        config: {
          strategy: 'by_column',
          rules: [
            { field: 'status', method: 'forward_fill' },
            { field: 'status', method: 'backward_fill' },
          ],
        },
      })
    ).toBe('fill [status] with forward, [status] with backward');
  });

  it('allows fields to be selected in more than one graphical rule', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(source).not.toContain('disabledOptions=');
  });

  it('allows adding sequential rules beyond the number of available fields', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(source).toContain('<RowActionsCell');
    expect(source).toContain('onAdd={() => insertRule(i)}');
    expect(source).not.toContain('if (rules.length >= fieldCompletions.length) return;');
    expect(source).not.toContain('canAct=');
  });

  it('copies a processing rule so it can be adjusted as the next sequential step', async () => {
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
    expect(source).toContain('values: source.values ? [...source.values] : undefined');
    expect(source).toContain('onCopy={() => copyRule(i)}');
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
    expect(source).not.toContain('disabled={!item.field}');
    expect(source).toContain('methodsForMissingValueType(colType)');
    expect(source).toContain('STATISTICAL_METHODS');
    expect(source).toContain('MODE_METHODS');
  });

  it('assigns stable rule ids before rendering legacy rules', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL(
          '../../src/renderer/components/workflow-forms/FormMissingValue.tsx',
          import.meta.url
        ),
        'utf8'
      )
    );

    expect(source).toContain('ensureStableRowIds(configuredRules)');
    expect(source).toContain('ensureStableRowIds(items)');
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
    const dsl = exportStep({
      id: 'test',
      type: 'missing_value',
      config: { strategy: 'by_column', rules: [] },
    });
    expect(dsl).toBe('');
  });

  it('does not export an unknown processing method', () => {
    const dsl = exportStep({
      id: 'test',
      type: 'missing_value',
      config: {
        strategy: 'by_column',
        rules: [{ field: 'amount', method: 'mean_fll' }],
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
      { strategy: 'drop_rows_by_nulls', condition: 'any_null', fields: ['id'] },
      { strategy: 'by_column', rules: [{ field: 'r', method: 'literal_fill', value: 'X' }] },
    ];
    for (const config of configs) {
      const dsl1 = exportStep({
        id: 't',
        type: 'missing_value',
        config,
      });
      const parsed = parseStep(dsl1, 'missing_value');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportStep({
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
  const asRules = (rules: Array<{ id: string; field: string; method: string }>) =>
    rules as MissingValueRule[];

  it('resets methods the column type no longer supports', () => {
    const rules = asRules([
      { id: 'r1', field: 'amount', method: 'mean_fill' },
      { id: 'r2', field: 'name', method: 'median_fill' },
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
      { id: 'r1', field: 'amount', method: 'mean_fill' },
      { id: 'r2', field: 'name', method: 'skip' },
    ]);
    const { rules: next, changed } = normalizeMissingValueMethods(rules, { name: 'text' });
    expect(changed).toBe(false);
    expect(next).toBe(rules);
  });

  it('ignores rules whose column has no known type yet', () => {
    const rules = asRules([{ id: 'r1', field: 'amount', method: 'mean_fill' }]);
    const { changed } = normalizeMissingValueMethods(rules, {});
    expect(changed).toBe(false);
  });
});
