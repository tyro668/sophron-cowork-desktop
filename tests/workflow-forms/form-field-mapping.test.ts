import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import { computeMappingTarget } from '../../src/main/data/operators/utils';
import type { MappingEntry } from '../../src/renderer/components/workflow-forms/FormFieldMapping';

function ok(config: Record<string, unknown>) {
  const type = 'field_mapping' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

// Replicate computeTarget from FormFieldMapping (module-level pure function)
function computeTarget(m: MappingEntry): string {
  if (!m.source) return '';
  if (m.targetMode === 'rename') return m.targetValue || '';
  return m.targetMode === 'prefix' ? `${m.targetValue}${m.source}` : `${m.source}${m.targetValue}`;
}

// Replicate migrateEntry from FormFieldMapping
function migrateEntry(e: Record<string, unknown>): MappingEntry {
  const source = (e.source as string) || '';
  const target = (e.target as string) || '';
  const targetMode = e.targetMode as string;
  if (targetMode === 'prefix' || targetMode === 'suffix' || targetMode === 'rename') {
    const targetValue = (e.targetValue as string) || '';
    return { source, targetMode, targetValue };
  }
  if (!source || !target) return { source, targetMode: 'rename', targetValue: target };
  if (target.startsWith(source))
    return {
      source,
      targetMode: 'suffix',
      targetValue: target.slice(source.length).replace(/^_/, ''),
    };
  if (target.endsWith(source))
    return {
      source,
      targetMode: 'prefix',
      targetValue: target.slice(0, -source.length).replace(/_$/, ''),
    };
  return { source, targetMode: 'rename', targetValue: target };
}

describe('FormFieldMapping — config ↔ DSL', () => {
  it('single mapping', () => {
    const r = ok({ mappings: [{ source: 'id', target: 'user_id' }] });
    expect(r.dsl).toContain('map');
    expect(r.dsl).toContain('id');
    expect(r.dsl).toContain('user_id');
  });

  it('multiple mappings', () => {
    const r = ok({
      mappings: [
        { source: 'id', target: 'user_id' },
        { source: 'name', target: 'user_name' },
        { source: 'email', target: 'contact_email' },
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
    const r = ok({ mappings: [{ source: 'first name', target: 'first_name' }] });
    expect(r.dsl).toContain('first name');
    expect(r.dsl).toContain('first_name');
  });
});

describe('FormFieldMapping — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { mappings: [{ source: 'id', target: 'user_id' }] },
      {
        mappings: [
          { source: 'a', target: 'x' },
          { source: 'b', target: 'y' },
        ],
      },
      { mappings: [{ source: 'old name', target: 'new_name' }] },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({
        id: 't',
        type: 'field_mapping',
        config,
      });
      const parsed = parsePrepOperatorDsl(dsl1, 'field_mapping');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'field_mapping',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});

describe('FormFieldMapping — computeTarget', () => {
  it('rename mode returns targetValue', () => {
    expect(computeTarget({ source: 'id', targetMode: 'rename', targetValue: 'user_id' })).toBe(
      'user_id'
    );
  });

  it('prefix mode prepends value', () => {
    expect(computeTarget({ source: 'name', targetMode: 'prefix', targetValue: 'stg_' })).toBe(
      'stg_name'
    );
  });

  it('suffix mode appends value', () => {
    expect(computeTarget({ source: 'email', targetMode: 'suffix', targetValue: '_bak' })).toBe(
      'email_bak'
    );
  });

  it('does not insert connector automatically', () => {
    expect(computeTarget({ source: 'id', targetMode: 'prefix', targetValue: 'stg' })).toBe('stgid');
  });

  it('returns empty string when source is empty', () => {
    expect(computeTarget({ source: '', targetMode: 'rename', targetValue: 'x' })).toBe('');
  });

  it('returns empty string when targetValue is empty in rename mode', () => {
    expect(computeTarget({ source: 'id', targetMode: 'rename', targetValue: '' })).toBe('');
  });

  it('returns just source when targetValue is empty in prefix mode', () => {
    expect(computeTarget({ source: 'id', targetMode: 'prefix', targetValue: '' })).toBe('id');
  });
});

describe('FormFieldMapping — migrateEntry', () => {
  it('passes through new format config directly', () => {
    const r = migrateEntry({ source: 'id', targetMode: 'prefix', targetValue: 'stg_' });
    expect(r).toEqual({ source: 'id', targetMode: 'prefix', targetValue: 'stg_' });
  });

  it('detects suffix from legacy { source, target }', () => {
    const r = migrateEntry({ source: 'id', target: 'id_bak' });
    expect(r.targetMode).toBe('suffix');
    expect(r.targetValue).toBe('bak');
  });

  it('detects prefix from legacy { source, target }', () => {
    const r = migrateEntry({ source: 'id', target: 'new_id' });
    expect(r.targetMode).toBe('prefix');
    expect(r.targetValue).toBe('new');
  });

  it('falls back to rename when legacy target has no overlap', () => {
    const r = migrateEntry({ source: 'id', target: 'new_name' });
    expect(r.targetMode).toBe('rename');
    expect(r.targetValue).toBe('new_name');
  });

  it('removes leading underscore from suffix value', () => {
    const r = migrateEntry({ source: 'id', target: 'id_bak' });
    expect(r.targetValue).toBe('bak');
  });

  it('removes trailing underscore from prefix value', () => {
    const r = migrateEntry({ source: 'id', target: 'new_id' });
    expect(r.targetValue).toBe('new');
  });

  it('returns rename with empty values when both source and target are empty', () => {
    const r = migrateEntry({});
    expect(r.targetMode).toBe('rename');
    expect(r.source).toBe('');
    expect(r.targetValue).toBe('');
  });
});

describe('FormFieldMapping — computeMappingTarget (backend)', () => {
  it('rename mode returns targetValue', () => {
    expect(
      computeMappingTarget({ source: 'id', targetMode: 'rename', targetValue: 'user_id' })
    ).toBe('user_id');
  });

  it('prefix mode prepends value', () => {
    expect(
      computeMappingTarget({ source: 'name', targetMode: 'prefix', targetValue: 'stg_' })
    ).toBe('stg_name');
  });

  it('suffix mode appends value', () => {
    expect(
      computeMappingTarget({ source: 'email', targetMode: 'suffix', targetValue: '_bak' })
    ).toBe('email_bak');
  });

  it('returns legacy target directly when targetMode is absent', () => {
    expect(computeMappingTarget({ source: 'id', target: 'user_id' })).toBe('user_id');
  });

  it('returns empty string when source is empty and no target', () => {
    expect(computeMappingTarget({ source: '', targetMode: 'rename', targetValue: 'x' })).toBe('');
  });

  it('prefers targetValue over target when targetMode is present', () => {
    expect(
      computeMappingTarget({
        source: 'id',
        target: 'old',
        targetMode: 'rename',
        targetValue: 'new',
      })
    ).toBe('new');
  });
});
