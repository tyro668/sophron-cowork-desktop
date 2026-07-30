import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SortConfigSchema } from '../../src/shared/operator-schemas';

describe('SortConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = SortConfigSchema.parse({
      keys: [
        { field: 'name', direction: 'desc', nulls: 'first' },
        { field: 'age', direction: 'asc', nulls: 'last' },
      ],
    });
    expect(result.keys).toHaveLength(2);
    expect(result.keys[0].field).toBe('name');
    expect(result.keys[0].direction).toBe('desc');
    expect(result.keys[0].nulls).toBe('first');
  });

  it('applies defaults for omitted optional fields', () => {
    const result = SortConfigSchema.parse({ keys: [{ field: 'name' }] });
    expect(result.keys[0].direction).toBe('asc');
    expect(result.keys[0].nulls).toBeUndefined();
  });

  it('defaults to empty array when keys omitted', () => {
    const result = SortConfigSchema.parse({});
    expect(result.keys).toEqual([]);
  });

  it('rejects keys with wrong type', () => {
    expect(() => SortConfigSchema.parse({ keys: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects invalid direction value', () => {
    expect(() =>
      SortConfigSchema.parse({ keys: [{ field: 'name', direction: 'invalid' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects duplicate sort fields', () => {
    expect(() =>
      SortConfigSchema.parse({
        keys: [
          { field: 'name', direction: 'asc' },
          { field: 'name', direction: 'desc' },
        ],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects empty field name', () => {
    expect(() =>
      SortConfigSchema.parse({
        keys: [{ field: '' }],
      })
    ).toThrow(z.ZodError);
  });
});
