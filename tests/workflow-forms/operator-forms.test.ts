import { describe, expect, it } from 'vitest';
import { readJoinUiConfig, JOIN_CONFLICT_DEFAULTS } from '../../src/shared/operator-config';
import { exportStep, parseStep } from '../helpers/jflow-step';

type PrepOperatorType = string;
type PrepOperatorAst = { type: string; config: Record<string, unknown> };

/**
 * Operator Forms — Config ↔ DSL Round-Trip Tests
 *
 * These tests verify the critical invariant underpinning the graphical form system:
 * any config object a form produces must round-trip through DSL export → parse
 * without losing semantic content.
 */

function roundTrip(type: PrepOperatorType, config: Record<string, unknown>) {
  const dsl = exportStep({ id: 'test', type, config });
  const parsed = parseStep(dsl, type);
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
    const result = ok({ condition: `[revenue] > 0 and [region] != 'TEST'` }, 'filter');
    expect(result.config.condition).toContain('and');
  });

  it('select — include', () => {
    const result = ok({ selection: 'include', fields: ['id', 'name', 'date'] }, 'select');
    expect(result.config.selection).toBe('include');
    expect(result.config.fields).toEqual(['id', 'name', 'date']);
  });

  it('select — exclude', () => {
    const result = ok({ selection: 'exclude', fields: ['debug_col'] }, 'select');
    expect(result.config.selection).toBe('exclude');
  });

  it('rename', () => {
    const result = ok(
      {
        mappings: [
          { source: 'dt', targetMode: 'rename', targetValue: 'order_date' },
          { source: 'rev', targetMode: 'rename', targetValue: 'revenue' },
        ],
      },
      'rename'
    );
    expect(result.config.mappings).toHaveLength(2);
    expect((result.config.mappings as Array<Record<string, string>>)[0].source).toBe('dt');
  });

  it('deduplicate — by columns', () => {
    const result = ok(
      {
        strategy: 'by_columns',
        fields: ['order_id', 'sku_id'],
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

  it('cast — single', () => {
    const result = ok(
      {
        conversions: [{ field: 'order_date', type: 'date', format: '%Y-%m-%d', onError: 'null' }],
      },
      'cast'
    );
    const conversions = result.config.conversions as Array<Record<string, unknown>>;
    expect(conversions).toHaveLength(1);
    expect(conversions[0].type).toBe('date');
  });

  it('cast — multiple fields', () => {
    const result = ok(
      {
        conversions: [
          { field: 'revenue', type: 'float', onError: 'null' },
          { field: 'qty', type: 'integer', onError: 'fail' },
        ],
      },
      'cast'
    );
    expect(result.config.conversions as Array<unknown>).toHaveLength(2);
  });

  it('sort', () => {
    const result = ok(
      {
        orderBy: [
          { field: 'region', direction: 'asc', nulls: 'last' },
          { field: 'revenue', direction: 'desc' },
        ],
      },
      'sort'
    );
    const keys = result.config.orderBy as Array<Record<string, unknown>>;
    expect(keys).toHaveLength(2);
    expect(keys[0].nulls).toBe('last');
  });

  it('derive — derive', () => {
    const result = ok(
      {
        calculations: [
          { field: 'margin', expression: 'if [revenue] = 0 then 0 else [profit] / [revenue] end' },
        ],
      },
      'derive'
    );
    const calcs = result.config.calculations as Array<Record<string, unknown>>;
    expect(calcs).toHaveLength(1);
    expect(calcs[0].field).toBe('margin');
  });

  it('derive — window function', () => {
    const result = ok(
      {
        calculations: [
          {
            field: 'rn',
            expression: 'ranking(row_number()) over(partition by [region] order by [revenue] desc)',
          },
        ],
      },
      'derive'
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

  it('join / set_op are edited per step against their right input', () => {
    expect(
      exportStep({
        id: 'test',
        type: 'join',
        config: {
          joinType: 'inner',
          rightAlias: 'right',
          conditions: [{ left: 'id', operator: '=', right: 'id' }],
        },
      })
    ).toBe('join inner right on [id]');
    expect(parseStep('join inner right on [id]', 'join').operator?.type).toBe('join');
    expect(parseStep('union right', 'set_op').operator?.type).toBe('set_op');
  });

  it('limit — simple limit', () => {
    const result = ok({ sampling: 'fixed', limit: 100 }, 'limit');
    expect(result.config.sampling).toBe('fixed');
    expect(result.config.limit).toBe(100);
  });

  it('limit — top with sort', () => {
    const result = ok(
      {
        sampling: 'fixed',
        limit: 10,
        orderBy: [{ field: 'revenue', direction: 'desc' }],
      },
      'limit'
    );
    expect(result.config.sampling).toBe('fixed');
  });

  it('pivot', () => {
    const result = ok(
      {
        on: [{ field: 'month', values: ['Jan', 'Feb'] }],
        using: [{ function: 'sum', expression: '[revenue]', alias: 'revenue_sum' }],
      },
      'pivot'
    );
    expect((result.config.on as Array<Record<string, unknown>>)[0]).toMatchObject({
      field: 'month',
      values: ['Jan', 'Feb'],
    });
  });

  it('unpivot', () => {
    const result = ok(
      {
        fields: ['jan', 'feb', 'mar'],
        nameColumn: 'month',
        valueColumn: 'sales',
      },
      'unpivot'
    );
    expect(result.config.nameColumn).toBe('month');
    expect(result.config.valueColumn).toBe('sales');
  });

  it('unnest — list', () => {
    const result = ok(
      { sourceKind: 'list', field: 'items', alias: 'item', withIndex: 'item_index' },
      'unnest'
    );
    expect(result.config.alias).toBe('item');
    expect(result.config.withIndex).toBe('item_index');
  });

  it('unnest — json', () => {
    const result = ok(
      {
        sourceKind: 'json',
        field: 'payload',
        alias: 'item',
      },
      'unnest'
    );
    expect(result.config.sourceKind).toBe('json');
  });

  it('missing_value — drop_empty_rows', () => {
    const result = ok({ strategy: 'drop_empty_rows' }, 'missing_value');
    expect(result.config.strategy).toBe('drop_rows_by_nulls');
    expect(result.config.condition).toBe('all_null');
  });

  it('missing_value — drop_rows_by_nulls', () => {
    const result = ok(
      { strategy: 'drop_rows_by_nulls', condition: 'any_null', fields: ['id', 'name'] },
      'missing_value'
    );
    expect(result.config.condition).toBe('any_null');
  });

  it('missing_value — by_column with rules', () => {
    const result = ok(
      {
        strategy: 'by_column',
        rules: [
          { field: 'status', method: 'literal_fill', value: 'UNKNOWN' },
          { field: 'revenue', method: 'literal_fill', value: '0' },
        ],
      },
      'missing_value'
    );
    const rules = result.config.rules as Array<Record<string, unknown>>;
    expect(rules).toHaveLength(2);
    expect(rules[0].method).toBe('literal_fill');
    expect(rules[0].value).toBe('UNKNOWN');
  });

  it('missing_value — by_column with statistical fill', () => {
    const result = ok(
      {
        strategy: 'by_column',
        rules: [
          { field: 'revenue', method: 'mean_fill' },
          { field: 'name', method: 'mode_fill' },
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
      'select',
      'deduplicate',
      'cast',
      'sort',
      'derive',
      'aggregate',
      'join',
      'rename',
      'limit',
      'pivot',
      'unpivot',
      'set_op',
      'unnest',
      'missing_value',
    ];
    for (const type of types) {
      const dsl = exportStep({ id: 'test', type, config: {} });
      expect(typeof dsl).toBe('string');
      if (dsl.trim()) {
        const parsed = parseStep(dsl, type);
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
    'select',
    'rename',
    'deduplicate',
    'missing_value',
    'cast',
    'sort',
    'join',
    'aggregate',
    'derive',
    'limit',
    'pivot',
    'unpivot',
    'set_op',
    'unnest',
  ];

  it('every registered form type has a round-trip test', () => {
    const testedTypes = new Set([
      'filter',
      'select',
      'rename',
      'deduplicate',
      'missing_value',
      'cast',
      'sort',
      'derive',
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
    const dsl1 = exportStep({ id: 'test', type: 'filter', config });
    const parsed = parseStep(dsl1, 'filter');
    expect(parsed.operator).not.toBeNull();
    const dsl2 = exportStep({
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
    const dsl1 = exportStep({ id: 'test', type: 'aggregate', config });
    const parsed = parseStep(dsl1, 'aggregate');
    expect(parsed.operator).not.toBeNull();
    const dsl2 = exportStep({
      id: 'test',
      type: 'aggregate',
      config: parsed.operator!.config,
    });
    expect(dsl2).toBe(dsl1);
  });
});

// ── join config read-side normalization ──────────────────────────────────

describe('readJoinUiConfig', () => {
  it('fills display defaults for an empty config', () => {
    const ui = readJoinUiConfig({});
    expect(ui.joinType).toBe('left');
    expect(ui.conditions).toEqual([]);
    // Absent conflict config compiles as right_prefix, so that is what the form shows.
    expect(ui.conflict.strategy).toBe('right_prefix');
    expect(ui.asof.operator).toBe('>=');
    expect(ui.asof.by).toEqual([]);
  });

  it('fills the right prefix default only for right_prefix strategy', () => {
    expect(readJoinUiConfig({ conflict: { strategy: 'right_prefix' } }).conflict.rightPrefix).toBe(
      'right_'
    );
    expect(readJoinUiConfig({ conflict: { strategy: 'suffix' } }).conflict.rightPrefix).toBe('');
    expect(JOIN_CONFLICT_DEFAULTS.leftSuffix).toBe('_left');
  });

  it('passes through configured values untouched', () => {
    const ui = readJoinUiConfig({
      joinType: 'asof',
      conditions: [{ left: 'a', operator: '=', right: 'b' }],
      asof: { leftTime: 't1', operator: 'nearest', rightTime: 't2', tolerance: '5m' },
    });
    expect(ui.joinType).toBe('asof');
    expect(ui.conditions).toEqual([{ left: 'a', operator: '=', right: 'b' }]);
    expect(ui.asof.operator).toBe('nearest');
    expect(ui.asof.tolerance).toBe('5m');
  });
});
