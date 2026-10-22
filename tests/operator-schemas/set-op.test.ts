import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SetOpConfigSchema } from '../../src/shared/operator-schemas';

describe('SetOpConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = SetOpConfigSchema.parse({
      operation: 'union',
      quantifier: 'all',
      match: 'by_name',
      rightInput: 'node_123',
    });
    expect(result.operation).toBe('union');
    expect(result.quantifier).toBe('all');
    expect(result.match).toBe('by_name');
  });

  it('requires a right input', () => {
    expect(() => SetOpConfigSchema.parse({})).toThrow(z.ZodError);
  });

  it('accepts all valid operation values', () => {
    expect(SetOpConfigSchema.parse({ operation: 'intersect', rightInput: 'R' }).operation).toBe(
      'intersect'
    );
    expect(SetOpConfigSchema.parse({ operation: 'except', rightInput: 'R' }).operation).toBe(
      'except'
    );
  });

  it('rejects keep with wrong type', () => {
    expect(() => SetOpConfigSchema.parse({ rightInput: 'R', keep: 'not-array' })).toThrow(
      z.ZodError
    );
  });
});
