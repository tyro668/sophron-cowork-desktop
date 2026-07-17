import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FieldMappingConfigSchema } from '../../src/shared/operator-schemas';

describe('FieldMappingConfigSchema', () => {
  it('parses valid mappings with all fields', () => {
    const result = FieldMappingConfigSchema.parse({
      mappings: [
        { source: 'old_name', targetMode: 'rename', targetValue: 'new_name' },
        { source: 'col', targetMode: 'prefix', targetValue: 'p_' },
      ],
    });
    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[0].source).toBe('old_name');
    expect(result.mappings[1].targetMode).toBe('prefix');
  });

  it('defaults missing fields in mapping entries', () => {
    const result = FieldMappingConfigSchema.parse({ mappings: [{ source: 'a' }] });
    expect(result.mappings[0].source).toBe('a');
    expect(result.mappings[0].targetValue).toBe('');
  });

  it('defaults to empty array when mappings omitted', () => {
    const result = FieldMappingConfigSchema.parse({});
    expect(result.mappings).toEqual([]);
  });

  it('rejects mappings with wrong type', () => {
    expect(() => FieldMappingConfigSchema.parse({ mappings: 'not-array' })).toThrow(z.ZodError);
  });
});
