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
    expect(result.limit).toBe(10);
    expect(result.mode).toBe('fixed');
    expect(result.unit).toBe('rows');
    expect(result.ties).toBe(false);
    expect(result.offset).toBe(0);
    expect(result.method).toBeUndefined();
  });

  it('parses random mode config with seed', () => {
    const result = LimitConfigSchema.parse({
      mode: 'random',
      limit: 10,
      unit: 'percent',
      method: 'bernoulli',
      seed: 42,
    });
    expect(result.mode).toBe('random');
    expect(result.method).toBe('bernoulli');
    expect(result.seed).toBe(42);
  });

  it('normalizes legacy row-sampling methods to reservoir semantics', () => {
    const result = LimitConfigSchema.parse({
      mode: 'random',
      limit: 10,
      unit: 'rows',
      method: 'bernoulli',
    });

    expect(result.method).toBeUndefined();
  });

  it('clears legacy offsets in percentage mode', () => {
    const result = LimitConfigSchema.parse({
      limit: 10,
      unit: 'percent',
      offset: 5,
    });

    expect(result.offset).toBe(0);
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

  it('rejects negative offset', () => {
    expect(() => LimitConfigSchema.parse({ offset: -1 })).toThrow(z.ZodError);
  });

  it('rejects float offset', () => {
    expect(() => LimitConfigSchema.parse({ offset: 1.5 })).toThrow(z.ZodError);
  });

  it('rejects percentages above 100 but allows row limits above 100', () => {
    expect(() => LimitConfigSchema.parse({ limit: 101, unit: 'percent' })).toThrow(
      'Percentage cannot exceed 100'
    );
    expect(LimitConfigSchema.parse({ limit: 1_000, unit: 'rows' }).limit).toBe(1_000);
  });
});
