import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CalculateFieldConfigSchema } from '../../src/shared/operator-schemas';

describe('CalculateFieldConfigSchema', () => {
  it('parses valid config with calculations', () => {
    const result = CalculateFieldConfigSchema.parse({
      calculations: [
        { field: 'total', expression: '[price] * [qty]', action: 'add' },
        { field: 'discount', expression: '[total] * 0.1', action: 'add' },
      ],
    });
    expect(result.calculations).toHaveLength(2);
    expect(result.calculations[0].field).toBe('total');
    expect(result.calculations[1].action).toBe('add');
  });

  it('applies defaults for omitted fields', () => {
    const result = CalculateFieldConfigSchema.parse({});
    expect(result.calculations).toEqual([]);
  });

  it('rejects legacy structured window fields', () => {
    expect(() =>
      CalculateFieldConfigSchema.parse({
        calculations: [
          {
            field: 'rn',
            expression: 'row_number()',
            type: 'window',
            fn: 'row_number',
            partitionBy: ['region'],
            orderBy: [{ field: 'amount', direction: 'desc' }],
          },
        ],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects unknown top-level mode state', () => {
    expect(() =>
      CalculateFieldConfigSchema.parse({
        calculations: [{ field: 'x', expression: 'sum([amount]) over ()' }],
        _activeMode: 'row',
      })
    ).toThrow(z.ZodError);
  });

  it('rejects calculations with wrong type', () => {
    expect(() => CalculateFieldConfigSchema.parse({ calculations: 'not-array' })).toThrow(
      z.ZodError
    );
  });
});
