import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LimitConfigSchema } from '../../src/shared/operator-schemas';

describe('LimitConfigSchema', () => {
  it('parses valid config with all fields', () => {
    const result = LimitConfigSchema.parse({
      limit: 50,
      mode: 'fixed',
      unit: 'rows',
      orderBy: [{ field: 'name', direction: 'asc' }],
      groupBy: ['category'],
      ties: true,
      offset: 10,
    });
    expect(result.limit).toBe(50);
    expect(result.mode).toBe('fixed');
    expect(result.ties).toBe(true);
    expect(result.offset).toBe(10);
  });

  it('applies defaults for omitted fields', () => {
    const result = LimitConfigSchema.parse({});
    expect(result.limit).toBe(100);
    expect(result.mode).toBe('fixed');
    expect(result.unit).toBe('rows');
    expect(result.ties).toBe(false);
    expect(result.offset).toBe(0);
    expect(result.method).toBe('system');
  });

  it('parses random mode config with seed', () => {
    const result = LimitConfigSchema.parse({
      mode: 'random',
      limit: 10,
      method: 'bernoulli',
      seed: 42,
    });
    expect(result.mode).toBe('random');
    expect(result.method).toBe('bernoulli');
    expect(result.seed).toBe(42);
  });

  it('rejects invalid mode value', () => {
    expect(() => LimitConfigSchema.parse({ mode: 'unknown' })).toThrow(z.ZodError);
  });

  it('rejects invalid unit value', () => {
    expect(() => LimitConfigSchema.parse({ unit: 'invalid' })).toThrow(z.ZodError);
  });

  it('rejects limit with wrong type', () => {
    expect(() => LimitConfigSchema.parse({ limit: 'abc' })).toThrow(z.ZodError);
  });
});
