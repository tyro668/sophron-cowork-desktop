import type { CalculationFunctionDefinition } from './function-registry';
import { formatCalculationStringLiteral } from './string-literal';

export function buildExtraParameter(
  definition: CalculationFunctionDefinition,
  rawValue: string | undefined
): string {
  const parameter = definition.extraParameter;
  if (!parameter) return '';
  if (parameter.kind === 'text') {
    const value = rawValue === undefined || rawValue === '' ? parameter.defaultValue : rawValue;
    return formatCalculationStringLiteral(value);
  }
  return normalizeNumericExtraParameter(definition, rawValue);
}

export function validateExtraParameter(
  definition: CalculationFunctionDefinition,
  rawValue: string | undefined
): void {
  if (!definition.extraParameter || definition.extraParameter.kind === 'text') return;
  normalizeNumericExtraParameter(definition, rawValue);
}

function normalizeNumericExtraParameter(
  definition: CalculationFunctionDefinition,
  rawValue: string | undefined
): string {
  const parameter = definition.extraParameter;
  if (!parameter || parameter.kind === 'text') return '';
  const value = rawValue?.trim() || parameter.defaultValue;
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Calculation function '${definition.id}' requires a numeric parameter`);
  }
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    (parameter.kind === 'integer' && !Number.isSafeInteger(parsed)) ||
    (parameter.min !== undefined && parsed < parameter.min) ||
    (parameter.max !== undefined && parsed > parameter.max)
  ) {
    throw new Error(`Calculation function '${definition.id}' parameter is outside its range`);
  }
  return String(parsed);
}

export function formatCalculationField(value: string): string {
  const field = value.replace(/^\[|\]$/g, '');
  if (!/[\]`\\]/.test(field)) return `[${field}]`;
  const escaped = field.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return '[`' + escaped + '`]';
}
