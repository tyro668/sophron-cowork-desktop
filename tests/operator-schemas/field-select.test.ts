import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FieldSelectConfigSchema } from '../../src/shared/operator-schemas';

describe('FieldSelectConfigSchema', () => {
  it('parses valid config with columns', () => {
    const result = FieldSelectConfigSchema.parse({ columns: ['a', 'b'] });
    expect(result.columns).toEqual(['a', 'b']);
  });

  it('defaults to empty array when columns omitted', () => {
    const result = FieldSelectConfigSchema.parse({});
    expect(result.columns).toEqual([]);
  });

  it('rejects columns with wrong type', () => {
    expect(() => FieldSelectConfigSchema.parse({ columns: 'not-array' })).toThrow(z.ZodError);
  });
});
