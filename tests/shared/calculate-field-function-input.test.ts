import { describe, expect, it } from 'vitest';
import {
  integerParameter,
  INTERVAL_UNITS,
  PERIOD_GRAINS,
  requiredParameter,
  validateCalculationFunctionInput,
  validateTimeAggregation,
} from '../../src/shared/calculate-field/function-input';
import {
  getCalculationFunction,
  type CalculationFunctionInput,
} from '../../src/shared/calculate-field/function-registry';

function validate(input: CalculationFunctionInput): void {
  const definition = getCalculationFunction(input.functionId);
  if (!definition) throw new Error(`Missing test definition '${input.functionId}'`);
  validateCalculationFunctionInput(definition, input);
}

describe('calculate field function input', () => {
  it('requires an order field for ordered functions', () => {
    expect(() => validate({ functionId: 'cumulative_sum', value: 'amount' })).toThrow(
      /requires order fields/
    );
    expect(() =>
      validate({
        functionId: 'cumulative_sum',
        value: 'amount',
        orderBy: [{ field: 'date', direction: 'asc' }],
      })
    ).not.toThrow();
  });

  it('rejects frames for functions that do not accept custom frames', () => {
    expect(() =>
      validate({
        functionId: 'rank',
        orderBy: [{ field: 'amount', direction: 'desc' }],
        frame: { type: 'rows', start: '1 preceding', end: 'current row' },
      })
    ).toThrow(/does not allow a window frame/);
  });

  it('enforces offset-specific extra parameter rules', () => {
    const orderBy = [{ field: 'date', direction: 'asc' as const }];
    expect(() =>
      validate({ functionId: 'first_value', value: 'amount', extraParameter: '2', orderBy })
    ).toThrow(/does not accept an extra parameter/);
    expect(() => validate({ functionId: 'offset_difference', value: 'amount', orderBy })).toThrow(
      /requires an extra parameter/
    );
  });

  it('validates numeric extra parameters without affecting text parameters', () => {
    const orderBy = [{ field: 'date', direction: 'asc' as const }];

    expect(() =>
      validate({ functionId: 'lag', value: 'amount', extraParameter: 'invalid', orderBy })
    ).toThrow(/numeric parameter/);
    expect(() =>
      validate({ functionId: 'quantile_cont', value: 'amount', extraParameter: '1.1' })
    ).toThrow(/outside its range/);
    expect(() =>
      validate({ functionId: 'string_agg', value: 'name', extraParameter: ', ' })
    ).not.toThrow();
  });

  it('uses registry bounds for integer parameters', () => {
    const input: CalculationFunctionInput = {
      functionId: 'rolling_time',
      parameters: { windowSize: '1' },
    };
    expect(integerParameter(input, 'windowSize', '7')).toBe('1');
    expect(() =>
      integerParameter({ ...input, parameters: { windowSize: '0' } }, 'windowSize', '7')
    ).toThrow(/outside its range/);
    expect(() =>
      integerParameter({ ...input, parameters: { windowSize: '1.5' } }, 'windowSize', '7')
    ).toThrow(/must be an integer/);
  });

  it('requires named parameters instead of inventing defaults', () => {
    expect(() => requiredParameter({ functionId: 'year_to_date' }, 'dateField')).toThrow(
      /requires 'dateField'/
    );
    expect(
      requiredParameter(
        { functionId: 'year_to_date', parameters: { dateField: ' order_date ' } },
        'dateField'
      )
    ).toBe('order_date');
  });

  it('validates time aggregation field compatibility', () => {
    expect(() => validateTimeAggregation('count', '*')).not.toThrow();
    expect(() => validateTimeAggregation('sum', '*')).toThrow(/does not accept '\*'/);
    expect(() => validateTimeAggregation('count_distinct', '*')).toThrow(/requires a value field/);
    expect(() => validateTimeAggregation('unknown', 'amount')).toThrow(/Unsupported/);
  });

  it('exposes the supported period grains and interval units', () => {
    expect([...PERIOD_GRAINS]).toEqual(['year', 'quarter', 'month', 'week', 'day']);
    expect([...INTERVAL_UNITS]).toEqual(['day', 'week', 'month', 'quarter', 'year']);
  });
});
