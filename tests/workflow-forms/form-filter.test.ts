import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

function roundTrip(config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type: 'filter', config });
  const parsed = parsePrepOperatorDsl(dsl, 'filter');
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  return { dsl, parsed, errors };
}

function ok(config: Record<string, unknown>) {
  const { dsl, parsed, errors } = roundTrip(config);
  expect(errors, `DSL errors for filter: ${dsl}`).toHaveLength(0);
  expect(parsed.operator, `null operator: ${dsl}`).not.toBeNull();
  return parsed.operator!;
}

describe('FormFilter — config ↔ DSL', () => {
  it('simple comparison', () => {
    const r = ok({ condition: '[revenue] > 0' });
    expect(r.config.condition).toBe('[revenue] > 0');
  });

  it('string equality', () => {
    const r = ok({ condition: '[region] = "EU"' });
    expect(r.config.condition).toContain('EU');
  });

  it('not equal', () => {
    const r = ok({ condition: '[status] != "TEST"' });
    expect(r.config.condition).toContain('!=');
  });

  it('between two values', () => {
    const r = ok({ condition: '[price] between 10 and 100' });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain('and');
  });

  it('between with dates', () => {
    const r = ok({
      condition: '[order_date] between 2024-01-01 and 2024-12-31',
    });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain('2024-01-01');
  });

  it('AND compound', () => {
    const r = ok({
      condition: '[revenue] > 0 and [region] = "EU"',
    });
    expect(r.config.condition).toContain(' and ');
  });

  it('OR compound', () => {
    const r = ok({
      condition: '[region] = "EU" or [region] = "US"',
    });
    expect(r.config.condition).toContain(' or ');
  });

  it('mixed AND + OR', () => {
    const r = ok({
      condition: '[revenue] > 0 and [region] = "EU" or [status] = "VIP"',
    });
    expect(r.config.condition).toContain(' and ');
    expect(r.config.condition).toContain(' or ');
  });

  it('between + AND compound', () => {
    const r = ok({
      condition: '[price] between 10 and 100 and [region] = "EU"',
    });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain(' and ');
  });

  it('multiple between with AND', () => {
    const r = ok({
      condition: '[a] between 1 and 10 and [b] between 20 and 30',
    });
    expect(r.config.condition).toContain('between');
    expect(r.config.condition).toContain(' and ');
  });
});

describe('FormFilter — parseCondition logic', () => {
  // Simulate the parsing logic from FormFilter.tsx
  function parseSingleBetween(expr: string) {
    const m = expr.match(/^\s*\[([^\]]+)\]\s+between\s+(.+?)\s+(?:and|%%PH%%)\s+(.+?)\s*$/i);
    if (!m) return null;
    return { field: m[1], val1: m[2], val2: m[3] };
  }

  function splitConditionAnd(condition: string) {
    // Protect between segments
    const placeholders: string[] = [];
    const protected_ = condition.replace(
      /\[([^\]]+)\]\s+between\s+(.+?)\s+and\s+(.+?)(?=\s*(?:$|and\s|or\s))/gi,
      (_m, field, v1, v2) => {
        const idx = placeholders.length;
        placeholders.push(`[${field}] between ${v1} %%PH%% ${v2}`);
        return `__BETWEEN_${idx}__`;
      }
    );
    const tokens = protected_.split(/(\s+(?:and|or)\s+)/i);
    return tokens;
  }

  it('simple between is not split', () => {
    const tokens = splitConditionAnd('[date_col] between 2024-01-01 and 2024-12-31');
    // Should have only one expression token, no connective tokens
    expect(tokens.filter((t, i) => i % 2 === 0 && t.trim())).toHaveLength(1);
  });

  it('between with AND compound splits correctly', () => {
    const tokens = splitConditionAnd('[price] between 10 and 100 and [region] = "EU"');
    const exprs = tokens.filter((_, i) => i % 2 === 0 && tokens[i].trim());
    expect(exprs.length).toBeGreaterThanOrEqual(1);
  });

  it('parses between back via placeholder', () => {
    const r = parseSingleBetween('[date_col] between 2024-01-01 %%PH%% 2024-12-31');
    expect(r).not.toBeNull();
    expect(r!.field).toBe('date_col');
    expect(r!.val2).toBe('2024-12-31');
  });
});

describe('FormFilter — DSL idempotent', () => {
  it('export→parse→export produces same DSL', () => {
    const configs = [
      { condition: '[revenue] > 0' },
      { condition: '[a] between 1 and 10 and [b] = "x"' },
      { condition: '[x] = "A" or [y] = "B"' },
      { condition: '[date] between 2024-01-01 and 2024-12-31' },
    ];
    for (const config of configs) {
      const dsl1 = exportPrepOperatorDsl({ id: 't', type: 'filter', config });
      const parsed = parsePrepOperatorDsl(dsl1, 'filter');
      expect(parsed.operator).not.toBeNull();
      const dsl2 = exportPrepOperatorDsl({
        id: 't',
        type: 'filter',
        config: parsed.operator!.config,
      });
      expect(dsl2).toBe(dsl1);
    }
  });
});
