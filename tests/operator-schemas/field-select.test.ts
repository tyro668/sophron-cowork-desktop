import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FieldSelectConfigSchema } from '../../src/shared/operator-schemas';

describe('FieldSelectConfigSchema', () => {
  it('parses valid config with columns', () => {
    const result = FieldSelectConfigSchema.parse({ columns: ['a', 'b'] });
    expect(result.columns).toEqual(['a', 'b']);
  });

  it('rejects config when columns are omitted', () => {
    expect(() => FieldSelectConfigSchema.parse({})).toThrow('At least one field must be selected');
  });

  it('rejects an empty columns array in exclude mode', () => {
    expect(() => FieldSelectConfigSchema.parse({ mode: 'exclude', columns: [] })).toThrow(
      'At least one field must be selected'
    );
  });

  it('rejects columns with wrong type', () => {
    expect(() => FieldSelectConfigSchema.parse({ columns: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects duplicate columns', () => {
    expect(() => FieldSelectConfigSchema.parse({ columns: ['a', 'a'] })).toThrow(z.ZodError);
  });

  it('rejects empty column name', () => {
    expect(() => FieldSelectConfigSchema.parse({ columns: ['a', ''] })).toThrow(z.ZodError);
  });

  it('trims column names', () => {
    const result = FieldSelectConfigSchema.parse({ columns: ['  a  ', 'b'] });
    expect(result.columns[0]).toBe('a');
  });
});
