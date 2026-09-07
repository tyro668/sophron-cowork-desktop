import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
    const r = ok({ mode: 'fixed', limit: 100, unit: 'rows' });
    expect(r.dsl).toContain('limit 100');
    expect(r.dsl).not.toContain('top');
    expect(r.config.limit).toBe(100);
  });

  it('limit with percent unit', () => {
    const r = ok({ mode: 'fixed', limit: 50, unit: 'percent' });
    expect(r.dsl).toContain('limit 50 percent');
  });

  it('limit with offset', () => {
    const r = ok({ mode: 'fixed', limit: 25, unit: 'rows', offset: 10 });
    expect(r.dsl).toContain('limit 25');
    expect(r.dsl).toContain('offset 10');
  });

  it('top mode with order by', () => {
    const r = ok({
      mode: 'fixed',
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
      mode: 'fixed',
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
    const r = ok({ mode: 'fixed', limit: 100, unit: 'rows' });
    expect(r.dsl).not.toContain('offset');
    expect(r.config.offset).toBeUndefined();
  });
});

describe('FormLimit — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { mode: 'fixed', limit: 100, unit: 'rows' },
      { mode: 'fixed', limit: 50, unit: 'percent' },
      { mode: 'fixed', limit: 25, unit: 'rows', offset: 10 },
      {
        mode: 'fixed',
        limit: 10,
        unit: 'rows',
        orderBy: [{ field: 'revenue', direction: 'desc' }],
      },
      {
        mode: 'fixed',
        limit: 5,
        unit: 'rows',
        orderBy: [
          { field: 'a', direction: 'asc' },
          { field: 'b', direction: 'desc' },
        ],
      },
      {
        mode: 'fixed',
        limit: 10,
        unit: 'rows',
        orderBy: [{ field: 'score', direction: 'desc' }],
        ties: true,
      },
      { mode: 'random', limit: 100, unit: 'rows' },
      { mode: 'random', limit: 10, unit: 'percent', method: 'system', seed: 42 },
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

describe('FormLimit — new features', () => {
  it('top with ties includes with ties in DSL', () => {
    const r = ok({
      mode: 'fixed',
      limit: 10,
      unit: 'rows',
      orderBy: [{ field: 'score', direction: 'desc' }],
      ties: true,
    });
    expect(r.dsl).toContain('top 10');
    expect(r.dsl).toContain('with ties');
  });

  it('sample rows mode produces sample DSL', () => {
    const r = ok({ mode: 'random', limit: 100, unit: 'rows' });
    expect(r.dsl).toContain('sample 100 rows');
    expect(r.dsl).not.toContain('system');
    expect(r.dsl).not.toContain('bernoulli');
  });

  it('sample percent mode produces sample DSL with percent', () => {
    const r = ok({ mode: 'random', limit: 10, unit: 'percent', method: 'system' });
    expect(r.dsl).toContain('sample 10 percent');
  });

  it('sample with seed produces repeatable DSL', () => {
    const r = ok({ mode: 'random', limit: 100, unit: 'rows', seed: 42 });
    expect(r.dsl).toContain('sample 100 rows');
    expect(r.dsl).toContain('repeatable 42');
  });

  it('system is default method and omitted in DSL', () => {
    const r = ok({ mode: 'random', limit: 50, unit: 'percent', method: 'system' });
    expect(r.dsl).toContain('sample 50 percent');
    expect(r.dsl).not.toContain('system');
  });

  it('rejects a zero limit', () => {
    expect(exportPrepOperatorDsl({ id: 'limit-zero', type: 'limit', config: { limit: 0 } })).toBe(
      ''
    );
    expect(parsePrepOperatorDsl('limit 0', 'limit').diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidLimit' })])
    );
  });

  it('percent + orderBy + ties preserves the percent unit', () => {
    const r = ok({
      mode: 'fixed',
      limit: 10,
      unit: 'percent',
      orderBy: [{ field: 'score', direction: 'desc' }],
      ties: true,
    });
    expect(r.dsl).toContain('top 10');
    expect(r.dsl).toContain('percent');
    expect(r.dsl).toContain('with ties');
    expect(r.config.unit).toBe('percent');
  });

  it('ordered row limits preserve offset in top DSL', () => {
    const r = ok({
      mode: 'fixed',
      limit: 10,
      unit: 'rows',
      offset: 5,
      orderBy: [{ field: 'score', direction: 'desc' }],
    });

    expect(r.dsl).toContain('offset 5');
    expect(r.config.offset).toBe(5);
  });
});

// ── UI source structure ─────────────────────────────────────────────

const limitSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/workflow-forms/FormLimit.tsx'),
  'utf8'
);

