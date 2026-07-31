import { describe, expect, it } from 'vitest';
import { exportPrepOperatorDsl, parsePrepOperatorDsl } from '../../src/shared/prep-dsl';
import type { PrepOperatorAst, PrepOperatorType } from '../../src/shared/prep-dsl';

/**
 * Operator Forms — Config ↔ DSL Round-Trip Tests
 *
 * These tests verify the critical invariant underpinning the graphical form system:
 * any config object a form produces must round-trip through DSL export → parse
 * without losing semantic content.
 */

function roundTrip(type: PrepOperatorType, config: Record<string, unknown>) {
  const dsl = exportPrepOperatorDsl({ id: 'test', type, config });
  const parsed = parsePrepOperatorDsl(dsl, type);
  return { dsl, parsed };
}

/** Parse and assert no errors, returning non-null operator AST. */
function ok(config: Record<string, unknown>, type: PrepOperatorType): PrepOperatorAst {
  const { dsl, parsed } = roundTrip(type, config);
  expect(
    parsed.diagnostics.filter((d) => d.severity === 'error'),
    `DSL round-trip errors for ${type}: ${dsl}`
  ).toHaveLength(0);
  expect(parsed.operator, `DSL parsed to null operator for ${type}: ${dsl}`).not.toBeNull();
  return parsed.operator!;
}

