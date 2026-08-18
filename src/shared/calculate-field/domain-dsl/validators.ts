import { parseFieldRefExact, toFieldName } from '../../prep-dsl/syntax/fields';
import { parseLiteral } from '../../prep-dsl/syntax/literals';
import {
  buildExtraParameter,
  getCalculationFunction,
  getCalculationParameter,
  MAX_CALCULATION_WINDOW_SIZE,
  type CalculationFunctionDefinition,
  type CalculationFunctionInput,
} from '../function-registry';

export const PERIOD_GRAINS = new Set(['year', 'quarter', 'month', 'week', 'day']);
export const INTERVAL_UNITS = new Set(['day', 'week', 'month', 'quarter', 'year']);
export const TIME_AGGREGATIONS = new Set(['sum', 'avg', 'count', 'min', 'max']);

function isIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}

export function validateDomainFunctionInput(
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
    buildExtraParameter(definition, input.extraParameter);
  }
  if (definition.category === 'offset') {
    if (input.frame) {
      throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
    }
    const hasExtra =
      input.extraParameter !== undefined &&
      input.extraParameter !== null &&
      input.extraParameter !== '';
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
  if (definition.category === 'cumulative' && input.frame) {
    throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
  }
  if (definition.category === 'ranking' && input.frame) {
    throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
  }
  if (definition.category === 'group_metrics' && input.frame) {
    throw new Error(`Calculation function '${definition.id}' does not allow a window frame`);
  }
}

export function requireArgumentCount(functionId: string, args: string[], expected: number): void {
  if (args.length !== expected) {
    throw new Error(`Calculation function '${functionId}' expects ${expected} arguments`);
  }
}

export function requireArgumentRange(
  functionId: string,
  args: string[],
  min: number,
  max: number
): void {
  if (args.length < min || args.length > max) {
    throw new Error(`Calculation function '${functionId}' expects ${min} to ${max} arguments`);
  }
}

export function requiredValue(functionId: string, value: string, position: number): string {
  if (!value.trim()) {
    throw new Error(`Calculation function '${functionId}' requires argument ${position}`);
  }
  return value.trim();
}

export function requiredField(functionId: string, value: string, position: number): string {
  const field = parseFieldRefExact(value);
  if (!field) {
    throw new Error(`Calculation function '${functionId}' argument ${position} must be a field`);
  }
  return toFieldName(field);
}

export function requiredString(functionId: string, value: string, position: number): string {
  if (!(value.startsWith('"') && value.endsWith('"'))) {
    throw new Error(
      `Calculation function '${functionId}' argument ${position} must be a double-quoted string`
    );
  }
  return String(parseLiteral(value));
}

export function positiveInteger(
  functionId: string,
  value: string,
  position: number,
  max: number
): string {
  if (!isIntegerString(value)) {
    throw new Error(`Calculation function '${functionId}' argument ${position} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(
      `Calculation function '${functionId}' argument ${position} is outside its range`
    );
  }
  return String(parsed);
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
  if (!isIntegerString(raw)) throw new Error(`Calculation parameter '${key}' must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Calculation parameter '${key}' is outside its range`);
  }
  return String(value);
}
