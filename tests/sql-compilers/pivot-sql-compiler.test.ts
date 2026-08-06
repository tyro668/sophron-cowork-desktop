import { describe, expect, it } from 'vitest';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { compilePivotSql } from '../../src/main/data/operators/pivot';

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
      on: ['month'],
      values: { month: ['Jan', 'Feb'] },
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
      on: ['month'],
      values: { month: ['Jan', 'Feb', 'Mar'] },
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
      on: ['year', 'quarter'],
      // The graphical value picker returns strings even for numeric source fields.
      values: { year: ['2024', '2025'], quarter: ['Q1', 'Q2'] },
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

  it('leaves fields without configured values dynamically expanded', async () => {
    const connection = await connect();
    await connection.run(
      'CREATE TABLE sales (region VARCHAR, year INTEGER, quarter VARCHAR, amount INTEGER)'
    );
    await connection.run("INSERT INTO sales VALUES ('East', 2024, 'Q1', 10)");

    const sql = compilePivotSql('result', 'sales', {
      on: ['year', 'quarter'],
      values: { year: ['2024'] },
      using: [{ function: 'sum', expression: '[amount]' }],
      groupBy: ['region'],
    });
    await connection.run(sql);

    expect(await columnNames(connection, 'result')).toEqual(['region', '2024_Q1']);
  });
});
