import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { compileLimitSql } from '../../src/main/data/operators/limit';

describe('compileLimitSql', () => {
  it('rejects percentages above 100 instead of silently clamping them', () => {
    expect(() =>
      compileLimitSql('output', 'input', ['value'], {
        mode: 'fixed',
        unit: 'percent',
        limit: 101,
      })
    ).toThrow('Percentage cannot exceed 100');
  });

  it('uses reservoir semantics for fixed-row sampling even with legacy method config', () => {
    const sql = compileLimitSql('output', 'input', ['value'], {
      mode: 'random',
      unit: 'rows',
      limit: 10,
      method: 'bernoulli',
      seed: 42,
    });

    expect(sql).toContain('reservoir(10 ROWS)');
    expect(sql).not.toContain('BERNOULLI');
  });

  it('defaults percentage sampling to system and supports bernoulli explicitly', () => {
    const systemSql = compileLimitSql('output', 'input', ['value'], {
      mode: 'random',
      unit: 'percent',
      limit: 10,
    });
    const bernoulliSql = compileLimitSql('output', 'input', ['value'], {
      mode: 'random',
      unit: 'percent',
      limit: 10,
      method: 'bernoulli',
    });

    expect(systemSql).toContain('TABLESAMPLE SYSTEM(10%)');
    expect(bernoulliSql).toContain('TABLESAMPLE BERNOULLI(10%)');
  });

  it('compiles offset+ties into a numbered CTE with rank boundary and projection', () => {
    const sql = compileLimitSql('output', 'input', ['value'], {
      mode: 'fixed',
      unit: 'rows',
      limit: 5,
      offset: 2,
      ties: true,
      orderBy: [{ field: 'value', direction: 'desc' }],
    });

    expect(sql).toContain('WITH numbered AS (');
    expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY "value" DESC)');
    expect(sql).toContain('RANK() OVER (ORDER BY "value" DESC)');
    expect(sql).toContain('FROM input');
    expect(sql).toContain('FROM numbered');
    expect(sql).toContain('WHERE __rn > 2');
    expect(sql).toContain('COALESCE(');
    expect(sql).toContain('ORDER BY "value" DESC');
  });

  it('uses the requested projection columns instead of selecting all in offset+ties', () => {
    const sql = compileLimitSql('output', 'input', ['value'], {
      mode: 'fixed',
      unit: 'rows',
      limit: 5,
      offset: 2,
      ties: true,
      orderBy: [{ field: 'value', direction: 'asc' }],
    });

    expect(sql).toContain('SELECT "value"');
    expect(sql).not.toContain('SELECT * FROM numbered');
  });

  it('compiles offset+ties with offset 0 into the same numbered CTE path', () => {
    const sql = compileLimitSql('output', 'input', ['value'], {
      mode: 'fixed',
      unit: 'rows',
      limit: 5,
      offset: 0,
      ties: true,
      orderBy: [{ field: 'value', direction: 'asc' }],
    });

    expect(sql).toContain('WITH numbered AS (');
    expect(sql).toContain('RANK() OVER (ORDER BY "value" ASC)');
    expect(sql).toContain('FROM numbered');
    expect(sql).toContain('WHERE __rn > 0');
  });

  it('executes offset+ties across tie groups using the post-offset boundary row', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      await connection.run('CREATE TABLE input (id INTEGER, score INTEGER)');
      await connection.run(
        'INSERT INTO input VALUES (1, 10), (2, 10), (3, 10), (4, 20), (5, 20), (6, 30)'
      );
      await connection.run(
        compileLimitSql('output', 'input', ['id', 'score'], {
          mode: 'fixed',
          unit: 'rows',
          limit: 2,
          offset: 2,
          ties: true,
          orderBy: [{ field: 'score', direction: 'asc' }],
        })
      );

      const result = await connection.runAndReadAll('SELECT id, score FROM output ORDER BY id');
      expect(result.getRowObjectsJson()).toEqual([
        { id: 3, score: 10 },
        { id: 4, score: 20 },
        { id: 5, score: 20 },
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('preserves source __rn/__rk fields without exposing helper columns', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      await connection.run(
        'CREATE TABLE input (__rn VARCHAR, __rk VARCHAR, id INTEGER, score INTEGER)'
      );
      await connection.run(
        "INSERT INTO input VALUES ('source-rn-1', 'source-rk-1', 1, 10), ('source-rn-2', 'source-rk-2', 2, 10), ('source-rn-3', 'source-rk-3', 3, 20)"
      );
      await connection.run(
        compileLimitSql('output', 'input', ['__rn', '__rk', 'id', 'score'], {
          mode: 'fixed',
          unit: 'rows',
          limit: 1,
          offset: 0,
          ties: true,
          orderBy: [{ field: 'score', direction: 'asc' }],
        })
      );

      const result = await connection.runAndReadAll('SELECT * FROM output ORDER BY id');
      expect(result.getRowObjectsJson()).toEqual([
        { __rn: 'source-rn-1', __rk: 'source-rk-1', id: 1, score: 10 },
        { __rn: 'source-rn-2', __rk: 'source-rk-2', id: 2, score: 10 },
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });
});
