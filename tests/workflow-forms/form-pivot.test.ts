import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'pivot', config });
  const parsed = parsePrepOperatorDsl(dsl, 'pivot');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, 'null operator').not.toBeNull();
  return parsed.operator!;
}

describe('FormPivot — config ↔ DSL', () => {
  it('export returns empty when on is absent', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { using: [{ function: 'sum', expression: '[amount]' }] },
    });
    expect(dsl).toBe('');
  });

  it('export returns empty when using is absent', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { on: ['category'], using: [] },
    });
    expect(dsl).toBe('');
  });

  it('export returns empty when a metric is incomplete', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { on: ['category'], using: [{ function: 'sum', expression: '' }] },
    });
    expect(dsl).toBe('');
  });

  it('round-trips a complete pivot config without an alias', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: { on: ['category'], using: [{ function: 'count', expression: '*' }] },
    });
    expect(dsl).toBe('pivot on [category] using count(*)');
    const r = ok({ on: ['category'], using: [{ function: 'count', expression: '*' }] });
    expect(r.config.on).toEqual(['category']);
    expect((r.config.using as Array<Record<string, unknown>>)[0].function).toBe('count');
  });

  it('round-trips a complete pivot config with an alias and group by', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: {
        on: ['category'],
        using: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
        groupBy: ['region'],
      },
    });
    expect(dsl).toBe('pivot on [category] using sum([amount]) as [total] group by [region]');
    const r = ok({
      on: ['category'],
      using: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
      groupBy: ['region'],
    });
    expect((r.config.using as Array<Record<string, unknown>>)[0].alias).toBe('total');
  });

  it('round-trips multiple ON fields each with their own value list', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'pivot',
      config: {
        on: ['year', 'quarter', 'channel'],
        values: { year: [2024, 2025], quarter: ['Q1', 'Q2'] },
        using: [{ function: 'sum', expression: '[amount]' }],
      },
    });
    expect(dsl).toBe(
      'pivot on [year] in (2024, 2025), [quarter] in ("Q1", "Q2"), [channel] using sum([amount])'
    );
    const r = ok({
      on: ['year', 'quarter', 'channel'],
      values: { year: [2024, 2025], quarter: ['Q1', 'Q2'] },
      using: [{ function: 'sum', expression: '[amount]' }],
    });
    expect(r.config.on).toEqual(['year', 'quarter', 'channel']);
    expect(r.config.values).toEqual({ year: [2024, 2025], quarter: ['Q1', 'Q2'] });
  });
});
