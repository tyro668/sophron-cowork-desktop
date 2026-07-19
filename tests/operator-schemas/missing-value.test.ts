import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MissingValueConfigSchema } from '../../src/shared/operator-schemas';

describe('MissingValueConfigSchema', () => {
  it('parses valid config with rules', () => {
    const result = MissingValueConfigSchema.parse({
      strategy: 'by_column',
      rules: [
        { column: 'age', method: 'literal_fill', value: 0 },
        { column: 'name', method: 'nullify_values', values: ['N/A', 'unknown'] },
      ],
    });
    expect(result.strategy).toBe('by_column');
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].method).toBe('literal_fill');
  });

  it('applies defaults for omitted fields', () => {
    const result = MissingValueConfigSchema.parse({});
    expect(result.strategy).toBe('by_column');
    expect(result.rules).toEqual([]);
  });

  it('parses drop_empty_rows strategy', () => {
    const result = MissingValueConfigSchema.parse({
      strategy: 'drop_empty_rows',
      condition: 'all_null',
    });
    expect(result.strategy).toBe('drop_empty_rows');
  });

  it('rejects rules with wrong type', () => {
    expect(() => MissingValueConfigSchema.parse({ rules: 'not-array' })).toThrow(z.ZodError);
  });
});
