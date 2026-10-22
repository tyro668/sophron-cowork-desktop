import { describe, expect, it } from 'vitest';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { compileScalarExpression } from '../../src/main/data/operators/compute';
import { compileCalculateFieldSql } from '../../src/main/data/operators/calculate-field';
import type { CalculationFunctionInput } from '../../src/shared/calculate-field/function-registry';
import { buildCalculationFunctionExpression } from '../../src/shared/calculate-field/sql-expression-builder';
import { buildCalculationFunctionDslExpression } from '../../src/shared/calculate-field/domain-dsl';
import {
  normalizeCalculationEntries,
  type CalculationConfigEntry,
} from '../../src/shared/calculate-field';
import { parsePrepOperatorDsl } from '../../src/shared/prep-dsl';

async function connect(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(':memory:');
  return await instance.connect();
}

async function runSql(sql: string): Promise<Record<string, unknown>[]> {
  const conn = await connect();
  await conn.run(
    'CREATE TABLE inp (revenue DOUBLE, cost DOUBLE, amount DOUBLE, region VARCHAR, name VARCHAR)'
  );
  await conn.run(
    "INSERT INTO inp VALUES (100, 40, 5, 'East', 'Alice'), (200, 150, 20, 'West', 'Bob'), (50, 10, 15, 'East', 'Charlie')"
  );
  await conn.run(sql);
  const reader = await conn.runAndReadAll(`SELECT * FROM out ORDER BY revenue`);
  const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
  return rows;
}

describe('compileScalarExpression', () => {
  it('field ref', () => {
    expect(compileScalarExpression('[amount]')).toBe('"amount"');
  });

  it('arithmetic', () => {
    expect(compileScalarExpression('[revenue] - [cost]')).toBe('"revenue" - "cost"');
  });

  it('string literal', () => {
    expect(compileScalarExpression("[name] = 'hello'")).toBe(`"name" = 'hello'`);
  });

  it('operator precedence passes through', () => {
    expect(compileScalarExpression('[a] + [b] * 2')).toBe('"a" + "b" * 2');
  });

  it('count(*) unchanged', () => {
    expect(compileScalarExpression('count(*)')).toBe('count(*)');
  });

  it('field arg inside function', () => {
    expect(compileScalarExpression('count([field])')).toBe('count("field")');
  });

  it('if/then/else → CASE WHEN/THEN/ELSE/END', () => {
    expect(compileScalarExpression('if [amount] > 10 then 1 else 0 end')).toBe(
      'CASE WHEN "amount" > 10 THEN 1 ELSE 0 END'
    );
  });

  it('does not rewrite conditional keywords inside string literals', () => {
    expect(
      compileScalarExpression("if [status] = 'if' then 'then' else CONCAT('else', 'end') end")
    ).toBe(`CASE WHEN "status" = 'if' THEN 'then' ELSE concat('else', 'end') END`);
  });

  it('nested if/then/else', () => {
    expect(
      compileScalarExpression('if [a] > 0 then if [b] > 0 then [c] else [d] end else [e] end')
    ).toBe('CASE WHEN "a" > 0 THEN CASE WHEN "b" > 0 THEN "c" ELSE "d" END ELSE "e" END');
  });

  it('if/then without else', () => {
    expect(compileScalarExpression('if [amount] < 0 then 0 end')).toBe(
      'CASE WHEN "amount" < 0 THEN 0 END'
    );
  });

  it('case/when then/else/end uppercased by DSL transform', () => {
    expect(compileScalarExpression("case [status] when 'PAID' then 1 else 0 end")).toBe(
      `CASE "status" WHEN 'PAID' THEN 1 ELSE 0 END`
    );
  });

  it('string function', () => {
    expect(compileScalarExpression('upper([name])')).toBe('upper("name")');
  });

  it('concat with mixed args', () => {
    expect(compileScalarExpression("concat([first], ' ', [last])")).toBe(
      `concat("first", ' ', "last")`
    );
  });

  it('coalesce', () => {
    expect(compileScalarExpression("coalesce([phone], [email], 'N/A')")).toBe(
      `coalesce("phone", "email", 'N/A')`
    );
  });

  it('nullif with two args', () => {
    expect(compileScalarExpression("nullif([status], 'CANCELLED')")).toBe(
      `nullif("status", 'CANCELLED')`
    );
  });

  it('CAST', () => {
    expect(compileScalarExpression('CAST([amount] AS double)')).toBe('CAST("amount" AS double)');
  });

  it('round with precision', () => {
    expect(compileScalarExpression('round([amount], 2)')).toBe('round("amount", 2)');
  });

  it('lower and trim', () => {
    expect(compileScalarExpression('lower(trim([name]))')).toBe('lower(trim("name"))');
  });

  it('substr', () => {
    expect(compileScalarExpression('substr([name], 1, 3)')).toBe('substr("name", 1, 3)');
  });

  it('split_part', () => {
    expect(compileScalarExpression("split_part([name], ' ', 1)")).toBe(
      `split_part("name", ' ', 1)`
    );
  });

  it('length', () => {
    expect(compileScalarExpression('length([name])')).toBe('length("name")');
  });

  it('abs', () => {
    expect(compileScalarExpression('abs([amount])')).toBe('abs("amount")');
  });

  it('field with spaces', () => {
    expect(compileScalarExpression('[order date]')).toBe('"order date"');
  });

  it('field with Chinese characters', () => {
    expect(compileScalarExpression('[商品数量]')).toBe('"商品数量"');
  });

  it('field with hyphen', () => {
    expect(compileScalarExpression('[order-date]')).toBe('"order-date"');
  });

  it('qualified field ref with dot', () => {
    // Qualified refs only make sense in join conditions; derive has no table alias.
    expect(() => compileScalarExpression('[t].[f]')).toThrow(/Qualified field/);
  });

  it('empty string literal', () => {
    expect(compileScalarExpression("[a] = ''")).toBe(`"a" = ''`);
  });

  it('string literal with special chars', () => {
    expect(compileScalarExpression("[a] = 'he''s'")).toBe(`"a" = 'he''s'`);
  });

  it('compileScalarExpression single-quote literal preserves SQL escape', () => {
    expect(compileScalarExpression("'it''s'")).toBe(`'it''s'`);
  });

  it('compileScalarExpression preserves SQL-escaped single quote in comparison', () => {
    expect(compileScalarExpression("[name] = 'it''s'")).toBe(`"name" = 'it''s'`);
  });

  it('compileScalarExpression turns a backslash-escaped single quote into SQL escape', () => {
    expect(compileScalarExpression("[name] = 'it\\'s'")).toBe(`"name" = 'it''s'`);
  });

  it('compileScalarExpression lone backslash-escaped single quote literal', () => {
    expect(compileScalarExpression("'it\\'s'")).toBe(`'it''s'`);
  });

  it('parenthesized expression', () => {
    expect(compileScalarExpression('([a] + [b]) * [c]')).toBe('("a" + "b") * "c"');
  });

  it('nested function calls', () => {
    expect(compileScalarExpression('round(abs([amount]), 2)')).toBe('round(abs("amount"), 2)');
  });

  it('nested function with mixed field and literal', () => {
    expect(compileScalarExpression('substr([name], length([name]) - 2, 3)')).toBe(
      `substr("name", length("name") - 2, 3)`
    );
  });

  it('if with complex and condition', () => {
    expect(compileScalarExpression('if [a] > 0 and [b] > 0 then [c] else [d] end')).toBe(
      'CASE WHEN "a" > 0 AND "b" > 0 THEN "c" ELSE "d" END'
    );
  });

  it('if with or condition', () => {
    expect(compileScalarExpression('if [a] > 0 or [b] = 0 then [c] end')).toBe(
      'CASE WHEN "a" > 0 OR "b" = 0 THEN "c" END'
    );
  });

  it('nested case inside if', () => {
    expect(
      compileScalarExpression("if [a] > 0 then case [b] when 'x' then 1 else 2 end else 0 end")
    ).toBe(`CASE WHEN "a" > 0 THEN CASE "b" WHEN 'x' THEN 1 ELSE 2 END ELSE 0 END`);
  });

  it('date function', () => {
    expect(compileScalarExpression("date_diff('day', [start], [end])")).toBe(
      `date_diff('day', "start", "end")`
    );
  });

  it('regexp_extract', () => {
    expect(compileScalarExpression("regexp_extract([sku], '^[A-Z]+', 0)")).toBe(
      `regexp_extract("sku", '^[A-Z]+', 0)`
    );
  });

  it('boolean literals in expression', () => {
    expect(compileScalarExpression('[active] = true')).toBe('"active" = TRUE');
  });

  it('null literal', () => {
    expect(compileScalarExpression('[a] is null')).toBe('"a" IS NULL');
  });

  it('expression with decimal', () => {
    expect(compileScalarExpression('[a] > 3.14')).toBe('"a" > 3.14');
  });

  it('expression with negative number', () => {
    expect(compileScalarExpression('[a] >= -5')).toBe('"a" >= -5');
  });

  it('multiplication and division', () => {
    expect(compileScalarExpression('[a] * [b] / [c]')).toBe('"a" * "b" / "c"');
  });

  it('modulo', () => {
    expect(compileScalarExpression('[a] % [b]')).toBe('"a" % "b"');
  });

  it('string concatenation with ||', () => {
    expect(compileScalarExpression('[first] || [last]')).toBe('"first" || "last"');
  });

  it('IS NULL pattern stays intact', () => {
    expect(compileScalarExpression('[a] is null')).toBe('"a" IS NULL');
  });

  it('IS NOT NULL pattern', () => {
    expect(compileScalarExpression('[a] is not null')).toBe('"a" IS NOT NULL');
  });

  it('empty string input', () => {
    expect(compileScalarExpression('')).toBe('');
  });

  it('whitespace-only input', () => {
    expect(compileScalarExpression('   ')).toBe('');
  });
});

