import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PivotConfigSchema } from '../../src/shared/operator-schemas';

describe('PivotConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = PivotConfigSchema.parse({
      on: ['category'],
      using: [{ function: 'sum', expression: 'amount', alias: 'total' }],
      groupBy: ['region'],
      values: ['A', 'B'],
    });
    expect(result.on).toEqual(['category']);
    expect(result.using).toHaveLength(1);
    expect(result.groupBy).toEqual(['region']);
    expect(result.values).toEqual(['A', 'B']);
  });

  it('applies defaults for omitted fields', () => {
    const result = PivotConfigSchema.parse({});
    expect(result.on).toEqual([]);
    expect(result.using).toEqual([]);
    expect(result.groupBy).toEqual([]);
    expect(result.values).toEqual([]);
  });

  it('rejects on with wrong type', () => {
    expect(() => PivotConfigSchema.parse({ on: 'not-array' })).toThrow(z.ZodError);
  });
});
