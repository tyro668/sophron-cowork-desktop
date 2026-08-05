import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FilterConfigSchema } from '../../src/shared/operator-schemas';

describe('FilterConfigSchema', () => {
  it('parses a valid condition', () => {
    const result = FilterConfigSchema.parse({ condition: '[revenue] > 0' });
    expect(result.condition).toBe('[revenue] > 0');
  });

  it('trims surrounding whitespace from the condition', () => {
    const result = FilterConfigSchema.parse({ condition: '  [revenue] > 0  ' });
    expect(result.condition).toBe('[revenue] > 0');
  });

  it('rejects an omitted condition', () => {
    expect(() => FilterConfigSchema.parse({})).toThrow('Filter requires a condition');
  });

  it('rejects an empty condition', () => {
    expect(() => FilterConfigSchema.parse({ condition: '' })).toThrow(
      'Filter requires a condition'
    );
  });

  it('rejects a whitespace-only condition', () => {
    expect(() => FilterConfigSchema.parse({ condition: '   ' })).toThrow(
      'Filter requires a condition'
    );
  });

  it('rejects a non-string condition', () => {
    expect(() => FilterConfigSchema.parse({ condition: 42 })).toThrow(z.ZodError);
  });
});
