import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UnpivotConfigSchema } from '../../src/shared/operator-schemas';

describe('UnpivotConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = UnpivotConfigSchema.parse({
      columns: ['q1', 'q2'],
      mode: 'except',
      nameColumn: 'quarter',
      valueColumn: 'revenue',
      includeNulls: true,
    });
    expect(result.columns).toEqual(['q1', 'q2']);
    expect(result.mode).toBe('except');
    expect(result.includeNulls).toBe(true);
  });

  it('applies defaults for omitted fields', () => {
    const result = UnpivotConfigSchema.parse({});
    expect(result.columns).toEqual([]);
    expect(result.mode).toBe('include');
    expect(result.includeNulls).toBe(false);
  });

  it('rejects invalid mode value', () => {
    expect(() => UnpivotConfigSchema.parse({ mode: 'invalid' })).toThrow(z.ZodError);
  });

  it('rejects includeNulls with wrong type', () => {
    expect(() => UnpivotConfigSchema.parse({ includeNulls: 'yes' })).toThrow(z.ZodError);
  });
});
