import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AggregateConfigSchema } from '../../src/shared/operator-schemas';

describe('AggregateConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = AggregateConfigSchema.parse({
      groupBy: ['region'],
      metrics: [
        { function: 'sum', expression: 'revenue', alias: 'total' },
        { function: 'count', expression: '*', alias: 'count' },
      ],
    });
    expect(result.groupBy).toEqual(['region']);
    expect(result.metrics).toHaveLength(2);
  });

  it('applies defaults for omitted fields', () => {
    const result = AggregateConfigSchema.parse({});
    expect(result.groupBy).toEqual([]);
    expect(result.metrics).toEqual([]);
  });

  it('rejects groupBy with wrong type', () => {
    expect(() => AggregateConfigSchema.parse({ groupBy: 'not-array' })).toThrow(z.ZodError);
  });
});
