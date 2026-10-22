import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UnnestConfigSchema } from '../../src/shared/operator-schemas';

describe('UnnestConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = UnnestConfigSchema.parse({
      sourceKind: 'json',
      field: 'items',
      alias: 'item',
      path: '$.data',
      withIndex: 'idx',
      keepParentNames: true,
    });
    expect(result.sourceKind).toBe('json');
    expect(result.field).toBe('items');
    expect(result.withIndex).toBe('idx');
  });

  it('rejects empty config (column is required)', () => {
    expect(() => UnnestConfigSchema.parse({})).toThrow(z.ZodError);
  });

  it('rejects empty alias for list mode', () => {
    expect(() => UnnestConfigSchema.parse({ field: 'items', alias: '' })).toThrow(z.ZodError);
  });

  it('rejects invalid sourceKind value', () => {
    expect(() => UnnestConfigSchema.parse({ sourceKind: 'csv' })).toThrow(z.ZodError);
  });
});
