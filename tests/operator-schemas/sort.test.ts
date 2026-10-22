import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SortConfigSchema } from '../../src/shared/operator-schemas';

describe('SortConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = SortConfigSchema.parse({
      orderBy: [
        { field: 'name', direction: 'desc', nulls: 'first' },
        { field: 'age', direction: 'asc', nulls: 'last' },
      ],
    });
    expect(result.orderBy).toHaveLength(2);
    expect(result.orderBy[0].field).toBe('name');
    expect(result.orderBy[0].direction).toBe('desc');
    expect(result.orderBy[0].nulls).toBe('first');
  });

  it('applies defaults for omitted optional fields', () => {
    const result = SortConfigSchema.parse({ orderBy: [{ field: 'name' }] });
    expect(result.orderBy[0].direction).toBe('asc');
    expect(result.orderBy[0].nulls).toBeUndefined();
  });

  it('rejects config when keys are omitted', () => {
    expect(() => SortConfigSchema.parse({})).toThrow('At least one sort field is required');
  });

  it('rejects an empty keys array', () => {
    expect(() => SortConfigSchema.parse({ orderBy: [] })).toThrow(
      'At least one sort field is required'
    );
  });

  it('rejects keys with wrong type', () => {
    expect(() => SortConfigSchema.parse({ orderBy: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects invalid direction value', () => {
    expect(() =>
      SortConfigSchema.parse({ orderBy: [{ field: 'name', direction: 'invalid' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects duplicate sort fields', () => {
    expect(() =>
      SortConfigSchema.parse({
        orderBy: [
          { field: 'name', direction: 'asc' },
          { field: 'name', direction: 'desc' },
        ],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects empty field name', () => {
    expect(() =>
      SortConfigSchema.parse({
        orderBy: [{ field: '' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects a blank row after a valid sort key', () => {
    const result = SortConfigSchema.safeParse({
      orderBy: [
        { field: 'name', direction: 'asc' },
        { field: '', direction: 'desc' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['orderBy', 1, 'field']);
    }
  });
});
