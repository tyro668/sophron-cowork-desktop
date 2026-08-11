import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { compileUnnestSql } from '../../src/main/data/operators/unnest';

async function executeList(
  rows: string,
  columns: string[],
  config: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  const createCols = columns.map((c) => `${c} VARCHAR`).join(', ');
  await connection.run(`CREATE TABLE inp (${createCols})`);
  await connection.run(`INSERT INTO inp VALUES ${rows}`);
  await connection.run(compileUnnestSql('out', 'inp', columns, config));
  const result = await connection.runAndReadAll('SELECT * FROM out ORDER BY id');
  return result.getRowObjectsJson() as Record<string, unknown>[];
}

async function executeJson(
  rows: string,
  columns: string[],
  config: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  const createCols = columns.map((c) => `${c} VARCHAR`).join(', ');
  await connection.run(`CREATE TABLE inp (${createCols})`);
  await connection.run(`INSERT INTO inp VALUES ${rows}`);
  await connection.run(compileUnnestSql('out', 'inp', columns, config));
  const result = await connection.runAndReadAll('SELECT * FROM out ORDER BY id');
  return result.getRowObjectsJson() as Record<string, unknown>[];
}

describe('compileUnnestSql — list mode', () => {
  it('unnests a basic array into rows', async () => {
    const rows = await executeList("(1, '[1, 2, 3]')", ['id', 'items'], {
      sourceKind: 'list',
      column: 'items',
      alias: 'item',
      preserveOrder: true,
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => Number(r.item))).toEqual([1, 2, 3]);
  });

  it('returns one row with null when source is NULL', async () => {
    const rows = await executeList('(1, NULL)', ['id', 'items'], {
      sourceKind: 'list',
      column: 'items',
      alias: 'item',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toBeNull();
  });

  it('returns one row with null when source is empty array', async () => {
    const rows = await executeList("(1, '[]')", ['id', 'items'], {
      sourceKind: 'list',
      column: 'items',
      alias: 'item',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toBeNull();
  });

  it('unnests with index column', async () => {
    const rows = await executeList("(1, '[10, 20]')", ['id', 'items'], {
      sourceKind: 'list',
      column: 'items',
      alias: 'item',
      withIndex: 'idx',
      preserveOrder: true,
    });
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].item)).toBe(10);
    expect(Number(rows[0].idx)).toBe(0);
    expect(Number(rows[1].item)).toBe(20);
    expect(Number(rows[1].idx)).toBe(1);
  });

  it('unnests with keepParentNames', async () => {
    const rows = await executeList("(1, '[10, 20]')", ['id', 'items'], {
      sourceKind: 'list',
      column: 'items',
      alias: 'val',
      keepParentNames: true,
      preserveOrder: true,
    });
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].items_val)).toBe(10);
    expect(Number(rows[1].items_val)).toBe(20);
  });

  it('preserves original row order', async () => {
    const rows = await executeList("(1, '[3, 1]'), (2, '[5, 2]')", ['id', 'items'], {
      sourceKind: 'list',
      column: 'items',
      alias: 'item',
      preserveOrder: true,
    });
    expect(rows).toHaveLength(4);
    const items = rows.map((r) => Number(r.item));
    expect(items).toEqual([3, 1, 5, 2]);
  });
});

describe('compileUnnestSql — JSON OBJECT mode', () => {
  it('expands JSON object keys into columns', async () => {
    const rows = await executeJson('(1, \'{"a": 10, "b": 20}\')', ['id', 'payload'], {
      sourceKind: 'json',
      column: 'payload',
      path: '$',
      _jsonType: 'OBJECT',
      _jsonKeys: ['a', 'b'],
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].a)).toBe(10);
    expect(Number(rows[0].b)).toBe(20);
  });

  it('expands JSON keys with special characters', async () => {
    const rows = await executeJson('(1, \'{"a.b": 1, "normal": 2}\')', ['id', 'payload'], {
      sourceKind: 'json',
      column: 'payload',
      path: '$',
      _jsonType: 'OBJECT',
      _jsonKeys: ['a.b', 'normal'],
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]['a.b'])).toBe(1);
    expect(Number(rows[0].normal)).toBe(2);
  });

  it('returns null columns when JSON source is NULL', async () => {
    const rows = await executeJson('(1, NULL)', ['id', 'payload'], {
      sourceKind: 'json',
      column: 'payload',
      path: '$',
      _jsonType: 'OBJECT',
      _jsonKeys: ['a'],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBeNull();
  });
});

describe('compileUnnestSql — conflict detection', () => {
  it('throws when alias conflicts with existing column', () => {
    expect(() =>
      compileUnnestSql('out', 'inp', ['id', 'items', 'item'], {
        sourceKind: 'list',
        column: 'items',
        alias: 'item',
      })
    ).toThrow(/conflict/);
  });

  it('throws when index column conflicts with existing column', () => {
    expect(() =>
      compileUnnestSql('out', 'inp', ['id', 'items', 'idx'], {
        sourceKind: 'list',
        column: 'items',
        alias: 'val',
        withIndex: 'idx',
      })
    ).toThrow(/conflict/);
  });

  it('throws when alias and index column have the same name', async () => {
    await expect(
      executeList("(1, '[1]')", ['id', 'items'], {
        sourceKind: 'list',
        column: 'items',
        alias: 'idx',
        withIndex: 'idx',
      })
    ).rejects.toThrow(/must be different/);
  });

  it('throws when JSON key conflicts with existing column', async () => {
    await expect(
      executeJson('(1, \'{"id": 1}\')', ['id', 'payload'], {
        sourceKind: 'json',
        column: 'payload',
        path: '$',
        _jsonType: 'OBJECT',
        _jsonKeys: ['id'],
      })
    ).rejects.toThrow(/conflict/);
  });

  it('throws when JSON keys have duplicates after normalization', async () => {
    await expect(
      executeJson('(1, \'{"A": 1, "a": 2}\')', ['id', 'payload'], {
        sourceKind: 'json',
        column: 'payload',
        path: '$',
        _jsonType: 'OBJECT',
        _jsonKeys: ['A', 'a'],
      })
    ).rejects.toThrow(/duplicate/);
  });
});
