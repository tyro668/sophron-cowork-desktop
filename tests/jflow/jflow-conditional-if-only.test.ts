import { describe, expect, it } from 'vitest';
import { parseJflowExpr, rewriteCaseExpression, rewriteCaseInJflow } from '../../src/shared/jflow';
import { parseExpression } from '../../src/shared/expression';

describe('conditionals are if … elseif only', () => {
  it('expression layer accepts elseif chains and in (...)', () => {
    expect(() =>
      parseExpression("if [a] > 1 then 'x' elseif [s] in ('A', 'B') then 'y' else 'z' end")
    ).not.toThrow();
  });

  it('expression layer rejects case with a clear message', () => {
    try {
      parseExpression('case when [a] > 1 then 1 end');
      throw new Error('should fail');
    } catch (e) {
      expect((e as { code: string }).code).toBe('caseRemoved');
      expect((e as Error).message).toMatch(/elseif/);
    }
  });

  it('jflow reports E_CASE_REMOVED with a quick-fix', () => {
    const r = parseJflowExpr("case when [x] > 1 then 'a' else 'b' end");
    expect(r.ast).toBeNull();
    const d = r.diagnostics.find((x) => x.code === 'E_CASE_REMOVED');
    expect(d?.fix?.text).toMatch(/^if /);
  });

  it('rewrites searched, simple, upper-case and nested case', () => {
    expect(
      rewriteCaseExpression(
        "case when [d] <= 30 then '0-30' when [d] <= 60 then '31-60' else '90+' end"
      )
    ).toBe("if [d] <= 30 then '0-30' elseif [d] <= 60 then '31-60' else '90+' end");
    const simple = rewriteCaseExpression("CASE [s] WHEN 'A' THEN 1 WHEN 'B' THEN 2 END")!;
    expect(simple).toMatch(/^if \[s\] = 'A' then 1 elseif \[s\] = 'B' then 2/);
    const nested = rewriteCaseExpression(
      '[x] + case when [a] > 1 then case when [b] then 1 else 2 end else 0 end'
    )!;
    expect(nested).not.toMatch(/\bcase\b/);
    expect(parseJflowExpr(nested).ast).not.toBeNull();
    expect(rewriteCaseExpression('[a] + 1')).toBeNull();
  });

  it('rewrites case inside a jflow document', () => {
    const out = rewriteCaseInJflow(
      "| derive [k] = case when [x] > 1 then 'a' else 'b' end, [j] = case [y] when 1 then 'u' end"
    );
    expect(out).toContain("if [x] > 1 then 'a' else 'b' end");
    expect(out).toMatch(/if \[y\] = 1 then 'u'/);
  });
});

import { rewriteCaseInNodeConfig } from '../../src/main/data/store/migrations';

describe('migration v28 conditional_if_only', () => {
  it('rewrites stored case expressions but keeps raw SQL nodes', () => {
    const next = rewriteCaseInNodeConfig('derive', {
      columns: [{ name: 'k', expression: "CASE WHEN [d] > 30 THEN 'late' ELSE 'ok' END" }],
    });
    expect(JSON.stringify(next)).toContain("if [d] > 30 then 'late' else 'ok' end");
    expect(
      rewriteCaseInNodeConfig('sql', { sql: 'SELECT CASE WHEN a THEN 1 END FROM input' })
    ).toBeNull();
    expect(rewriteCaseInNodeConfig('filter', { condition: '[a] > 1' })).toBeNull();
  });
});
