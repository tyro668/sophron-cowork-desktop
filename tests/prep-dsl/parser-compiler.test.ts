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
      input source task as raw_orders
        | select [order_id], [region], [revenue]
        | missing value row drop when all_null
        | missing value [region] nullify values ("", "N/A", "-")
        | cast [revenue] as float on_error null
        | derive [margin] = if [revenue] = 0 then 0 else [profit] / [revenue]
        | output table "clean_orders" mode replace
    `);

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(result.ast?.sources).toHaveLength(1);
    expect(result.ast?.mainSource).toBe('raw_orders');
    expect(result.ast?.operators.map((operator) => operator.type)).toEqual([
      'field_select',
      'missing_value',
      'missing_value',
      'type_convert',
      'calculate_field',
    ]);
    expect(result.ast?.output?.type).toBe('output');
  });

  it('compiles multi-source join pipelines with left and right handles', () => {
    const result = parsePrepDsl(`
      input source task as orders
      input source dataset "customer_dim" as customers

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep left *, [customers].[name] as [customer_name]
            expect many_to_one
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

  it('parses asof join configuration', () => {
    const result = parsePrepDsl(`
      input source task as events
      input source dataset "device_status_snapshot" as status

      from events
        | join asof status
            on [events].[event_time] >= [status].[snapshot_time]
            by [events].[device_id] = [status].[device_id]
            tolerance 6h
            keep left *, [status].[region] as [device_region]
            expect many_to_one
        | output table "events_with_status" mode replace
    `);

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    const join = result.ast?.operators.find((operator) => operator.type === 'join');
    expect(join?.config.joinType).toBe('asof');
    expect(join?.config.asof).toMatchObject({
      leftTime: 'events.event_time',
      operator: '>=',
      rightTime: 'status.snapshot_time',
      direction: 'backward',
      tolerance: '6h',
    });
  });

  it('rejects legacy dotted field references inside one bracket pair', () => {
    const result = parsePrepDsl(`
      input source task as orders
      input source dataset "customer_dim" as customers

      from orders
        | join left customers on [orders.customer_id] = [customers.customer_id]
    `);

    expect(
      result.diagnostics.some((item) => item.message.includes('[table_name].[field_name]'))
    ).toBe(true);
  });

  it('exports compiled workflows back to DSL', () => {
    const result = parsePrepDsl(`
      input source task as orders
      input source dataset "customer_dim" as customers

      from orders
        | join left customers
            on [orders].[customer_id] = [customers].[customer_id]
            keep left *, [customers].[name] as [customer_name]
            expect many_to_one
        | output table "orders_with_customers" mode replace
    `);
    const compiled = compilePrepWorkflowToFlow(result.ast!);
    const exported = exportPrepWorkflowDsl(compiled.nodes, compiled.edges);

    expect(exported).toContain('input source task as orders');
    expect(exported).toContain('from orders');
    expect(exported).toContain('join left customers');
    expect(exported).toContain('[orders].[customer_id]');
  });

  it('parses single-operator DSL for every editable operator', () => {
    const cases: Array<[PrepOperatorType, string]> = [
      ['field_select', 'select [order_id], [region]'],
      ['field_mapping', 'map [dt] to [order_date]'],
      ['filter', 'filter [revenue] > 0'],
      ['deduplicate', 'deduplicate by [order_id] keep last order by [updated_at] desc'],
      ['missing_value', 'missing value [region] nullify values ("", "N/A")'],
      ['type_convert', 'cast [revenue] as float on_error null'],
      ['sort', 'sort by [order_date] desc nulls last'],
      ['calculate_field', 'derive [margin] = [profit] / [revenue]'],
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
      expect(result.operator?.config.dsl).toBe(dsl);
    }
  });

  it('preserves backtick-quoted sort fields with spaces', () => {
    const result = parsePrepOperatorDsl(
      'sort by [`Unit Price`] asc, [`Sales 总和`] desc nulls last',
      'sort'
    );

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(result.operator?.config.keys).toEqual([
      { field: 'Unit Price', direction: 'asc' },
      { field: 'Sales 总和', direction: 'desc', nulls: 'last' },
    ]);
    expect(result.operator && exportPrepOperatorDsl(result.operator)).toBe(
      'sort by [`Unit Price`] asc, [`Sales 总和`] desc nulls last'
    );
  });

  it('rejects legacy cast target aliases', () => {
    for (const targetType of ['string', 'int', 'double', 'timestamp']) {
      const result = parsePrepOperatorDsl(`cast [value] as ${targetType}`, 'type_convert');

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
    const result = parsePrepOperatorDsl('filter [订单ID]="A1000001"', 'filter');

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    expect(result.operator?.type).toBe('filter');
    expect(result.operator?.config.condition).toBe('[订单ID]="A1000001"');
  });

  it('exports single operators from saved DSL or structured config', () => {
    expect(
      exportPrepOperatorDsl({
        id: 'filter-1',
        type: 'filter',
        config: { dsl: 'filter [status] = "PAID"', condition: '[status] = "PAID"' },
      })
    ).toBe('filter [status] = "PAID"');

    expect(
      exportPrepOperatorDsl({
        id: 'derive-1',
        type: 'calculate_field',
        config: { calculations: [{ field: 'margin', expression: '[profit] / [revenue]' }] },
      })
    ).toBe('derive [margin] = [profit] / [revenue]');
  });
});
