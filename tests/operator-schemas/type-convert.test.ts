import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  TypeConvertConfigSchema,
  DATE_FORMAT_VALUES,
  DATE_FORMAT_PRESETS,
} from '../../src/shared/operator-schemas';

describe('TypeConvertConfigSchema', () => {
  it('parses valid conversions with all fields', () => {
    const result = TypeConvertConfigSchema.parse({
      conversions: [{ column: 'age', type: 'integer', onError: 'fail' }],
    });
    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].column).toBe('age');
    expect(result.conversions[0].type).toBe('integer');
    expect(result.conversions[0].onError).toBe('fail');
  });

  it('parses format field for date conversions', () => {
    const result = TypeConvertConfigSchema.parse({
      conversions: [{ column: 'dt', type: 'date', format: '%m/%d/%y' }],
    });
    expect(result.conversions[0].format).toBe('%m/%d/%y');
  });

  it('applies defaults for omitted fields', () => {
    const result = TypeConvertConfigSchema.parse({ conversions: [{ column: 'age' }] });
    expect(result.conversions[0].type).toBe('text');
    expect(result.conversions[0].onError).toBeUndefined();
  });

  it('defaults to empty array when conversions omitted', () => {
    const result = TypeConvertConfigSchema.parse({});
    expect(result.conversions).toEqual([]);
  });

  it('rejects conversions with wrong type', () => {
    expect(() => TypeConvertConfigSchema.parse({ conversions: 'not-array' })).toThrow(z.ZodError);
  });

  it('rejects invalid format string', () => {
    expect(() =>
      TypeConvertConfigSchema.parse({
        conversions: [{ column: 'dt', type: 'date', format: '%Q' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects empty string format', () => {
    const result = TypeConvertConfigSchema.parse({
      conversions: [{ column: 'dt', type: 'date', format: '' }],
    });
    expect(result.conversions[0].format).toBeUndefined();
  });

  it('exports DATE_FORMAT_VALUES and DATE_FORMAT_PRESETS with matching lengths', () => {
    expect(DATE_FORMAT_VALUES.length).toBeGreaterThan(0);
    expect(DATE_FORMAT_PRESETS.length).toBe(DATE_FORMAT_VALUES.length);
    DATE_FORMAT_PRESETS.forEach((p, i) => {
      expect(p.value).toBe(DATE_FORMAT_VALUES[i]);
    });
  });

  it('parses valid scale for decimal conversions', () => {
    const result = TypeConvertConfigSchema.parse({
      conversions: [{ column: 'price', type: 'decimal', scale: 4 }],
    });
    expect(result.conversions[0].scale).toBe(4);
  });

  it('rejects scale below 0', () => {
    expect(() =>
      TypeConvertConfigSchema.parse({
        conversions: [{ column: 'price', type: 'decimal', scale: -1 }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects scale above 18', () => {
    expect(() =>
      TypeConvertConfigSchema.parse({
        conversions: [{ column: 'price', type: 'decimal', scale: 19 }],
      })
    ).toThrow(z.ZodError);
  });

  it('accepts scale 0 for decimal', () => {
    const result = TypeConvertConfigSchema.parse({
      conversions: [{ column: 'price', type: 'decimal', scale: 0 }],
    });
    expect(result.conversions[0].scale).toBe(0);
  });

  it('rejects non-integer scale', () => {
    expect(() =>
      TypeConvertConfigSchema.parse({
        conversions: [{ column: 'price', type: 'decimal', scale: 2.5 }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects empty string scale as undefined', () => {
    const result = TypeConvertConfigSchema.parse({
      conversions: [{ column: 'price', type: 'decimal', scale: '' }],
    });
    expect(result.conversions[0].scale).toBeUndefined();
  });

  it('rejects format with non-date type', () => {
    expect(() =>
      TypeConvertConfigSchema.parse({
        conversions: [{ column: 'x', type: 'integer', format: '%Y-%m-%d' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects scale with non-decimal type', () => {
    expect(() =>
      TypeConvertConfigSchema.parse({
        conversions: [{ column: 'x', type: 'integer', scale: 4 }],
      })
    ).toThrow(z.ZodError);
  });
});
