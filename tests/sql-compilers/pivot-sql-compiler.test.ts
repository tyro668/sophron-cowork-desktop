import { describe, expect, it } from 'vitest';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import {
  compilePivotSql,
  RESOLVED_DYNAMIC_PIVOT_VALUES,
} from '../../src/main/data/operators/pivot';

async function connect(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(':memory:');
  return await instance.connect();
}

async function columnNames(connection: DuckDBConnection, table: string): Promise<string[]> {
  const reader = await connection.runAndReadAll(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`
  );
  return (reader.getRowObjectsJson() as Array<{ column_name: string }>).map(
    (row) => row.column_name
  );
}

describe('compilePivotSql', () => {
  it('uses native IN so selected values remain output columns when data is absent', async () => {
    const connection = await connect();
    await connection.run('CREATE TABLE sales (region VARCHAR, month VARCHAR, amount INTEGER)');
    await connection.run("INSERT INTO sales VALUES ('East', 'Jan', 10)");

    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'month', values: ['Jan', 'Feb'] }],
      using: [{ function: 'sum', expression: '[amount]' }],
      groupBy: ['region'],
    });
    expect(sql).toContain(`ON "month" IN ('Jan', 'Feb')`);
    await connection.run(sql);

    expect(await columnNames(connection, 'result')).toEqual(['region', 'Jan', 'Feb']);
  });

  it('preserves group rows with no matching data and keeps absent values as null columns', async () => {
    const connection = await connect();
    await connection.run('CREATE TABLE sales (region VARCHAR, month VARCHAR, amount INTEGER)');
    await connection.run(`
      INSERT INTO sales VALUES
        ('East', 'Jan', 10),
        ('West', 'Feb', 20)
    `);

    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'month', values: ['Jan', 'Feb', 'Mar'] }],
      using: [{ function: 'sum', expression: '[amount]' }],
      groupBy: ['region'],
    });
    await connection.run(sql);

    const reader = await connection.runAndReadAll('SELECT * FROM result ORDER BY region');
    const rows = reader.getRowObjectsJson();
    expect(rows).toEqual([
      { region: 'East', Jan: '10', Feb: null, Mar: null },
      { region: 'West', Jan: null, Feb: '20', Mar: null },
    ]);
  });

  it('applies independent IN restrictions per ON field', async () => {
    const connection = await connect();
    await connection.run(
      'CREATE TABLE sales (region VARCHAR, year INTEGER, quarter VARCHAR, amount INTEGER)'
    );
    await connection.run(`
      INSERT INTO sales VALUES
        ('East', 2024, 'Q1', 10),
        ('East', 2024, 'Q3', 70),
        ('East', 2025, 'Q1', 80),
        ('West', 2025, 'Q2', 90)
    `);

    const sql = compilePivotSql('result', 'sales', {
      on: [
        { field: 'year', values: ['2024', '2025'] },
        { field: 'quarter', values: ['Q1', 'Q2'] },
      ],
      using: [{ function: 'sum', expression: '[amount]' }],
      groupBy: ['region'],
    });
    expect(sql).toContain(`ON "year" IN ('2024', '2025'), "quarter" IN ('Q1', 'Q2')`);
    await connection.run(sql);

    const reader = await connection.runAndReadAll('SELECT * FROM result ORDER BY region');
    const rows = reader.getRowObjectsJson();
    expect(rows).toEqual([
      {
        region: 'East',
        '2024_Q1': '10',
        '2024_Q2': null,
        '2025_Q1': '80',
        '2025_Q2': null,
      },
      {
        region: 'West',
        '2024_Q1': null,
        '2024_Q2': null,
        '2025_Q1': null,
        '2025_Q2': '90',
      },
    ]);
  });

  it('rejects unresolved dynamic values at the SQL compiler boundary', () => {
    expect(() =>
      compilePivotSql('result', 'sales', {
        on: [
          { field: 'year', values: ['2024'] },
          { field: 'quarter', values: [] },
        ],
        using: [{ function: 'sum', expression: '[amount]' }],
        groupBy: ['region'],
      })
    ).toThrow(/quarter.*unresolved dynamic values/);
  });

  it('accepts an empty resolved value set for an empty input relation', async () => {
    const connection = await connect();
    await connection.run('CREATE TABLE sales (region VARCHAR, quarter VARCHAR, amount INTEGER)');
    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'quarter', values: [] }],
      using: [{ function: 'sum', expression: '[amount]' }],
      groupBy: ['region'],
      [RESOLVED_DYNAMIC_PIVOT_VALUES]: true,
    });
    await connection.run(sql);

    expect(await columnNames(connection, 'result')).toEqual(['region']);
  });

  it('compiles numeric values as bare literals, not quoted strings', async () => {
    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'year', values: [2024, 2025] }],
      using: [{ function: 'sum', expression: '[amount]' }],
    });
    expect(sql).toContain(`ON "year" IN (2024, 2025)`);
  });

  it('compiles boolean values as bare literals', async () => {
    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'active', values: [true, false] }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(sql).toContain(`ON "active" IN (TRUE, FALSE)`);
  });

  it('compiles null values as NULL', async () => {
    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'status', values: [null] }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(sql).toContain(`ON "status" IN (NULL)`);
  });

  it('creates a stable column name for a selected empty-string pivot value', async () => {
    const connection = await connect();
    await connection.run('CREATE TABLE sales (status VARCHAR, amount INTEGER)');
    await connection.run("INSERT INTO sales VALUES ('', 10), ('paid', 20)");

    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'status', values: [''] }],
      using: [{ function: 'sum', expression: '[amount]' }],
    });
    expect(sql).toContain(`IN ('' AS "empty")`);
    await connection.run(sql);

    expect(await columnNames(connection, 'result')).toEqual(['empty']);
    const selectedReader = await connection.runAndReadAll('SELECT * FROM result');
    expect(selectedReader.getRowObjectsJson()).toEqual([{ empty: '10' }]);
  });

  it('suffixes the empty-string column without merging conflicting source values', async () => {
    const connection = await connect();
    await connection.run('CREATE TABLE sales (status VARCHAR, amount INTEGER)');
    await connection.run(
      "INSERT INTO sales VALUES ('', 10), ('empty', 20), ('empty_0', 30), ('paid', 40)"
    );

    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'status', values: ['', 'empty', 'empty_0', 'paid'] }],
      using: [{ function: 'sum', expression: '[amount]' }],
    });
    expect(sql).toContain(`IN ('' AS "empty_1", 'empty', 'empty_0', 'paid')`);
    await connection.run(sql);

    expect(await columnNames(connection, 'result')).toEqual([
      'empty_1',
      'empty',
      'empty_0',
      'paid',
    ]);
    const reader = await connection.runAndReadAll('SELECT * FROM result');
    expect(reader.getRowObjectsJson()).toEqual([
      { empty_1: '10', empty: '20', empty_0: '30', paid: '40' },
    ]);
  });

  it('escapes a quoted value containing a comma', async () => {
    const connection = await connect();
    await connection.run('CREATE TABLE sales (city VARCHAR, amount INTEGER)');
    await connection.run("INSERT INTO sales VALUES ('New York, NY', 10)");

    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'city', values: ['New York, NY'] }],
      using: [{ function: 'sum', expression: '[amount]' }],
    });
    expect(sql).toContain(`ON "city" IN ('New York, NY')`);
    await connection.run(sql);

    expect(await columnNames(connection, 'result')).toEqual(['New York, NY']);
  });

  it('rejects count_distinct with a star expression instead of emitting COUNT(DISTINCT *)', () => {
    expect(() =>
      compilePivotSql('result', 'sales', {
        on: [{ field: 'month', values: ['Jan'] }],
        using: [{ function: 'count_distinct', expression: '*' }],
      })
    ).toThrow(/only count may count all rows/);
  });

  it('allows count with a star expression', () => {
    const sql = compilePivotSql('result', 'sales', {
      on: [{ field: 'month', values: ['Jan'] }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(sql).toContain('COUNT(*)');
  });

  it('matches DECIMAL columns via string literals to preserve precision', async () => {
    const connection = await connect();
    await connection.run('CREATE TABLE t (d DECIMAL(18,6))');
    await connection.run('INSERT INTO t VALUES (-5),(2024),(3.14)');

    const sql = compilePivotSql('result', 't', {
      on: [{ field: 'd', values: ['-5', '2024', '3.14'] }],
      using: [{ function: 'count', expression: '*' }],
    });
    expect(sql).toContain(`ON "d" IN ('-5', '2024', '3.14')`);
    await connection.run(sql);

    expect(await columnNames(connection, 'result')).toEqual(['-5', '2024', '3.14']);
  });
});
