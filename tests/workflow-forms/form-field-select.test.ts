import { describe, expect, it } from 'vitest';
import { exportStep, parseStep } from '../helpers/jflow-step';

function ok(config: Record<string, unknown>) {
  const type = 'select' as const;
  const dsl = exportStep({ id: 'test', type, config });
  const parsed = parseStep(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormFieldSelect — config ↔ DSL', () => {
  it('include columns', () => {
    const r = ok({ selection: 'include', fields: ['id', 'name', 'date'] });
    expect(r.dsl).toContain('select');
    expect(r.config.fields).toEqual(['id', 'name', 'date']);
    expect(r.config.selection).toBe('include');
  });

  it('exclude columns', () => {
    const r = ok({ selection: 'exclude', fields: ['debug_col'] });
    expect(r.dsl).toContain('drop [debug_col]');
    expect(r.config.selection).toBe('exclude');
  });

  it('single column', () => {
    const r = ok({ selection: 'include', fields: ['id'] });
    expect(r.config.fields).toEqual(['id']);
  });

  it('many columns', () => {
    const cols = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const r = ok({ selection: 'include', fields: cols });
    expect(r.config.fields).toEqual(cols);
  });
});

describe('FormFieldSelect — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { selection: 'include', fields: ['id', 'name'] },
      { selection: 'exclude', fields: ['tmp'] },
      { selection: 'include', fields: ['single_col'] },
    ];
    for (const config of configs) {
      const dsl1 = exportStep({
        id: 't',
        type: 'select',
        config,
      });
      const parsed = parseStep(dsl1, 'select');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportStep({
        id: 't',
        type: 'select',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});

describe('FormFieldSelect — edge cases', () => {
  it('empty columns produce empty DSL (no-op)', () => {
    const dsl = exportStep({
      id: 'test',
      type: 'select',
      config: { selection: 'include', fields: [] },
    });
    expect(dsl).toBe('');
  });
});
