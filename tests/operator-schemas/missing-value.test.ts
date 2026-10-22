import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MissingValueConfigSchema } from '../../src/shared/operator-schemas';

describe('MissingValueConfigSchema', () => {
  it('parses valid config with rules', () => {
    const result = MissingValueConfigSchema.parse({
      strategy: 'by_column',
      rules: [
        { field: 'age', method: 'literal_fill', value: 0 },
        { field: 'name', method: 'nullify_values', values: ['N/A', 'unknown'] },
      ],
    });
    expect(result.strategy).toBe('by_column');
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].method).toBe('literal_fill');
  });

  it('rejects an empty default column configuration', () => {
    expect(() => MissingValueConfigSchema.parse({})).toThrow(/requires at least one rule/);
  });

  it('parses drop_empty_rows strategy', () => {
    const result = MissingValueConfigSchema.parse({
      strategy: 'drop_empty_rows',
      condition: 'all_null',
    });
    expect(result.strategy).toBe('drop_empty_rows');
  });

  it('requires an explicit condition for scoped row deletion', () => {
    expect(() =>
      MissingValueConfigSchema.parse({
        strategy: 'drop_rows_by_nulls',
        fields: ['status'],
      })
    ).toThrow(/requires an explicit/);
  });

  it('rejects unsupported row conditions', () => {
    expect(() =>
      MissingValueConfigSchema.parse({
        strategy: 'drop_rows_by_nulls',
        condition: 'all_missing',
      })
    ).toThrow(z.ZodError);
    expect(() =>
      MissingValueConfigSchema.parse({
        strategy: 'drop_empty_rows',
        condition: 'any_null',
      })
    ).toThrow(/only supports the all_null/);
  });

  it('rejects empty and duplicate row-deletion fields', () => {
    expect(() =>
      MissingValueConfigSchema.parse({
        strategy: 'drop_rows_by_nulls',
        condition: 'any_null',
        fields: [''],
      })
    ).toThrow(z.ZodError);
    expect(() =>
      MissingValueConfigSchema.parse({
        strategy: 'drop_rows_by_nulls',
        condition: 'all_null',
        fields: ['status', 'status'],
      })
    ).toThrow(/is duplicated/);
  });

  it('rejects rules with wrong type', () => {
    expect(() => MissingValueConfigSchema.parse({ rules: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects a rule without a field and an unknown method', () => {
    expect(() =>
      MissingValueConfigSchema.parse({
        rules: [{ field: '', method: 'skip' }],
      })
    ).toThrow(z.ZodError);
    expect(() =>
      MissingValueConfigSchema.parse({
        rules: [{ field: 'amount', method: 'mean_fll' }],
      })
    ).toThrow(z.ZodError);
  });

  it('accepts forward and backward fill without extra ordering config', () => {
    const result = MissingValueConfigSchema.parse({
      rules: [
        { field: 'first', method: 'forward_fill' },
        { field: 'second', method: 'backward_fill' },
      ],
    });
    expect(result.rules.map((rule) => rule.method)).toEqual(['forward_fill', 'backward_fill']);
  });

  it('allows sequential treatments of one field inside a single operator', () => {
    const result = MissingValueConfigSchema.parse({
      strategy: 'by_column',
      rules: [
        { field: 'status', method: 'nullify_values', values: ['N/A'] },
        { field: 'status', method: 'literal_fill', value: 'UNKNOWN' },
      ],
    });
    expect(result.rules).toHaveLength(2);
  });

  it('accepts typed special values', () => {
    const result = MissingValueConfigSchema.parse({
      rules: [
        {
          field: 'mixed',
          method: 'nullify_values',
          values: [0, true, 'N/A'],
        },
      ],
    });
    expect(result.rules[0].values).toEqual([0, true, 'N/A']);
  });

  it('rejects an empty special-value list', () => {
    expect(() =>
      MissingValueConfigSchema.parse({
        rules: [{ field: 'status', method: 'nullify_values', values: [] }],
      })
    ).toThrow(/requires at least one value/);
  });

  it('rejects null as a literal fill value', () => {
    expect(() =>
      MissingValueConfigSchema.parse({
        rules: [{ field: 'status', method: 'literal_fill', value: null }],
      })
    ).toThrow(/requires a non-null value/);
  });
});
