import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

interface ConfigMetric {
  function: string;
  expression: string;
  alias: string;
}

function ok(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'aggregate', config });
  const parsed = parsePrepOperatorDsl(dsl, 'aggregate');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, 'null operator').not.toBeNull();
  return parsed.operator!;
}

function metricsOf(operator: NonNullable<ReturnType<typeof ok>>): ConfigMetric[] {
  return (operator.config.metrics as ConfigMetric[]) ?? [];
}

describe('FormAggregate — config ↔ DSL', () => {
  it('aggregate all with single metric', () => {
    const r = ok({
      groupBy: [],
      metrics: [{ function: 'count', expression: '*', alias: 'total_rows' }],
    });
    expect(r.config.groupBy).toEqual([]);
    expect(metricsOf(r)).toHaveLength(1);
    expect(metricsOf(r)[0].alias).toBe('total_rows');
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
    expect(metricsOf(r)).toHaveLength(2);
    expect(metricsOf(r)[1].alias).toBe('n');
  });

  it('aggregate by multiple fields', () => {
    const r = ok({
      groupBy: ['region', 'year'],
      metrics: [{ function: 'avg', expression: '[score]', alias: 'avg_score' }],
    });
    expect(r.config.groupBy).toEqual(['region', 'year']);
    expect(metricsOf(r)[0].function).toBe('avg');
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

  it('exporter returns empty when alias missing', () => {
    const dsl = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: {
        groupBy: [],
        metrics: [{ function: 'sum', expression: '[revenue]' }],
      },
    });
    expect(dsl).toBe('');
  });

  it('multiple metrics with complex expressions', () => {
    const r = ok({
      groupBy: ['category'],
      metrics: [
        { function: 'sum', expression: '[price] * [qty]', alias: 'revenue' },
        { function: 'count_distinct', expression: '[user_id]', alias: 'unique_users' },
      ],
    });
    expect(metricsOf(r)).toHaveLength(2);
    expect(metricsOf(r)[0].expression).toBe('[price] * [qty]');
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

  it('formats date granularity without relying on the cached DSL', () => {
    const config = {
      dsl: 'not the real formatter output',
      groupBy: ['created at', 'region'],
      dateGranularity: { 'created at': 'month' },
      metrics: [{ function: 'count', expression: '*', alias: 'rows' }],
    };
    const { dsl: _cached, ...stripped } = config;
    void _cached;
    const exported = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: stripped,
    });
    expect(exported).toBe('aggregate by month([created at]), [region] metrics count(*) as [rows]');
    const reparsed = parsePrepOperatorDsl(exported, 'aggregate');
    expect(reparsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(reparsed.operator?.config).toMatchObject({
      groupBy: ['created at', 'region'],
      dateGranularity: { 'created at': 'month' },
    });
  });

  describe('metrics lexical parsing', () => {
    function errors(dsl: string): Array<{ code?: string }> {
      return parsePrepOperatorDsl(dsl, 'aggregate').diagnostics.filter(
        (d) => d.severity === 'error'
      );
    }

    it('parses nested-parenthesis expression', () => {
      const r = ok({
        groupBy: [],
        metrics: [{ function: 'sum', expression: '[a] * ([b] + [c])', alias: 'total' }],
      });
      expect(metricsOf(r)[0].expression).toBe('[a] * ([b] + [c])');
    });

    it('trims whitespace around expression', () => {
      const r = ok({
        groupBy: [],
        metrics: [{ function: 'sum', expression: '[a] + [b]', alias: 't' }],
      });
      expect(metricsOf(r)[0].expression).toBe('[a] + [b]');
    });

    it('rejects empty expression when requireComplete', () => {
      const errs = errors('aggregate all metrics sum() as [t]');
      expect(errs.some((e) => e.code === 'invalidMetric')).toBe(true);
    });

    it('accepts count(*) as non-empty expression', () => {
      const r = ok({
        groupBy: [],
        metrics: [{ function: 'count', expression: '*', alias: 'row_count' }],
      });
      expect(metricsOf(r)[0].expression).toBe('*');
    });

    it('rejects missing alias when requireComplete', () => {
      const errs = errors('aggregate all metrics sum([a])');
      expect(errs.some((e) => e.code === 'invalidMetric')).toBe(true);
    });

    it('rejects trailing garbage after alias', () => {
      const errs = errors('aggregate all metrics sum([a]) as [b] garbe');
      expect(errs.some((e) => e.code === 'invalidMetric')).toBe(true);
    });

    it('rejects field token in place of alias', () => {
      const errs = errors('aggregate all metrics sum([a]) [b]');
      expect(errs.some((e) => e.code === 'invalidMetric')).toBe(true);
    });

    it('rejects dangling as keyword', () => {
      const errs = errors('aggregate all metrics sum([a]) as');
      expect(errs.some((e) => e.code === 'invalidMetric')).toBe(true);
    });

    it('rejects missing parentheses', () => {
      const errs = errors('aggregate all metrics sum');
      expect(errs.some((e) => e.code === 'invalidMetric')).toBe(true);
    });
  });
});
