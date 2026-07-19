import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JoinConfigSchema } from '../../src/shared/operator-schemas';

describe('JoinConfigSchema', () => {
  it('parses valid config with conditions', () => {
    const result = JoinConfigSchema.parse({
      joinType: 'inner',
      conditions: [{ left: '[order_id]', operator: '=', right: '[id]' }],
      rightAlias: 'orders',
    });
    expect(result.joinType).toBe('inner');
    expect(result.conditions).toHaveLength(1);
    expect(result.rightAlias).toBe('orders');
  });

  it('applies defaults for omitted fields', () => {
    const result = JoinConfigSchema.parse({});
    expect(result.joinType).toBe('left');
    expect(result.keep).toEqual([]);
  });

  it('parses asof join config', () => {
    const result = JoinConfigSchema.parse({
      joinType: 'asof',
      asof: {
        leftTime: '[ts]',
        rightTime: '[time]',
        operator: '<=',
        direction: 'forward',
        tolerance: '5m',
        by: [{ left: '[symbol]', right: '[sym]' }],
      },
    });
    expect(result.joinType).toBe('asof');
    expect(result.asof).toBeDefined();
  });

  it('rejects conditions with wrong type', () => {
    expect(() => JoinConfigSchema.parse({ conditions: 'not-array' })).toThrow(z.ZodError);
  });
});
