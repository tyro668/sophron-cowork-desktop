import { describe, expect, it } from 'vitest';
import { parseExpression } from '../src/shared/expression/parser';
import { parsePrepOperatorDsl } from '../src/shared/prep-dsl';
import {
  migrateConfigQuoteSemantics,
  rewriteDoubleQuotedLiterals,
} from '../src/main/data/store/migrations';

describe('SQL quote semantics in the DSL', () => {
  it('treats "name" as a field identifier and \'text\' as a string', () => {
    expect(parseExpression('"订单状态"')).toEqual({ k: 'field', name: '订单状态' });
    expect(parseExpression("'已完成'")).toEqual({ k: 'str', value: '已完成' });
    expect(parseExpression(`'it''s'`)).toEqual({ k: 'str', value: "it's" });
  });

  it('rejects double-quoted text values in statement value positions', () => {
    const parsed = parsePrepOperatorDsl('cast [d] as date format "%Y-%m-%d"', 'cast');
    expect(parsed.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('rejects single-quoted names in output statements', () => {
    const parsed = parsePrepOperatorDsl("output table 'x' mode replace", 'output');
    expect(parsed.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('migrates saved double-quoted literals to single quotes once', () => {
    expect(rewriteDoubleQuotedLiterals('[订单状态] = "已完成"')).toBe("[订单状态] = '已完成'");
    expect(rewriteDoubleQuotedLiterals(`[a] = "it's" and [b] = 'x'`)).toBe(
      `[a] = 'it''s' and [b] = 'x'`
    );
    expect(
      migrateConfigQuoteSemantics('filter', { condition: '[s] in ("A", "B")', note: '"keep"' })
    ).toEqual({ condition: "[s] in ('A', 'B')", note: '"keep"' });
    expect(migrateConfigQuoteSemantics('filter', { condition: "[s] = 'A'" })).toBeNull();
  });
});

describe('field-type names in expression casts', () => {
  it('migrates SQL spellings of cast targets to field types, leaving text alone', async () => {
    const { rewriteCastTargetTypes, migrateConfigCastTypeNames } =
      await import('../src/main/data/store/migrations');
    expect(rewriteCastTargetTypes("cast([a] as varchar) || 'as double)'")).toBe(
      "cast([a] as text) || 'as double)'"
    );
    expect(rewriteCastTargetTypes('try_cast([d] as TIMESTAMP) + cast([n] as double)')).toBe(
      'try_cast([d] as datetime) + cast([n] as float)'
    );
    expect(rewriteCastTargetTypes('cast([x] as decimal(18,4))')).toBe('cast([x] as decimal(18,4))');
    expect(rewriteCastTargetTypes('cast([x] as bigint)')).toBe('cast([x] as integer)');
    expect(migrateConfigCastTypeNames('sql', { expression: 'cast(a as varchar)' })).toBeNull();
  });

  it('accepts only field-type names as cast targets', async () => {
    const { parseExpression } = await import('../src/shared/expression');
    expect(() => parseExpression('cast([a] as varchar)')).toThrow(/use one of text/);
    expect(() => parseExpression('cast([a] as text(3))')).toThrow();
    expect(() => parseExpression('cast([a] as decimal(18,2))')).not.toThrow();
  });
});
