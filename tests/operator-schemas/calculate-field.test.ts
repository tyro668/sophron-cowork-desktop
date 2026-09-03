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

  it('rejects configs without a calculation', () => {
    expect(() => CalculateFieldConfigSchema.parse({})).toThrow(z.ZodError);
  });

  it('rejects calculations with missing required text', () => {
    expect(() =>
      CalculateFieldConfigSchema.parse({ calculations: [{ expression: '[price] * 2' }] })
    ).toThrow(z.ZodError);
    expect(() => CalculateFieldConfigSchema.parse({ calculations: [{ field: 'total' }] })).toThrow(
      z.ZodError
    );
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