describe('FormLimit — UI source structure', () => {
  it('no longer imports GlassSortKeyEditor', () => {
    expect(limitSource).not.toContain('GlassSortKeyEditor');
  });

  it('uses GlassRadioSelect for the mode sidebar', () => {
    expect(limitSource).toContain('import { GlassRadioSelect }');
    expect(limitSource).toContain('<GlassRadioSelect');
    expect(limitSource).toContain('w-[180px]');
  });

  it('mode selection is separate from the detail controls', () => {
    expect(limitSource).toContain("'limitMode'");
    expect(limitSource).toContain('onChange={setMode}');
  });

  it('clears the persisted limit when the quantity input is cleared', () => {
    expect(limitSource).toContain('updateConfig((cfg) => ({ ...cfg, limit: undefined }))');
  });

  it('sort field tag-input has direction toggles (↑↓)', () => {
    const sortTags = limitSource.match(/\{k\.direction\s*===\s*'asc'\s*\?\s*'↑'\s*:\s*'↓'\s*\}/);
    expect(sortTags).not.toBeNull();
  });

  it('sort field input has stable key', () => {
    expect(limitSource).toContain('key="sort-input"');
  });

  it('WITH TIES checkbox is inside sort row (not separate row)', () => {
    const tiesLine = limitSource.indexOf('limitTies');
    expect(tiesLine).not.toBe(-1);
    const sortSection = limitSource.slice(
      limitSource.indexOf('sortOpen ?'),
      limitSource.indexOf('limitTies')
    );
    expect(sortSection.length).toBeGreaterThan(0);
    expect(limitSource).not.toContain('{/* WITH TIES */}');
  });

  it('sort container width is fixed (w-72, not flex-1)', () => {
    const sortContainer = limitSource.match(/className="w-72 min-w-0 relative"/g);
    expect(sortContainer).not.toBeNull();
    // Should not have flex-1 for sort container
    expect(limitSource).not.toContain('className="flex-1 min-w-0 relative"');
  });

  it('all quantity/unit/offset/seed/method controls use the standard width w-60', () => {
    const w60Controls = limitSource.match(/w-60/g);
    expect(w60Controls!.length).toBe(5);
    expect(limitSource).not.toMatch(/w-28/);
  });

  it('only shows system and bernoulli methods for percentage sampling', () => {
    expect(limitSource).toContain('{!isRows && (');
  });

  it('sort tags use compact padding (px-1)', () => {
    const sortTag = limitSource.match(/px-1 py-0\.5 text-\[12px\] font-medium text-accent/g);
    expect(sortTag).not.toBeNull();
    expect(limitSource).not.toContain('px-1.5 py-0.5 text-[12px] font-medium text-accent');
  });

  it('WITH TIES checkbox shows for both rows and percent (no isRows guard)', () => {
    // The checkbox condition should be just `hasSort`, not `isRows && hasSort`
    const tiesCheckbox = limitSource.match(/\{hasSort\s*&&\s*\(/);
    expect(tiesCheckbox).not.toBeNull();
    expect(limitSource).not.toContain('isRows && hasSort && (');
  });
});