describe('DuckDB integration — period comparison and time accumulation', () => {
  it('executes canonical domain DSL expressions through the SQL compiler', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE period_data (id INT, region VARCHAR, date DATE, sales DOUBLE)');
    await conn.run(
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-01', 10), (2, 'A', DATE '2024-01-02', 15)"
    );
    await conn.run(
      compileCalculateFieldSql('out', 'period_data', {
        calculations: [
          {
            field: 'running_sales',
            expression: 'accumulate(yeartodate(sum([sales]), [date])) over(partition by [region])',
          },
        ],
      })
    );
    const reader = await conn.runAndReadAll('SELECT running_sales FROM out ORDER BY id');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];

    expect(rows.map((row) => row.running_sales)).toEqual([10, 25]);
  });

  async function runGeneratedCalculation(
    functionId: string,
    parameters: Record<string, string>,
    insertRows: string
  ): Promise<Record<string, unknown>[]> {
    const conn = await connect();
    await conn.run('CREATE TABLE period_data (id INT, region VARCHAR, date DATE, sales DOUBLE)');
    await conn.run(insertRows);
    const expression = buildCalculationFunctionExpression({
      functionId,
      value: 'sales',
      partitionBy: ['region'],
      parameters,
    });
    await conn.run(
      compileCalculateFieldSql('out', 'period_data', {
        calculations: [{ field: 'result', expression }],
      })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out ORDER BY id');
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }

  it('compares with the previous row after date ordering', async () => {
    const rows = await runGeneratedCalculation(
      'previous_difference',
      { dateField: 'date' },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-02', 15), (2, 'A', DATE '2024-01-01', 10)"
    );

    expect(rows[0].result).toBe(5);
    expect(rows[1].result).toBe(null);
  });

  it('returns null when the matching year-over-year period is missing', async () => {
    const rows = await runGeneratedCalculation(
      'year_over_year_value',
      { dateField: 'date', granularity: 'month' },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2023-01-01', 10), (2, 'A', DATE '2025-01-01', 30), (3, 'A', DATE '2026-01-01', 40)"
    );

    expect(rows[0].result).toBe(null);
    expect(rows[1].result).toBe(null);
    expect(rows[2].result).toBe(30);
  });

  it('accumulates from the start of the year through the current row', async () => {
    const rows = await runGeneratedCalculation(
      'year_to_date',
      { dateField: 'date', aggregation: 'sum', fiscalStartMonth: '1' },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-01', 10), (2, 'A', DATE '2024-01-02', 15), (3, 'A', DATE '2025-01-01', 7)"
    );

    expect(rows.map((row) => row.result)).toEqual([10, 25, 7]);
  });

  it('week_to_date keeps ISO week rows in the same partition across the year boundary', async () => {
    const rows = await runGeneratedCalculation(
      'week_to_date',
      { dateField: 'date', aggregation: 'sum' },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-12-30', 10), (2, 'A', DATE '2024-12-31', 15), (3, 'A', DATE '2025-01-01', 20)"
    );

    expect(rows.map((row) => row.result)).toEqual([10, 25, 45]);
  });

  it('year_over_year week grain matches by ISO year, not calendar year', async () => {
    const rows = await runGeneratedCalculation(
      'year_over_year_value',
      { dateField: 'date', granularity: 'week' },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-01', 100), (2, 'A', DATE '2024-12-30', 10), (3, 'A', DATE '2025-01-01', 15)"
    );

    expect(rows[0].result).toBe(null);
    expect(rows[1].result).toBe(100);
    expect(rows[2].result).toBe(null);
  });

  it('month grain year_over_year still matches by calendar year', async () => {
    const rows = await runGeneratedCalculation(
      'year_over_year_value',
      { dateField: 'date', granularity: 'month' },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-01', 100), (2, 'A', DATE '2025-01-01', 15)"
    );

    expect(rows[0].result).toBe(null);
    expect(rows[1].result).toBe(100);
  });

  async function runGeneratedOffsetCalculation(
    functionId: string,
    input: Omit<CalculationFunctionInput, 'functionId'>,
    insertRows: string
  ): Promise<Record<string, unknown>[]> {
    const conn = await connect();
    await conn.run('CREATE TABLE period_data (id INT, region VARCHAR, date DATE, sales DOUBLE)');
    await conn.run(insertRows);
    const expression = buildCalculationFunctionDslExpression({ functionId, ...input });
    await conn.run(
      compileCalculateFieldSql('out', 'period_data', {
        calculations: [{ field: 'result', expression }],
      })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out ORDER BY id');
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }

  it('lag returns the previous row after date ordering', async () => {
    const rows = await runGeneratedOffsetCalculation(
      'lag',
      {
        value: '[sales]',
        valueIsExpression: true,
        partitionBy: ['region'],
        orderBy: [{ field: 'date', direction: 'asc' }],
      },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-01', 10), (2, 'A', DATE '2024-01-02', 15), (3, 'A', DATE '2024-01-03', 20)"
    );

    expect(rows.map((row) => row.result)).toEqual([null, 10, 15]);
  });

  it('offset_difference compares against N rows back', async () => {
    const rows = await runGeneratedOffsetCalculation(
      'offset_difference',
      {
        value: '[sales]',
        valueIsExpression: true,
        extraParameter: '2',
        orderBy: [{ field: 'date', direction: 'asc' }],
      },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-01', 10), (2, 'A', DATE '2024-01-02', 15), (3, 'A', DATE '2024-01-03', 20)"
    );

    expect(rows.map((row) => row.result)).toEqual([null, null, 10]);
  });

  it('last_value returns the last row of the partition', async () => {
    const rows = await runGeneratedOffsetCalculation(
      'last_value',
      {
        value: '[sales]',
        valueIsExpression: true,
        partitionBy: ['region'],
        orderBy: [{ field: 'date', direction: 'asc' }],
      },
      "INSERT INTO period_data VALUES (1, 'A', DATE '2024-01-01', 10), (2, 'A', DATE '2024-01-02', 15), (3, 'A', DATE '2024-01-03', 20)"
    );

    expect(rows.map((row) => row.result)).toEqual([20, 20, 20]);
  });
});

