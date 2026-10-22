import { describe, expect, it } from 'vitest';
import { migrateConfigToV3Naming } from '../../src/main/data/store/v3-config-naming';

describe('prep-dsl/v3 config naming migration', () => {
  it('renames legacy keys per operator', () => {
    expect(migrateConfigToV3Naming('sort', { keys: [{ field: 'a' }] })).toEqual({
      orderBy: [{ field: 'a' }],
    });
    expect(migrateConfigToV3Naming('field_select', { columns: ['a'], mode: 'exclude' })).toEqual({
      fields: ['a'],
      selection: 'exclude',
    });
    expect(migrateConfigToV3Naming('limit', { limit: 5, mode: 'random' })).toEqual({
      limit: 5,
      sampling: 'random',
    });
    expect(migrateConfigToV3Naming('set_op', { mode: 'all' })).toEqual({ quantifier: 'all' });
    expect(
      migrateConfigToV3Naming('missing_value', {
        columns: ['a'],
        rules: [{ column: 'b', method: 'skip' }],
      })
    ).toEqual({ fields: ['a'], rules: [{ field: 'b', method: 'skip' }] });
    expect(
      migrateConfigToV3Naming('type_convert', { conversions: [{ column: 'x', type: 'text' }] })
    ).toEqual({
      conversions: [{ field: 'x', type: 'text' }],
    });
    expect(migrateConfigToV3Naming('unnest', { column: 'x' })).toEqual({ field: 'x' });
  });

  it('leaves v3 and output configs untouched', () => {
    expect(migrateConfigToV3Naming('sort', { orderBy: [] })).toBeNull();
    expect(migrateConfigToV3Naming('output', { mode: 'replace' })).toBeNull();
  });
});
