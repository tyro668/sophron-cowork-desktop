import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SetOpConfigSchema } from '../../src/shared/operator-schemas';

describe('SetOpConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = SetOpConfigSchema.parse({
      operation: 'union',
      mode: 'all',
      match: 'by_name',
      rightInput: 'node_123',
    });
    expect(result.operation).toBe('union');
    expect(result.mode).toBe('all');
    expect(result.match).toBe('by_name');
  });

  it('applies defaults for omitted fields', () => {
    const result = SetOpConfigSchema.parse({});
    expect(result.operation).toBe('union');
    expect(result.mode).toBe('all');
    expect(result.match).toBe('by_name');
  });

  it('accepts all valid operation values', () => {
    expect(SetOpConfigSchema.parse({ operation: 'intersect' }).operation).toBe('intersect');
    expect(SetOpConfigSchema.parse({ operation: 'except' }).operation).toBe('except');
  });

  it('rejects keep with wrong type', () => {
    expect(() => SetOpConfigSchema.parse({ keep: 'not-array' })).toThrow(z.ZodError);
  });
});
