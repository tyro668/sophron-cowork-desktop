import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PivotConfigSchema } from '../../src/shared/operator-schemas';

describe('PivotConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = PivotConfigSchema.parse({
      on: [{ field: 'category', values: ['A', 'B'] }],
      using: [{ function: 'sum', expression: 'amount', alias: 'total' }],
      groupBy: ['region'],
    });
    expect(result.on).toEqual([{ field: 'category', values: ['A', 'B'], customValues: [] }]);
    expect(result.using).toHaveLength(1);
    expect(result.groupBy).toEqual(['region']);
  });

  it('accepts an on field with an empty values array (dynamic)', () => {
    const result = PivotConfigSchema.parse({
      on: [{ field: 'category', values: [] }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(result.on[0].values).toEqual([]);
  });

  it('allows at most 100 configured values per pivot field', () => {
    const config = {
      on: [{ field: 'category', values: Array.from({ length: 100 }, (_, index) => index) }],
      using: [{ function: 'count', expression: '*' }],
    };

    expect(PivotConfigSchema.parse(config).on[0].values).toHaveLength(100);
    expect(() =>
      PivotConfigSchema.parse({
        ...config,
        on: [{ field: 'category', values: [...config.on[0].values, 100] }],
      })
    ).toThrow(z.ZodError);
  });

  it('defaults on.values to empty array when omitted', () => {
    const result = PivotConfigSchema.parse({
      on: [{ field: 'category' }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(result.on[0].values).toEqual([]);
  });

  it('parses a metric without an alias', () => {
    const result = PivotConfigSchema.parse({
      on: [{ field: 'category' }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(result.using[0].alias).toBeUndefined();
  });

  it('rejects a missing on array', () => {
    expect(() =>
      PivotConfigSchema.parse({ using: [{ function: 'sum', expression: '*' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects an empty on', () => {
    expect(() =>
      PivotConfigSchema.parse({ on: [], using: [{ function: 'sum', expression: '*' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects an empty using', () => {
    expect(() => PivotConfigSchema.parse({ on: [{ field: 'category' }], using: [] })).toThrow(
      z.ZodError
    );
  });

  it('rejects a metric missing an expression', () => {
    expect(() =>
      PivotConfigSchema.parse({
        on: [{ field: 'category' }],
        using: [{ function: 'sum', expression: '' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects a metric missing a function', () => {
    expect(() =>
      PivotConfigSchema.parse({ on: [{ field: 'category' }], using: [{ expression: 'amount' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects on with wrong type', () => {
    expect(() => PivotConfigSchema.parse({ on: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects an on axis missing a field', () => {
    expect(() =>
      PivotConfigSchema.parse({
        on: [{ values: ['A'] }],
        using: [{ function: 'count', expression: '*' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects duplicate on fields', () => {
    expect(() =>
      PivotConfigSchema.parse({
        on: [
          { field: 'category', values: ['A'] },
          { field: 'Category', values: ['B'] },
        ],
        using: [{ function: 'count', expression: '*' }],
      })
    ).toThrow(z.ZodError);
  });

  it('accepts the full pivot whitelist including median, var_samp, stddev_samp, mode', () => {
    for (const fn of ['median', 'var_samp', 'stddev_samp', 'mode'] as const) {
      const result = PivotConfigSchema.parse({
        on: [{ field: 'region', values: [] }],
        using: [{ function: fn, expression: '[amount]', alias: `m_${fn}` }],
      });
      expect(result.using[0].function).toBe(fn);
    }
  });

  it('rejects functions outside the pivot whitelist', () => {
    for (const fn of [
      'string_agg',
      'approx_top_k',
      'quantile_cont',
      'list',
      'first',
      'last',
      'stddev_pop',
      'var_pop',
    ] as const) {
      expect(() =>
        PivotConfigSchema.parse({
          on: [{ field: 'region', values: [] }],
          using: [{ function: fn, expression: '[amount]', alias: 'x' }],
        })
      ).toThrow(z.ZodError);
    }
  });
});
