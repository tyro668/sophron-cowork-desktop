import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DeduplicateConfigSchema } from '../../src/shared/operator-schemas';

describe('DeduplicateConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = DeduplicateConfigSchema.parse({
      fields: ['id'],
      keep: 'last',
      orderBy: [{ field: 'ts', direction: 'desc' }],
    });
    expect(result.fields).toEqual(['id']);
    expect(result.keep).toBe('last');
    expect(result.orderBy).toHaveLength(1);
  });

  it('applies defaults for explicit all-column deduplication', () => {
    const result = DeduplicateConfigSchema.parse({ strategy: 'all_columns' });
    expect(result.fields).toEqual([]);
    expect(result.keep).toBe('first');
    expect(result.orderBy).toEqual([]);
  });

  it('rejects an unconfigured deduplication', () => {
    expect(() => DeduplicateConfigSchema.parse({})).toThrow(
      'At least one deduplication field is required'
    );
  });

  it('rejects columns with wrong type', () => {
    expect(() => DeduplicateConfigSchema.parse({ fields: 123 })).toThrow(z.ZodError);
  });
});