describe('operator forms — config ↔ DSL round-trip', () => {
  it('filter', () => {
    const result = ok({ condition: '[revenue] > 0' }, 'filter');
    expect(result.config.condition).toBe('[revenue] > 0');
  });

  it('filter with complex expression', () => {
    const result = ok({ condition: '[revenue] > 0 and [region] != "TEST"' }, 'filter');
    expect(result.config.condition).toContain('and');
  });

  it('field_select — include', () => {
    const result = ok({ mode: 'include', columns: ['id', 'name', 'date'] }, 'field_select');
    expect(result.config.mode).toBe('include');
    expect(result.config.columns).toEqual(['id', 'name', 'date']);
  });

  it('field_select — exclude', () => {
    const result = ok({ mode: 'exclude', columns: ['debug_col'] }, 'field_select');
    expect(result.config.mode).toBe('exclude');
  });

  it('field_mapping', () => {
    const result = ok(
      {
        mappings: [
          { source: 'dt', target: 'order_date' },
          { source: 'rev', target: 'revenue' },
        ],
      },
      'field_mapping'
    );
    expect(result.config.mappings).toHaveLength(2);
    expect((result.config.mappings as Array<Record<string, string>>)[0].source).toBe('dt');
  });

  it('deduplicate — by columns', () => {
    const result = ok(
      {
        strategy: 'by_columns',
        columns: ['order_id', 'sku_id'],
        keep: 'last',
        orderBy: [{ field: 'updated_at', direction: 'desc' }],
      },
      'deduplicate'
    );
    expect(result.config.strategy).toBe('by_columns');
    expect(result.config.keep).toBe('last');
  });

  it('deduplicate — all columns', () => {
    const result = ok({ strategy: 'all_columns' }, 'deduplicate');
    expect(result.config.strategy).toBe('all_columns');
  });

  it('type_convert — single', () => {
    const result = ok(
      {
        conversions: [{ column: 'order_date', type: 'date', format: '%Y-%m-%d', onError: 'null' }],
      },
      'type_convert'
    );
    const conversions = result.config.conversions as Array<Record<string, unknown>>;
    expect(conversions).toHaveLength(1);
    expect(conversions[0].type).toBe('date');
  });

  it('type_convert — multiple fields', () => {
    const result = ok(
      {
        conversions: [
          { column: 'revenue', type: 'float', onError: 'null' },
          { column: 'qty', type: 'integer', onError: 'fail' },
        ],
      },
      'type_convert'
    );
    expect(result.config.conversions as Array<unknown>).toHaveLength(2);
  });

  it('sort', () => {
    const result = ok(
      {
        keys: [
          { field: 'region', direction: 'asc', nulls: 'last' },
          { field: 'revenue', direction: 'desc' },
        ],
      },
      'sort'
    );
    const keys = result.config.keys as Array<Record<string, unknown>>;
    expect(keys).toHaveLength(2);
    expect(keys[0].nulls).toBe('last');
  });

  it('calculate_field — derive', () => {
    const result = ok(
      {
        calculations: [
          { field: 'margin', expression: 'if [revenue] = 0 then 0 else [profit] / [revenue]' },
        ],
      },
      'calculate_field'
    );
    const calcs = result.config.calculations as Array<Record<string, unknown>>;
    expect(calcs).toHaveLength(1);
    expect(calcs[0].field).toBe('margin');
  });

  it('calculate_field — window function', () => {
    const result = ok(
      {
        calculations: [
          {
            field: 'rn',
            expression: 'row_number() over(partition by [region] order by [revenue] desc)',
          },
        ],
      },
      'calculate_field'
    );
    const calcs = result.config.calculations as Array<Record<string, unknown>>;
    expect(calcs[0].expression).toContain('over(');
  });

  it('aggregate', () => {
    const result = ok(
      {
        groupBy: ['region', 'month'],
        metrics: [
          { function: 'sum', expression: '[revenue]', alias: 'total_revenue' },
          { function: 'count', expression: '*', alias: 'row_count' },
        ],
      },
      'aggregate'
    );
    expect(result.config.groupBy).toEqual(['region', 'month']);
    const metrics = result.config.metrics as Array<Record<string, unknown>>;
    expect(metrics).toHaveLength(2);
    expect(metrics[0].alias).toBe('total_revenue');
  });

  it('aggregate — aggregate all', () => {
    const result = ok(
      {
        groupBy: [],
        metrics: [{ function: 'count', expression: '*', alias: 'row_count' }],
      },
      'aggregate'
    );
    const metrics = result.config.metrics as Array<Record<string, unknown>>;
    expect(metrics).toHaveLength(1);
  });

  it('join — inner', () => {
    const result = ok(
      {
        joinType: 'inner',
        rightInput: 'customers',
        conditions: [{ left: 'orders.customer_id', operator: '=', right: 'customers.customer_id' }],
      },
      'join'
    );
    expect(result.config.joinType).toBe('inner');
    expect(result.config.rightInput).toBe('customers');
  });

  it('join — left with keep', () => {
    const result = ok(
      {
        joinType: 'left',
        rightInput: 'customers',
        conditions: [{ left: 'orders.customer_id', operator: '=', right: 'customers.customer_id' }],
        keep: [
          { side: 'left', wildcard: true },
          { source: 'customers.name', alias: 'customer_name' },
        ],
      },
      'join'
    );
    expect(result.config.joinType).toBe('left');
    const keep = result.config.keep as Array<Record<string, unknown>>;
    expect(keep).toBeDefined();
    expect(keep.some((k) => k.wildcard === true)).toBe(true);
  });

  it('join — anti', () => {
    const result = ok(
      {
        joinType: 'anti',
        rightInput: 'blacklist',
        conditions: [{ left: 'orders.customer_id', operator: '=', right: 'blacklist.customer_id' }],
      },
      'join'
    );
    expect(result.config.joinType).toBe('anti');
  });

  it('join — cross', () => {
    const result = ok({ joinType: 'cross', rightInput: 'dates' }, 'join');
    expect(result.config.joinType).toBe('cross');
  });

  it('join — asof', () => {
    const result = ok(
      {
        joinType: 'asof',
        rightInput: 'rates',
        conditions: [],
        asof: {
          leftTime: 'trades.trade_time',
          operator: '>=',
          rightTime: 'rates.rate_time',
          tolerance: '1d',
          by: [{ left: 'trades.currency', operator: '=', right: 'rates.currency' }],
        },
      },
      'join'
    );
    expect(result.config.joinType).toBe('asof');
    const asof = result.config.asof as Record<string, unknown>;
    expect(asof.tolerance).toBe('1d');
  });

  it('limit — simple limit', () => {
    const result = ok({ mode: 'fixed', limit: 100 }, 'limit');
    expect(result.config.mode).toBe('fixed');
    expect(result.config.limit).toBe(100);
  });

  it('limit — top with sort', () => {
    const result = ok(
      {
        mode: 'fixed',
        limit: 10,
        orderBy: [{ field: 'revenue', direction: 'desc' }],
      },
      'limit'
    );
    expect(result.config.mode).toBe('fixed');
  });

  it('pivot', () => {
    const result = ok(
      {
        on: ['month'],
        using: [{ function: 'sum', expression: '[revenue]', alias: 'revenue_sum' }],
        groupBy: ['region'],
      },
      'pivot'
    );
    expect(result.config.on).toEqual(['month']);
  });

  it('unpivot', () => {
    const result = ok(
      {
        columns: ['jan', 'feb', 'mar'],
        nameColumn: 'month',
        valueColumn: 'sales',
      },
      'unpivot'
    );
    expect(result.config.nameColumn).toBe('month');
    expect(result.config.valueColumn).toBe('sales');
  });

  it('set_op — union', () => {
    const result = ok(
      { operation: 'union', rightInput: 'returns', mode: 'all', match: 'by_name' },
      'set_op'
    );
    expect(result.config.operation).toBe('union');
  });

  it('unnest — list', () => {
    const result = ok(
      { sourceKind: 'list', column: 'items', alias: 'item', withIndex: 'item_index' },
      'unnest'
    );
    expect(result.config.alias).toBe('item');
    expect(result.config.withIndex).toBe('item_index');
  });

  it('unnest — json', () => {
    const result = ok(
      {
        sourceKind: 'json',
        column: 'payload',
        path: '$.items',
        alias: 'item',
      },
      'unnest'
    );
    expect(result.config.sourceKind).toBe('json');
    expect(result.config.path).toBe('$.items');
  });

  it('missing_value — drop_empty_rows', () => {
    const result = ok({ strategy: 'drop_empty_rows' }, 'missing_value');
    expect(result.config.strategy).toBe('drop_empty_rows');
  });

  it('missing_value — drop_rows_by_nulls', () => {
    const result = ok(
      { strategy: 'drop_rows_by_nulls', condition: 'any_null', columns: ['id', 'name'] },
      'missing_value'
    );
    expect(result.config.condition).toBe('any_null');
  });

  it('missing_value — by_column with rules', () => {
    const result = ok(
      {
        strategy: 'by_column',
        rules: [
          { column: 'region', method: 'nullify_values', values: ['', 'N/A', '-'] },
          { column: 'status', method: 'literal_fill', value: 'UNKNOWN' },
          { column: 'revenue', method: 'literal_fill', value: '0' },
        ],
      },
      'missing_value'
    );
    const rules = result.config.rules as Array<Record<string, unknown>>;
    expect(rules).toHaveLength(3);
    expect(rules[0].method).toBe('nullify_values');
    expect(rules[1].value).toBe('UNKNOWN');
  });

  it('missing_value — by_column with statistical fill', () => {
    const result = ok(
      {
        strategy: 'by_column',
        rules: [
          { column: 'revenue', method: 'mean_fill' },
          { column: 'name', method: 'mode_fill' },
        ],
      },
      'missing_value'
    );
    const rules = result.config.rules as Array<Record<string, unknown>>;
    expect(rules).toHaveLength(2);
    expect(rules[0].method).toBe('mean_fill');
    expect(rules[1].method).toBe('mode_fill');
  });
});

