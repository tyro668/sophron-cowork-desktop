import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UnnestConfigSchema } from '../../src/shared/operator-schemas';

describe('UnnestConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = UnnestConfigSchema.parse({
      sourceKind: 'json',
      column: 'items',
      alias: 'item',
      path: '$.data',
      withIndex: 'idx',
      keepParentNames: true,
    });
    expect(result.sourceKind).toBe('json');
    expect(result.column).toBe('items');
    expect(result.withIndex).toBe('idx');
  });

  it('applies defaults for omitted fields', () => {
    const result = UnnestConfigSchema.parse({});
    expect(result.sourceKind).toBe('list');
    expect(result.column).toBe('items');
    expect(result.alias).toBe('item');
    expect(result.path).toBe('$');
    expect(result.keepParentNames).toBe(false);
  });

  it('rejects invalid sourceKind value', () => {
    expect(() => UnnestConfigSchema.parse({ sourceKind: 'csv' })).toThrow(z.ZodError);
  });
});
