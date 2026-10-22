import { describe, expect, it } from 'vitest';
import { sqlNamedInputs } from '../../src/shared/sql-query';
import { buildSqlQuery } from '../../src/main/data/operators/sql-query';
import { getWorkflowUpstreamSignature } from '../../src/shared/workflow-plan/graph';
import { compileCalculateFieldSql } from '../../src/main/data/operators/calculate-field';

const nodes = [
  { id: 'a', type: 'input', config: { alias: 'erp' } },
  { id: 'b', type: 'input', config: { alias: 'bank' } },
  { id: 'c', type: 'input', config: { alias: 'unused' } },
  { id: 'd', type: 'input', config: { alias: 'off', disabled: true } },
];

describe('SQL node named inputs', () => {
  it('detects referenced aliases only, ignoring comments and strings', () => {
    expect(
      sqlNamedInputs("SELECT * FROM erp JOIN bank USING (id) -- unused\nWHERE x = 'off'", nodes)
    ).toEqual([
      { alias: 'erp', nodeId: 'a' },
      { alias: 'bank', nodeId: 'b' },
    ]);
  });

  it('exposes named inputs as CTEs next to input', () => {
    expect(
      buildSqlQuery('SELECT * FROM erp', 'SELECT 1', [{ alias: 'erp', query: 'SELECT 2' }])
    ).toBe(
      'WITH "input" AS (SELECT 1), "erp" AS (SELECT 2) SELECT * FROM (\nSELECT * FROM erp\n) AS "__sql_result"'
    );
  });

  it('includes named inputs in the upstream cache signature', () => {
    const sig = (alias: string) =>
      getWorkflowUpstreamSignature(
        {
          nodes: [
            ...nodes.slice(0, 2).map((n) => (n.id === 'b' ? { ...n, config: { alias, x: 1 } } : n)),
            {
              id: 's',
              type: 'sql',
              config: { sql: 'SELECT * FROM input JOIN bank USING (id)' },
            },
          ],
          edges: [{ sourceNodeId: 'a', targetNodeId: 's' }],
        },
        's'
      );
    expect(sig('bank')).toContain('"b"');
    expect(sig('other')).not.toContain('"b"');
  });
});

describe('derive sequential references', () => {
  it('keeps independent rows in a single SELECT', () => {
    expect(
      compileCalculateFieldSql('o', 'i', {
        calculations: [
          { field: 'x', expression: '[a] + 1', action: 'add' },
          { field: 'y', expression: '[a] * 2', action: 'add' },
        ],
      })
    ).toBe('CREATE TEMP TABLE o AS SELECT *, "a" + 1 AS "x", "a" * 2 AS "y" FROM i');
  });

  it('layers rows that reference fields created earlier in the node', () => {
    expect(
      compileCalculateFieldSql(
        'o',
        'i',
        {
          calculations: [
            { field: 'x', expression: '[a] + 1', action: 'add' },
            { field: 'y', expression: '[x] * 2', action: 'add' },
            { field: 'a', expression: '[y] - 1', action: 'replace' },
          ],
        },
        ['a']
      )
    ).toBe(
      'CREATE TEMP TABLE o AS SELECT * REPLACE ("y" - 1 AS "a") FROM (SELECT *, "x" * 2 AS "y" FROM (SELECT *, "a" + 1 AS "x" FROM i) AS __calc_1) AS __calc_2'
    );
  });
});
