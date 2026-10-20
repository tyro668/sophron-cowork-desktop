import { describe, expect, it } from 'vitest';
import { lintExpression } from '../../src/renderer/components/workflow-forms/shared/expressionLint';

describe('lintExpression', () => {
  const fields = ['金额', '数量'];
  it('accepts a valid formula', () => {
    expect(lintExpression('if [金额] > 0 then [金额] / [数量] else 0 end', fields)).toEqual([]);
  });
  it('flags unknown fields and unclosed brackets with 1-based positions', () => {
    const issues = lintExpression('[金额] * 2 + [不存在字段] * (', fields);
    expect(issues.map((i) => [i.kind, i.line, i.column, i.detail])).toEqual([
      ['unknownField', 1, 12, '不存在字段'],
      ['unclosed', 1, 22, '('],
    ]);
  });
  it('ignores brackets inside string literals and reports stray closers', () => {
    expect(lintExpression("concat('(', [金额])", fields)).toEqual([]);
    expect(lintExpression('[金额])', fields)[0].kind).toBe('unexpectedClose');
  });
  it('skips unknown-field checks when no field list is known', () => {
    expect(lintExpression('[x] + 1', [])).toEqual([]);
  });
  it('reports line numbers on multi-line formulas', () => {
    expect(lintExpression('[金额]\n+ [y]', fields)[0]).toMatchObject({ line: 2, column: 3 });
  });
});
