import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PivotConfigSchema } from '../../src/shared/operator-schemas';

describe('PivotConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = PivotConfigSchema.parse({
      on: ['category'],
      using: [{ function: 'sum', expression: 'amount', alias: 'total' }],
      groupBy: ['region'],
      values: { category: ['A', 'B'] },
    });
    expect(result.on).toEqual(['category']);
    expect(result.using).toHaveLength(1);
    expect(result.groupBy).toEqual(['region']);
    expect(result.values).toEqual({ category: ['A', 'B'] });
  });

  it('parses a metric without an alias', () => {
    const result = PivotConfigSchema.parse({
      on: ['category'],
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
    expect(() => PivotConfigSchema.parse({ on: ['category'], using: [] })).toThrow(z.ZodError);
  });

  it('rejects a metric missing an expression', () => {
    expect(() =>
      PivotConfigSchema.parse({ on: ['category'], using: [{ function: 'sum', expression: '' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects a metric missing a function', () => {
    expect(() =>
      PivotConfigSchema.parse({ on: ['category'], using: [{ expression: 'amount' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects on with wrong type', () => {
    expect(() => PivotConfigSchema.parse({ on: 'not-array' })).toThrow(z.ZodError);
  });
});
