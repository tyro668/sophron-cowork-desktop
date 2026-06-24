import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
  const type = 'field_mapping' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
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
