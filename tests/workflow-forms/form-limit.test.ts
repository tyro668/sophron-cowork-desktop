import {
  validateLimitCount,
  validateLimitSeed,
} from '../../src/renderer/components/workflow-forms/FormLimit';
import { describe, expect, it } from 'vitest';
import { exportStep, parseStep } from '../helpers/jflow-step';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function ok(config: Record<string, unknown>) {
  const type = 'limit' as const;
  const dsl = exportStep({ id: 'test', type, config });
  const parsed = parseStep(dsl, type);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  expect(errors, `DSL errors: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return { dsl, config: parsed.operator!.config };
}

describe('FormLimit — config ↔ DSL', () => {
  it('simple limit with default rows', () => {
    const r = ok({ sampling: 'fixed', limit: 100, unit: 'rows' });
    expect(r.dsl).toContain('take 100');
    expect(r.dsl).not.toContain('top');
    expect(r.config.limit).toBe(100);
  });

  it('limit with percent unit', () => {
    const r = ok({ sampling: 'fixed', limit: 50, unit: 'percent' });
    expect(r.dsl).toContain('take 50%');
  });

  it('limit with offset', () => {
    const r = ok({ sampling: 'fixed', limit: 25, unit: 'rows', offset: 10 });
    expect(r.dsl).toContain('take 25 offset: 10');
    expect(r.dsl).toContain('take 25 offset: 10');
  });

  it('top mode with order by', () => {
    const r = ok({
      sampling: 'fixed',
      limit: 10,
      unit: 'rows',
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    });
    expect(r.dsl).toContain('take 10 sort: -[revenue]');
    expect(r.dsl).toContain('revenue');
    expect(r.dsl).toContain('take 10 sort: -[revenue]');
  });

  it('top mode with multiple order keys', () => {
    const r = ok({
      sampling: 'fixed',
      limit: 5,
      unit: 'rows',
      orderBy: [
        { field: 'category', direction: 'asc' },
        { field: 'revenue', direction: 'desc' },
      ],
    });
    expect(r.dsl).toContain('take 5 sort: [category], -[revenue]');
    expect(r.dsl).toContain('category');
    expect(r.dsl).toContain('revenue');
    expect(r.dsl).toContain('take 5 sort: [category], -[revenue]');
    expect(r.dsl).toContain('-[revenue]');
  });

  it('limit without offset omits offset in DSL', () => {
    const r = ok({ sampling: 'fixed', limit: 100, unit: 'rows' });
    expect(r.dsl).not.toContain('offset');
    expect(r.config.offset).toBeUndefined();
  });
});

describe('FormLimit — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { sampling: 'fixed', limit: 100, unit: 'rows' },
      { sampling: 'fixed', limit: 50, unit: 'percent' },
      { sampling: 'fixed', limit: 25, unit: 'rows', offset: 10 },
      {
        sampling: 'fixed',
        limit: 10,
        unit: 'rows',
        orderBy: [{ field: 'revenue', direction: 'desc' }],
      },
      {
        sampling: 'fixed',
        limit: 5,
        unit: 'rows',
        orderBy: [
          { field: 'a', direction: 'asc' },
          { field: 'b', direction: 'desc' },
        ],
      },
      {
        sampling: 'fixed',
        limit: 10,
        unit: 'rows',
        orderBy: [{ field: 'score', direction: 'desc' }],
        ties: true,
      },
      { sampling: 'random', limit: 100, unit: 'rows' },
      { sampling: 'random', limit: 10, unit: 'percent', method: 'system', seed: 42 },
    ];
    for (const config of configs) {
      const dsl1 = exportStep({ id: 't', type: 'limit', config });
      const parsed = parseStep(dsl1, 'limit');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportStep({
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
      sampling: 'fixed',
      limit: 10,
      unit: 'rows',
      orderBy: [{ field: 'score', direction: 'desc' }],
      ties: true,
    });
    expect(r.dsl).toContain('take 10 sort: -[score] ties: include');
    expect(r.dsl).toContain('take 10 sort: -[score] ties: include');
  });

  it('sample rows mode produces sample DSL', () => {
    const r = ok({ sampling: 'random', limit: 100, unit: 'rows' });
    expect(r.dsl).toContain('sample 100');
    expect(r.dsl).not.toContain('system');
    expect(r.dsl).not.toContain('bernoulli');
  });

  it('sample percent mode produces sample DSL with percent', () => {
    const r = ok({ sampling: 'random', limit: 10, unit: 'percent', method: 'system' });
    expect(r.dsl).toContain('sample 10%');
  });

  it('sample with seed produces repeatable DSL', () => {
    const r = ok({ sampling: 'random', limit: 100, unit: 'rows', seed: 42 });
    expect(r.dsl).toContain('sample 100 seed: 42');
    expect(r.dsl).toContain('sample 100 seed: 42');
  });

  it('system is default method and omitted in DSL', () => {
    const r = ok({ sampling: 'random', limit: 50, unit: 'percent', method: 'system' });
    expect(r.dsl).toContain('sample 50%');
    expect(r.dsl).not.toContain('system');
  });

  it('rejects a zero limit', () => {
    expect(exportStep({ id: 'limit-zero', type: 'limit', config: { limit: 0 } })).toBe('');
    expect(parseStep('take 0', 'limit').diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'E_ARG_RANGE' })])
    );
  });

  it('percent + orderBy + ties preserves the percent unit', () => {
    const r = ok({
      sampling: 'fixed',
      limit: 10,
      unit: 'percent',
      orderBy: [{ field: 'score', direction: 'desc' }],
      ties: true,
    });
    expect(r.dsl).toContain('take 10% sort: -[score] ties: include');
    expect(r.dsl).toContain('take 10% sort: -[score] ties: include');
    expect(r.dsl).toContain('ties: include');
    expect(r.config.unit).toBe('percent');
  });

  it('ordered row limits preserve offset in top DSL', () => {
    const r = ok({
      sampling: 'fixed',
      limit: 10,
      unit: 'rows',
      offset: 5,
      orderBy: [{ field: 'score', direction: 'desc' }],
    });

    expect(r.dsl).toContain('take 10 sort: -[score] offset: 5');
    expect(r.config.offset).toBe(5);
  });
});

// ── UI source structure ─────────────────────────────────────────────

const limitSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/workflow-forms/FormLimit.tsx'),
  'utf8'
);

describe('FormLimit — UI source structure', () => {
  it('no longer imports GlassSortKeyEditor or the old radio sidebar', () => {
    expect(limitSource).not.toContain('GlassSortKeyEditor');
    expect(limitSource).not.toContain('GlassRadioSelect');
    expect(limitSource).not.toContain('w-[180px]');
  });

  it('uses a dropdown for the mode row', () => {
    expect(limitSource).toContain('<SelectCell');
    expect(limitSource).not.toContain('<SegmentCells');
    expect(limitSource).toContain("'limitMode'");
    expect(limitSource).toContain('onChange={setMode}');
  });

  it('clears the persisted limit when the quantity input is cleared', () => {
    // Empty / invalid input commits `limit: undefined` (n is undefined).
    expect(limitSource).toContain('updateConfig((cfg) => ({ ...cfg, limit: n }))');
    expect(validateLimitCount('', 'rows')).toBe('count');
  });

  it('edits sort keys with the shared sort-keys editor', () => {
    expect(limitSource).toContain('SortKeysEditor');
    expect(limitSource).toContain('onChange={commitSortKeys}');
  });

  it('only shows system and bernoulli methods for percentage sampling', () => {
    expect(limitSource).toContain('{!isRows ? (');
    expect(limitSource).toContain("value: 'bernoulli'");
    expect(limitSource).toContain("value: 'system'");
  });

  it('WITH TIES checkbox shows whenever sort keys exist (no isRows guard)', () => {
    // The checkbox condition should be just `hasSort`, not `isRows && hasSort`
    const tiesCheckbox = limitSource.match(/const tiesRow = hasSort \?/);
    expect(tiesCheckbox).not.toBeNull();
    expect(limitSource).not.toContain('isRows && hasSort && (');
  });
});

describe('limit count / seed validation', () => {
  it('requires a positive integer count and caps percent at 100', () => {
    expect(validateLimitCount('0', 'rows')).toBe('count');
    expect(validateLimitCount('1.5', 'rows')).toBe('count');
    expect(validateLimitCount('-3', 'rows')).toBe('count');
    expect(validateLimitCount('10', 'rows')).toBeNull();
    expect(validateLimitCount('101', 'percent')).toBe('percent');
    expect(validateLimitCount('100', 'percent')).toBeNull();
  });
  it('accepts an empty seed but rejects non-integers', () => {
    expect(validateLimitSeed('')).toBe(true);
    expect(validateLimitSeed('42')).toBe(true);
    expect(validateLimitSeed('4.2')).toBe(false);
    expect(validateLimitSeed('abc')).toBe(false);
  });
});