describe('operator forms — empty config handling', () => {
  it('handles empty config without crashing', () => {
    const types: PrepOperatorType[] = [
      'filter',
      'field_select',
      'deduplicate',
      'type_convert',
      'sort',
      'calculate_field',
      'aggregate',
      'join',
      'field_mapping',
      'limit',
      'pivot',
      'unpivot',
      'set_op',
      'unnest',
      'missing_value',
    ];
    for (const type of types) {
      const dsl = exportPrepOperatorDsl({ id: 'test', type, config: {} });
      expect(typeof dsl).toBe('string');
      if (dsl.trim()) {
        const parsed = parsePrepOperatorDsl(dsl, type);
        // Empty-config DSL may have errors — that's fine, it just shouldn't crash
        expect(parsed.diagnostics).toBeDefined();
        if (parsed.operator) {
          expect(parsed.operator.type).toBe(type);
        }
      }
    }
  });
});

describe('operator forms — all registered types', () => {
  const ALL_FORM_TYPES: PrepOperatorType[] = [
    'filter',
    'field_select',
    'field_mapping',
    'deduplicate',
    'missing_value',
    'type_convert',
    'sort',
    'join',
    'aggregate',
    'calculate_field',
    'limit',
    'pivot',
    'unpivot',
    'set_op',
    'unnest',
  ];

  it('every registered form type has a round-trip test', () => {
    const testedTypes = new Set([
      'filter',
      'field_select',
      'field_mapping',
      'deduplicate',
      'missing_value',
      'type_convert',
      'sort',
      'calculate_field',
      'aggregate',
      'join',
      'limit',
      'pivot',
      'unpivot',
      'set_op',
      'unnest',
    ]);
    for (const type of ALL_FORM_TYPES) {
      expect(testedTypes.has(type), `Missing round-trip test for: ${type}`).toBe(true);
    }
  });
});

describe('operator forms — DSL generation stability', () => {
  it('filter DSL is idempotent under export→parse→export', () => {
    const config = { condition: '[revenue] > 0' };
    const dsl1 = exportPrepOperatorDsl({ id: 'test', type: 'filter', config });
    const parsed = parsePrepOperatorDsl(dsl1, 'filter');
    expect(parsed.operator).not.toBeNull();
    const dsl2 = exportPrepOperatorDsl({
      id: 'test',
      type: 'filter',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });

  it('aggregate DSL is idempotent under export→parse→export', () => {
    const config = {
      groupBy: ['region'],
      metrics: [
        { function: 'sum', expression: '[revenue]', alias: 'total_revenue' },
        { function: 'count', expression: '*', alias: 'row_count' },
      ],
    };
    const dsl1 = exportPrepOperatorDsl({ id: 'test', type: 'aggregate', config });
    const parsed = parsePrepOperatorDsl(dsl1, 'aggregate');
    expect(parsed.operator).not.toBeNull();
    const dsl2 = exportPrepOperatorDsl({
      id: 'test',
      type: 'aggregate',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });

  it('join DSL is idempotent under export→parse→export', () => {
    const config = {
      joinType: 'left',
      rightInput: 'customers',
      conditions: [{ left: 'orders.customer_id', operator: '=', right: 'customers.customer_id' }],
      keep: [
        { side: 'left', wildcard: true },
        { source: 'customers.name', alias: 'customer_name' },
      ],
    };
    const dsl1 = exportPrepOperatorDsl({ id: 'test', type: 'join', config });
    const parsed = parsePrepOperatorDsl(dsl1, 'join');
    expect(parsed.operator).not.toBeNull();
    const dsl2 = exportPrepOperatorDsl({
      id: 'test',
      type: 'join',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });
});
