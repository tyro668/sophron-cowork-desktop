import { describe, expect, it } from 'vitest';
import {
  compilePrepWorkflowToFlow,
  exportPrepOperatorDsl,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
} from '../../src/shared/prep-dsl';
import type { PrepOperatorType } from '../../src/shared/prep-dsl';

function errorsOf(
  diagnostics: Array<{ severity: 'error' | 'warning'; message: string; code?: string }>
) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
}

const currentOperatorCases: Array<{
  name: string;
  type: PrepOperatorType;
  dsl: string;
  expectedConfig?: Record<string, unknown>;
}> = [
  {
    name: 'input source',
    type: 'input_source',
    dsl: 'input source dataset "orders_input" as orders',
    expectedConfig: { source: 'dataset', datasetId: 'orders_input', alias: 'orders' },
  },
  {
    name: 'select fields',
    type: 'field_select',
    dsl: 'select [order_id], [region], [revenue]',
    expectedConfig: { mode: 'include', columns: ['order_id', 'region', 'revenue'] },
  },
  {
    name: 'drop fields',
    type: 'field_select',
    dsl: 'drop [debug_flag], [internal_note]',
    expectedConfig: { mode: 'exclude', columns: ['debug_flag', 'internal_note'] },
  },
  {
    name: 'rename fields',
    type: 'field_mapping',
    dsl: 'map [dt] to [order_date], [rev] to [revenue]',
    expectedConfig: {
      mappings: [
        { source: 'dt', target: 'order_date' },
        { source: 'rev', target: 'revenue' },
      ],
    },
  },
  {
    name: 'filter rows',
    type: 'filter',
    dsl: 'filter [status] in ("PAID", "SHIPPED") and [revenue] > 0',
    expectedConfig: { condition: '[status] in ("PAID", "SHIPPED") and [revenue] > 0' },
  },
  {
    name: 'deduplicate rows',
    type: 'deduplicate',
    dsl: 'deduplicate by [order_id] keep last order by [updated_at] desc',
    expectedConfig: { strategy: 'by_columns', columns: ['order_id'], keep: 'last' },
  },
  {
    name: 'deduplicate fields containing clause keywords',
    type: 'deduplicate',
    dsl: 'deduplicate by [`order by`], [`keep status`] keep last order by [`by score`] desc',
    expectedConfig: {
      strategy: 'by_columns',
      columns: ['order by', 'keep status'],
      keep: 'last',
      orderBy: [{ field: 'by score', direction: 'desc' }],
    },
  },
  {
    name: 'drop empty rows',
    type: 'missing_value',
    dsl: 'missing value row drop when all_null',
    expectedConfig: { strategy: 'drop_empty_rows', condition: 'all_null' },
  },
  {
    name: 'nullify and fill missing values',
    type: 'missing_value',
    dsl: 'missing value [region] nullify values ("", "N/A"), [score] fill median',
    expectedConfig: { strategy: 'by_column' },
  },
  {
    name: 'convert types',
    type: 'type_convert',
    dsl: 'cast [order_date] as date format "%Y-%m-%d" on_error null, [revenue] as float on_error fail',
    expectedConfig: {
      conversions: [
        { column: 'order_date', type: 'date', format: '%Y-%m-%d', onError: 'null' },
        { column: 'revenue', type: 'float', onError: 'fail' },
      ],
    },
  },
  {
    name: 'sort rows',
    type: 'sort',
    dsl: 'sort by [order_date] desc nulls last, [order_id] asc',
  },
  {
    name: 'limit sorted rows with a clause keyword in the field name',
    type: 'limit',
    dsl: 'top 10 by [`with ties score`] desc with ties',
    expectedConfig: {
      mode: 'fixed',
      limit: 10,
      unit: 'rows',
      orderBy: [{ field: 'with ties score', direction: 'desc' }],
      ties: true,
    },
  },
  {
    name: 'aggregate metrics',
    type: 'aggregate',
    dsl: 'aggregate by [region] metrics sum([revenue]) as [total_revenue], count(*) as [row_count]',
    expectedConfig: { groupBy: ['region'] },
  },
  {
    name: 'aggregate with date granularity',
    type: 'aggregate',
    dsl: 'aggregate by year([Date]) metrics sum([Price]) as [total]',
    expectedConfig: { groupBy: ['Date'], dateGranularity: { Date: 'year' } },
  },
  {
    name: 'aggregate with mixed granularity and bare fields',
    type: 'aggregate',
    dsl: 'aggregate by year([Date]), [UUID] metrics sum([Price]) as [`合价`]',
    expectedConfig: {
      groupBy: ['Date', 'UUID'],
      dateGranularity: { Date: 'year' },
    },
  },
  {
    name: 'aggregate with granularity field first',
    type: 'aggregate',
    dsl: 'aggregate by month([Date]), [region] metrics count(*) as [n]',
    expectedConfig: {
      groupBy: ['Date', 'region'],
      dateGranularity: { Date: 'month' },
    },
  },
  {
    name: 'aggregate metric with single-quoted string containing paren',
    type: 'aggregate',
    dsl: "aggregate all metrics string_agg([name], ')') as [names], count(*) as [rows]",
    expectedConfig: {
      metrics: [
        { function: 'string_agg', expression: "[name], ')'", alias: 'names' },
        { function: 'count', expression: '*', alias: 'rows' },
      ],
    },
  },
  {
    name: 'aggregate metric with SQL escaped single quote',
    type: 'aggregate',
    dsl: "aggregate all metrics concat([name], 'it''s') as [names]",
    expectedConfig: {
      metrics: [{ function: 'concat', expression: "[name], 'it''s'", alias: 'names' }],
    },
  },
  {
    name: 'aggregate with multiple metrics using backslash-escaped single quote',
    type: 'aggregate',
    dsl: "aggregate all metrics string_agg([name], 'it\\'s') as [names], count(*) as [rows]",
    expectedConfig: {
      metrics: [
        { function: 'string_agg', expression: "[name], 'it\\'s'", alias: 'names' },
        { function: 'count', expression: '*', alias: 'rows' },
      ],
    },
  },
  {
    name: 'aggregate by field with a hash in its name',
    type: 'aggregate',
    dsl: 'aggregate by [`商品#编号`] metrics sum([amount]) as [total]',
    expectedConfig: {
      groupBy: ['商品#编号'],
      metrics: [{ function: 'sum', expression: '[amount]', alias: 'total' }],
    },
  },
  {
    name: 'pivot metric with single-quoted string containing comma',
    type: 'pivot',
    dsl: "pivot on [region] using string_agg([name], ', ') as [names], count(*) as [n]",
    expectedConfig: {
      on: [{ field: 'region', values: [] }],
      using: [
        { function: 'string_agg', expression: "[name], ', '", alias: 'names' },
        { function: 'count', expression: '*', alias: 'n' },
      ],
    },
  },
  {
    name: 'pivot with multiple metrics using backslash-escaped single quote',
    type: 'pivot',
    dsl: "pivot on [region] using string_agg([name], 'it\\'s') as [names], count(*) as [n]",
    expectedConfig: {
      on: [{ field: 'region', values: [] }],
      using: [
        { function: 'string_agg', expression: "[name], 'it\\'s'", alias: 'names' },
        { function: 'count', expression: '*', alias: 'n' },
      ],
    },
  },
  {
    name: 'derive scalar field',
    type: 'calculate_field',
    dsl: 'derive [margin] = [profit] / nullif([revenue], 0)',
    expectedConfig: {
      calculations: [{ field: 'margin', expression: '[profit] / nullif([revenue], 0)' }],
    },
  },
  {
    name: 'derive window field',
    type: 'calculate_field',
    dsl: 'derive [rn] = row_number() over(partition by [region] order by [revenue] desc)',
    expectedConfig: {
      calculations: [
        {
          field: 'rn',
          expression: 'row_number() over(partition by [region] order by [revenue] desc)',
        },
      ],
    },
  },
  {
    name: 'left join',
    type: 'join',
    dsl: 'join left customers on [orders].[customer_id] = [customers].[customer_id] keep left *, [customers].[name] as [customer_name]',
    expectedConfig: { joinType: 'left', rightInput: 'customers' },
  },
  {
    name: 'asof join',
    type: 'join',
    dsl: 'join asof rates on [orders].[order_time] >= [rates].[rate_time] by [orders].[currency] = [rates].[currency] tolerance 1d keep left *, [rates].[rate] as [fx_rate]',
    expectedConfig: { joinType: 'asof', rightInput: 'rates' },
  },
  {
    name: 'limit rows',
    type: 'limit',
    dsl: 'limit 100',
    expectedConfig: { mode: 'fixed', limit: 100, unit: 'rows' },
  },
  {
    name: 'top rows',
    type: 'limit',
    dsl: 'top 10 by [revenue] desc',
    expectedConfig: { mode: 'fixed', limit: 10, unit: 'rows' },
  },
  {
    name: 'pivot rows',
    type: 'pivot',
    dsl: 'pivot on [month] in ("Jan", "Feb") using sum([revenue]) as [revenue_sum] group by [region]',
    expectedConfig: {
      on: [{ field: 'month', values: ['Jan', 'Feb'] }],
      groupBy: ['region'],
    },
  },
  {
    name: 'unpivot rows',
    type: 'unpivot',
    dsl: 'unpivot [jan], [feb], [mar] into name [month] value [sales]',
    expectedConfig: {
      mode: 'include',
      columns: ['jan', 'feb', 'mar'],
      nameColumn: 'month',
      valueColumn: 'sales',
    },
  },
  {
    name: 'union rows',
    type: 'set_op',
    dsl: 'union returns mode all by name',
    expectedConfig: { operation: 'union', rightInput: 'returns', mode: 'all', match: 'by_name' },
  },
  {
    name: 'unnest list',
    type: 'unnest',
    dsl: 'unnest [items] as [item]',
    expectedConfig: { sourceKind: 'list', column: 'items', alias: 'item' },
  },
  {
    name: 'output table',
    type: 'output',
    dsl: 'output table "clean_orders" mode replace',
    expectedConfig: { destination: 'duckdb_table', table: 'clean_orders', mode: 'replace' },
  },
];

