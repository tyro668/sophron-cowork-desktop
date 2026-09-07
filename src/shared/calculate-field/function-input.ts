import { validateExtraParameter } from './expression-format';
import {
  getCalculationFunction,
  getCalculationParameter,
  MAX_CALCULATION_WINDOW_SIZE,
  type CalculationFunctionDefinition,
  type CalculationFunctionInput,
} from './function-registry';

export const PERIOD_GRAINS = new Set(['year', 'quarter', 'month', 'week', 'day']);
export const INTERVAL_UNITS = new Set(['day', 'week', 'month', 'quarter', 'year']);
export const TIME_AGGREGATIONS = new Set(['sum', 'avg', 'count', 'min', 'max']);

export function validateCalculationFunctionInput(
  definition: CalculationFunctionDefinition,
  input: CalculationFunctionInput
): void {
  if (definition.order === 'required') {
    const orderFields = (input.orderBy ?? []).filter((entry) => entry.field.trim());
    if (orderFields.length === 0) {
      throw new Error(`Calculation function '${definition.id}' requires order fields`);
    }
  }
  if (definition.extraParameter) {
    validateExtraParameter(definition, input.extraParameter);
  }
  const rejectsFrame =
    definition.category === 'offset' ||
    definition.category === 'cumulative' ||
    definition.category === 'ranking' ||
    definition.category === 'group_metrics';
  if (input.frame && rejectsFrame) {
    throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
  }
  if (definition.category !== 'offset') return;

  const hasExtra = Boolean(input.extraParameter);
  if ((definition.id === 'first_value' || definition.id === 'last_value') && hasExtra) {
    throw new Error(`Calculation function '${definition.id}' does not accept an extra parameter`);
  }
  if (
    (definition.id === 'nth_value' ||
      definition.id === 'offset_difference' ||
      definition.id === 'offset_rate') &&
    !hasExtra
  ) {
    throw new Error(`Calculation function '${definition.id}' requires an extra parameter`);
  }
}

export function requiredParameter(input: CalculationFunctionInput, key: string): string {
  const value = input.parameters?.[key]?.trim();
  if (!value) throw new Error(`Calculation function '${input.functionId}' requires '${key}'`);
  return value;
}

export function parameterDefault(
  definition: CalculationFunctionDefinition,
  key: string,
  fallback: string
): string {
  return getCalculationParameter(definition, key)?.defaultValue ?? fallback;
}

export function parameterMax(functionId: string, key: string, fallback: number): number {
  const definition = getCalculationFunction(functionId);
  return definition ? (getCalculationParameter(definition, key)?.max ?? fallback) : fallback;
}

export function integerParameter(
  input: CalculationFunctionInput,
  key: string,
  fallback: string
): string {
  const definition = getCalculationFunction(input.functionId);
  const parameter = definition ? getCalculationParameter(definition, key) : undefined;
  const min = parameter?.min ?? 1;
  const max = parameter?.max ?? MAX_CALCULATION_WINDOW_SIZE;
  const raw = input.parameters?.[key]?.trim() || fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Calculation parameter '${key}' must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Calculation parameter '${key}' is outside its range`);
  }
  return String(value);
}

export function validateTimeAggregation(aggregation: string, value: string): void {
  if (aggregation === 'count_distinct') {
    if (value === '*') throw new Error("Time aggregation 'count_distinct' requires a value field");
    return;
  }
  if (!TIME_AGGREGATIONS.has(aggregation)) {
    throw new Error(`Unsupported time aggregation '${aggregation}'`);
  }
  if (value === '*' && aggregation !== 'count') {
    throw new Error(`Time aggregation '${aggregation}' does not accept '*'`);
  }
}
