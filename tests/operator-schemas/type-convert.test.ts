import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TypeConvertConfigSchema } from '../../src/shared/operator-schemas';

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
});
