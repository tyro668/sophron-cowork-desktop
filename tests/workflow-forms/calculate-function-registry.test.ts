import { describe, expect, it } from 'vitest';
import {
  buildCalculationFunctionExpression,
  calculationFunctionsByCategory,
  CALCULATION_FUNCTION_CATEGORIES,
  usesTemporalCalculationRangeUnit,
} from '../../src/shared/calculate-field/function-registry';

describe('calculation function registry', () => {
  it('registers every first-phase function category', () => {
    expect(CALCULATION_FUNCTION_CATEGORIES).toEqual([
      'group_metrics',
      'ranking',
      'cumulative',
      'offset',
      'moving_window',
    ]);
    for (const category of CALCULATION_FUNCTION_CATEGORIES) {
      expect(calculationFunctionsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('uses the first range order field to determine whether to show time units', () => {
    const columnTypes = { date: 'date', amount: 'decimal' };
    expect(
      usesTemporalCalculationRangeUnit('range', [{ field: 'date', direction: 'asc' }], columnTypes)
    ).toBe(true);
    expect(
      usesTemporalCalculationRangeUnit(
        'range',
        [{ field: 'amount', direction: 'asc' }],
        columnTypes
      )
    ).toBe(false);
    expect(
      usesTemporalCalculationRangeUnit(
        'range',
        [
          { field: 'amount', direction: 'asc' },
          { field: 'date', direction: 'asc' },
        ],
        columnTypes
      )
    ).toBe(false);
    expect(
      usesTemporalCalculationRangeUnit(
        'range',
        [
          { field: 'date', direction: 'asc' },
          { field: 'amount', direction: 'asc' },
        ],
        columnTypes
      )
    ).toBe(true);
    expect(
      usesTemporalCalculationRangeUnit('rows', [{ field: 'date', direction: 'asc' }], columnTypes)
    ).toBe(false);
  });

  it('builds a grouped metric', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'sum',
        value: 'amount',
        partitionBy: ['region', 'category'],
      })
    ).toBe('sum([amount]) OVER (PARTITION BY [region], [category])');
  });

  it('builds count distinct and percentage expressions', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'count_distinct',
        value: 'customer',
        partitionBy: ['region'],
      })
    ).toBe('count(DISTINCT [customer]) OVER (PARTITION BY [region])');
    expect(
      buildCalculationFunctionExpression({
        functionId: 'percentage',
        value: 'amount',
        partitionBy: ['region'],
      })
    ).toBe('[amount] / sum([amount]) OVER (PARTITION BY [region])');
  });

  it('quotes string parameters as SQL string literals', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'string_agg',
        value: 'name',
        extraParameter: "it's, ",
        partitionBy: ['region'],
      })
    ).toBe("string_agg([name], 'it''s, ') OVER (PARTITION BY [region])");
  });

  it('does not apply stale order fields to unordered grouped metrics', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'sum',
        value: 'amount',
        partitionBy: ['region'],
        orderBy: [{ field: 'date', direction: 'desc' }],
      })
    ).toBe('sum([amount]) OVER (PARTITION BY [region])');
  });

  it('builds ranking with multiple sort fields', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'rank',
        partitionBy: ['region'],
        orderBy: [
          { field: 'amount', direction: 'desc' },
          { field: 'date', direction: 'asc' },
        ],
      })
    ).toBe('rank() OVER (PARTITION BY [region] ORDER BY [amount] desc, [date])');
  });

  it('uses and validates ranking parameters', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'ntile',
        extraParameter: '4',
        orderBy: [{ field: 'amount', direction: 'desc' }],
      })
    ).toBe('ntile(4) OVER (ORDER BY [amount] desc)');
    expect(() =>
      buildCalculationFunctionExpression({
        functionId: 'ntile',
        extraParameter: '0',
        orderBy: [{ field: 'amount', direction: 'asc' }],
      })
    ).toThrow(/outside its range/);
  });

  it('builds a cumulative calculation with a fixed frame', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'cumulative_sum',
        value: 'amount',
        partitionBy: ['region'],
        orderBy: [{ field: 'date', direction: 'asc' }],
      })
    ).toBe(
      'sum([amount]) OVER (PARTITION BY [region] ORDER BY [date] ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)'
    );
  });

  it('builds lag and offset rate calculations', () => {
    const input = {
      value: 'amount',
      extraParameter: '2',
      partitionBy: ['region'],
      orderBy: [{ field: 'date', direction: 'asc' as const }],
    };
    expect(buildCalculationFunctionExpression({ functionId: 'lag', ...input })).toBe(
      'lag([amount], 2) OVER (PARTITION BY [region] ORDER BY [date])'
    );
    expect(buildCalculationFunctionExpression({ functionId: 'offset_rate', ...input })).toBe(
      '([amount] - lag([amount], 2) OVER (PARTITION BY [region] ORDER BY [date])) / nullif(lag([amount], 2) OVER (PARTITION BY [region] ORDER BY [date]), 0)'
    );
  });

  it('builds a custom date range frame with exclusion', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'moving_avg',
        value: 'amount',
        partitionBy: ['region'],
        orderBy: [{ field: 'date', direction: 'asc' }],
        frame: {
          type: 'range',
          start: 'interval 7 day preceding',
          end: 'current row',
          exclude: 'current row',
        },
      })
    ).toBe(
      'avg([amount]) OVER (PARTITION BY [region] ORDER BY [date] RANGE BETWEEN INTERVAL 7 DAY PRECEDING AND CURRENT ROW EXCLUDE CURRENT ROW)'
    );
  });

  it('builds a numeric range offset without an interval unit', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'moving_sum',
        value: 'amount',
        orderBy: [{ field: 'amount', direction: 'asc' }],
        frame: {
          type: 'range',
          start: '100 preceding',
          end: 'current row',
        },
      })
    ).toBe('sum([amount]) OVER (ORDER BY [amount] RANGE BETWEEN 100 PRECEDING AND CURRENT ROW)');
  });

  it('rejects a range offset with multiple order fields', () => {
    expect(() =>
      buildCalculationFunctionExpression({
        functionId: 'moving_sum',
        value: 'amount',
        orderBy: [
          { field: 'date', direction: 'asc' },
          { field: 'id', direction: 'asc' },
        ],
        frame: {
          type: 'range',
          start: 'interval 7 day preceding',
          end: 'current row',
        },
      })
    ).toThrow(/exactly one order field/);
  });

  it('requires order fields for ordered calculations', () => {
    expect(() => buildCalculationFunctionExpression({ functionId: 'row_number' })).toThrow(
      /requires order fields/
    );
  });

  it('rejects an invalid custom frame instead of substituting an offset', () => {
    expect(() =>
      buildCalculationFunctionExpression({
        functionId: 'moving_avg',
        value: 'amount',
        orderBy: [{ field: 'date', direction: 'asc' }],
        frame: {
          type: 'rows',
          start: ' preceding',
          end: 'current row',
        },
      })
    ).toThrow(/invalid window frame bound/);
  });

  it('rejects a window frame whose start is after its end', () => {
    expect(() =>
      buildCalculationFunctionExpression({
        functionId: 'moving_sum',
        value: 'amount',
        orderBy: [{ field: 'id', direction: 'asc' }],
        frame: {
          type: 'rows',
          start: '1 following',
          end: 'current row',
        },
      })
    ).toThrow(/start must not be after its end/);
  });

  it('accepts preceding bounds in chronological order', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'moving_sum',
        value: 'amount',
        orderBy: [{ field: 'id', direction: 'asc' }],
        frame: {
          type: 'rows',
          start: '5 preceding',
          end: '1 preceding',
        },
      })
    ).toBe('sum([amount]) OVER (ORDER BY [id] ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING)');
  });
});
