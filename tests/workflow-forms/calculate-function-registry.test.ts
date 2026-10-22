import { describe, expect, it } from 'vitest';
import { buildCalculationFunctionExpression } from '../../src/shared/calculate-field/sql-expression-builder';
import {
  calculationSceneDslId,
  calculationFunctionsByCategory,
  CALCULATION_FUNCTION_CATEGORIES,
  getCalculationFunctionBySceneOperation,
  isCalculationSceneDslId,
  usesTemporalCalculationRangeUnit,
} from '../../src/shared/calculate-field/function-registry';
import {
  buildCalculationFunctionDslExpression,
  normalizeCalculationDomainExpression,
} from '../../src/shared/calculate-field/domain-dsl';
import { parseCalculationFunctionWizardInput } from '../../src/shared/calculate-field/wizard-input';

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

  it('resolves operations within their calculation scene', () => {
    expect(getCalculationFunctionBySceneOperation('group', 'sum')?.id).toBe('sum');
    expect(getCalculationFunctionBySceneOperation('running', 'sum')?.id).toBe('cumulative_sum');
    expect(getCalculationFunctionBySceneOperation('ranking', 'rank')?.id).toBe('rank');
    expect(getCalculationFunctionBySceneOperation('reference', 'lag')?.id).toBe('lag');
    expect(getCalculationFunctionBySceneOperation('group', 'group_sum')).toBeUndefined();
    expect(getCalculationFunctionBySceneOperation('group', 'no_such_fn')).toBeUndefined();
  });

  it('derives the supported scene ids from the category registry', () => {
    const scenes = CALCULATION_FUNCTION_CATEGORIES.map(calculationSceneDslId);
    expect(scenes).toEqual([
      'group',
      'ranking',
      'running',
      'reference',
      'moving',
      'compare',
      'accumulate',
    ]);
    expect(scenes.every(isCalculationSceneDslId)).toBe(true);
    expect(isCalculationSceneDslId('unknown')).toBe(false);
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

  it('builds ranking domain DSL', () => {
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'rank',
        partitionBy: ['region'],
        orderBy: [
          { field: 'amount', direction: 'desc' },
          { field: 'date', direction: 'asc' },
        ],
      })
    ).toBe('ranking(rank()) over(partition by [region] order by [amount] desc, [date])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'ntile',
        extraParameter: '4',
        orderBy: [{ field: 'amount', direction: 'desc' }],
      })
    ).toBe('ranking(ntile(4)) over(order by [amount] desc)');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'row_number',
        orderBy: [{ field: 'id', direction: 'asc' }],
      })
    ).toBe('ranking(row_number()) over(order by [id])');
    expect(
      ['dense_rank', 'percent_rank', 'cume_dist'].map((functionId) =>
        buildCalculationFunctionDslExpression({
          functionId,
          orderBy: [{ field: 'amount', direction: 'asc' }],
        })
      )
    ).toEqual([
      'ranking(dense_rank()) over(order by [amount])',
      'ranking(percent_rank()) over(order by [amount])',
      'ranking(cume_dist()) over(order by [amount])',
    ]);
  });

  it('applies the default bucket count when ntile omits the parameter', () => {
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'ntile',
        orderBy: [{ field: 'amount', direction: 'desc' }],
      })
    ).toBe('ranking(ntile(2)) over(order by [amount] desc)');
  });

  it('parses and normalizes ranking domain DSL', () => {
    expect(
      normalizeCalculationDomainExpression(
        'ranking(rank()) over(partition by [region] order by [amount] desc, [date])'
      )
    ).toBe('ranking(rank()) over(partition by [region] order by [amount] desc, [date])');
    expect(
      normalizeCalculationDomainExpression('ranking(ntile(4)) over(order by [amount] desc)')
    ).toBe('ranking(ntile(4)) over(order by [amount] desc)');
  });

  it('rejects unterminated over clauses in direct and wizard parsing', () => {
    const partitionExpression = 'group(sum([amount])) over(partition by [region]';
    const orderedExpression = 'ranking(rank()) over(order by [amount]';
    const framedExpression =
      'moving(avg([amount])) over(order by [date] rows between 1 preceding and current row';

    expect(() => normalizeCalculationDomainExpression(partitionExpression)).toThrow(
      /closing parenthesis/
    );
    expect(() => normalizeCalculationDomainExpression(orderedExpression)).toThrow(
      /closing parenthesis/
    );
    expect(() => normalizeCalculationDomainExpression(framedExpression)).toThrow(
      /closing parenthesis/
    );
    expect(parseCalculationFunctionWizardInput(partitionExpression)).toBeUndefined();
    expect(parseCalculationFunctionWizardInput(orderedExpression)).toBeUndefined();
    expect(parseCalculationFunctionWizardInput(framedExpression)).toBeUndefined();
  });

  it('rejects invalid domain parameters before restoring graphical configuration', () => {
    expect(
      parseCalculationFunctionWizardInput('group(quantile_cont([amount], 3))')
    ).toBeUndefined();
    expect(
      parseCalculationFunctionWizardInput('group(quantile_cont([amount], 0.5))')
    ).toMatchObject({ functionId: 'quantile_cont', value: 'amount', extraParameter: '0.5' });
  });

  it('rejects ranking without order, with a frame, or with a bad bucket count', () => {
    expect(() =>
      normalizeCalculationDomainExpression('ranking(rank()) over(partition by [region])')
    ).toThrow(/order by|order fields/);
    expect(() =>
      normalizeCalculationDomainExpression(
        'ranking(rank()) over(order by [amount] rows between 1 preceding and current row)'
      )
    ).toThrow(/does not allow a window frame/);
    expect(() =>
      normalizeCalculationDomainExpression('ranking(ntile()) over(order by [amount])')
    ).toThrow(/expects 1 arguments/);
    expect(() =>
      normalizeCalculationDomainExpression('ranking(ntile(0)) over(order by [amount])')
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
      'lag([amount], 2) OVER (PARTITION BY [region] ORDER BY [date] ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)'
    );
    expect(buildCalculationFunctionExpression({ functionId: 'offset_rate', ...input })).toBe(
      '([amount] - lag([amount], 2) OVER (PARTITION BY [region] ORDER BY [date] ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)) / nullif(lag([amount], 2) OVER (PARTITION BY [region] ORDER BY [date] ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING), 0)'
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
    ).toThrow(/invalid window frame bound/i);
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
    ).toBe(
      `compare(same_period_last_year([sales], [date], 'month', 'value')) over(partition by [region])`
    );
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'year_to_date',
        value: 'sales',
        partitionBy: ['region'],
        parameters: { dateField: 'date', aggregation: 'sum', fiscalStartMonth: '4' },
      })
    ).toBe('accumulate(year_to_date(sum([sales]), [date], 4)) over(partition by [region])');
  });

  it('normalizes domain DSL spacing', () => {
    expect(
      normalizeCalculationDomainExpression(
        `compare( same_period_last_year( [sales] , [date] , 'month' , 'value' ) ) over( partition by [region] )`
      )
    ).toBe(
      `compare(same_period_last_year([sales], [date], 'month', 'value')) over(partition by [region])`
    );
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

  it('builds offset domain DSL with partition and order', () => {
    const orderBy = [{ field: 'date', direction: 'asc' as const }];
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'lag',
        value: 'sales',
        partitionBy: ['region'],
        orderBy,
      })
    ).toBe('reference(lag([sales])) over(partition by [region] order by [date])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'lead',
        value: 'sales',
        extraParameter: '2',
        partitionBy: ['region'],
        orderBy,
      })
    ).toBe('reference(lead([sales], 2)) over(partition by [region] order by [date])');
  });

  it('builds offset_difference and offset_rate domain DSL', () => {
    const orderBy = [
      { field: 'amount', direction: 'desc' as const },
      { field: 'date', direction: 'asc' as const },
    ];
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'offset_difference',
        value: 'sales',
        extraParameter: '2',
        partitionBy: ['region'],
        orderBy,
      })
    ).toBe(
      'reference(offset_difference([sales], 2)) over(partition by [region] order by [amount] desc, [date])'
    );
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'offset_rate',
        value: 'sales',
        extraParameter: '2',
        partitionBy: ['region'],
        orderBy,
      })
    ).toBe(
      'reference(offset_rate([sales], 2)) over(partition by [region] order by [amount] desc, [date])'
    );
  });

  it('builds first_value, last_value and nth_value domain DSL', () => {
    const orderBy = [{ field: 'date', direction: 'asc' as const }];
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'first_value',
        value: 'sales',
        orderBy,
      })
    ).toBe('reference(first_value([sales])) over(order by [date])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'last_value',
        value: 'sales',
        partitionBy: ['region'],
        orderBy,
      })
    ).toBe('reference(last_value([sales])) over(partition by [region] order by [date])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'nth_value',
        value: 'sales',
        extraParameter: '3',
        orderBy,
      })
    ).toBe('reference(nth_value([sales], 3)) over(order by [date])');
  });

  it('parses offset domain DSL back into a structured input', () => {
    const parsed = normalizeCalculationDomainExpression(
      'reference(offset_difference([sales], 2)) over(partition by [region] order by [amount] desc, [date])'
    );
    expect(parsed).toBe(
      'reference(offset_difference([sales], 2)) over(partition by [region] order by [amount] desc, [date])'
    );
  });

  it('expands offset domain DSL to SQL with full partition frame', () => {
    const input = {
      functionId: 'last_value' as const,
      value: '[sales]',
      valueIsExpression: true,
      partitionBy: ['region'],
      orderBy: [{ field: 'date', direction: 'asc' as const }],
    };
    expect(buildCalculationFunctionExpression(input)).toBe(
      'last_value([sales]) OVER (PARTITION BY [region] ORDER BY [date] ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)'
    );
  });

  it('builds canonical group metric domain DSL', () => {
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'sum',
        value: 'amount',
        partitionBy: ['region'],
      })
    ).toBe('group(sum([amount])) over(partition by [region])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'count',
        value: '*',
        partitionBy: ['region'],
      })
    ).toBe('group(count(*)) over(partition by [region])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'quantile_cont',
        value: 'amount',
        extraParameter: '0.5',
        partitionBy: ['region'],
      })
    ).toBe('group(quantile_cont([amount], 0.5)) over(partition by [region])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'string_agg',
        value: 'name',
        extraParameter: ', ',
        partitionBy: ['region'],
      })
    ).toBe(`group(string_agg([name], ', ')) over(partition by [region])`);
    expect(
      ['var', 'bool_and', 'bool_or', 'count_distinct'].map((functionId) =>
        buildCalculationFunctionDslExpression({
          functionId,
          value: 'amount',
          partitionBy: ['region'],
        })
      )
    ).toEqual([
      'group(var_pop([amount])) over(partition by [region])',
      'group(bool_and([amount])) over(partition by [region])',
      'group(bool_or([amount])) over(partition by [region])',
      'group(count_distinct([amount])) over(partition by [region])',
    ]);
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'percentage',
        value: 'amount',
        partitionBy: ['region'],
      })
    ).toBe('group(percent_of_total([amount])) over(partition by [region])');
  });

  it('builds canonical cumulative and moving window domain DSL', () => {
    const orderBy = [{ field: 'date', direction: 'asc' as const }];
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'cumulative_sum',
        value: 'amount',
        partitionBy: ['region'],
        orderBy,
      })
    ).toBe('running(sum([amount])) over(partition by [region] order by [date])');
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'moving_avg',
        value: 'amount',
        partitionBy: ['region'],
        orderBy,
        frame: {
          type: 'rows',
          start: '1 preceding',
          end: 'current row',
        },
      })
    ).toBe(
      'moving(avg([amount])) over(partition by [region] order by [date] rows between 1 preceding and current row)'
    );
  });

  it('parses and normalizes group, cumulative and moving domain DSL', () => {
    expect(
      normalizeCalculationDomainExpression('group(sum( [amount] )) over( partition by [region] )')
    ).toBe('group(sum([amount])) over(partition by [region])');
    expect(
      normalizeCalculationDomainExpression(
        'running(sum([amount])) over(partition by [region] order by [date])'
      )
    ).toBe('running(sum([amount])) over(partition by [region] order by [date])');
    expect(
      normalizeCalculationDomainExpression(
        'moving(avg([amount])) over(partition by [region] order by [date] rows between 1 preceding and current row)'
      )
    ).toBe(
      'moving(avg([amount])) over(partition by [region] order by [date] rows between 1 preceding and current row)'
    );
  });

  it('rejects cumulative with a frame and moving without a frame', () => {
    expect(() =>
      normalizeCalculationDomainExpression(
        'running(sum([amount])) over(order by [date] rows between 1 preceding and current row)'
      )
    ).toThrow(/does not allow a window frame/);
    expect(() =>
      normalizeCalculationDomainExpression('moving(avg([amount])) over(order by [date])')
    ).toThrow(/requires a window frame/);
  });

  it('preserves text parameters such as string_agg delimiters', () => {
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'string_agg',
        value: 'name',
        extraParameter: ', ',
        partitionBy: ['region'],
      })
    ).toBe(`group(string_agg([name], ', ')) over(partition by [region])`);
    expect(
      buildCalculationFunctionDslExpression({
        functionId: 'string_agg',
        value: 'name',
        extraParameter: ' ',
      })
    ).toBe(`group(string_agg([name], ' '))`);
  });

  it('rejects explicit window frames on offset and parses them directly without silent drop', () => {
    expect(() =>
      normalizeCalculationDomainExpression(
        'reference(lag([sales])) over(order by [date] rows between 1 preceding and current row)'
      )
    ).toThrow(/does not allow a window frame/);
    expect(() =>
      normalizeCalculationDomainExpression(
        'reference(offset_difference([sales], 2)) over(order by [date] rows between 1 preceding and current row)'
      )
    ).toThrow(/does not allow a window frame/);
  });

  it('rejects bare identifiers in over order by', () => {
    expect(() =>
      normalizeCalculationDomainExpression('moving(avg([sales])) over(order by date)')
    ).toThrow(/field references/);
  });

  it('rejects an explicit window frame on group metrics', () => {
    expect(() =>
      buildCalculationFunctionDslExpression({
        functionId: 'sum',
        value: 'amount',
        partitionBy: ['region'],
        frame: { type: 'rows', start: '1 preceding', end: 'current row' },
      })
    ).toThrow(/does not allow a window frame/);
  });

  it('rejects same-category frame bounds whose start is after end', () => {
    expect(() =>
      normalizeCalculationDomainExpression(
        'moving(avg([sales])) over(order by [date] rows between 2 preceding and 10 preceding)'
      )
    ).toThrow(/Invalid window frame order|invalid window frame/i);
    expect(() =>
      normalizeCalculationDomainExpression(
        'moving(avg([sales])) over(order by [date] rows between 10 following and 2 following)'
      )
    ).toThrow(/Invalid window frame order|invalid window frame/i);
  });

  it('parses frame directly from the token cursor without regex fallback', () => {
    expect(
      normalizeCalculationDomainExpression(
        `moving(avg([sales])) over(order by [date] range between interval 7 'day' preceding and current row)`
      )
    ).toBe(
      `moving(avg([sales])) over(order by [date] range between interval 7 'day' preceding and current row)`
    );
  });

  it('rejects unquoted interval units in frame bounds', () => {
    expect(() =>
      normalizeCalculationDomainExpression(
        'moving(avg([sales])) over(order by [date] range between interval 7 day preceding and current row)'
      )
    ).toThrow(/interval frame unit/i);
  });
});
