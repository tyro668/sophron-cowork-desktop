import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import {
  compileAsofJoinSql,
  compileJoinConditionList,
  compileJoinProjection,
} from '../../src/main/data/operators/join';
import { JoinConfigSchema, parseOperatorConfig } from '../../src/shared/operator-schemas';

async function executeAsofJoin(
  operator: '>=' | '<=',
  opts: { tolerance?: string; includeExact?: boolean } = {}
): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    await connection.run(
      "CREATE TABLE left_input AS SELECT TIMESTAMP '2026-01-01 10:00:00' AS event_time"
    );
    const rightRows = [
      "SELECT TIMESTAMP '2026-01-01 08:00:00' AS event_time, 'before' AS label",
      "SELECT TIMESTAMP '2026-01-01 12:00:00' AS event_time, 'after' AS label",
    ];
    if (opts.includeExact) {
      rightRows.push("SELECT TIMESTAMP '2026-01-01 10:00:00' AS event_time, 'exact' AS label");
    }
    await connection.run(`CREATE TABLE right_input AS ${rightRows.join(' UNION ALL ')}`);
    await connection.run(
      compileAsofJoinSql(
        'asof_output',
        'left_input',
        'right_input',
        ['event_time'],
        ['event_time', 'label'],
        parseOperatorConfig(JoinConfigSchema, {
          joinType: 'asof',
          asof: {
            leftTime: '[event_time]',
            rightTime: '[event_time]',
            operator,
            ...(opts.tolerance ? { tolerance: opts.tolerance } : {}),
          },
          keep: [
            { side: 'right', source: '[event_time]', alias: 'matched_time' },
            { side: 'right', source: '[label]', alias: 'label' },
          ],
        })
      )
    );
    const result = await connection.runAndReadAll('SELECT matched_time, label FROM asof_output');
    return result.getRowObjectsJson() as Record<string, unknown>[];
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

describe('compileJoinConditionList', () => {
  it('generates = condition by default', () => {
    const result = compileJoinConditionList([{ left: '[order_id]', operator: '=', right: '[id]' }]);
    expect(result).toBe('l."order_id" = r."id"');
  });

  it('generates < condition', () => {
    const result = compileJoinConditionList([
      { left: '[price]', operator: '<', right: '[max_price]' },
    ]);
    expect(result).toBe('l."price" < r."max_price"');
  });

  it('generates <= condition', () => {
    const result = compileJoinConditionList([
      { left: '[date]', operator: '<=', right: '[end_date]' },
    ]);
    expect(result).toBe('l."date" <= r."end_date"');
  });

  it('generates > condition', () => {
    const result = compileJoinConditionList([
      { left: '[score]', operator: '>', right: '[threshold]' },
    ]);
    expect(result).toBe('l."score" > r."threshold"');
  });

  it('generates >= condition', () => {
    const result = compileJoinConditionList([
      { left: '[qty]', operator: '>=', right: '[min_qty]' },
    ]);
    expect(result).toBe('l."qty" >= r."min_qty"');
  });

  it('combines multiple conditions with AND', () => {
    const result = compileJoinConditionList([
      { left: '[customer_id]', operator: '=', right: '[id]' },
      { left: '[date]', operator: '>=', right: '[start_date]' },
    ]);
    expect(result).toBe('l."customer_id" = r."id" AND l."date" >= r."start_date"');
  });

  it('returns empty string for empty conditions', () => {
    expect(compileJoinConditionList([])).toBe('');
  });

  it('throws for conditions with an empty side instead of emitting broken SQL', () => {
    expect(() =>
      compileJoinConditionList([
        { left: '[order_id]', operator: '=', right: '' },
        { left: '', operator: '=', right: '[id]' },
        { left: '   ', operator: '=', right: '[id]' },
      ])
    ).toThrow('Non-cross join requires at least one valid condition');
    expect(() =>
      compileJoinConditionList([
        { left: '[order_id]', operator: '=', right: '[id]' },
        { left: '[date]', operator: '=', right: '' },
      ])
    ).toThrow('Non-cross join requires at least one valid condition');
  });

  it('throws for conditions whose field reference resolves to an empty name', () => {
    expect(() =>
      compileJoinConditionList([{ left: '[order_id]', operator: '=', right: '[``]' }])
    ).toThrow('Non-cross join requires at least one valid condition');
    expect(() =>
      compileJoinConditionList([{ left: '[``]', operator: '=', right: '[id]' }])
    ).toThrow('Non-cross join requires at least one valid condition');
  });

  it('rejects unsupported operators before SQL compilation', () => {
    expect(() =>
      compileJoinConditionList([
        { left: '[order_id]', operator: '= r.id OR true --', right: '[id]' },
      ])
    ).toThrow('Unsupported join condition operator');
  });
});

