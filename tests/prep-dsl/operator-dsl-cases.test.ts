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
    expectedConfig: { on: ['month'], values: ['Jan', 'Feb'], groupBy: ['region'] },
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
    ['calculate_field', 'derive [result] garbage = [amount]'],
    ['join', 'join left returns garbage'],
    ['join', 'join left returns on [orders].[id] = [returns].[id] garbage'],
    ['join', 'join left returns on [orders].[id] = [returns].[id] suffix _l _r garbage'],
    ['output', 'output table "result" mode replace mode append'],
    ['type_convert', 'cast [amount] as float on_error null on_error keep'],
    ['calculate_field', 'derive [result] = period_compare(yoy_diff, [amount] garbage, [date])'],
  ] as const)('rejects trailing DSL for %s: %s', (type, dsl) => {
    const parsed = parsePrepOperatorDsl(dsl, type);

    expect(errorsOf(parsed.diagnostics), dsl).not.toHaveLength(0);
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
      dsl: 'explode json [`with index`] path "$.keep parent names" as [`keep parent names`] with index [`with index`]',
      expectedConfig: {
        sourceKind: 'json',
        column: 'with index',
        path: '$.keep parent names',
        alias: 'keep parent names',
        withIndex: 'with index',
        keepParentNames: false,
      },
    },
  ])('parses unnest keywords inside field names: $dsl', ({ dsl, expectedConfig }) => {
    const parsed = parsePrepOperatorDsl(dsl, 'unnest');

    expect(errorsOf(parsed.diagnostics), dsl).toHaveLength(0);
    expect(parsed.operator?.config).toMatchObject({ dsl, ...expectedConfig });
    expect(exportPrepOperatorDsl(parsed.operator!)).toBe(dsl);
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
        left: 'orders.brand and model',
        operator: '=',
        right: 'products.brand and model',
      },
      { left: 'orders.sku', operator: '=', right: 'products.sku' },
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
        left: 'orders.keep suffix',
        operator: '=',
        right: 'products.keep suffix',
      },
    ]);
    expect(parsed.operator?.config.keep).toEqual([
      { side: 'left', wildcard: true },
      { source: 'products.on value', alias: 'right_prefix value' },
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

  it('uses 10 rows as the default limit when config is omitted', () => {
    expect(exportPrepOperatorDsl({ id: 'limit-default', type: 'limit', config: {} })).toBe(
      'limit 10'
    );
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
    expect(exportPrepOperatorDsl(percent.operator!)).toBe(percentDsl);

    const rowsDsl = 'top 10 by [score] desc offset 5 with ties';
    const rows = parsePrepOperatorDsl(rowsDsl, 'limit');
    expect(errorsOf(rows.diagnostics)).toHaveLength(0);
    expect(rows.operator?.config).toMatchObject({ unit: 'rows', offset: 5, ties: true });
    expect(exportPrepOperatorDsl(rows.operator!)).toBe(rowsDsl);
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
