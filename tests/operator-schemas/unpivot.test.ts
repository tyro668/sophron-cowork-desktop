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

  it('rejects configs without an unpivot field', () => {
    expect(() => UnpivotConfigSchema.parse({})).toThrow(z.ZodError);
  });

  it('rejects invalid mode value', () => {
    expect(() => UnpivotConfigSchema.parse({ columns: ['q1'], mode: 'invalid' })).toThrow(
      z.ZodError
    );
  });

  it('rejects includeNulls with wrong type', () => {
    expect(() => UnpivotConfigSchema.parse({ columns: ['q1'], includeNulls: 'yes' })).toThrow(
      z.ZodError
    );
  });
});
