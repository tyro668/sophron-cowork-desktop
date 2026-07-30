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

  it('rejects rename with empty targetValue', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [{ source: 'a', targetMode: 'rename', targetValue: '' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects prefix with empty targetValue', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [{ source: 'a', targetMode: 'prefix', targetValue: '' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects suffix with empty targetValue', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [{ source: 'a', targetMode: 'suffix', targetValue: '' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects duplicate source fields', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [
          { source: 'a', targetMode: 'rename', targetValue: 'x' },
          { source: 'a', targetMode: 'rename', targetValue: 'y' },
        ],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects duplicate target names', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [
          { source: 'a', targetMode: 'rename', targetValue: 'x' },
          { source: 'b', targetMode: 'rename', targetValue: 'x' },
        ],
      })
    ).toThrow(z.ZodError);
  });

  it('accepts old format without targetMode (legacy compat)', () => {
    const result = FieldMappingConfigSchema.parse({
      mappings: [{ source: 'a', target: 'b' }],
    });
    expect(result.mappings[0].source).toBe('a');
  });

  it('accepts empty source placeholder row', () => {
    const result = FieldMappingConfigSchema.parse({
      mappings: [{ source: '', targetMode: 'rename', targetValue: '' }],
    });
    expect(result.mappings).toHaveLength(1);
  });

  it('rejects invalid targetMode value', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [{ source: 'a', targetMode: 'invalid', targetValue: 'b' }],
      })
    ).toThrow(z.ZodError);
  });
});
