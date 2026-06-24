import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
  const type = 'limit' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormLimit — config ↔ DSL', () => {
  it('simple limit with default rows', () => {
    const r = ok({ mode: 'limit', limit: 100, unit: 'rows' });
    expect(r.dsl).toContain('limit 100');
    expect(r.dsl).not.toContain('top');
    expect(r.config.limit).toBe(100);
  });

  it('limit with percent unit', () => {
    const r = ok({ mode: 'limit', limit: 50, unit: 'percent' });
    expect(r.dsl).toContain('limit 50 percent');
  });

  it('limit with offset', () => {
    const r = ok({ mode: 'limit', limit: 25, unit: 'rows', offset: 10 });
    expect(r.dsl).toContain('limit 25');
    expect(r.dsl).toContain('offset 10');
  });

  it('top mode with order by', () => {
    const r = ok({
      mode: 'top',
      limit: 10,
      unit: 'rows',
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    });
    expect(r.dsl).toContain('top 10');
    expect(r.dsl).toContain('revenue');
    expect(r.dsl).toContain('desc');
  });

  it('top mode with multiple order keys', () => {
    const r = ok({
      mode: 'top',
      limit: 5,
      unit: 'rows',
      orderBy: [
        { field: 'category', direction: 'asc' },
        { field: 'revenue', direction: 'desc' },
      ],
    });
    expect(r.dsl).toContain('top 5');
    expect(r.dsl).toContain('category');
    expect(r.dsl).toContain('revenue');
    expect(r.dsl).toContain('asc');
    expect(r.dsl).toContain('desc');
  });

  it('limit without offset omits offset in DSL', () => {
    const r = ok({ mode: 'limit', limit: 100, unit: 'rows' });
    expect(r.dsl).not.toContain('offset');
    expect(r.config.offset).toBeUndefined();
  });
});

describe('FormLimit — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { mode: 'limit', limit: 100, unit: 'rows' },
      { mode: 'limit', limit: 50, unit: 'percent' },
      { mode: 'limit', limit: 25, unit: 'rows', offset: 10 },
      { mode: 'top', limit: 10, unit: 'rows', orderBy: [{ field: 'revenue', direction: 'desc' }] },
      {
        mode: 'top',
        limit: 5,
        unit: 'rows',
        orderBy: [
          { field: 'a', direction: 'asc' },
          { field: 'b', direction: 'desc' },
        ],
      },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({ id: 't', type: 'limit', config });
      const parsed = parsePrepOperatorDsl(dsl1, 'limit');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'limit',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});