describe('compileCalculateFieldSql', () => {
  it('replaces an existing input column when imported DSL omitted the action flag', () => {
    const sql = compileCalculateFieldSql(
      'out',
      'inp',
      {
        calculations: [
          {
            field: 'Adj Close',
            expression: "CAST(REPLACE([`Adj Close`], '$', '') AS DECIMAL(18,2))",
          },
        ],
      },
      ['Ticker', 'Adj Close']
    );

    expect(sql).toContain('SELECT * REPLACE (');
    expect(sql).not.toContain('SELECT *,');
  });

  it('rejects an explicit add action that conflicts with an input column', () => {
    expect(() =>
      compileCalculateFieldSql(
        'out',
        'inp',
        {
          calculations: [{ field: 'amount', expression: '[amount] * 2', action: 'add' }],
        },
        ['amount']
      )
    ).toThrow(/already exists/);
  });

  it('rejects an explicit replace action for a missing input column', () => {
    expect(() =>
      compileCalculateFieldSql(
        'out',
        'inp',
        {
          calculations: [{ field: 'missing', expression: '[amount] * 2', action: 'replace' }],
        },
        ['amount']
      )
    ).toThrow(/does not exist/);
  });

  it('replaces an existing input column for an explicit replace action', () => {
    const sql = compileCalculateFieldSql(
      'out',
      'inp',
      {
        calculations: [{ field: 'amount', expression: '[amount] * 2', action: 'replace' }],
      },
      ['amount']
    );

    expect(sql).toContain('SELECT * REPLACE (');
  });

  it('single calculation', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [{ field: 'margin', expression: '[revenue] - [cost]' }],
    });
    expect(sql).toBe('CREATE TEMP TABLE out AS SELECT *, "revenue" - "cost" AS "margin" FROM inp');
  });

  it('multiple calculations', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        { field: 'margin', expression: '[revenue] - [cost]' },
        { field: 'tax', expression: '[revenue] * 0.13' },
      ],
    });
    expect(sql).toBe(
      'CREATE TEMP TABLE out AS SELECT *, "revenue" - "cost" AS "margin", "revenue" * 0.13 AS "tax" FROM inp'
    );
  });

  it('rejects empty calculations', () => {
    expect(() => compileCalculateFieldSql('out', 'inp', {})).toThrow(
      'At least one calculated field is required'
    );
  });

  it('if/then/else in calculation', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        {
          field: 'mei',
          expression: 'if [商品数量] > 10 then 1 else 0 end',
        },
      ],
    });
    expect(sql).toBe(
      'CREATE TEMP TABLE out AS SELECT *, CASE WHEN "商品数量" > 10 THEN 1 ELSE 0 END AS "mei" FROM inp'
    );
  });

  it('window expression in calculation', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        {
          field: 'rn',
          expression: 'ranking(row_number()) over(partition by [region] order by [amount] desc)',
        },
      ],
    });
    expect(sql).toBe(
      'CREATE TEMP TABLE out AS SELECT *, row_number() OVER (PARTITION BY "region" ORDER BY "amount" DESC) AS "rn" FROM inp'
    );
  });

  it('rejects a calculation with an empty field name', () => {
    expect(() =>
      compileCalculateFieldSql('out', 'inp', {
        calculations: [
          { field: 'good', expression: '[a] + [b]' },
          { field: '', expression: '[x]' },
        ],
      })
    ).toThrow('Calculated field name is required');
  });

  it('rejects a calculation with an empty expression', () => {
    expect(() =>
      compileCalculateFieldSql('out', 'inp', {
        calculations: [
          { field: 'good', expression: '[a] + [b]' },
          { field: 'blank', expression: '   ' },
        ],
      })
    ).toThrow('Calculation expression is required');
  });

  it('rejects a duplicate target field', () => {
    expect(() =>
      compileCalculateFieldSql('out', 'inp', {
        calculations: [
          { field: 'dup', expression: '[a] + [b]' },
          { field: 'DUP', expression: '[c]' },
        ],
      })
    ).toThrow(/configured more than once/);
  });

  it('field name with Chinese', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [{ field: '利润', expression: '[revenue] - [cost]' }],
    });
    expect(sql).toBe('CREATE TEMP TABLE out AS SELECT *, "revenue" - "cost" AS "利润" FROM inp');
  });

  it('three calculations', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        { field: 'a', expression: '[x]' },
        { field: 'b', expression: '[y]' },
        { field: 'c', expression: '[z]' },
      ],
    });
    expect(sql).toBe(
      'CREATE TEMP TABLE out AS SELECT *, "x" AS "a", "y" AS "b", "z" AS "c" FROM inp'
    );
  });

  it('count_distinct in expression', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        {
          field: 'unique_cnt',
          expression: 'count(DISTINCT [customer_id]) over(partition by [region])',
        },
      ],
    });
    expect(sql).toContain('count(DISTINCT "customer_id")');
    expect(sql).toContain('OVER (PARTITION BY "region")');
  });

  it('output and input with underscore names', () => {
    const sql = compileCalculateFieldSql('result_2024', 'source_table', {
      calculations: [{ field: 'total', expression: '[qty] * [price]' }],
    });
    expect(sql).toBe(
      'CREATE TEMP TABLE result_2024 AS SELECT *, "qty" * "price" AS "total" FROM source_table'
    );
  });

  it('complex if expression with string comparison', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        {
          field: 'status_label',
          expression: "if [status] = 'PAID' then '已支付' else '未支付' end",
        },
      ],
    });
    expect(sql).toBe(
      `CREATE TEMP TABLE out AS SELECT *, CASE WHEN "status" = 'PAID' THEN '已支付' ELSE '未支付' END AS "status_label" FROM inp`
    );
  });
});

