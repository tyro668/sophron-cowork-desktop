import { describe, expect, it } from 'vitest';
import {
  compilePrepWorkflowToFlow,
  exportPrepOperatorDsl,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
} from '../../src/shared/prep-dsl';
import type { PrepOperatorType } from '../../src/shared/prep-dsl';

describe('prep DSL parser and workflow compiler', () => {
  it('parses a single-source cleaning pipeline', () => {
    const result = parsePrepDsl(`
      input pipeline as raw_orders
        | select [order_id], [region], [revenue]
        | missing_value row drop when all_null
        | missing_value [region] nullify values ('', 'N/A', '-')
        | cast [revenue] as float on_error null
        | derive [margin] = if [revenue] = 0 then 0 else [profit] / [revenue]
        | output table "clean_orders" mode replace
    `);

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(result.ast?.sources).toHaveLength(1);
    expect(result.ast?.mainSource).toBe('raw_orders');
    expect(result.ast?.operators.map((operator) => operator.type)).toEqual([
      'select',
      'missing_value',
      'missing_value',
      'cast',
      'derive',
    ]);
    expect(result.ast?.output?.type).toBe('output');
  });

  it('compiles multi-source join pipelines with left and right handles', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
keep left *, [customers].[name] as [customer_name]
        | output table "orders_with_customers" mode replace
    `);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(result.ast).not.toBeNull();
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const joinNode = compiled.nodes.find((node) => node.type === 'join');
    expect(joinNode?.config?.joinType).toBe('left');
    expect(joinNode?.config?.rightInput).toBe('customers');
    expect(
      compiled.edges.some(
        (edge) => edge.targetNodeId === joinNode?.id && edge.targetHandle === 'left'
      )
    ).toBe(true);
    expect(
      compiled.edges.some(
        (edge) => edge.targetNodeId === joinNode?.id && edge.targetHandle === 'right'
      )
    ).toBe(true);
  });

  it('parses ASOF join', () => {
    const result = parsePrepDsl(`
      input pipeline as events
      input rawTable "device_status_snapshot" as status

      from events
        | join asof status
            on [events].[event_time] >= [status].[snapshot_time]
            by [events].[device_id] = [status].[device_id]
            tolerance 6h
            keep left *, [status].[region] as [device_region]
        | output table "events_with_status" mode replace
    `);

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const join = result.ast?.operators.find((operator) => operator.type === 'join');
    expect(join?.config.joinType).toBe('asof');
    expect(join?.config.asof).toMatchObject({
      leftTime: '[events].[event_time]',
      operator: '>=',
      rightTime: '[status].[snapshot_time]',
      tolerance: '6h',
    });
  });

  it('rejects legacy dotted field references inside one bracket pair', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers

      from orders
        | join left customers on [orders.customer_id] = [customers.customer_id]
    `);

    expect(
      result.diagnostics.some((item) => item.message.includes('[table_name].[field_name]'))
    ).toBe(true);
  });

  it('exports compiled workflows back to DSL', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep left *, [customers].[name] as [customer_name]
        | output table "orders_with_customers" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);
    const exported = exportPrepWorkflowDsl(compiled.nodes, compiled.edges);

    expect(exported).toContain('input pipeline as orders');
    expect(exported).toContain('from orders');
    expect(exported).toContain('join left customers');
    expect(exported).toContain('[orders].[customer_id]');
  });

  it('exports structured input and output node configs without cached DSL text', () => {
    const exported = exportPrepWorkflowDsl(
      [
        {
          id: 'source',
          type: 'input',
          config: { source: 'rawTable', rawTableId: 'rawTable-sales-id', alias: 'sales' },
        },
        {
          id: 'output',
          type: 'output',
          config: {
            destination: 'duckdb_table',
            table: 'data_output_abc123',
            resultTableName: 'Processed Sales',
            mode: 'replace',
          },
        },
      ],
      [
        {
          sourceNodeId: 'source',
          targetNodeId: 'output',
          targetHandle: 'input',
        },
      ]
    );

    expect(exported).toContain('input rawTable "rawTable-sales-id" as sales');
    expect(exported).toContain('output table "Processed Sales" mode replace');
    expect(parsePrepDsl(exported).diagnostics.filter((item) => item.severity === 'error')).toEqual(
      []
    );
  });

  it('parses single-operator DSL for every editable operator', () => {
    const cases: Array<[PrepOperatorType, string]> = [
      ['select', 'select [order_id], [region]'],
      ['rename', 'rename [dt] as [order_date]'],
      ['filter', 'filter [revenue] > 0'],
      ['deduplicate', 'deduplicate by [order_id] keep last order by [updated_at] desc'],
      ['missing_value', `missing_value [region] nullify values ('', 'N/A')`],
      ['cast', 'cast [revenue] as float on_error null'],
      ['sort', 'sort [order_date] desc nulls last'],
      ['derive', 'derive [margin] = [profit] / [revenue]'],
      ['aggregate', 'aggregate by [region] metrics sum([revenue]) as [total_revenue]'],
      [
        'join',
        'join left customers on [orders].[customer_id] = [customers].[customer_id] keep left *, [customers].[name] as [customer_name]',
      ],
    ];

    for (const [type, dsl] of cases) {
      const result = parsePrepOperatorDsl(dsl, type);
      expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
      expect(result.operator?.type).toBe(type);
      expect(result.operator?.dsl).toBe(dsl);
      expect(result.operator?.config).not.toHaveProperty('dsl');
    }
  });

  it('preserves backtick-quoted sort fields with spaces', () => {
    const result = parsePrepOperatorDsl(
      'sort [`Unit Price`] asc, [`Sales 总和`] desc nulls last',
      'sort'
    );

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(result.operator?.config.orderBy).toEqual([
      { field: 'Unit Price', direction: 'asc' },
      { field: 'Sales 总和', direction: 'desc', nulls: 'last' },
    ]);
    expect(result.operator && exportPrepOperatorDsl({ id: 'op', ...result.operator })).toBe(
      'sort [Unit Price] asc, [Sales 总和] desc nulls last'
    );
  });

  it('rejects legacy cast target aliases', () => {
    for (const targetType of ['string', 'int', 'double', 'timestamp']) {
      const result = parsePrepOperatorDsl(`cast [value] as ${targetType}`, 'cast');

      expect(result.diagnostics.some((item) => item.code === 'invalidCastTargetType')).toBe(true);
    }
  });

  it('rejects single-operator DSL when the operator type does not match', () => {
    const result = parsePrepOperatorDsl('aggregate all metrics count(*) as [row_count]', 'filter');

    expect(result.operator?.type).toBe('aggregate');
    expect(result.diagnostics.some((item) => item.code === 'operatorDslTypeMismatch')).toBe(true);
  });

  it('validates qualified fields in single-operator DSL', () => {
    const result = parsePrepOperatorDsl(
      'join left customers on [orders.customer_id] = [customers].[customer_id]',
      'join'
    );

    expect(result.diagnostics.some((item) => item.code === 'invalidQualifiedField')).toBe(true);
  });

  it('accepts unicode field names in single-operator expressions', () => {
    const result = parsePrepOperatorDsl(`filter [订单ID]='A1000001'`, 'filter');

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(result.operator?.type).toBe('filter');
    expect(result.operator?.config.condition).toBe(`[订单ID]='A1000001'`);
  });

  it('exports single operators from saved DSL or structured config', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'filter-1',
        type: 'filter',
        config: { dsl: `filter [status] = 'PAID'`, condition: `[status] = 'PAID'` },
      })
    ).toBe(`filter [status] = 'PAID'`);

    expect(
      exportPrepOperatorDsl({
        id: 'derive-1',
        type: 'derive',
        config: { calculations: [{ field: 'margin', expression: '[profit] / [revenue]' }] },
      })
    ).toBe('derive [margin] = [profit] / [revenue]');
  });

  it('rejects a full workflow whose join on condition swaps the sides', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers

      from orders
        | join left customers
            on [customers].[customer_id] = [orders].[customer_id]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.map((item) => item.code)).toContain('joinConditionSideMismatch');
  });

  it('rejects a full workflow whose join on left side references an undeclared source', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers

      from orders
        | join left customers
            on [bogus].[customer_id] = [customers].[customer_id]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.map((item) => item.code)).toContain('joinFieldSourceNotFound');
  });

  it('rejects a full workflow whose join keep references an undeclared source', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep [bogus].[name] as [customer_name]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.map((item) => item.code)).toContain('joinFieldSourceNotFound');
  });

  it('accepts a full workflow self-join referencing the same alias on both sides', () => {
    const result = parsePrepDsl(`
      input pipeline as orders

      from orders
        | join left orders
            on [orders].[a] = [orders].[b]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });

  it('rejects a join condition whose left side references the right input alias', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers

      from orders
        | join left customers
            on [customers].[amount] > [customers].[limit]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.map((item) => item.code)).toContain('joinConditionSideMismatch');
  });

  it('rejects a join condition whose left side references a declared source not yet in the pipeline', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers
      input rawTable "product_dim" as products

      from orders
        | join left customers
            on [products].[id] = [customers].[id]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.map((item) => item.code)).toContain('joinConditionSideMismatch');
  });

  it('rejects a chained join whose later left side references a prior right input by its original alias', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers
      input rawTable "product_dim" as products

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[id]
        | join left products
            on [customers].[id] = [products].[customer_id]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.map((item) => item.code)).toContain('joinConditionSideMismatch');
  });

  it('accepts a chained join whose later left side references the prior output column name', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers
      input rawTable "product_dim" as products

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[id]
            keep [orders].[order_id], [customers].[id] as [customer_id]
        | join left products
            on [customer_id] = [products].[customer_id]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });

  it('rejects a join keep that references a declared source on neither side', () => {
    const result = parsePrepDsl(`
      input pipeline as orders
      input rawTable "customer_dim" as customers
      input rawTable "product_dim" as products

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[id]
            keep [products].[name] as [product_name]
        | output table "result" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);

    expect(compiled.diagnostics.map((item) => item.code)).toContain('joinFieldSourceNotFound');
  });
});
