import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { compileUnpivotSql } from '../../src/main/data/operators/unpivot';

async function execute(
  rows: string,
  columns: string[],
  config: Record<string, unknown>,
  columnTypes: Record<string, string>
): Promise<{ rows: Record<string, unknown>[]; valueType: string }> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  const createCols = columns.map((c) => `${c} VARCHAR`).join(', ');
  await connection.run(`CREATE TABLE inp (${createCols})`);
  await connection.run(`INSERT INTO inp VALUES ${rows}`);

  const castCols = columns
    .map((c) => {
      const t = columnTypes[c];
      if (!t || t === 'text') return c;
      const duckType =
        t === 'integer'
          ? 'BIGINT'
          : t === 'float'
            ? 'DOUBLE'
            : t === 'decimal'
              ? 'DECIMAL(18,6)'
              : t === 'date'
                ? 'DATE'
                : t === 'datetime'
                  ? 'TIMESTAMPTZ'
                  : t === 'boolean'
                    ? 'BOOLEAN'
                    : 'VARCHAR';
      return `CAST(${c} AS ${duckType}) AS ${c}`;
    })
    .join(', ');
  await connection.run(`CREATE TABLE src AS SELECT ${castCols} FROM inp`);

  await connection.run(compileUnpivotSql('out', 'src', columns, config, columnTypes));
  const result = await connection.runAndReadAll('SELECT * FROM out ORDER BY 1, 2');
  const typeResult = await connection.runAndReadAll('SELECT typeof(value) AS vt FROM out LIMIT 1');
  return {
    rows: result.getRowObjectsJson() as Record<string, unknown>[],
    valueType: String((typeResult.getRowObjectsJson() as Record<string, unknown>[])[0]?.vt ?? ''),
  };
}

describe('compileUnpivotSql — type cast paths', () => {
  const columns = ['id', 'q1', 'q2'];
  const rows = "(1, 100, 'abc'), (2, NULL, 'def'), (3, 200, NULL)";

  it('int+text with includeNulls=false: value type is VARCHAR, nulls excluded', async () => {
    const { rows: result, valueType } = await execute(
      rows,
      columns,
      { columns: ['q1', 'q2'], mode: 'include', includeNulls: false },
      { id: 'integer', q1: 'integer', q2: 'text' }
    );
    expect(valueType).toBe('VARCHAR');
    // id=1: q1=100, q2='abc' → both non-null → 2 rows
    // id=2: q1=NULL → excluded, q2='def' → 1 row
    // id=3: q1=200 → 1 row, q2=NULL → excluded
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ id: '1', name: 'q1', value: '100' });
    expect(result[1]).toMatchObject({ id: '1', name: 'q2', value: 'abc' });
    expect(result[2]).toMatchObject({ id: '2', name: 'q2', value: 'def' });
    expect(result[3]).toMatchObject({ id: '3', name: 'q1', value: '200' });
  });

  it('int+text with includeNulls=true: value type is VARCHAR, nulls preserved', async () => {
    const { rows: result, valueType } = await execute(
      rows,
      columns,
      { columns: ['q1', 'q2'], mode: 'include', includeNulls: true },
      { id: 'integer', q1: 'integer', q2: 'text' }
    );
    expect(valueType).toBe('VARCHAR');
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ id: '1', name: 'q1', value: '100' });
    expect(result[1]).toMatchObject({ id: '1', name: 'q2', value: 'abc' });
    expect(result[2]).toMatchObject({ id: '2', name: 'q1', value: null });
    expect(result[3]).toMatchObject({ id: '2', name: 'q2', value: 'def' });
    expect(result[4]).toMatchObject({ id: '3', name: 'q1', value: '200' });
    expect(result[5]).toMatchObject({ id: '3', name: 'q2', value: null });
  });

  const rowsNum = '(1, 10, 3.5), (2, NULL, 2.5), (3, 5, NULL)';

  it('int+float with includeNulls=false: value type is DOUBLE, nulls excluded', async () => {
    const { rows: result, valueType } = await execute(
      rowsNum,
      columns,
      { columns: ['q1', 'q2'], mode: 'include', includeNulls: false },
      { id: 'integer', q1: 'integer', q2: 'float' }
    );
    expect(valueType).toBe('DOUBLE');
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ id: '1', name: 'q1', value: 10 });
    expect(result[1]).toMatchObject({ id: '1', name: 'q2', value: 3.5 });
    expect(result[2]).toMatchObject({ id: '2', name: 'q2', value: 2.5 });
    expect(result[3]).toMatchObject({ id: '3', name: 'q1', value: 5 });
  });

  it('int+float with includeNulls=true: value type is DOUBLE, nulls preserved', async () => {
    const { rows: result, valueType } = await execute(
      rowsNum,
      columns,
      { columns: ['q1', 'q2'], mode: 'include', includeNulls: true },
      { id: 'integer', q1: 'integer', q2: 'float' }
    );
    expect(valueType).toBe('DOUBLE');
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ id: '1', name: 'q1', value: 10 });
    expect(result[1]).toMatchObject({ id: '1', name: 'q2', value: 3.5 });
    expect(result[2]).toMatchObject({ id: '2', name: 'q1', value: null });
    expect(result[3]).toMatchObject({ id: '2', name: 'q2', value: 2.5 });
    expect(result[4]).toMatchObject({ id: '3', name: 'q1', value: 5 });
    expect(result[5]).toMatchObject({ id: '3', name: 'q2', value: null });
  });
});
