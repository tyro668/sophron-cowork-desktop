import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function ok(config: Record<string, unknown>) {
  const type = 'deduplicate' as const;
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormDeduplicate — config ↔ DSL', () => {
  it('all columns, keep first', () => {
    const r = ok({ strategy: 'all_columns' });
    expect(r.dsl).toBe('deduplicate');
    expect(r.config.strategy).toBe('all_columns');
  });

  it('all columns, keep last', () => {
    const r = ok({ strategy: 'all_columns', keep: 'last' });
    expect(r.config.keep).toBe('last');
  });

  it('by columns, keep first', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['order_id'],
      keep: 'first',
    });
    expect(r.dsl).toContain('by [order_id]');
    expect(r.config.strategy).toBe('by_columns');
  });

  it('by columns, keep last with order', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['order_id'],
      keep: 'last',
      orderBy: [{ field: 'updated_at', direction: 'desc' }],
    });
    expect(r.dsl).toContain('keep last');
    expect(r.dsl).toContain('order by [updated_at] desc');
  });

  it('by multiple columns', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['order_id', 'sku_id'],
      keep: 'first',
    });
    expect(r.dsl).toContain('by [order_id], [sku_id]');
    expect(r.config.columns).toEqual(['order_id', 'sku_id']);
  });

  it('by columns with nulls positioning', () => {
    const r = ok({
      strategy: 'by_columns',
      columns: ['id'],
      keep: 'last',
      orderBy: [{ field: 'updated_at', direction: 'asc', nulls: 'last' }],
    });
    expect(r.dsl).toContain('nulls last');
  });
});

describe('FormDeduplicate — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { strategy: 'all_columns' },
      { strategy: 'by_columns', columns: ['id'], keep: 'first' },
      {
        strategy: 'by_columns',
        columns: ['a', 'b'],
        keep: 'last',
        orderBy: [{ field: 'ts', direction: 'desc' }],
      },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({
        id: 't',
        type: 'deduplicate',
        config,
      });
      const parsed = parsePrepOperatorDsl(dsl1, 'deduplicate');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'deduplicate',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});