describe('DuckDB integration — compileCalculateFieldSql execution', () => {
  it('keeps an imported DSL replacement executable after form normalization and editing', async () => {
    const parsed = parsePrepOperatorDsl('derive [amount] = [amount] * 2', 'calculate_field');
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    const imported = parsed.operator?.config.calculations as CalculationConfigEntry[];
    const calculations = normalizeCalculationEntries(imported, [
      'revenue',
      'cost',
      'amount',
      'region',
      'name',
    ]).map((calculation) => ({
      ...calculation,
      expression: '[amount] * 3',
    }));
    const sql = compileCalculateFieldSql('out', 'inp', { calculations }, [
      'revenue',
      'cost',
      'amount',
      'region',
      'name',
    ]);

    const rows = await runSql(sql);

    expect(rows.map((row) => row.amount)).toEqual([45, 15, 60]);
  });

  it('executes a string aggregation generated by the calculation wizard registry', async () => {
    const expression = buildCalculationFunctionExpression({
      functionId: 'string_agg',
      value: 'name',
      extraParameter: ';',
    });
    const sql = compileCalculateFieldSql(
      'out',
      'inp',
      { calculations: [{ field: 'names', expression }] },
      ['revenue', 'cost', 'amount', 'region', 'name']
    );

    const rows = await runSql(sql);

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.names))).toEqual(new Set(['Alice;Bob;Charlie']));
  });

  it('arithmetic expression produces correct results', async () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [{ field: 'margin', expression: '[revenue] - [cost]' }],
    });
    const rows = await runSql(sql);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ revenue: 50, cost: 10, margin: 40 });
    expect(rows[1]).toMatchObject({ revenue: 100, cost: 40, margin: 60 });
    expect(rows[2]).toMatchObject({ revenue: 200, cost: 150, margin: 50 });
  });

  it('if/then/else executes correctly', async () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [{ field: 'tag', expression: 'if [amount] > 10 then 1 else 0 end' }],
    });
    const rows = await runSql(sql);
    expect(rows).toHaveLength(3);
    // ORDER BY revenue: 50(amount=15), 100(amount=5), 200(amount=20)
    expect(rows[0].tag).toBe(1);
    expect(rows[1].tag).toBe(0);
    expect(rows[2].tag).toBe(1);
  });

  it('if/then/else with and condition', async () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        { field: 'tag', expression: 'if [amount] > 10 and [revenue] > 100 then 1 else 0 end' },
      ],
    });
    const rows = await runSql(sql);
    expect(rows.find((r) => r.amount === 20)).toMatchObject({ tag: 1 });
    expect(rows.find((r) => r.amount === 15)).toMatchObject({ tag: 0 });
  });

  it('multiple calculations execute correctly', async () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        { field: 'margin', expression: '[revenue] - [cost]' },
        { field: 'margin_rate', expression: 'round(([revenue] - [cost]) / [revenue] * 100, 1)' },
      ],
    });
    const rows = await runSql(sql);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ revenue: 50, margin: 40 });
    expect(rows[0].margin_rate).toBeCloseTo(80, 0);
    expect(rows[2]).toMatchObject({ revenue: 200, margin: 50 });
    expect(rows[2].margin_rate).toBeCloseTo(25, 0);
  });

  it('window function row_number', async () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        {
          field: 'rn',
          expression: 'ranking(row_number()) over(partition by [region] order by [amount] desc)',
        },
      ],
    });
    const rows = await runSql(sql);
    const east = rows.filter((r) => r.region === 'East');
    expect(east).toHaveLength(2);
    expect(east[0].rn).toBeDefined();
    // amounts: 15 (Charlie), 5 (Alice) — desc order → rn 1 = 15, rn 2 = 5
    const sorted = [...east].sort((a, b) => Number(a.rn) - Number(b.rn));
    expect(Number(sorted[0].rn)).toBe(1);
    expect(sorted[0].amount).toBe(15);
    expect(Number(sorted[1].rn)).toBe(2);
    expect(sorted[1].amount).toBe(5);
  });

  it('upper/lower/trim/length string functions', async () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        { field: 'up', expression: 'upper([name])' },
        { field: 'low', expression: 'lower([name])' },
        { field: 'len', expression: 'length([name])' },
      ],
    });
    const rows = await runSql(sql);
    const alice = rows.find((r) => r.name === 'Alice');
    expect(alice!.up).toBe('ALICE');
    expect(alice!.low).toBe('alice');
    expect(alice!.len).toBe('5');
  });

  it('coalesce replaces null', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE null_test (x DOUBLE, y DOUBLE)');
    await conn.run('INSERT INTO null_test VALUES (1, NULL), (NULL, 2), (NULL, NULL), (3, 4)');
    await conn.run(
      `CREATE TEMP TABLE out AS SELECT *, coalesce("x", "y", -1) AS "coalesced" FROM null_test`
    );
    const reader = await conn.runAndReadAll(
      'SELECT * FROM out ORDER BY x NULLS LAST, y NULLS LAST'
    );
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows).toHaveLength(4);
    // ORDER BY x NULLS LAST, y NULLS LAST: (1,null), (3,4), (null,2), (null,null)
    expect(rows[0]).toMatchObject({ x: 1, y: null, coalesced: 1 });
    expect(rows[3]).toMatchObject({ x: null, y: null, coalesced: -1 });
  });

  it('string literal with Chinese characters', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE t (s VARCHAR)');
    await conn.run("INSERT INTO t VALUES ('hello'), ('world')");
    await conn.run(
      `CREATE TEMP TABLE out AS SELECT *, CASE WHEN "s" = 'hello' THEN '你好' ELSE '世界' END AS "greeting" FROM t`
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out ORDER BY s');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ s: 'hello', greeting: '你好' });
    expect(rows[1]).toMatchObject({ s: 'world', greeting: '世界' });
  });
});

