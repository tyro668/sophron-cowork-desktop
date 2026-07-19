import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DeduplicateConfigSchema } from '../../src/shared/operator-schemas';

describe('DeduplicateConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = DeduplicateConfigSchema.parse({
      columns: ['id'],
      keep: 'last',
      orderBy: [{ field: 'ts', direction: 'desc' }],
    });
    expect(result.columns).toEqual(['id']);
    expect(result.keep).toBe('last');
    expect(result.orderBy).toHaveLength(1);
  });

  it('applies defaults for omitted fields', () => {
    const result = DeduplicateConfigSchema.parse({});
    expect(result.columns).toEqual([]);
    expect(result.keep).toBe('first');
    expect(result.orderBy).toEqual([]);
  });

  it('rejects columns with wrong type', () => {
    expect(() => DeduplicateConfigSchema.parse({ columns: 123 })).toThrow(z.ZodError);
  });
});
