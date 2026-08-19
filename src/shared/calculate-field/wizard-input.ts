import { parseFieldRefExact, toFieldName } from '../prep-dsl/syntax/fields';
import { parseCalculationFunctionDslExpression } from './domain-dsl';
import type { CalculationFunctionInput } from './function-registry';

export function parseCalculationFunctionWizardInput(
  expression: string
): CalculationFunctionInput | undefined {
  if (!expression.trim()) return undefined;
  try {
    const input = parseCalculationFunctionDslExpression(expression);
    if (!input) return undefined;
    const value = input.value?.trim();
    if (!value || value === '*') return input;
    const field = parseFieldRefExact(value);
    if (!field) return undefined;
    return { ...input, value: toFieldName(field), valueIsExpression: false };
  } catch {
    return undefined;
  }
}
