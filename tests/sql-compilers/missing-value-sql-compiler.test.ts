import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { compileMissingValueSql } from '../../src/main/data/operators/missing-value';

const columns = ['id', 'device', 'event_time', 'value'];

async function execute(
  rows: string,
  rules: Array<Record<string, unknown>>
): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run(
    'CREATE TABLE inp (id INTEGER, device VARCHAR, event_time INTEGER, value VARCHAR)'
  );
  await connection.run(`INSERT INTO inp VALUES ${rows}`);
  await connection.run(
    compileMissingValueSql('out', 'inp', columns, { strategy: 'by_column', rules })
  );
  const result = await connection.runAndReadAll('SELECT * FROM out ORDER BY id');
  return result.getRowObjectsJson() as Record<string, unknown>[];
}

describe('compileMissingValueSql forward/backward fill', () => {
  it('forward fills from the nearest preceding non-null row in original table order', async () => {
    const rows = await execute(
      "(1, 'a', 10, NULL), (2, 'b', 5, 'A'), (3, 'a', 1, NULL), (4, 'b', 20, NULL)",
      [{ column: 'value', method: 'forward_fill' }]
    );
    expect(rows.map((row) => row.value)).toEqual([null, 'A', 'A', 'A']);
  });

  it('backward fills from the nearest following non-null row in original table order', async () => {
    const rows = await execute(
      "(1, 'a', 10, NULL), (2, 'b', 5, NULL), (3, 'a', 1, 'B'), (4, 'b', 20, NULL)",
      [{ column: 'value', method: 'backward_fill' }]
    );
    expect(rows.map((row) => row.value)).toEqual(['B', 'B', 'B', null]);
  });

  it('applies repeated treatment of one field in rule order', async () => {
    const rows = await execute("(1, 'a', 10, 'N/A'), (2, 'b', 5, NULL)", [
      { column: 'value', method: 'nullify_values', values: ['N/A'] },
      { column: 'value', method: 'literal_fill', value: 'UNKNOWN' },
    ]);
    expect(rows.map((row) => row.value)).toEqual(['UNKNOWN', 'UNKNOWN']);
  });
});

describe('compileMissingValueSql typed literal values', () => {
  it('nullifies numeric and boolean values without converting them to strings', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run('CREATE TABLE inp (id INTEGER, amount DOUBLE, active BOOLEAN)');
    await connection.run('INSERT INTO inp VALUES (1, 0, false), (2, 2.5, true)');
    await connection.run(
      compileMissingValueSql('out', 'inp', ['id', 'amount', 'active'], {
        strategy: 'by_column',
        rules: [
          { column: 'amount', method: 'nullify_values', values: [0] },
          { column: 'active', method: 'nullify_values', values: [false] },
        ],
      })
    );
    const result = await connection.runAndReadAll('SELECT * FROM out ORDER BY id');
    expect(result.getRowObjectsJson()).toEqual([
      { id: 1, amount: null, active: null },
      { id: 2, amount: 2.5, active: true },
    ]);
  });

  it('fills a numeric column with a numeric literal', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run('CREATE TABLE inp (id INTEGER, amount DOUBLE)');
    await connection.run('INSERT INTO inp VALUES (1, NULL), (2, 2.5)');
    await connection.run(
      compileMissingValueSql('out', 'inp', ['id', 'amount'], {
        strategy: 'by_column',
        rules: [{ column: 'amount', method: 'literal_fill', value: 1.25 }],
      })
    );
    const result = await connection.runAndReadAll('SELECT * FROM out ORDER BY id');
    expect(result.getRowObjectsJson()).toEqual([
      { id: 1, amount: 1.25 },
      { id: 2, amount: 2.5 },
    ]);
  });
});

describe('compileMissingValueSql preserves source column types', () => {
  it.each([
    ['mean_fill', 2],
    ['median_fill', 2],
  ])('casts the %s result back to INTEGER', async (method, expectedValue) => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run('CREATE TABLE inp (id INTEGER, amount INTEGER)');
    await connection.run('INSERT INTO inp VALUES (1, 1), (2, NULL), (3, 2)');
    await connection.run(
      compileMissingValueSql('out', 'inp', ['id', 'amount'], {
        strategy: 'by_column',
        rules: [{ column: 'amount', method }],
      })
    );
    const result = await connection.runAndReadAll(
      'SELECT amount, typeof(amount) AS amount_type FROM out WHERE id = 2'
    );
    expect(result.getRowObjectsJson()).toEqual([{ amount: expectedValue, amount_type: 'INTEGER' }]);
  });

  it('casts a fractional literal back to the integer column type', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run('CREATE TABLE inp (id INTEGER, amount INTEGER)');
    await connection.run('INSERT INTO inp VALUES (1, NULL)');
    await connection.run(
      compileMissingValueSql('out', 'inp', ['id', 'amount'], {
        strategy: 'by_column',
        rules: [{ column: 'amount', method: 'literal_fill', value: 1.5 }],
      })
    );
    const result = await connection.runAndReadAll(
      'SELECT amount, typeof(amount) AS amount_type FROM out'
    );
    expect(result.getRowObjectsJson()).toEqual([{ amount: 2, amount_type: 'INTEGER' }]);
  });
});

describe('compileMissingValueSql validation and row deletion', () => {
  it('treats drop_empty_rows as all-null even when legacy config omits condition', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run(
      'CREATE TABLE inp (id INTEGER, first_value VARCHAR, second_value VARCHAR)'
    );
    await connection.run("INSERT INTO inp VALUES (1, NULL, NULL), (2, 'A', NULL), (3, NULL, 'B')");
    await connection.run(
      compileMissingValueSql('out', 'inp', ['id', 'first_value', 'second_value'], {
        strategy: 'drop_empty_rows',
        columns: ['first_value', 'second_value'],
      })
    );
    const result = await connection.runAndReadAll('SELECT id FROM out ORDER BY id');
    expect(result.getRowObjectsJson()).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it('rejects row deletion when the input has no fields', () => {
    expect(() =>
      compileMissingValueSql('out', 'inp', [], {
        strategy: 'drop_empty_rows',
      })
    ).toThrow(/requires at least one input field/);
  });

  it('rejects mean and median fill for known non-numeric fields before DuckDB execution', () => {
    expect(() =>
      compileMissingValueSql(
        'out',
        'inp',
        ['name'],
        {
          strategy: 'by_column',
          rules: [{ column: 'name', method: 'mean_fill' }],
        },
        { name: 'text' }
      )
    ).toThrow(/requires a numeric field/);
  });
});
