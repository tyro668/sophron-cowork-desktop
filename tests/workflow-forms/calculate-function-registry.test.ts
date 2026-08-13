import { describe, expect, it } from 'vitest';
import {
  buildCalculationFunctionExpression,
  calculationFunctionsByCategory,
  CALCULATION_FUNCTION_CATEGORIES,
  usesTemporalCalculationRangeUnit,
} from '../../src/shared/calculate-field/function-registry';
import {
  buildCalculationFunctionDslExpression,
  normalizeCalculationDomainExpression,
} from '../../src/shared/calculate-field/domain-dsl';

describe('calculation function registry', () => {
  it('registers every first-phase function category', () => {
    expect(CALCULATION_FUNCTION_CATEGORIES).toEqual([
      'group_metrics',
      'ranking',
      'cumulative',
      'offset',
      'moving_window',
      'period_compare',
      'time_intelligence',
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

  it('builds previous-row value, difference, and rate expressions', () => {
    const input = {
      value: 'sales',
      partitionBy: ['region'],
      parameters: { dateField: 'date' },
    };
    expect(buildCalculationFunctionExpression({ functionId: 'previous_value', ...input })).toBe(
      'lag([sales]) OVER (PARTITION BY [region] ORDER BY [date])'
    );
    expect(
      buildCalculationFunctionExpression({ functionId: 'previous_difference', ...input })
    ).toBe('[sales] - (lag([sales]) OVER (PARTITION BY [region] ORDER BY [date]))');
    expect(buildCalculationFunctionExpression({ functionId: 'previous_rate', ...input })).toBe(
      '([sales] - (lag([sales]) OVER (PARTITION BY [region] ORDER BY [date]))) / nullif((lag([sales]) OVER (PARTITION BY [region] ORDER BY [date])), 0)'
    );
  });

  it('builds a strict year-over-year expression that returns null for a missing year', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'year_over_year_value',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', granularity: 'month' },
      })
    ).toContain("CASE WHEN (extract('year' FROM [date]) - lag(extract('year' FROM [date]))");
    expect(
      buildCalculationFunctionExpression({
        functionId: 'year_over_year_value',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', granularity: 'month' },
      })
    ).toContain('= 1 THEN lag([sales])');
    expect(
      buildCalculationFunctionExpression({
        functionId: 'year_over_year_value',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', granularity: 'month' },
      })
    ).toContain('ELSE NULL END');
  });

  it('builds current-row time accumulation and rolling-time expressions', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'year_to_date',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', aggregation: 'sum', fiscalStartMonth: '1' },
      })
    ).toBe(
      "sum([sales]) OVER (PARTITION BY extract('year' FROM [date]), [region] ORDER BY [date] ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)"
    );
    expect(
      buildCalculationFunctionExpression({
        functionId: 'rolling_time',
        value: 'sales',
        partitionBy: ['region'],
        parameters: {
          dateField: 'date',
          aggregation: 'avg',
          windowSize: '7',
          intervalUnit: 'day',
        },
      })
    ).toBe(
      'avg([sales]) OVER (PARTITION BY [region] ORDER BY [date] RANGE BETWEEN INTERVAL 7 DAY PRECEDING AND CURRENT ROW)'
    );
  });

  it('builds canonical domain DSL for period comparison and time accumulation', () => {
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'year_over_year_value',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', granularity: 'month' },
      })
    ).toBe('year_over_year_value([sales], [date], "month") over(partition by [region])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'year_to_date',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', aggregation: 'sum', fiscalStartMonth: '4' },
      })
    ).toBe('year_to_date(sum([sales]), [date], 4) over(partition by [region])');
  });

  it('normalizes domain DSL spacing', () => {
    expect(
      normalizeCalculationDomainExpression(
        'year_over_year_value( [sales] , [date] , "month" ) over( partition by [region] )'
      )
    ).toBe('year_over_year_value([sales], [date], "month") over(partition by [region])');
  });

  it('week_to_date partitions by ISO year so the year boundary does not split a week', () => {
    expect(
      buildCalculationFunctionExpression({
        functionId: 'week_to_date',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', aggregation: 'sum' },
      })
    ).toBe(
      "sum([sales]) OVER (PARTITION BY extract('isoyear' FROM [date]), extract('week' FROM [date]), [region] ORDER BY [date] ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)"
    );
  });

  it('week grain year_over_year orders and guards by ISO year', () => {
    const expression = buildCalculationFunctionExpression({
      functionId: 'year_over_year_value',
      value: 'sales',
      partitionBy: ['region'],
      parameters: { dateField: 'date', granularity: 'week' },
    });

    expect(expression).toContain("extract('isoyear' FROM [date])");
    expect(expression).not.toContain("extract('year' FROM [date])");
    expect(expression).toContain("extract('week' FROM [date])");
  });

  it('month grain year_over_year keeps the calendar year', () => {
    const expression = buildCalculationFunctionExpression({
      functionId: 'year_over_year_value',
      value: 'sales',
      partitionBy: ['region'],
      parameters: { dateField: 'date', granularity: 'month' },
    });

    expect(expression).toContain("extract('year' FROM [date])");
    expect(expression).not.toContain('isoyear');
  });
});
