import { describe, expect, it } from 'vitest';
import {
  analyzeExpression,
  compileExpression,
  compileExpressionList,
  lookupExpressionFunction,
} from '../../src/shared/expression';

describe('typed expression layer', () => {
  it('compiles fields, operators and whitelisted functions', () => {
    expect(compileExpression('round([金额] / [数量], 2)')).toBe('round("金额" / "数量", 2)');
    expect(compileExpression('')).toBe('');
  });

  it('maps Chinese aliases to canonical functions', () => {
    expect(lookupExpressionFunction('四舍五入')?.name).toBe('round');
    expect(compileExpression('四舍五入([a], 1)')).toBe(compileExpression('round([a], 1)'));
  });

  it('rejects unknown functions and stray keywords', () => {
    expect(() => compileExpression('read_csv("x")')).toThrow(/Unknown function/);
    expect(() => compileExpression('AND [a] > 1')).toThrow(/Unexpected token/);
  });

  it('infers result types for the editor', () => {
    expect(analyzeExpression('[a] > 1', { a: 'integer' })).toMatchObject({
      ok: true,
      type: 'boolean',
    });
    expect(analyzeExpression('[a] / 2', { a: 'integer' }).ok).toBe(true);
    expect(analyzeExpression('upper([n])', { n: 'text' })).toMatchObject({ type: 'text' });
    expect(analyzeExpression('foo(1)').ok).toBe(false);
  });

  it('compiles metric argument lists', () => {
    expect(compileExpressionList("[name], '-'")).toBe(`"name", '-'`);
  });
});
