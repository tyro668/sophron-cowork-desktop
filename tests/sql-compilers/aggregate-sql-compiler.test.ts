import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { compileAggregateSql } from '../../src/main/data/operators/aggregate';

async function connect(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(':memory:');
  return await instance.connect();
}

describe('compileAggregateSql', () => {
  it('rejects an empty metrics list instead of falling back to row_count', () => {
    expect(() => compileAggregateSql('out', 'in', {})).toThrow(z.ZodError);
  });

  it('rejects a metric missing an expression', () => {
    expect(() =>
      compileAggregateSql('out', 'in', {
        metrics: [{ function: 'sum', expression: '', alias: 'total' }],
      })
    ).toThrow(z.ZodError);
  });

  it('rejects a metric missing an alias bypassing the DSL', () => {
    expect(() =>
      compileAggregateSql('out', 'in', {
        metrics: [{ function: 'sum', expression: '[revenue]', alias: '' }],
      })
    ).toThrow(z.ZodError);
  });

  it('compiles a complete metric with group by', () => {
    const sql = compileAggregateSql('out', 'in', {
      groupBy: ['region'],
      metrics: [{ function: 'sum', expression: '[revenue]', alias: 'total' }],
    });
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('SUM("revenue") AS "total"');
    expect(sql).not.toContain('row_count');
  });

  it('applies date granularity via date_trunc', () => {
    const sql = compileAggregateSql('out', 'in', {
      groupBy: ['Date'],
      dateGranularity: { Date: 'year' },
      metrics: [{ function: 'sum', expression: '[Price]', alias: '合价' }],
    });
    expect(sql).toContain('date_trunc(\'year\', "Date") AS "Date"');
    expect(sql).toContain('SUM("Price") AS "合价"');
  });

  it('executes string_agg with a single-quoted separator containing a paren', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (region VARCHAR, name VARCHAR)');
    await conn.run("INSERT INTO w VALUES ('East', 'Alice'), ('East', 'Bob'), ('West', 'Cara')");
    await conn.run(
      compileAggregateSql('out', 'w', {
        groupBy: ['region'],
        metrics: [
          { function: 'string_agg', expression: "[name], ')'", alias: 'names' },
          { function: 'count', expression: '*', alias: 'rows' },
        ],
      })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out ORDER BY region');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ region: 'East', names: 'Alice)Bob' });
    expect(Number(rows[0].rows)).toBe(2);
    expect(rows[1]).toMatchObject({ region: 'West', names: 'Cara' });
    expect(Number(rows[1].rows)).toBe(1);
  });

  it('executes a metric with a SQL-escaped single quote literal', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (name VARCHAR)');
    await conn.run("INSERT INTO w VALUES ('Alice'), ('Bob')");
    await conn.run(
      compileAggregateSql('out', 'w', {
        metrics: [{ function: 'string_agg', expression: "[name], 'it''s'", alias: 'joined' }],
      })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].joined).toBe("Aliceit'sBob");
  });

  it('executes a metric with a backslash-escaped single quote identically to SQL escape', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (name VARCHAR)');
    await conn.run("INSERT INTO w VALUES ('Alice'), ('Bob')");
    await conn.run(
      compileAggregateSql('out', 'w', {
        metrics: [{ function: 'string_agg', expression: "[name], 'it\\'s'", alias: 'joined' }],
      })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].joined).toBe("Aliceit'sBob");
  });

  it('injects a default comma separator into string_agg when expression has no comma', () => {
    const sql = compileAggregateSql('out', 'in', {
      metrics: [{ function: 'string_agg', expression: '[name]', alias: 'names' }],
    });
    expect(sql).toContain('STRING_AGG("name", \',\') AS "names"');
  });

  it('does not inject a default separator when expression already contains a comma', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (name VARCHAR)');
    await conn.run("INSERT INTO w VALUES ('Alice'), ('Bob')");
    await conn.run(
      compileAggregateSql('out', 'w', {
        metrics: [{ function: 'string_agg', expression: "[name], '|'", alias: 'names' }],
      })
    );
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].names).toBe('Alice|Bob');
  });

  it('injects default k=3 into approx_top_k and executes correctly', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (val INTEGER)');
    await conn.run('INSERT INTO w VALUES (10), (20), (30), (40), (50)');
    const sql = compileAggregateSql('out', 'w', {
      metrics: [{ function: 'approx_top_k', expression: '[val]', alias: 'top_vals' }],
    });
    expect(sql).toContain('APPROX_TOP_K("val", 3)');
    await conn.run(sql);
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].top_vals).toHaveLength(3);
  });

  it('injects default probability 0.5 into quantile_cont and executes correctly', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (val INTEGER)');
    await conn.run('INSERT INTO w VALUES (10), (20), (30)');
    const sql = compileAggregateSql('out', 'w', {
      metrics: [{ function: 'quantile_cont', expression: '[val]', alias: 'median' }],
    });
    expect(sql).toContain('QUANTILE_CONT("val", 0.5)');
    await conn.run(sql);
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(Number(rows[0].median)).toBe(20);
  });

  it('injects default probability 0.5 into quantile_disc and executes correctly', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (val INTEGER)');
    await conn.run('INSERT INTO w VALUES (10), (20), (30)');
    const sql = compileAggregateSql('out', 'w', {
      metrics: [{ function: 'quantile_disc', expression: '[val]', alias: 'median' }],
    });
    expect(sql).toContain('QUANTILE_DISC("val", 0.5)');
    await conn.run(sql);
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(Number(rows[0].median)).toBe(20);
  });

  it('injects default probability 0.5 into approx_quantile and executes correctly', async () => {
    const conn = await connect();
    await conn.run('CREATE TABLE w (val INTEGER)');
    await conn.run('INSERT INTO w VALUES (10), (20), (30)');
    const sql = compileAggregateSql('out', 'w', {
      metrics: [{ function: 'approx_quantile', expression: '[val]', alias: 'median' }],
    });
    expect(sql).toContain('APPROX_QUANTILE("val", 0.5)');
    await conn.run(sql);
    const reader = await conn.runAndReadAll('SELECT * FROM out');
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    expect(Number(rows[0].median)).toBe(20);
  });
});
