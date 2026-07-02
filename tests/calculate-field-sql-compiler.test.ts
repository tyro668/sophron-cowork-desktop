import { describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { compileScalarExpression } from '../src/main/data/operators/compute';
import { compileCalculateFieldSql } from '../src/main/data/operators/calculate-field';

async function runSql(sql: string): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
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
      `case "status" when 'PAID' THEN 1 ELSE 0 END`
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
    expect(compileScalarExpression('[t].[f]')).toBe('"t"."f"');
  });

  it('empty string literal', () => {
    expect(compileScalarExpression("[a] = ''")).toBe(`"a" = ''`);
  });

  it('string literal with special chars', () => {
    expect(compileScalarExpression("[a] = 'he''s'")).toBe(`"a" = 'he''s'`);
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
      'CASE WHEN "a" > 0 and "b" > 0 THEN "c" ELSE "d" END'
    );
  });

  it('if with or condition', () => {
    expect(compileScalarExpression('if [a] > 0 or [b] = 0 then [c] end')).toBe(
      'CASE WHEN "a" > 0 or "b" = 0 THEN "c" END'
    );
  });

  it('nested case inside if', () => {
    expect(
      compileScalarExpression("if [a] > 0 then case [b] when 'x' then 1 else 2 end else 0 end")
    ).toBe(`CASE WHEN "a" > 0 THEN case "b" when 'x' THEN 1 ELSE 2 END ELSE 0 END`);
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
    expect(compileScalarExpression('[active] = true')).toBe('"active" = true');
  });

  it('null literal', () => {
    expect(compileScalarExpression('is_null([a])')).toBe('is_null("a")');
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
    expect(compileScalarExpression('[a] is null')).toBe('"a" is null');
  });

  it('IS NOT NULL pattern', () => {
    expect(compileScalarExpression('[a] is not null')).toBe('"a" is not null');
  });

  it('empty string input', () => {
    expect(compileScalarExpression('')).toBe('');
  });

  it('whitespace-only input', () => {
    expect(compileScalarExpression('   ')).toBe('   ');
  });
});

describe('compileCalculateFieldSql', () => {
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

  it('empty calculations', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {});
    expect(sql).toBe('CREATE TEMP TABLE out AS SELECT * FROM inp');
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
          expression: 'row_number() over(partition by [region] order by [amount] desc)',
        },
      ],
    });
    expect(sql).toBe(
      'CREATE TEMP TABLE out AS SELECT *, row_number() over(partition by "region" order by "amount" desc) AS "rn" FROM inp'
    );
  });

  it('empty field name produces empty alias — compileCalculateFieldSql does not skip empty field', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {
      calculations: [
        { field: 'good', expression: '[a] + [b]' },
        { field: '', expression: '[x]' },
        { expression: '[y]' },
        { field: 'also_good', expression: '[c]' },
      ],
    });
    // field: '' passes typeof check and produces AS ""
    // missing 'field' key fails typeof check and is skipped
    expect(sql).toBe(
      'CREATE TEMP TABLE out AS SELECT *, "a" + "b" AS "good", "x" AS "", "c" AS "also_good" FROM inp'
    );
  });

  it('calculations as undefined', () => {
    const sql = compileCalculateFieldSql('out', 'inp', {});
    expect(sql).toBe('CREATE TEMP TABLE out AS SELECT * FROM inp');
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
    expect(sql).toContain('over(partition by "region")');
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
          expression: 'row_number() over(partition by [region] order by [amount] desc)',
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
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
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
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
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
