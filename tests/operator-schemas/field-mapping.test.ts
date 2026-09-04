import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FieldMappingConfigSchema } from '../../src/shared/operator-schemas';

describe('FieldMappingConfigSchema', () => {
  it('preserves stable UI row ids', () => {
    const result = FieldMappingConfigSchema.parse({
      mappings: [{ id: 'mapping-1', source: 'a', targetMode: 'rename', targetValue: 'b' }],
    });

    expect(result.mappings[0].id).toBe('mapping-1');
  });

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

  it('allows a rename whose source and target names are equal', () => {
    const result = FieldMappingConfigSchema.parse({
      mappings: [{ source: 'status', targetMode: 'rename', targetValue: 'status' }],
    });

    expect(result.mappings[0]).toMatchObject({ source: 'status', targetValue: 'status' });
  });

  it('validates whitespace without changing field names or affixes', () => {
    const result = FieldMappingConfigSchema.parse({
      mappings: [{ source: ' amount ', targetMode: 'suffix', targetValue: ' kg' }],
    });

    expect(result.mappings[0]).toMatchObject({ source: ' amount ', targetValue: ' kg' });
  });

  it('rejects mappings without an explicit target mode', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({ mappings: [{ source: 'a', target: 'b' }] })
    ).toThrow(z.ZodError);
  });

  it('rejects config when mappings are omitted', () => {
    expect(() => FieldMappingConfigSchema.parse({})).toThrow(
      'At least one field mapping is required'
    );
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

  it('rejects an empty source placeholder row', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [{ source: '', targetMode: 'rename', targetValue: '' }],
      })
    ).toThrow('Source field is required');
  });

  it('rejects a blank row after a valid mapping', () => {
    const result = FieldMappingConfigSchema.safeParse({
      mappings: [
        { source: 'a', targetMode: 'rename', targetValue: 'x' },
        { source: '', targetMode: 'rename', targetValue: '' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['mappings', 1, 'source'] })])
      );
    }
  });

  it('rejects invalid targetMode value', () => {
    expect(() =>
      FieldMappingConfigSchema.parse({
        mappings: [{ source: 'a', targetMode: 'invalid', targetValue: 'b' }],
      })
    ).toThrow(z.ZodError);
  });
});
