import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AggregateConfigSchema } from '../../src/shared/operator-schemas';
import { AGGREGATE_FUNCTIONS } from '../../src/shared/operator-schemas/common';

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

  it('applies defaults for omitted fields but requires at least one metric', () => {
    const result = AggregateConfigSchema.parse({
      metrics: [{ function: 'count', expression: '*', alias: 'row_count' }],
    });
    expect(result.groupBy).toEqual([]);
    expect(result.metrics).toHaveLength(1);
    expect(() => AggregateConfigSchema.parse({})).toThrow(z.ZodError);
  });

  it('rejects groupBy with wrong type', () => {
    expect(() => AggregateConfigSchema.parse({ groupBy: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects duplicate groupBy fields', () => {
    expect(
      AggregateConfigSchema.safeParse({
        groupBy: ['Date', 'Date'],
        metrics: [{ function: 'count', expression: '*', alias: 'rows' }],
      }).success
    ).toBe(false);
  });

  it('accepts every aggregate function exposed by the frontend', () => {
    for (const fn of AGGREGATE_FUNCTIONS) {
      expect(
        AggregateConfigSchema.safeParse({
          metrics: [{ function: fn, expression: '[value]', alias: 'result' }],
        }).success
      ).toBe(true);
    }
  });
});
