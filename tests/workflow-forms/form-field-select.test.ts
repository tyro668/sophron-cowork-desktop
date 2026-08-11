import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
  const type = 'field_select' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormFieldSelect — config ↔ DSL', () => {
  it('include columns', () => {
    const r = ok({ mode: 'include', columns: ['id', 'name', 'date'] });
    expect(r.dsl).toContain('select');
    expect(r.config.columns).toEqual(['id', 'name', 'date']);
    expect(r.config.mode).toBe('include');
  });

  it('exclude columns', () => {
    const r = ok({ mode: 'exclude', columns: ['debug_col'] });
    expect(r.dsl).toContain('drop');
    expect(r.config.mode).toBe('exclude');
  });

  it('single column', () => {
    const r = ok({ mode: 'include', columns: ['id'] });
    expect(r.config.columns).toEqual(['id']);
  });

  it('many columns', () => {
    const cols = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const r = ok({ mode: 'include', columns: cols });
    expect(r.config.columns).toEqual(cols);
  });
});

describe('FormFieldSelect — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { mode: 'include', columns: ['id', 'name'] },
      { mode: 'exclude', columns: ['tmp'] },
      { mode: 'include', columns: ['single_col'] },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({
        id: 't',
        type: 'field_select',
        config,
      });
      const parsed = parsePrepOperatorDsl(dsl1, 'field_select');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'field_select',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});

describe('FormFieldSelect — edge cases', () => {
  it('empty columns produce empty DSL (no-op)', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'field_select',
      config: { mode: 'include', columns: [] },
    });
    expect(dsl).toBe('');
  });
});