describe('operator DSL executable cases', () => {
  it('rejects sort DSL without a valid field', () => {
    const parsed = parsePrepOperatorDsl('sort by []', 'sort');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'sortMissingField' })])
    );
  });

  it.each([
    'sort by [order_date] desc garbage',
    'sort by [order_date] asc desc',
    'sort by [order_date] nulls middle',
    'sort by [order_date] nulls last asc',
    'sort by [order_date],',
  ])('rejects partially parsed sort DSL: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'sort');

    expect(errorsOf(parsed.diagnostics), dsl).not.toHaveLength(0);
  });

  it.each([
    ['field_select', 'select [order_id] garbage'],
    ['field_mapping', 'map [order_id] to [id] garbage'],
    ['limit', 'limit 10 garbage'],
    ['limit', 'sample 10 rows system repeatable 1 garbage'],
    ['limit', 'top 10 by [amount] desc with ties garbage'],
    ['type_convert', 'cast [amount] as float garbage'],
    ['set_op', 'union returns mode all by name garbage'],
    ['output', 'output table "result" mode replace garbage'],
    ['deduplicate', 'deduplicate by [id] keep first garbage'],
    ['missing_value', 'missing value [amount] garbage'],
    ['unnest', 'unnest [items] as [item] garbage'],
    ['unpivot', 'unpivot [q1] into name [quarter] value [amount] garbage'],
    ['pivot', 'pivot on [region] garbage using count(*)'],
    ['aggregate', 'aggregate by [region] garbage metrics sum([amount]) as [total_amount]'],
    ['aggregate', 'aggregate by monthly([Date]) metrics sum([amount]) as [total_amount]'],
    ['aggregate', 'aggregate by year([Date]) extra metrics sum([amount]) as [total_amount]'],
    ['aggregate', 'aggregate by year([Date]), month([Date]) metrics count(*) as [rows]'],
    ['aggregate', 'aggregate by year([Date]), [Date] metrics count(*) as [rows]'],
    ['calculate_field', 'derive [result] garbage = [amount]'],
    ['join', 'join left returns garbage'],
    ['join', 'join left returns on [orders].[id] = [returns].[id] garbage'],
    ['join', 'join left returns on [orders].[id] = [returns].[id] suffix _l _r garbage'],
    ['join', 'join left returns on [l.id] != [r.id] garbage'],
    ['output', 'output table "result" mode replace mode append'],
    ['type_convert', 'cast [amount] as float on_error null on_error keep'],
    ['calculate_field', 'derive [result] = period_compare(yoy_diff, [amount] garbage, [date])'],
  ] as const)('rejects trailing DSL for %s: %s', (type, dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, type);

    expect(errorsOf(parsed.diagnostics), dsl).not.toHaveLength(0);
  });

  it.each([
    'aggregate by year([Date]), month([Date]) metrics count(*) as [rows]',
    'aggregate by year([Date]), [Date] metrics count(*) as [rows]',
  ])('rejects duplicate aggregate group fields: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'aggregate');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'duplicateAggregateGroupField' })])
    );
  });

  it.each(['pivot on [Item] in using count(*)', 'pivot on [Item] in () using count(*)'])(
    'rejects pivot on field with an empty value list: %s',
    (dsl) => {
      const parsed = parsePrepOperatorDsl(dsl, 'pivot');

      expect(errorsOf(parsed.diagnostics)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotValueList' })])
      );
    }
  );

  it('accepts pivot on field without values as dynamic all values', () => {
    const parsed = parsePrepOperatorDsl('pivot on [Item] using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([{ field: 'Item', values: [] }]);
  });

  it('rejects duplicate pivot on fields', () => {
    const parsed = parsePrepOperatorDsl('pivot on [Item], [item] using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotField' })])
    );
  });

  it.each([
    'pivot on [year] in 2024 using count(*)',
    'pivot on [year] in () using count(*)',
    'pivot on [year] in (2024) garbage using count(*)',
  ])('rejects malformed pivot in list: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotValueList' })])
    );
  });

  it('rejects a pivot value list with an unterminated parenthesis as a structural error', () => {
    const parsed = parsePrepOperatorDsl('pivot on [year] in (2024 using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivot' })])
    );
    expect(errorsOf(parsed.diagnostics)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotValueList' })])
    );
  });

  it('rejects a pivot in list with an unterminated string', () => {
    const parsed = parsePrepOperatorDsl('pivot on [year] in ("abc) using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).not.toHaveLength(0);
  });

  it.each([
    'pivot on [sfc] in ("null",) using count(*)',
    'pivot on [sfc] in ("a", "b",) using count(*)',
    'pivot on [sfc] in (, "a") using count(*)',
    'pivot on [sfc] in ("a", 2024,) using count(*)',
  ])('rejects a pivot value list with a stray comma: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotValueList' })])
    );
  });

  it.each([
    'pivot on [sfc], [category] in ("食品", "电子产品"), using count(*)',
    'pivot on [category] in ("食品"), using count(*)',
    'pivot on [category] in ("食品"), group by [region]',
    'pivot on [category] in ("食品"),',
  ])('rejects a trailing comma after the pivot axis list: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotValueList' })])
    );
  });

  it('rejects a pivot value list with values missing a separating comma', () => {
    const parsed = parsePrepOperatorDsl('pivot on [sfc] in ("a" "b") using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotValueList' })])
    );
  });

  it('rejects a pivot with no on fields', () => {
    const parsed = parsePrepOperatorDsl('pivot on using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivot' })])
    );
    expect(parsed.operator).toBeNull();
  });

  it('rejects a pivot group by with no fields', () => {
    const parsed = parsePrepOperatorDsl('pivot on [category] using count(*) group by', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidPivotGroupField' })])
    );
    expect(parsed.operator).toBeNull();
  });

  it.each(['pivot on [a] using', 'pivot on [a] using '])(
    'rejects a pivot with no using metrics: %s',
    (dsl) => {
      const parsed = parsePrepOperatorDsl(dsl, 'pivot');

      expect(errorsOf(parsed.diagnostics)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'invalidPivot' })])
      );
      expect(parsed.operator).toBeNull();
    }
  );

  it('treats a bracketed pivot value as a literal string', () => {
    const parsed = parsePrepOperatorDsl('pivot on [sfc] in ([amount]) using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([{ field: 'sfc', values: ['amount'] }]);
  });

  it('parses multiple pivot axes with per-field value lists', () => {
    const parsed = parsePrepOperatorDsl(
      'pivot on [year] in (2024), [quarter] in ("Q1") using count(*)',
      'pivot'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([
      { field: 'year', values: [2024] },
      { field: 'quarter', values: ['Q1'] },
    ]);
  });

  it('parses a dynamic axis (no values) followed by a fixed axis', () => {
    const parsed = parsePrepOperatorDsl(
      'pivot on [a] in ("x"), [b] using count(*) group by [region]',
      'pivot'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([
      { field: 'a', values: ['x'] },
      { field: 'b', values: [] },
    ]);
    expect(parsed.operator?.config.groupBy).toEqual(['region']);
  });

  it('parses a dynamic axis first followed by a fixed axis', () => {
    const parsed = parsePrepOperatorDsl(
      'pivot on [sfc], [category] in ("食品", "电子产品") using count(*)',
      'pivot'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([
      { field: 'sfc', values: [] },
      { field: 'category', values: ['食品', '电子产品'] },
    ]);
  });

  it('parses group by fields named group and by without clashing with the clause', () => {
    const parsed = parsePrepOperatorDsl(
      'pivot on [a] using count(*) group by [group], [by]',
      'pivot'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.groupBy).toEqual(['group', 'by']);
  });

  it('preserves number, boolean and null literal types through pivot round-trip', () => {
    const config = {
      on: [{ field: 'year', values: [2024, true, null] }],
      using: [{ function: 'count', expression: '*' }],
    };
    const dsl = exportPrepOperatorDsl({ id: 'pivot-lit', type: 'pivot', config });
    const parsed = parsePrepOperatorDsl(dsl, 'pivot');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([{ field: 'year', values: [2024, true, null] }]);
  });

  it('preserves a comma inside a quoted pivot value through round-trip', () => {
    const config = {
      on: [{ field: 'city', values: ['New York, NY', 'Paris'] }],
      using: [{ function: 'count', expression: '*' }],
    };
    const dsl = exportPrepOperatorDsl({ id: 'pivot-comma', type: 'pivot', config });
    const parsed = parsePrepOperatorDsl(dsl, 'pivot');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([
      { field: 'city', values: ['New York, NY', 'Paris'] },
    ]);
  });

  it('does not export a pivot with an incomplete axis', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'pivot-partial',
        type: 'pivot',
        config: {
          on: [
            { field: 'year', values: [] },
            { field: '', values: [] },
          ],
          using: [{ function: 'count', expression: '*' }],
        },
      })
    ).toBe('');
  });

  it('does not export a pivot with an axis whose values are not an array', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'pivot-bad-values',
        type: 'pivot',
        config: {
          on: [{ field: 'year', values: 'not-an-array' }],
          using: [{ function: 'count', expression: '*' }],
        },
      })
    ).toBe('');
  });

  it('parses negative, decimal and scientific-notation pivot values', () => {
    const parsed = parsePrepOperatorDsl(
      'pivot on [y] in (-2024, 3.14, 1e3) using count(*)',
      'pivot'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([{ field: 'y', values: [-2024, 3.14, 1000] }]);
  });

  it('parses plus/minus prefixed pivot values', () => {
    const parsed = parsePrepOperatorDsl('pivot on [y] in (+5, -2) using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([{ field: 'y', values: [5, -2] }]);
  });

  it('parses a single scientific-notation pivot value', () => {
    const parsed = parsePrepOperatorDsl('pivot on [y] in (1e3) using count(*)', 'pivot');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([{ field: 'y', values: [1000] }]);
  });

  it('parses single-quoted pivot string values', () => {
    const parsed = parsePrepOperatorDsl("pivot on [y] in ('a', 'b') using count(*)", 'pivot');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([{ field: 'y', values: ['a', 'b'] }]);
  });

  it('formats pivot string values with double quotes and round-trips through parse', () => {
    // Build the config without the parse-time `dsl` field so the formatter cannot
    // short-circuit and return the original text; the real format logic runs here.
    const dsl = exportPrepOperatorDsl({
      id: 'pivot-single-quote',
      type: 'pivot',
      config: {
        on: [{ field: 'y', values: ['a', 'b'] }],
        using: [{ function: 'count', expression: '*' }],
      },
    });
    expect(dsl).toBe('pivot on [y] in ("a", "b") using count(*)');

    const reparsed = parsePrepOperatorDsl(dsl, 'pivot');
    expect(errorsOf(reparsed.diagnostics)).toHaveLength(0);
    expect(reparsed.operator?.config.on).toEqual([{ field: 'y', values: ['a', 'b'] }]);
  });

  it('parses multiple all-dynamic axes with a multi-field group by', () => {
    const parsed = parsePrepOperatorDsl(
      'pivot on [a], [b] using count(*) group by [x], [y]',
      'pivot'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.on).toEqual([
      { field: 'a', values: [] },
      { field: 'b', values: [] },
    ]);
    expect(parsed.operator?.config.groupBy).toEqual(['x', 'y']);
  });

  it.each([
    'join semi customers on [orders].[customer_id] = [customers].[id] keep [orders].[order_id]',
    'join anti blacklist on [orders].[customer_id] = [blacklist].[customer_id] suffix _left _right',
    'join semi customers on [orders].[customer_id] = [customers].[id] right_prefix r_',
  ])('rejects semi/anti join with keep/suffix/right_prefix: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'join');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidSemiAntiClause' })])
    );
  });

  it('accepts semi join without keep/conflict', () => {
    const parsed = parsePrepOperatorDsl(
      'join semi customers on [orders].[customer_id] = [customers].[id]',
      'join'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.joinType).toBe('semi');
    expect(parsed.operator?.config.keep).toBeUndefined();
    expect(parsed.operator?.config.conflict).toBeUndefined();
  });

  it.each(['semi', 'anti'])(
    '%s join round-trips without injecting a default conflict or keep config',
    (joinType) => {
      const dsl = `join ${joinType} customers on [orders].[customer_id] = [customers].[id]`;
      const parsed = parsePrepOperatorDsl(dsl, 'join');

      expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
      expect(parsed.operator?.config.keep).toBeUndefined();
      expect(parsed.operator?.config.conflict).toBeUndefined();

      const exported = exportPrepOperatorDsl({
        id: `${joinType}_join`,
        type: 'join',
        config: parsed.operator!.config,
      });
      expect(exported).toBe(dsl);
    }
  );

  it.each([
    'join inner customers on [`L1.Order_ID`] = [`R1.Order_ID`] keep [`L1.Order_ID`]',
    'join left products on [orders.brand and model] = [products.brand and model]',
  ])('rejects single-bracket dotted field refs in join DSL: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'join');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidJoinFieldRef' })])
    );
  });

  it.each([
    'join left customers on [customers].[amount] > [orders].[amount]',
    'join left products on [orders].[id] = [customers].[id]',
    'join semi customers on [customers].[id] = [orders].[id]',
    'join asof status on [status].[event_time] >= [events].[snapshot_time]',
    'join asof status on [events].[event_time] >= [status].[snapshot_time] by [status].[device_id] = [events].[device_id]',
  ])('rejects join conditions where sides reference the wrong table: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'join');

    expect(errorsOf(parsed.diagnostics), dsl).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'joinConditionSideMismatch' })])
    );
  });

  it('rejects a condition where both sides reference the right input', () => {
    const parsed = parsePrepOperatorDsl(
      'join left customers on [customers].[a] = [customers].[b]',
      'join'
    );

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'joinConditionSideMismatch' })])
    );
  });

  it('accepts a right-side reference that differs only in case', () => {
    const parsed = parsePrepOperatorDsl(
      'join left customers on [orders].[id] = [Customers].[id]',
      'join'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
  });

  it('accepts ASOF on and by referencing the right input', () => {
    const parsed = parsePrepOperatorDsl(
      'join asof status on [events].[event_time] >= [status].[snapshot_time] by [events].[device_id] = [status].[device_id]',
      'join'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
  });

  it.each([
    'join asof status on [events].[event_time] >= [status].[snapshot_time] by [events].[device_id] = [``]',
    'join asof status on [events].[event_time] >= [status].[snapshot_time] by [``] = [status].[device_id]',
    'join left customers on [customers].[id] = [``]',
  ])('rejects join conditions with an empty field reference: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'join');

    expect(errorsOf(parsed.diagnostics), dsl).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidJoinFieldRef' })])
    );
  });

  it('rejects a half-filled ASOF by condition after DSL export and reparse', () => {
    const { parsed } = (() => {
      const config = {
        joinType: 'asof',
        asof: {
          leftTime: '[Date]',
          rightTime: '[Date]',
          operator: '>=',
          by: [{ left: '[Order_ID]', operator: '=', right: '' }],
        },
        rightInput: 'R',
      };
      const dsl = exportPrepOperatorDsl({ id: 'asof-half-by', type: 'join', config });
      const result: { parsed: ReturnType<typeof parsePrepOperatorDsl>; dsl: string } = {
        parsed: parsePrepOperatorDsl(dsl, 'join'),
        dsl,
      };
      return result;
    })();

    expect(errorsOf(parsed.diagnostics)).toHaveLength(1);
  });

  it('round-trips a join whose right input is renamed with an as clause', () => {
    const dsl =
      'join left customers as c on [orders].[customer_id] = [c].[id] keep [c].[name] as [customer_name]';
    const parsed = parsePrepOperatorDsl(dsl, 'join');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.rightAlias).toBe('c');

    const exported = exportPrepOperatorDsl({
      id: 'join-rename',
      type: 'join',
      config: parsed.operator!.config,
    });
    expect(exported).toBe(dsl);

    const reparsed = parsePrepOperatorDsl(exported, 'join');
    expect(errorsOf(reparsed.diagnostics)).toHaveLength(0);
    expect(reparsed.operator?.config.rightAlias).toBe('c');
  });

  it('round-trips an asof join whose right input is renamed with an as clause', () => {
    const dsl =
      'join asof status as st on [events].[event_time] >= [st].[snapshot_time] by [events].[device_id] = [st].[device_id]';
    const parsed = parsePrepOperatorDsl(dsl, 'join');

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.rightAlias).toBe('st');

    const exported = exportPrepOperatorDsl({
      id: 'asof-rename',
      type: 'join',
      config: parsed.operator!.config,
    });
    expect(exported).toBe(dsl);

    const reparsed = parsePrepOperatorDsl(exported, 'join');
    expect(errorsOf(reparsed.diagnostics)).toHaveLength(0);
    expect(reparsed.operator?.config.rightAlias).toBe('st');
  });

  it('does not export a placeholder field for an empty sort config', () => {
    expect(exportPrepOperatorDsl({ id: 'sort-empty', type: 'sort', config: { keys: [] } })).toBe(
      ''
    );
  });

  it('rejects incomplete field mapping DSL and does not export placeholder fields', () => {
    const parsed = parsePrepOperatorDsl('map [] to [target]', 'field_mapping');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidFieldMapping' })])
    );
    expect(
      exportPrepOperatorDsl({
        id: 'mapping-empty',
        type: 'field_mapping',
        config: { mappings: [] },
      })
    ).toBe('');
  });

  it('rejects empty field selection DSL and does not export an empty drop operation', () => {
    const parsed = parsePrepOperatorDsl('select []', 'field_select');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'fieldSelectMissingField' })])
    );
    expect(
      exportPrepOperatorDsl({
        id: 'field-select-empty',
        type: 'field_select',
        config: { mode: 'exclude', columns: [] },
      })
    ).toBe('');
  });

  it('rejects empty deduplicate-by DSL but preserves explicit all-column deduplication', () => {
    const parsed = parsePrepOperatorDsl('deduplicate by [] keep first', 'deduplicate');

    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'deduplicateMissingField' })])
    );
    expect(
      exportPrepOperatorDsl({
        id: 'deduplicate-empty',
        type: 'deduplicate',
        config: { strategy: 'by_columns', columns: [] },
      })
    ).toBe('');
    expect(
      exportPrepOperatorDsl({
        id: 'deduplicate-all',
        type: 'deduplicate',
        config: { strategy: 'all_columns', columns: [] },
      })
    ).toBe('deduplicate');
  });

  it.each(currentOperatorCases)('parses and exports $name', ({ type, dsl, expectedConfig }) => {
    const parsed = parsePrepOperatorDsl(dsl, type);

    expect(errorsOf(parsed.diagnostics), dsl).toHaveLength(0);
    expect(parsed.operator?.type).toBe(type);
    expect(parsed.operator?.config).toMatchObject({ dsl, ...expectedConfig });
    expect(
      exportPrepOperatorDsl({ id: `${type}_case`, type, config: parsed.operator!.config })
    ).toBe(dsl);
  });

  it.each([
    {
      dsl: 'unnest [`keep parent names`] as [`with index`] with index [`keep parent names`] keep parent names true',
      expectedConfig: {
        sourceKind: 'list',
        column: 'keep parent names',
        alias: 'with index',
        withIndex: 'keep parent names',
        keepParentNames: true,
      },
    },
    {
      dsl: 'explode json [`with index`] path "$.keep parent names"',
      expectedConfig: {
        sourceKind: 'json',
        column: 'with index',
        path: '$.keep parent names',
        alias: '',
        keepParentNames: false,
        preserveOrder: false,
      },
    },
  ])('parses unnest keywords inside field names: $dsl', ({ dsl, expectedConfig }) => {
    const parsed = parsePrepOperatorDsl(dsl, 'unnest');

    expect(errorsOf(parsed.diagnostics), dsl).toHaveLength(0);
    expect(parsed.operator?.config).toMatchObject({ dsl, ...expectedConfig });
    expect(exportPrepOperatorDsl({ id: 'unnest_keywords_case', ...parsed.operator! })).toBe(dsl);
  });

  it('compiles and round-trips a workflow that uses every currently executable operator family', () => {
    const parsed = parsePrepDsl(`
      input source task as orders
      input source dataset "customers" as customers

      from orders
        | select [order_id], [customer_id], [dt], [region], [rev], [profit], [status], [updated_at]
        | map [dt] to [order_date], [rev] to [revenue]
        | cast [order_date] as date format "%Y-%m-%d" on_error null, [revenue] as float on_error null, [profit] as float on_error null
        | missing value [region] nullify values ("", "N/A")
        | missing value [region] fill "UNKNOWN"
        | deduplicate by [order_id] keep last order by [updated_at] desc
        | derive [rn] = row_number() over(partition by [region] order by [revenue] desc)
        | filter [status] = "PAID" and [revenue] > 0
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep left *, [customers].[name] as [customer_name]
        | aggregate by [region] metrics sum([revenue]) as [total_revenue], count(*) as [row_count]
        | sort by [total_revenue] desc
        | output table "operator_case_output" mode replace
    `);

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.ast).not.toBeNull();

    const compiled = compilePrepWorkflowToFlow(parsed.ast!);
    expect(errorsOf(compiled.diagnostics)).toHaveLength(0);
    expect(compiled.nodes.map((node) => node.type)).toEqual([
      'input_source',
      'input_source',
      'field_select',
      'field_mapping',
      'type_convert',
      'missing_value',
      'missing_value',
      'deduplicate',
      'calculate_field',
      'filter',
      'join',
      'aggregate',
      'sort',
      'output',
    ]);

    const exported = exportPrepWorkflowDsl(compiled.nodes, compiled.edges);
    const reparsed = parsePrepDsl(exported);
    expect(errorsOf(reparsed.diagnostics)).toHaveLength(0);
  });

  it('parses sort options after a backtick field containing spaces', () => {
    const parsed = parsePrepOperatorDsl(
      'sort by [`Unit Price`] desc nulls last, [`Order Date`] asc',
      'sort'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.keys).toEqual([
      { field: 'Unit Price', direction: 'desc', nulls: 'last' },
      { field: 'Order Date', direction: 'asc' },
    ]);
  });

  it('does not split mapping and join keywords inside backtick fields', () => {
    const mapping = parsePrepOperatorDsl('map [`from to`] to [`mapped as value`]', 'field_mapping');
    const join = parsePrepOperatorDsl(
      'join left products on [orders].[`brand and model`] = [products].[`brand and model`] and [orders].[sku] = [products].[sku]',
      'join'
    );

    expect(errorsOf(mapping.diagnostics)).toHaveLength(0);
    expect(mapping.operator?.config.mappings).toEqual([
      { source: 'from to', target: 'mapped as value' },
    ]);
    expect(errorsOf(join.diagnostics)).toHaveLength(0);
    expect(join.operator?.config.conditions).toEqual([
      {
        left: '[orders].[`brand and model`]',
        operator: '=',
        right: '[products].[`brand and model`]',
      },
      { left: '[orders].[sku]', operator: '=', right: '[products].[sku]' },
    ]);
  });

  it('does not treat join clause keywords inside backtick fields as clauses', () => {
    const parsed = parsePrepOperatorDsl(
      'join left products on [orders].[`keep suffix`] = [products].[`keep suffix`] keep left *, [products].[`on value`] as [`right_prefix value`]',
      'join'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.conditions).toEqual([
      {
        left: '[orders].[`keep suffix`]',
        operator: '=',
        right: '[products].[`keep suffix`]',
      },
    ]);
    expect(parsed.operator?.config.keep).toEqual([
      { side: 'left', wildcard: true },
      { source: '[products].[`on value`]', alias: 'right_prefix value' },
    ]);
  });

  it('does not report a matched invalid operator as unsupported', () => {
    const parsed = parsePrepOperatorDsl('pivot invalid syntax', 'pivot');
    const errorCodes = errorsOf(parsed.diagnostics).map((diagnostic) => diagnostic.code);

    expect(errorCodes).toContain('invalidPivot');
    expect(errorCodes).not.toContain('unsupportedCommand');
  });

  it('ignores empty cached DSL and exports the structured configuration', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'limit',
        type: 'limit',
        config: { dsl: '   ', mode: 'fixed', limit: 20, unit: 'rows' },
      })
    ).toBe('limit 20');

    expect(
      exportPrepWorkflowDsl(
        [
          { id: 'source', type: 'input_source', config: { dsl: '' } },
          {
            id: 'limit',
            type: 'limit',
            config: { mode: 'fixed', limit: 20, unit: 'rows' },
          },
        ],
        [{ sourceNodeId: 'source', targetNodeId: 'limit', targetHandle: 'input' }]
      )
    ).toBe('input source task\n  | limit 20');
  });

  it('rejects workflow export when an incomplete operator cannot be formatted', () => {
    expect(() =>
      exportPrepWorkflowDsl(
        [
          { id: 'source', type: 'input_source', config: { dsl: 'input source task' } },
          { id: 'sort-empty', type: 'sort', config: { keys: [] } },
        ],
        [{ sourceNodeId: 'source', targetNodeId: 'sort-empty', targetHandle: 'input' }]
      )
    ).toThrow('Cannot export incomplete sort operator (sort-empty)');
  });

  it('does not export DSL for an empty filter config', () => {
    expect(exportPrepOperatorDsl({ id: 'filter-empty', type: 'filter', config: {} })).toBe('');
    expect(
      exportPrepOperatorDsl({ id: 'filter-empty', type: 'filter', config: { condition: '   ' } })
    ).toBe('');
  });

  it('rejects workflow export when a filter operator has an empty condition', () => {
    expect(() =>
      exportPrepWorkflowDsl(
        [
          { id: 'source', type: 'input_source', config: { dsl: 'input source task' } },
          { id: 'filter-empty', type: 'filter', config: { condition: '' } },
        ],
        [{ sourceNodeId: 'source', targetNodeId: 'filter-empty', targetHandle: 'input' }]
      )
    ).toThrow('Cannot export incomplete filter operator (filter-empty)');
  });

  it('preserves a comma inside a quoted IN value through the DSL codec', () => {
    const dsl = 'filter [city] in ("New York, NY", "Paris")';
    const parsed = parsePrepOperatorDsl(dsl, 'filter');
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(parsed.operator).not.toBeNull();
    const exported = exportPrepOperatorDsl({
      id: 'test',
      type: parsed.operator!.type,
      config: parsed.operator!.config,
    });
    expect(exported).toBe(dsl);
  });

  it('preserves is null / is not null through the DSL codec', () => {
    for (const dsl of ['filter [phone] is null', 'filter [phone] is not null']) {
      const parsed = parsePrepOperatorDsl(dsl, 'filter');
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      expect(parsed.operator).not.toBeNull();
      expect(
        exportPrepOperatorDsl({
          id: 'test',
          type: parsed.operator!.type,
          config: parsed.operator!.config,
        })
      ).toBe(dsl);
    }
  });

  it('accepts valid IN / NOT IN lists through the DSL codec', () => {
    for (const dsl of [
      'filter [code] in ("a", "b")',
      'filter [code] not in (1, 2, 3)',
      'filter [code] in ("New York, NY", "Paris")',
    ]) {
      const parsed = parsePrepOperatorDsl(dsl, 'filter');
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      expect(parsed.operator).not.toBeNull();
    }
  });

  it('rejects IN with trailing content after the closing parenthesis', () => {
    const parsed = parsePrepOperatorDsl('filter [code] in ("a") trailing', 'filter');
    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidFilterCondition' })])
    );
  });

  it.each([
    'filter [code] in ()',
    'filter [code] in (,1)',
    'filter [code] in (1,)',
    'filter [code] in (1,,2)',
    'filter [code] in (1 2)',
  ])('rejects malformed IN list: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'filter');
    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidFilterCondition' })])
    );
  });

  it('rejects unterminated literals in a filter condition', () => {
    const parsed = parsePrepOperatorDsl('filter [code] = "abc', 'filter');
    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidFilterCondition' })])
    );
  });

  it('treats a hash inside a single-quoted string as content, not a comment', () => {
    const parsed = parsePrepOperatorDsl("filter [text] = 'a#b' # real comment", 'filter');
    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config).toMatchObject({ condition: "[text] = 'a#b'" });
  });

  it('keeps a hash inside a backtick field reference and strips a trailing comment', () => {
    const parsed = parsePrepOperatorDsl('filter [`Order#`] is not null # 排除空订单号', 'filter');
    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config).toMatchObject({ condition: '[`Order#`] is not null' });
  });

  it.each([
    'filter [name] like ("a", "b")',
    'filter [name] not like ("a", "b")',
    'filter [name] matches ("a", "b")',
    'filter [name] not matches ("a", "b")',
    'filter [name] begin ("a")',
    'filter [name] end ("b")',
  ])('rejects list right-hand value for string operators: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'filter');
    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidFilterCondition' })])
    );
  });

  it('accepts single-value string operators through the DSL codec', () => {
    for (const dsl of [
      'filter [name] like "a%"',
      'filter [name] not like "a%"',
      'filter [name] matches "^a"',
      'filter [name] not matches "^a"',
      'filter [name] begin "a"',
      'filter [name] end "b"',
    ]) {
      const parsed = parsePrepOperatorDsl(dsl, 'filter');
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      expect(parsed.operator).not.toBeNull();
    }
  });

  it('accepts each comparison operator with a literal right-hand value', () => {
    for (const dsl of [
      'filter [a] = 1',
      'filter [a] != 2',
      'filter [a] <> 3',
      'filter [a] > -5',
      'filter [a] < 0.5',
      'filter [a] >= 10',
      'filter [a] <= 100',
      'filter [a] = "x"',
      'filter [a] = null',
      'filter [a] = true',
      'filter [a] = 2024-01-01',
    ]) {
      const parsed = parsePrepOperatorDsl(dsl, 'filter');
      expect(
        parsed.diagnostics.filter((d) => d.severity === 'error'),
        dsl
      ).toHaveLength(0);
      expect(parsed.operator).not.toBeNull();
    }
  });

  it.each([
    'filter [amount] + 1',
    'filter [amount] - 1',
    'filter [amount] * 2',
    'filter [amount] / 2',
    'filter [amount] % 2',
    'filter [amount] || "x"',
    'filter [amount] * 2 > 5',
  ])('rejects a non-comparison operator as the top-level operator: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'filter');
    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidFilterCondition' })])
    );
  });

  it.each([
    'filter [a] = [b]',
    'filter [a] > [b]',
    'filter [a] in ([b])',
    'filter [a] between [b] and [c]',
  ])('accepts and round-trips a single field reference as the right-hand value: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'filter');
    expect(
      parsed.diagnostics.filter((d) => d.severity === 'error'),
      dsl
    ).toHaveLength(0);
    expect(parsed.operator).not.toBeNull();
    expect(
      exportPrepOperatorDsl({
        id: 'test',
        type: parsed.operator!.type,
        config: parsed.operator!.config,
      })
    ).toBe(dsl);
  });

  it.each([
    'filter [a] = Beijing',
    'filter [a] in (Beijing, Berlin)',
    'filter [a] like abc',
    'filter [a] between Beijing and Berlin',
  ])('rejects a bare identifier that is not true/false/null as the right-hand value: %s', (dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, 'filter');
    expect(errorsOf(parsed.diagnostics)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalidFilterCondition' })])
    );
  });

  it('accepts quoted strings and the bare booleans/null as the right-hand value', () => {
    for (const dsl of [
      'filter [a] = "Beijing"',
      'filter [a] = true',
      'filter [a] = false',
      'filter [a] = null',
      'filter [a] in ("Beijing", "Berlin")',
    ]) {
      const parsed = parsePrepOperatorDsl(dsl, 'filter');
      expect(
        parsed.diagnostics.filter((d) => d.severity === 'error'),
        dsl
      ).toHaveLength(0);
      expect(parsed.operator).not.toBeNull();
    }
  });

  it('does not export a limit when the row count is omitted', () => {
    expect(exportPrepOperatorDsl({ id: 'limit-empty', type: 'limit', config: {} })).toBe('');
  });

  it('does not export a type_convert without conversions', () => {
    expect(
      exportPrepOperatorDsl({ id: 'typeconvert-empty', type: 'type_convert', config: {} })
    ).toBe('');
  });

  it('does not export a calculate_field without calculations', () => {
    expect(
      exportPrepOperatorDsl({ id: 'calculatefield-empty', type: 'calculate_field', config: {} })
    ).toBe('');
  });

  it('does not export an unnest without a column', () => {
    expect(exportPrepOperatorDsl({ id: 'unnest-empty', type: 'unnest', config: {} })).toBe('');
  });

  it('does not export an unnest list without an alias', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'unnest-no-alias',
        type: 'unnest',
        config: { sourceKind: 'list', column: 'items' },
      })
    ).toBe('');
  });

  it('does not export an unnest list with an empty index column', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'unnest-empty-index',
        type: 'unnest',
        config: { sourceKind: 'list', column: 'items', alias: 'item', withIndex: '' },
      })
    ).toBe('');
  });

  it('does not export an unpivot without columns', () => {
    expect(exportPrepOperatorDsl({ id: 'unpivot-empty', type: 'unpivot', config: {} })).toBe('');
  });

  it('does not export a set_op without a right input', () => {
    expect(exportPrepOperatorDsl({ id: 'setop-empty', type: 'set_op', config: {} })).toBe('');
    expect(
      exportPrepOperatorDsl({
        id: 'setop-no-right',
        type: 'set_op',
        config: { operation: 'union' },
      })
    ).toBe('');
  });

  it('does not export a join without a right input', () => {
    expect(exportPrepOperatorDsl({ id: 'join-empty', type: 'join', config: {} })).toBe('');
  });

  it('does not export a non-cross join without conditions', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'join-no-condition',
        type: 'join',
        config: { joinType: 'left', rightInput: 'R' },
      })
    ).toBe('');
  });

  it('does not export an asof join without time fields', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'join-asof-no-time',
        type: 'join',
        config: { joinType: 'asof', rightInput: 'R' },
      })
    ).toBe('');
  });

  it.each(['limit 101 percent', 'sample 101 percent'])(
    'rejects percentages above 100: %s',
    (dsl) => {
      const parsed = parsePrepOperatorDsl(dsl, 'limit');

      expect(errorsOf(parsed.diagnostics)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'invalidLimitPercent' })])
      );
    }
  );

  it('preserves percent and offset units in top DSL', () => {
    const percentDsl = 'top 10 percent by [score] desc with ties';
    const percent = parsePrepOperatorDsl(percentDsl, 'limit');
    expect(errorsOf(percent.diagnostics)).toHaveLength(0);
    expect(percent.operator?.config).toMatchObject({ unit: 'percent', ties: true });
    expect(exportPrepOperatorDsl({ id: 'percent_top', ...percent.operator! })).toBe(percentDsl);

    const rowsDsl = 'top 10 by [score] desc offset 5 with ties';
    const rows = parsePrepOperatorDsl(rowsDsl, 'limit');
    expect(errorsOf(rows.diagnostics)).toHaveLength(0);
    expect(rows.operator?.config).toMatchObject({ unit: 'rows', offset: 5, ties: true });
    expect(exportPrepOperatorDsl({ id: 'rows_top', ...rows.operator! })).toBe(rowsDsl);
  });

  it.each(['sample 10 rows system', 'sample 10 rows bernoulli'])(
    'rejects percentage-only methods for fixed-row sampling: %s',
    (dsl) => {
      const parsed = parsePrepOperatorDsl(dsl, 'limit');

      expect(errorsOf(parsed.diagnostics)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'invalidSampleMethodForRows' })])
      );
    }
  );

  it.each(['limit 10 percent offset 5', 'top 10 percent by [score] offset 5'])(
    'rejects offsets for percentage-based limits: %s',
    (dsl) => {
      const parsed = parsePrepOperatorDsl(dsl, 'limit');

      expect(errorsOf(parsed.diagnostics)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'invalidPercentOffset' })])
      );
    }
  );

  it('exports operators in edge order when the node array is shuffled', () => {
    const exported = exportPrepWorkflowDsl(
      [
        {
          id: 'sort',
          type: 'sort',
          config: { keys: [{ field: 'amount', direction: 'desc' }] },
        },
        { id: 'output', type: 'output', config: { table: 'result', mode: 'replace' } },
        { id: 'source', type: 'input_source', config: { dsl: 'input source task as source' } },
        {
          id: 'select',
          type: 'field_select',
          config: { mode: 'include', columns: ['amount'] },
        },
      ],
      [
        { sourceNodeId: 'source', targetNodeId: 'select', targetHandle: 'input' },
        { sourceNodeId: 'select', targetNodeId: 'sort', targetHandle: 'input' },
        { sourceNodeId: 'sort', targetNodeId: 'output', targetHandle: 'input' },
      ]
    );

    expect(exported).toBe(
      [
        'input source task as source',
        '  | select [amount]',
        '  | sort by [amount] desc',
        '  | output table "result" mode replace',
      ].join('\n')
    );
  });

  it('parses cast fields containing the as keyword', () => {
    const parsed = parsePrepOperatorDsl(
      'cast [`value as text`] as integer on_error fail',
      'type_convert'
    );

    expect(errorsOf(parsed.diagnostics)).toHaveLength(0);
    expect(parsed.operator?.config.conversions).toEqual([
      { column: 'value as text', type: 'integer', onError: 'fail' },
    ]);
  });

  it('exports graphical dataset and file output configurations', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'dataset_output',
        type: 'output',
        config: { destination: 'dataset', dataset: 'clean_orders', mode: 'replace' },
      })
    ).toBe('output dataset "clean_orders" mode replace');
    expect(
      exportPrepOperatorDsl({
        id: 'file_output',
        type: 'output',
        config: {
          destination: 'file',
          filePath: 'exports/orders.csv',
          format: 'csv',
          mode: 'replace',
        },
      })
    ).toBe('output file "exports/orders.csv" format csv mode replace');
  });
});
