import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import { compileFieldMappingSql } from '../../src/main/data/operators/field-mapping';
import {
  computeFieldMappingTarget,
  normalizeFieldMappingEntry,
} from '../../src/shared/operator-config';

function ok(config: Record<string, unknown>) {
  const type = 'rename' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormFieldMapping — config ↔ DSL', () => {
  it('single mapping', () => {
    const r = ok({
      mappings: [{ source: 'id', targetMode: 'rename', targetValue: 'user_id' }],
    });
    expect(r.dsl).toContain('rename');
    expect(r.dsl).toContain('id');
    expect(r.dsl).toContain('user_id');
  });

  it('multiple mappings', () => {
    const r = ok({
      mappings: [
        { source: 'id', targetMode: 'rename', targetValue: 'user_id' },
        { source: 'name', targetMode: 'rename', targetValue: 'user_name' },
        { source: 'email', targetMode: 'rename', targetValue: 'contact_email' },
      ],
    });
    expect(r.dsl).toContain('id');
    expect(r.dsl).toContain('user_id');
    expect(r.dsl).toContain('name');
    expect(r.dsl).toContain('contact_email');
    const mappings = r.config.mappings as Array<Record<string, unknown>>;
    expect(mappings).toHaveLength(3);
  });

  it('mapping with special characters in field names', () => {
    const r = ok({
      mappings: [{ source: 'first name', targetMode: 'rename', targetValue: 'first_name' }],
    });
    expect(r.dsl).toContain('first name');
    expect(r.dsl).toContain('first_name');
  });
});

describe('FormFieldMapping — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { mappings: [{ source: 'id', targetMode: 'rename', targetValue: 'user_id' }] },
      {
        mappings: [
          { source: 'a', targetMode: 'rename', targetValue: 'x' },
          { source: 'b', targetMode: 'rename', targetValue: 'y' },
        ],
      },
      { mappings: [{ source: 'old name', targetMode: 'rename', targetValue: 'new_name' }] },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({
        id: 't',
        type: 'rename',
        config,
      });
      const parsed = parsePrepOperatorDsl(dsl1, 'rename');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'rename',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });

  it('parses DSL into configuration accepted by the graphical form', () => {
    const parsed = parsePrepOperatorDsl('rename [old] as [new]', 'rename');
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    const mappings = parsed.operator?.config.mappings as Record<string, unknown>[];
    expect(mappings.map(normalizeFieldMappingEntry)).toEqual([
      { source: 'old', targetMode: 'rename', targetValue: 'new' },
    ]);
  });
});

describe('FormFieldMapping — computeTarget', () => {
  it('rename mode returns targetValue', () => {
    expect(
      computeFieldMappingTarget({ source: 'id', targetMode: 'rename', targetValue: 'user_id' })
    ).toBe('user_id');
  });

  it('prefix mode prepends value', () => {
    expect(
      computeFieldMappingTarget({ source: 'name', targetMode: 'prefix', targetValue: 'stg_' })
    ).toBe('stg_name');
  });

  it('suffix mode appends value', () => {
    expect(
      computeFieldMappingTarget({ source: 'email', targetMode: 'suffix', targetValue: '_bak' })
    ).toBe('email_bak');
  });

  it('does not insert connector automatically', () => {
    expect(
      computeFieldMappingTarget({ source: 'id', targetMode: 'prefix', targetValue: 'stg' })
    ).toBe('stgid');
  });

  it('returns empty string when source is empty', () => {
    expect(computeFieldMappingTarget({ source: '', targetMode: 'rename', targetValue: 'x' })).toBe(
      ''
    );
  });

  it('returns empty string when targetValue is empty in rename mode', () => {
    expect(computeFieldMappingTarget({ source: 'id', targetMode: 'rename', targetValue: '' })).toBe(
      ''
    );
  });

  it('returns just source when targetValue is empty in prefix mode', () => {
    expect(computeFieldMappingTarget({ source: 'id', targetMode: 'prefix', targetValue: '' })).toBe(
      'id'
    );
  });
});

describe('FormFieldMapping — normalizeEntry', () => {
  it('normalizes current-format configuration', () => {
    expect(
      normalizeFieldMappingEntry({ source: 'id', targetMode: 'prefix', targetValue: 'stg_' })
    ).toEqual({ source: 'id', targetMode: 'prefix', targetValue: 'stg_' });
  });

  it('rejects a missing or unsupported target mode', () => {
    expect(() => normalizeFieldMappingEntry({ source: 'id' })).toThrow(
      'Unsupported field mapping target mode'
    );
    expect(() => normalizeFieldMappingEntry({ source: 'id', targetMode: 'invalid' })).toThrow(
      'Unsupported field mapping target mode'
    );
  });
});

describe('FormFieldMapping — SQL compilation', () => {
  it('uses the same target computation for rename, prefix and suffix modes', () => {
    const sql = compileFieldMappingSql('output', 'input', ['id', 'name', 'email'], {
      mappings: [
        { source: 'id', targetMode: 'rename', targetValue: 'user_id' },
        { source: 'name', targetMode: 'prefix', targetValue: 'stg_' },
        { source: 'email', targetMode: 'suffix', targetValue: '_backup' },
      ],
    });

    expect(sql).toContain('"id" AS "user_id"');
    expect(sql).toContain('"name" AS "stg_name"');
    expect(sql).toContain('"email" AS "email_backup"');
  });
});
