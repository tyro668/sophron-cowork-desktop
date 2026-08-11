import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { compileTypeConvertSql } from '../../src/main/data/operators/type-convert';

async function execute(
  rows: string,
  columns: string[],
  config: Record<string, unknown>,
  columnTypes?: Record<string, string>
): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run('CREATE TABLE inp (id INTEGER, val VARCHAR, extra VARCHAR)');
  await connection.run(`INSERT INTO inp VALUES ${rows}`);
  await connection.run(compileTypeConvertSql('out', 'inp', columns, config, columnTypes));
  const result = await connection.runAndReadAll('SELECT * FROM out ORDER BY id');
  return result.getRowObjectsJson() as Record<string, unknown>[];
}

describe('compileTypeConvertSql — try_strptime', () => {
  it('converts text to date with try_strptime, partial error rows become null', async () => {
    const rows = await execute(
      "(1, '2024-03-15', 'x'), (2, 'invalid', 'x'), (3, '2024-06-01', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [{ column: 'val', type: 'date', format: '%Y-%m-%d', onError: 'null' }],
      }
    );
    expect(rows.map((r) => String(r.id))).toEqual(['1', '2', '3']);
    expect(String(rows[0].val)).toBe('2024-03-15');
    expect(rows[1].val).toBeNull();
    expect(String(rows[2].val)).toBe('2024-06-01');
  });

  it('converts text to datetime with try_strptime', async () => {
    const rows = await execute(
      "(1, '2024-03-15 10:30:00', 'x'), (2, 'bad', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [
          { column: 'val', type: 'datetime', format: '%Y-%m-%d %H:%M:%S', onError: 'null' },
        ],
      }
    );
    expect(rows.map((r) => String(r.id))).toEqual(['1', '2']);
    expect(String(rows[0].val)).toContain('10:30:00');
    expect(rows[1].val).toBeNull();
  });
});

describe('compileTypeConvertSql — timezone auto-parse', () => {
  it('converts ISO 8601 timestamps with timezone offsets to TIMESTAMPTZ', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run('CREATE TABLE inp (id INTEGER, val VARCHAR, extra VARCHAR)');
    await connection.run(
      "INSERT INTO inp VALUES (1, '2024-03-15T10:00:00+08:00', 'x'), (2, '2024-03-15T02:00:00Z', 'x'), (3, '2024-12-25T23:59:59+14:00', 'x')"
    );
    await connection.run(
      compileTypeConvertSql('out', 'inp', ['id', 'val', 'extra'], {
        conversions: [{ column: 'val', type: 'datetime', onError: 'null' }],
      })
    );
    // Query UTC values via AT TIME ZONE to avoid session timezone dependency
    const result = await connection.runAndReadAll(
      "SELECT id, val::VARCHAR as val_str, val AT TIME ZONE 'UTC' as val_utc, typeof(val) as val_type FROM out ORDER BY id"
    );
    const rows = result.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows.map((r) => String(r.id))).toEqual(['1', '2', '3']);
    expect(String(rows[0].val_utc)).toContain('02:00:00');
    expect(String(rows[1].val_utc)).toContain('02:00:00');
    expect(String(rows[2].val_utc)).toContain('09:59:59');
    expect(String(rows[0].val_type)).toBe('TIMESTAMP WITH TIME ZONE');
  });
});

describe('compileTypeConvertSql — decimal scale', () => {
  it('converts to DECIMAL(18,0) rounding to integer', async () => {
    const rows = await execute(
      "(1, '12.34', 'x'), (2, '56.78', 'x'), (3, '9.99', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [{ column: 'val', type: 'decimal', scale: 0, onError: 'null' }],
      }
    );
    expect(rows.map((r) => Number(r.val))).toEqual([12, 57, 10]);
  });

  it('converts to DECIMAL(18,18) preserving many fractional digits', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run('CREATE TABLE inp (id INTEGER, val VARCHAR, extra VARCHAR)');
    await connection.run(
      "INSERT INTO inp VALUES (1, '0.141592653589793238', 'x'), (2, '0.718281828459045235', 'x')"
    );
    await connection.run(
      compileTypeConvertSql('out', 'inp', ['id', 'val', 'extra'], {
        conversions: [{ column: 'val', type: 'decimal', scale: 18, onError: 'null' }],
      })
    );
    const result = await connection.runAndReadAll(
      'SELECT id, val::VARCHAR as val_str, typeof(val) as val_type FROM out ORDER BY id'
    );
    const rows = result.getRowObjectsJson() as Record<string, unknown>[];
    expect(rows[0].val_str).toBe('.141592653589793238');
    expect(rows[1].val_str).toBe('.718281828459045235');
    expect(String(rows[0].val_type)).toBe('DECIMAL(18,18)');
  });
});