describe('DuckDB integration — new date functions', () => {
  async function runDateSql(
    sql: string,
    createTable: string,
    insertRows: string
  ): Promise<Record<string, unknown>[]> {
    const conn = await connect();
    await conn.run(createTable);
    await conn.run(insertRows);
    await conn.run(sql);
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    return rows;
  }

  it('year extracts year from date', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT year(d) AS y FROM dates`,
      `CREATE TABLE dates (d DATE)`,
      `INSERT INTO dates VALUES ('2024-03-15'), ('2023-12-31')`
    );
    expect(Number(rows[0].y)).toBe(2024);
    expect(Number(rows[1].y)).toBe(2023);
  });

  it('month extracts month from date', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT month(d) AS m FROM dates`,
      `CREATE TABLE dates (d DATE)`,
      `INSERT INTO dates VALUES ('2024-01-15'), ('2024-12-31')`
    );
    expect(Number(rows[0].m)).toBe(1);
    expect(Number(rows[1].m)).toBe(12);
  });

  it('day extracts day from date', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT day(d) AS d FROM dates`,
      `CREATE TABLE dates (d DATE)`,
      `INSERT INTO dates VALUES ('2024-01-01'), ('2024-01-31')`
    );
    expect(Number(rows[0].d)).toBe(1);
    expect(Number(rows[1].d)).toBe(31);
  });

  it('date_diff computes difference in days', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT date_diff('day', d1, d2) AS diff FROM dates`,
      `CREATE TABLE dates (d1 DATE, d2 DATE)`,
      `INSERT INTO dates VALUES ('2024-01-01', '2024-01-10'), ('2024-01-01', '2024-02-01')`
    );
    expect(Number(rows[0].diff)).toBe(9);
    expect(Number(rows[1].diff)).toBe(31);
  });

  it('date_trunc truncates to month start', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT date_trunc('month', d) AS m FROM dates`,
      `CREATE TABLE dates (d DATE)`,
      `INSERT INTO dates VALUES ('2024-03-15'), ('2024-03-31')`
    );
    expect(String(rows[0].m).startsWith('2024-03-01')).toBe(true);
    expect(String(rows[1].m).startsWith('2024-03-01')).toBe(true);
  });

  it('strptime parses string to date', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT strptime(s, '%Y%m%d') AS d FROM dates`,
      `CREATE TABLE dates (s VARCHAR)`,
      `INSERT INTO dates VALUES ('20240315'), ('20241201')`
    );
    expect(String(rows[0].d).startsWith('2024-03-15')).toBe(true);
    expect(String(rows[1].d).startsWith('2024-12-01')).toBe(true);
  });

  it('current_date returns today', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT current_date = current_date AS same FROM (SELECT 1) AS t(x)`,
      `CREATE TABLE t (x INT)`,
      `INSERT INTO t VALUES (1)`
    );
    expect(rows[0].same).toBe(true);
  });

  it('now returns current timestamp', async () => {
    const rows = await runDateSql(
      `CREATE TEMP TABLE out AS SELECT typeof(now()) AS t FROM (SELECT 1) AS t(x)`,
      `CREATE TABLE t (x INT)`,
      `INSERT INTO t VALUES (1)`
    );
    expect(rows[0].t).toBe('TIMESTAMP WITH TIME ZONE');
  });
});

describe('DuckDB integration — new window functions', () => {
  async function runWindowSql(sql: string, insertRows: string): Promise<Record<string, unknown>[]> {
    const conn = await connect();
    await conn.run('CREATE TABLE inp (id INT, region VARCHAR, score INT, amount INT)');
    await conn.run(insertRows);
    await conn.run(sql);
    const reader = await conn.runAndReadAll('SELECT * FROM out ORDER BY id');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    return rows;
  }

  it('dense_rank without gaps', async () => {
    const rows = await runWindowSql(
      `CREATE TEMP TABLE out AS SELECT id, dense_rank() over(order by score desc) AS r FROM inp`,
      `INSERT INTO inp VALUES (1, 'A', 100, 10), (2, 'A', 100, 20), (3, 'A', 90, 30), (4, 'A', 80, 40)`
    );
    expect(Number(rows[0].r)).toBe(1);
    expect(Number(rows[1].r)).toBe(1);
    expect(Number(rows[2].r)).toBe(2);
    expect(Number(rows[3].r)).toBe(3);
  });

  it('ntile divides into buckets', async () => {
    const rows = await runWindowSql(
      `CREATE TEMP TABLE out AS SELECT id, ntile(2) over(order by score) AS b FROM inp`,
      `INSERT INTO inp VALUES (1, 'A', 10, 1), (2, 'A', 20, 2), (3, 'A', 30, 3), (4, 'A', 40, 4)`
    );
    expect(Number(rows[0].b)).toBe(1);
    expect(Number(rows[1].b)).toBe(1);
    expect(Number(rows[2].b)).toBe(2);
    expect(Number(rows[3].b)).toBe(2);
  });

  it('first_value returns first in window', async () => {
    const rows = await runWindowSql(
      `CREATE TEMP TABLE out AS SELECT id, region, first_value(amount) over(partition by region order by score) AS fv FROM inp`,
      `INSERT INTO inp VALUES (1, 'A', 10, 100), (2, 'A', 20, 200), (3, 'B', 5, 300), (4, 'B', 15, 400)`
    );
    const a = rows.filter((r) => r.region === 'A').sort((a, b) => Number(a.id) - Number(b.id));
    expect(Number(a[0].fv)).toBe(100);
    expect(Number(a[1].fv)).toBe(100);
    const b = rows.filter((r) => r.region === 'B').sort((a, b) => Number(a.id) - Number(b.id));
    expect(Number(b[0].fv)).toBe(300);
    expect(Number(b[1].fv)).toBe(300);
  });

  it('last_value returns last in window frame', async () => {
    // last_value in DuckDB uses default frame ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    const rows = await runWindowSql(
      `CREATE TEMP TABLE out AS SELECT id, region, last_value(amount) over(partition by region order by score) AS lv FROM inp`,
      `INSERT INTO inp VALUES (1, 'A', 10, 100), (2, 'A', 20, 200), (3, 'B', 5, 300), (4, 'B', 15, 400)`
    );
    const a = rows.filter((r) => r.region === 'A').sort((a, b) => Number(a.id) - Number(b.id));
    // First row in A (score=10): frame is just itself, last_value=100
    expect(Number(a[0].lv)).toBe(100);
    // Second row in A (score=20): frame is rows 1-2, last_value=200
    expect(Number(a[1].lv)).toBe(200);
    const b = rows.filter((r) => r.region === 'B').sort((a, b) => Number(a.id) - Number(b.id));
    expect(Number(b[0].lv)).toBe(300);
    expect(Number(b[1].lv)).toBe(400);
  });
});

describe('DuckDB integration — new math functions', () => {
  it('ceil rounds up', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: 'ceil([amount])' }],
      })
    );
    // ORDER BY revenue: amounts are 15, 5, 20
    expect(Number(rows[0].r)).toBe(15);
    expect(Number(rows[1].r)).toBe(5);
    expect(Number(rows[2].r)).toBe(20);
  });

  it('floor rounds down', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: 'floor([amount])' }],
      })
    );
    expect(Number(rows[0].r)).toBe(15);
    expect(Number(rows[1].r)).toBe(5);
    expect(Number(rows[2].r)).toBe(20);
  });
});

describe('DuckDB integration — new string functions', () => {
  it('contains returns true/false', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: "contains([name], 'li')" }],
      })
    );
    // ORDER BY revenue: Charlie(50), Alice(100), Bob(200)
    // contains('Charlie', 'li')=true, contains('Alice', 'li')=true, contains('Bob', 'li')=false
    expect(rows[0].r).toBe(true);
    expect(rows[1].r).toBe(true);
    expect(rows[2].r).toBe(false);
  });

  it('starts_with', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: "starts_with([name], 'A')" }],
      })
    );
    // ORDER BY revenue: Charlie, Alice(starts with A), Bob
    expect(rows[0].r).toBe(false);
    expect(rows[1].r).toBe(true);
    expect(rows[2].r).toBe(false);
  });

  it('ends_with', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: "ends_with([name], 'e')" }],
      })
    );
    // ORDER BY revenue: Charlie(ends with e), Alice(ends with e), Bob
    expect(rows[0].r).toBe(true);
    expect(rows[1].r).toBe(true);
    expect(rows[2].r).toBe(false);
  });

  it('replace', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: "replace([name], 'lic', 'X')" }],
      })
    );
    const alice = rows.find((row) => row.name === 'Alice');
    expect(alice!.r).toBe('AXe');
  });

  it('regexp_replace', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [
          { field: 'r', expression: "regexp_replace([name], '[aeiouAEIOU]', '*', 'g')" },
        ],
      })
    );
    const alice = rows.find((row) => row.name === 'Alice');
    expect(alice!.r).toBe('*l*c*');
  });

  it('lpad', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: "lpad([name], 10, '*')" }],
      })
    );
    const bob = rows.find((row) => row.name === 'Bob');
    // Bob is 3 chars, padded to 10 = 7 stars
    expect(bob!.r).toBe('*******Bob');
  });

  it('rpad', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: "rpad([name], 10, '*')" }],
      })
    );
    const bob = rows.find((row) => row.name === 'Bob');
    expect(bob!.r).toBe('Bob*******');
  });

  it('reverse', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: 'reverse([name])' }],
      })
    );
    const alice = rows.find((row) => row.name === 'Alice');
    const charlie = rows.find((row) => row.name === 'Charlie');
    expect(alice!.r).toBe('ecilA');
    expect(charlie!.r).toBe('eilrahC');
  });

  it('repeat', async () => {
    const rows = await runSql(
      compileCalculateFieldSql('out', 'inp', {
        calculations: [{ field: 'r', expression: "repeat([name] || '-', 2)" }],
      })
    );
    const alice = rows.find((row) => row.name === 'Alice');
    expect(alice!.r).toBe('Alice-Alice-');
  });
});

describe('DuckDB integration — new null functions', () => {
  it('nullif with empty string converts to null', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE t (s VARCHAR)');
    await conn.run("INSERT INTO t VALUES ('hello'), (''), ('world')");
    await conn.run(
      "CREATE TEMP TABLE out AS SELECT nullif(s, '') AS r FROM t ORDER BY s NULLS FIRST"
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].r).toBe(null);
    expect(rows[1].r).toBe('hello');
    expect(rows[2].r).toBe('world');
  });
});

describe('DuckDB integration — new type functions', () => {
  it('try_cast returns null on failure', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE t (s VARCHAR)');
    await conn.run("INSERT INTO t VALUES ('123'), ('abc'), ('456')");
    await conn.run(`CREATE TEMP TABLE out AS SELECT try_cast(s AS int) AS r FROM t ORDER BY s`);
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    // ORDER BY s string sort: '123', '456', 'abc'
    expect(Number(rows[0].r)).toBe(123);
    expect(Number(rows[1].r)).toBe(456);
    expect(rows[2].r).toBe(null);
  });

  it('try_cast parses string to number', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE t (s VARCHAR)');
    await conn.run("INSERT INTO t VALUES ('123.45'), ('-67.89')");
    await conn.run(`CREATE TEMP TABLE out AS SELECT try_cast(s AS double) AS r FROM t ORDER BY s`);
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    // ORDER BY s string sort: '-67.89', '123.45' (because '-' < '1')
    expect(Number(rows[0].r)).toBeCloseTo(-67.89, 1);
    expect(Number(rows[1].r)).toBeCloseTo(123.45, 1);
  });
});

describe('DuckDB integration — cross-row window functions', () => {
  async function runW(expression: string): Promise<Record<string, unknown>[]> {
    const conn = await connect();
    await conn.run('CREATE TABLE w (id INTEGER, amount DOUBLE, region VARCHAR, name VARCHAR)');
    await conn.run(
      "INSERT INTO w VALUES (1, 100, 'East', 'Alice'), (2, 200, 'West', 'Bob'), (3, 50, 'East', 'Charlie')"
    );
    await conn.run(
      compileCalculateFieldSql('out', 'w', { calculations: [{ field: 'r', expression }] })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out ORDER BY id');
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }

  // ── Partitioned aggregates ──
  it('sum([amount]) OVER (PARTITION BY [region])', async () => {
    const rows = await runW('sum([amount]) OVER (PARTITION BY [region])');
    // East: 100+50=150, West: 200
    expect(rows[0].r).toBe(150); // Alice (East)
    expect(rows[1].r).toBe(200); // Bob (West)
    expect(rows[2].r).toBe(150); // Charlie (East)
  });

  it('avg([amount]) OVER (PARTITION BY [region])', async () => {
    const rows = await runW('avg([amount]) OVER (PARTITION BY [region])');
    expect(rows[0].r).toBe(75); // (100+50)/2
    expect(rows[1].r).toBe(200); // West single value
    expect(rows[2].r).toBe(75); // (100+50)/2
  });

  it('min([amount]) OVER (PARTITION BY [region])', async () => {
    const rows = await runW('min([amount]) OVER (PARTITION BY [region])');
    expect(rows[0].r).toBe(50); // Alice (East min)
    expect(rows[1].r).toBe(200); // Bob (West min)
    expect(rows[2].r).toBe(50); // Charlie (East min)
  });

  it('max([amount]) OVER (PARTITION BY [region])', async () => {
    const rows = await runW('max([amount]) OVER (PARTITION BY [region])');
    expect(rows[0].r).toBe(100); // Alice (East max)
    expect(rows[1].r).toBe(200); // Bob (West max)
    expect(rows[2].r).toBe(100); // Charlie (East max)
  });

  it('count(*) OVER () returns total row count', async () => {
    const rows = await runW('count(*) OVER ()');
    expect(rows[0].r).toBe('3'); // DuckDB count returns string
    expect(rows[1].r).toBe('3');
    expect(rows[2].r).toBe('3');
  });

  // ── Ranking ──
  it('ranking(rank()) orders rows by amount descending', async () => {
    const rows = await runW('ranking(rank()) over(order by [amount] desc)');
    // 200(Bob) rank1, 100(Alice) rank2, 50(Charlie) rank3
    expect(rows[0].r).toBe('2'); // Alice rank 2
    expect(rows[1].r).toBe('1'); // Bob rank 1
    expect(rows[2].r).toBe('3'); // Charlie rank 3
  });

  it('ranking(row_number()) assigns row numbers', async () => {
    const rows = await runW('ranking(row_number()) over(order by [id])');
    expect(rows[0].r).toBe('1');
    expect(rows[1].r).toBe('2');
    expect(rows[2].r).toBe('3');
  });

  it('ranking(dense_rank()) assigns dense ranks within a partition', async () => {
    const rows = await runW('ranking(dense_rank()) over(partition by [region] order by [amount])');
    // East: 50(Charlie)=1, 100(Alice)=2; West: 200(Bob)=1
    expect(rows[0].r).toBe('2'); // Alice (East, amount=100 rank2)
    expect(rows[1].r).toBe('1'); // Bob (West, amount=200 rank1)
    expect(rows[2].r).toBe('1'); // Charlie (East, amount=50 rank1)
  });

  it('ranking(ntile(2)) divides rows into two buckets', async () => {
    const rows = await runW('ranking(ntile(2)) over(order by [id])');
    // 3 rows, 2 buckets: 1→bucket1, 2→bucket1, 3→bucket2
    expect(rows[0].r).toBe('1');
    expect(rows[1].r).toBe('1');
    expect(rows[2].r).toBe('2');
  });

  it('ranking(percent_rank()) calculates the relative rank', async () => {
    const rows = await runW('ranking(percent_rank()) over(order by [amount])');
    expect(Number(rows[0].r)).toBeCloseTo(0.5);
    expect(Number(rows[1].r)).toBeCloseTo(1);
    expect(Number(rows[2].r)).toBeCloseTo(0);
  });

  it('ranking(cume_dist()) calculates the cumulative distribution', async () => {
    const rows = await runW('ranking(cume_dist()) over(order by [amount])');
    expect(Number(rows[0].r)).toBeCloseTo(2 / 3);
    expect(Number(rows[1].r)).toBeCloseTo(1);
    expect(Number(rows[2].r)).toBeCloseTo(1 / 3);
  });

  it('ranking(row_number()) over(...) domain DSL expands to the same result', async () => {
    const rows = await runW(
      'ranking(row_number()) over(partition by [region] order by [amount] desc)'
    );
    expect(rows[0].r).toBe('1'); // Alice (East, amount=100)
    expect(rows[1].r).toBe('1'); // Bob (West, amount=200)
    expect(rows[2].r).toBe('2'); // Charlie (East, amount=50)
  });

  it('ranking(ntile(2)) domain DSL with a bare order identifier expands correctly', async () => {
    const rows = await runW('ranking(ntile(2)) over(order by id)');
    expect(rows[0].r).toBe('1');
    expect(rows[1].r).toBe('1');
    expect(rows[2].r).toBe('2');
  });

  // ── Offset ──
  it('reference(lag([amount])) returns the previous row value', async () => {
    const rows = await runW('reference(lag([amount])) over(order by [id])');
    expect(rows[0].r).toBe(null); // Alice: no previous
    expect(rows[1].r).toBe(100); // Bob: previous=100
    expect(rows[2].r).toBe(200); // Charlie: previous=200
  });

  it('reference(lead([amount])) returns the next row value', async () => {
    const rows = await runW('reference(lead([amount])) over(order by [id])');
    expect(rows[0].r).toBe(200); // Alice: next=200
    expect(rows[1].r).toBe(50); // Bob: next=50
    expect(rows[2].r).toBe(null); // Charlie: no next
  });

  // ── Frame ──
  it('sum([amount]) OVER (ORDER BY [id] ROWS UNBOUNDED PRECEDING) running total', async () => {
    const rows = await runW(
      'sum([amount]) OVER (ORDER BY [id] ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)'
    );
    expect(rows[0].r).toBe(100); // 100
    expect(rows[1].r).toBe(300); // 100+200
    expect(rows[2].r).toBe(350); // 100+200+50
  });

  it('avg([amount]) OVER (ORDER BY [id] ROWS 1 PRECEDING) moving average 2 rows', async () => {
    const rows = await runW(
      'avg([amount]) OVER (ORDER BY [id] ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)'
    );
    expect(rows[0].r).toBe(100); // (100)/1
    expect(rows[1].r).toBe(150); // (100+200)/2
    expect(rows[2].r).toBe(125); // (200+50)/2
  });

  // ── Value ──
  it('reference(first([amount])) returns the first partition value', async () => {
    const rows = await runW('reference(first([amount])) over(partition by [region] order by [id])');
    // East: first=100(Alice), West: first=200(Bob)
    expect(rows[0].r).toBe(100); // Alice (East, first=100)
    expect(rows[1].r).toBe(200); // Bob (West, first=200)
    expect(rows[2].r).toBe(100); // Charlie (East, first=100)
  });

  it('reference(last([amount])) uses the full partition frame', async () => {
    const rows = await runW('reference(last([amount])) over(partition by [region] order by [id])');
    // East: last=50(Charlie), West: last=200(Bob)
    expect(rows[0].r).toBe(50); // Alice (East, last=50)
    expect(rows[1].r).toBe(200); // Bob (West, last=200)
    expect(rows[2].r).toBe(50); // Charlie (East, last=50)
  });

  it('executes renamed group aggregate operations', async () => {
    const variance = await runW('group(var_pop([amount])) over(partition by [region])');
    expect(Number(variance[0].r)).toBeCloseTo(625);
    expect(Number(variance[1].r)).toBeCloseTo(0);
    expect(Number(variance[2].r)).toBeCloseTo(625);

    const distinct = await runW('group(count_distinct([name])) over(partition by [region])');
    expect(distinct.map((row) => row.r)).toEqual(['2', '1', '2']);

    const quantile = await runW('group(quantile_cont([amount], 0.5)) over(partition by [region])');
    expect(quantile.map((row) => Number(row.r))).toEqual([75, 200, 75]);

    const allPositive = await runW('group(bool_and([amount] > 0)) over(partition by [region])');
    expect(allPositive.map((row) => row.r)).toEqual([true, true, true]);

    const anyAbove150 = await runW('group(bool_or([amount] > 150)) over(partition by [region])');
    expect(anyAbove150.map((row) => row.r)).toEqual([false, true, false]);
  });

  it('executes group percentoftotal and string_agg operations', async () => {
    const percentage = await runW('group(percentoftotal([amount])) over(partition by [region])');
    expect(Number(percentage[0].r)).toBeCloseTo(2 / 3);
    expect(Number(percentage[1].r)).toBeCloseTo(1);
    expect(Number(percentage[2].r)).toBeCloseTo(1 / 3);

    const concatenated = await runW('group(string_agg([name], ",")) over(partition by [region])');
    expect(new Set(String(concatenated[0].r).split(','))).toEqual(new Set(['Alice', 'Charlie']));
    expect(concatenated[1].r).toBe('Bob');
    expect(new Set(String(concatenated[2].r).split(','))).toEqual(new Set(['Alice', 'Charlie']));
  });

  // ── Percentage ──
  it('[amount] / sum([amount]) OVER () calculates percentage of total', async () => {
    const rows = await runW('[amount] / sum([amount]) OVER ()');
    // Total=350, Alice=100/350, Bob=200/350, Charlie=50/350
    expect(Number(rows[0].r)).toBeCloseTo(100 / 350, 5);
    expect(Number(rows[1].r)).toBeCloseTo(200 / 350, 5);
    expect(Number(rows[2].r)).toBeCloseTo(50 / 350, 5);
  });

  it('executes a raw window expression with a bounded frame', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE wf (id INTEGER, amount DOUBLE)');
    await conn.run('INSERT INTO wf VALUES (1, 100), (2, 200), (3, 50)');
    await conn.run(
      compileCalculateFieldSql('out', 'wf', {
        calculations: [
          {
            field: 'r',
            expression:
              'sum([amount]) OVER (ORDER BY [id] ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
            action: 'add',
          },
        ],
      })
    );
    const reader = await conn.runAndReadAll('SELECT r FROM out ORDER BY id');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].r).toBe(100);
    expect(rows[1].r).toBe(300);
    expect(rows[2].r).toBe(250);
  });

  // ── Custom offset types ──
  it('compound lag expression with N=2 compares against 2 rows back', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (id INTEGER, amount DOUBLE)');
    await conn.run('INSERT INTO w VALUES (1, 100), (2, 200), (3, 50)');
    await conn.run(
      compileCalculateFieldSql('out', 'w', {
        calculations: [
          {
            field: 'r',
            expression: '[amount] - lag([amount], 2) OVER (ORDER BY [id])',
          },
        ],
      })
    );
    const reader = await conn.runAndReadAll('SELECT r FROM out ORDER BY id');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].r).toBe(null); // id=1: no row 2 back
    expect(rows[1].r).toBe(null); // id=2: no row 2 back
    expect(rows[2].r).toBe(-50); // id=3: 50 - 100(1) = -50
  });

  it('compound lag rate expression with N=2 calculates rate against 2 rows back', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (id INTEGER, amount DOUBLE)');
    await conn.run('INSERT INTO w VALUES (1, 100), (2, 200), (3, 50)');
    await conn.run(
      compileCalculateFieldSql('out', 'w', {
        calculations: [
          {
            field: 'r',
            expression:
              '([amount] - lag([amount], 2) OVER (ORDER BY [id])) / lag([amount], 2) OVER (ORDER BY [id])',
          },
        ],
      })
    );
    const reader = await conn.runAndReadAll('SELECT r FROM out ORDER BY id');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].r).toBe(null); // id=1: no row 2 back
    expect(rows[1].r).toBe(null); // id=2: no row 2 back
    expect(Number(rows[2].r)).toBeCloseTo(-0.5, 5); // (50-100)/100 = -0.5
  });

  // ── String aggregate ──
  it("string_agg([name], ', ') OVER (PARTITION BY [region]) concatenates names", async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (id INTEGER, name VARCHAR, region VARCHAR)');
    await conn.run(
      "INSERT INTO w VALUES (1, 'Alice', 'East'), (2, 'Bob', 'West'), (3, 'Charlie', 'East')"
    );
    await conn.run(
      compileCalculateFieldSql('out', 'w', {
        calculations: [
          { field: 'r', expression: "string_agg([name], ', ') OVER (PARTITION BY [region])" },
        ],
      })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out ORDER BY id');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].r).toBe('Alice, Charlie'); // East
    expect(rows[1].r).toBe('Bob'); // West
    expect(rows[2].r).toBe('Alice, Charlie'); // East
  });

  // ── Multiple calculations ──
  it('multiple calculations in one node', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (id INTEGER, amount DOUBLE, region VARCHAR)');
    await conn.run("INSERT INTO w VALUES (1, 100, 'East'), (2, 200, 'West'), (3, 50, 'East')");
    await conn.run(
      compileCalculateFieldSql('out', 'w', {
        calculations: [
          { field: 'total', expression: 'sum([amount]) OVER ()' },
          { field: 'rn', expression: 'ranking(row_number()) over(order by [id])' },
        ],
      })
    );
    const reader = await conn.runAndReadAll('SELECT total, rn FROM out ORDER BY id');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].total).toBe(350);
    expect(rows[0].rn).toBe('1');
    expect(rows[1].total).toBe(350);
    expect(rows[1].rn).toBe('2');
  });
});