describe('compileAsofJoinSql', () => {
  it('matches the latest earlier row for a backward join', async () => {
    await expect(executeAsofJoin('>=')).resolves.toEqual([
      { matched_time: '2026-01-01 08:00:00', label: 'before' },
    ]);
  });

  it('matches the earliest later row for a forward join', async () => {
    await expect(executeAsofJoin('<=')).resolves.toEqual([
      { matched_time: '2026-01-01 12:00:00', label: 'after' },
    ]);
  });

  it('matches only the exact-time row for a backward join with zero tolerance', async () => {
    await expect(executeAsofJoin('>=', { tolerance: '0s', includeExact: true })).resolves.toEqual([
      { matched_time: '2026-01-01 10:00:00', label: 'exact' },
    ]);
  });

  it('matches only the exact-time row for a forward join with zero tolerance', async () => {
    await expect(executeAsofJoin('<=', { tolerance: '0s', includeExact: true })).resolves.toEqual([
      { matched_time: '2026-01-01 10:00:00', label: 'exact' },
    ]);
  });

  it('matches only the exact-time row for a nearest join with zero tolerance', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      await connection.run(
        "CREATE TABLE left_input AS SELECT TIMESTAMP '2026-01-01 10:00:00' AS event_time"
      );
      await connection.run(`
        CREATE TABLE right_input AS
        SELECT TIMESTAMP '2026-01-01 08:00:00' AS event_time, 'before' AS label
        UNION ALL
        SELECT TIMESTAMP '2026-01-01 12:00:00' AS event_time, 'after' AS label
        UNION ALL
        SELECT TIMESTAMP '2026-01-01 10:00:00' AS event_time, 'exact' AS label
      `);
      await connection.run(
        compileAsofJoinSql(
          'asof_output',
          'left_input',
          'right_input',
          ['event_time'],
          ['event_time', 'label'],
          parseOperatorConfig(JoinConfigSchema, {
            joinType: 'asof',
            asof: {
              leftTime: '[event_time]',
              rightTime: '[event_time]',
              operator: 'nearest',
              tolerance: '0s',
            },
            keep: [
              { side: 'right', source: '[event_time]', alias: 'matched_time' },
              { side: 'right', source: '[label]', alias: 'label' },
            ],
          })
        )
      );
      const result = await connection.runAndReadAll('SELECT matched_time, label FROM asof_output');
      expect(result.getRowObjectsJson()).toEqual([
        { matched_time: '2026-01-01 10:00:00', label: 'exact' },
      ]);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  it('rejects an ASOF by condition with an empty side at config parse time', () => {
    expect(() =>
      parseOperatorConfig(JoinConfigSchema, {
        joinType: 'asof',
        asof: {
          leftTime: '[event_time]',
          rightTime: '[event_time]',
          operator: '>=',
          by: [{ left: '[device_id]', operator: '=', right: '' }],
        },
      })
    ).toThrow();
    expect(() =>
      parseOperatorConfig(JoinConfigSchema, {
        joinType: 'asof',
        asof: {
          leftTime: '[event_time]',
          rightTime: '[event_time]',
          operator: '>=',
          by: [{ left: '', operator: '=', right: '[device_id]' }],
        },
      })
    ).toThrow();
  });

  it('throws when an ASOF by condition resolves to an empty field name', () => {
    const config = parseOperatorConfig(JoinConfigSchema, {
      joinType: 'asof',
      asof: {
        leftTime: '[event_time]',
        rightTime: '[event_time]',
        operator: '>=',
        by: [{ left: '[device_id]', operator: '=', right: '[``]' }],
      },
    });
    expect(() =>
      compileAsofJoinSql('out', 'l', 'r', ['event_time'], ['event_time'], config)
    ).toThrow('ASOF by condition requires both left and right fields');
  });

  it('allows an empty ASOF by array', () => {
    const sql = compileAsofJoinSql(
      'out',
      'l',
      'r',
      ['event_time'],
      ['event_time'],
      parseOperatorConfig(JoinConfigSchema, {
        joinType: 'asof',
        asof: {
          leftTime: '[event_time]',
          rightTime: '[event_time]',
          operator: '>=',
          by: [],
        },
      })
    );
    expect(sql).toContain('LEFT JOIN LATERAL');
  });
});

describe('compileJoinProjection — output name uniqueness', () => {
  it('projects all columns with suffix only on conflicting names', () => {
    const sql = compileJoinProjection([], ['id', 'name'], ['id', 'region'], {
      strategy: 'suffix',
      leftSuffix: '_left',
      rightSuffix: '_right',
    });
    expect(sql).toBe('l."id" AS "id_left", l."name", r."id" AS "id_right", r."region"');
  });

  it('throws when suffix collides with an existing left column', () => {
    expect(() =>
      compileJoinProjection([], ['id', 'id_left'], ['id'], {
        strategy: 'suffix',
        leftSuffix: '_left',
        rightSuffix: '_right',
      })
    ).toThrow(/conflicts with/);
  });

  it('throws when right prefix collides with an existing left column', () => {
    expect(() =>
      compileJoinProjection([], ['id', 'right_id'], ['id'], {
        strategy: 'right_prefix',
        rightPrefix: 'right_',
      })
    ).toThrow(/conflicts with/);
  });

  it('falls back to the right_ prefix when rightPrefix is empty', () => {
    const sql = compileJoinProjection([], ['id', 'name'], ['id', 'region'], {
      strategy: 'right_prefix',
      rightPrefix: '',
    });
    expect(sql).toBe('l."id", l."name", r."id" AS "right_id", r."region"');
  });

  it('throws when two custom aliases produce the same output name', () => {
    expect(() =>
      compileJoinProjection(
        [
          { side: 'left', source: '[amount]', alias: 'value' },
          { side: 'right', source: '[price]', alias: 'value' },
        ],
        ['amount'],
        ['price'],
        {}
      )
    ).toThrow(/conflicts with/);
  });

  it('treats names differing only in case as conflicting', () => {
    expect(() =>
      compileJoinProjection(
        [
          { side: 'left', source: '[Amount]', alias: 'value' },
          { side: 'right', source: '[price]', alias: 'Value' },
        ],
        ['Amount'],
        ['price'],
        {}
      )
    ).toThrow(/conflicts with/);
  });

  it('projects wildcard columns with conflict resolution', () => {
    const sql = compileJoinProjection(
      [
        { side: 'left', wildcard: true },
        { side: 'right', wildcard: true },
      ],
      ['id'],
      ['id', 'region'],
      { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' }
    );
    expect(sql).toBe('l."id" AS "id_left", r."id" AS "id_right", r."region"');
  });

  it('respects explicit alias overrides without conflict', () => {
    const sql = compileJoinProjection(
      [{ side: 'right', source: '[price]', alias: 'final_price' }],
      ['id'],
      ['price'],
      { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' }
    );
    expect(sql).toBe('r."price" AS "final_price"');
  });

  it('resolves qualified keep sources to the correct side', () => {
    const sql = compileJoinProjection(
      [
        { source: '[L1].[Order_ID]' },
        { source: '[L1].[Date]' },
        { source: '[R1].[Order_ID]' },
        { source: '[R1].[CNT]' },
        { source: '[R1].[Date]' },
      ],
      ['Order_ID', 'Date'],
      ['Order_ID', 'Date', 'CNT'],
      { strategy: 'suffix', leftSuffix: '_l', rightSuffix: '_r' },
      'R1'
    );
    expect(sql).toBe(
      'l."Order_ID" AS "Order_ID_l", l."Date" AS "Date_l", r."Order_ID" AS "Order_ID_r", r."CNT", r."Date" AS "Date_r"'
    );
  });

  it('resolves a keep source to the right side when the alias differs only in case', () => {
    const sql = compileJoinProjection(
      [{ source: '[Customers].[name]', alias: 'customer_name' }],
      ['id'],
      ['name'],
      { strategy: 'suffix', leftSuffix: '_left', rightSuffix: '_right' },
      'customers'
    );
    expect(sql).toBe('r."name" AS "customer_name"');
  });

  it('throws on duplicate output names from conflicting qualified keep sources', () => {
    expect(() =>
      compileJoinProjection(
        [{ source: '[L1].[Order_ID]' }, { source: '[R1].[Order_ID]' }],
        ['Order_ID', 'id_left'],
        ['Order_ID'],
        { strategy: 'suffix', leftSuffix: '_l', rightSuffix: '_l' },
        'R1'
      )
    ).toThrow(/conflicts with/);
  });
});
