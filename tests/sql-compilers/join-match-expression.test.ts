import { describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { compileJoinPredicate } from '../../src/main/data/operators/join';
import { JoinConfigSchema } from '../../src/shared/operator-schemas';

describe('join match expression', () => {
  it('rejects a match expression on a cross join', () => {
    expect(() =>
      JoinConfigSchema.parse({ joinType: 'cross', expression: '[a].[x] > 1' })
    ).toThrow();
  });

  it('compiles qualifiers to l/r, resolves unambiguous bare fields, and runs in DuckDB', async () => {
    const predicate = compileJoinPredicate(
      {
        conditions: [{ left: '[erp].[客户]', operator: '=', right: '[bank].[户名]' }],
        expression: 'abs([bank].[金额] - [金额]) <= 1',
        rightAlias: 'bank',
      },
      ['客户', '金额'],
      ['户名', '收入']
    );
    expect(predicate).toBe('l."客户" = r."户名" AND (abs(r."金额" - l."金额") <= 1)');
    expect(() =>
      compileJoinPredicate({ expression: '[x] > 1', rightAlias: 'bank' }, ['x'], ['x'])
    ).toThrow(/must be qualified/);

    const connection = await (await DuckDBInstance.create(':memory:')).connect();
    await connection.run(
      "CREATE TABLE erp AS SELECT * FROM (VALUES ('A', 100.0), ('B', 50.0)) t(客户, 金额)"
    );
    await connection.run(
      "CREATE TABLE bank AS SELECT * FROM (VALUES ('A', 100.5), ('B', 70.0)) t(户名, 金额)"
    );
    const reader = await connection.runAndReadAll(
      `SELECT l."客户" FROM erp l INNER JOIN bank r ON ${compileJoinPredicate(
        {
          conditions: [{ left: '[erp].[客户]', operator: '=', right: '[bank].[户名]' }],
          expression: 'abs([bank].[金额] - [erp].[金额]) <= 1',
          rightAlias: 'bank',
        },
        ['客户', '金额'],
        ['户名', '金额']
      )}`
    );
    expect(reader.getRowObjectsJson()).toEqual([{ 客户: 'A' }]);
  });
});