describe('compileTypeConvertSql — on_error behavior', () => {
  it('on_error keep returns the original value unchanged', async () => {
    const rows = await execute(
      "(1, '123', 'x'), (2, 'abc', 'x'), (3, '456', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [{ column: 'val', type: 'integer', onError: 'keep' }],
      }
    );
    expect(rows.map((r) => String(r.val))).toEqual(['123', 'abc', '456']);
  });

  it('on_error null sets failed rows to null', async () => {
    const rows = await execute(
      "(1, '123', 'x'), (2, 'abc', 'x'), (3, '456', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [{ column: 'val', type: 'integer', onError: 'null' }],
      }
    );
    expect(Number(rows[0].val)).toBe(123);
    expect(rows[1].val).toBeNull();
    expect(Number(rows[2].val)).toBe(456);
  });

  it('on_error fail throws on invalid conversion', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run('CREATE TABLE inp2 (id INTEGER, val VARCHAR, extra VARCHAR)');
    await connection.run("INSERT INTO inp2 VALUES (1, '123', 'x'), (2, 'abc', 'x')");
    await expect(
      connection.run(
        compileTypeConvertSql('out2', 'inp2', ['id', 'val', 'extra'], {
          conversions: [{ column: 'val', type: 'integer', onError: 'fail' }],
        })
      )
    ).rejects.toThrow();
  });
});

describe('compileTypeConvertSql — date/datetime cross-type with format', () => {
  it('skips conversion when source type = target type (date→date)', async () => {
    const rows = await execute(
      "(1, '2024-03-15', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [{ column: 'val', type: 'date', format: '%Y-%m-%d', onError: 'null' }],
      },
      { val: 'date' }
    );
    expect(String(rows[0].val)).toBe('2024-03-15');
  });

  it('truncates time when converting datetime→date', async () => {
    const rows = await execute(
      "(1, '2024-03-15 10:30:00', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [
          { column: 'val', type: 'date', format: '%Y-%m-%d %H:%M:%S', onError: 'null' },
        ],
      },
      { val: 'datetime' }
    );
    expect(String(rows[0].val)).toBe('2024-03-15');
  });

  it('promotes to timestamp when converting date→datetime', async () => {
    const rows = await execute(
      "(1, '2024-03-15', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [{ column: 'val', type: 'datetime', format: '%Y-%m-%d', onError: 'null' }],
      },
      { val: 'date' }
    );
    expect(String(rows[0].val)).toContain('00:00:00');
  });
});

describe('compileTypeConvertSql — basic type conversions', () => {
  it('converts text to integer', async () => {
    const rows = await execute("(1, '42', 'x'), (2, '-7', 'x')", ['id', 'val', 'extra'], {
      conversions: [{ column: 'val', type: 'integer', onError: 'null' }],
    });
    expect(Number(rows[0].val)).toBe(42);
    expect(Number(rows[1].val)).toBe(-7);
  });

  it('converts text to float', async () => {
    const rows = await execute("(1, '3.14', 'x'), (2, '-0.5', 'x')", ['id', 'val', 'extra'], {
      conversions: [{ column: 'val', type: 'float', onError: 'null' }],
    });
    expect(Number(rows[0].val)).toBeCloseTo(3.14);
    expect(Number(rows[1].val)).toBeCloseTo(-0.5);
  });

  it('converts text to boolean', async () => {
    const rows = await execute(
      "(1, 'true', 'x'), (2, 'false', 'x'), (3, '1', 'x'), (4, '0', 'x')",
      ['id', 'val', 'extra'],
      {
        conversions: [{ column: 'val', type: 'boolean', onError: 'null' }],
      }
    );
    expect(Boolean(rows[0].val)).toBe(true);
    expect(Boolean(rows[1].val)).toBe(false);
    expect(Boolean(rows[2].val)).toBe(true);
    expect(Boolean(rows[3].val)).toBe(false);
  });
});
