import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'aggregate', config });
  const parsed = parsePrepOperatorDsl(dsl, 'aggregate');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, 'null operator').not.toBeNull();
  return parsed.operator!;
}

describe('FormAggregate — config ↔ DSL', () => {
  it('aggregate all with single metric', () => {
    const r = ok({
      groupBy: [],
      metrics: [{ function: 'count', expression: '*', alias: 'total_rows' }],
    });
    expect(r.config.groupBy).toEqual([]);
    expect(r.config.metrics).toHaveLength(1);
    expect(r.config.metrics![0].alias).toBe('total_rows');
  });

  it('aggregate by single field with multiple metrics', () => {
    const r = ok({
      groupBy: ['region'],
      metrics: [
        { function: 'sum', expression: '[revenue]', alias: 'total' },
        { function: 'count', expression: '*', alias: 'n' },
      ],
    });
    expect(r.config.groupBy).toEqual(['region']);
    expect(r.config.metrics).toHaveLength(2);
    expect(r.config.metrics![1].alias).toBe('n');
  });

  it('aggregate by multiple fields', () => {
    const r = ok({
      groupBy: ['region', 'year'],
      metrics: [{ function: 'avg', expression: '[score]', alias: 'avg_score' }],
    });
    expect(r.config.groupBy).toEqual(['region', 'year']);
    expect(r.config.metrics![0].function).toBe('avg');
  });

  it('empty groupBy omits "by" clause', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: {
        groupBy: [],
        metrics: [{ function: 'count', expression: '*', alias: 'n' }],
      },
    });
    expect(dsl).toContain('aggregate all');
    expect(dsl).not.toContain('by');
  });

  it('undefined groupBy defaults to all', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: {
        metrics: [{ function: 'avg', expression: '[price]', alias: 'avg_price' }],
      },
    });
    expect(dsl).toBe('aggregate all metrics avg([price]) as [avg_price]');
  });

  it('exporter uses default alias when alias missing', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: {
        groupBy: [],
        metrics: [{ function: 'sum', expression: '[revenue]' }],
      },
    });
    // Exporter uses 'row_count' as default alias (parser uses function+field combo)
    expect(dsl).toBe('aggregate all metrics sum([revenue]) as [row_count]');
  });

  it('multiple metrics with complex expressions', () => {
    const r = ok({
      groupBy: ['category'],
      metrics: [
        { function: 'sum', expression: '[price] * [qty]', alias: 'revenue' },
        { function: 'count_distinct', expression: '[user_id]', alias: 'unique_users' },
      ],
    });
    expect(r.config.metrics).toHaveLength(2);
    expect(r.config.metrics![0].expression).toBe('[price] * [qty]');
  });

  it('idempotent: aggregate all', () => {
    const dsl1 = 'aggregate all metrics count(*) as [n]';
    const parsed = parsePrepOperatorDsl(dsl1, 'aggregate');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const dsl2 = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });

  it('idempotent: aggregate by single field', () => {
    const dsl1 = 'aggregate by [region] metrics sum([revenue]) as [total], count(*) as [n]';
    const parsed = parsePrepOperatorDsl(dsl1, 'aggregate');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const dsl2 = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });
});
