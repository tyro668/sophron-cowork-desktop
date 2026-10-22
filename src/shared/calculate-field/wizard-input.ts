import { parseFieldRefExact, toFieldName } from '../expression-syntax/fields';
import { parseCalculationFunctionDslExpression } from './domain-dsl';
import { validateCalculationFunctionInput } from './function-input';
import { getCalculationFunction, type CalculationFunctionInput } from './function-registry';

export function parseCalculationFunctionWizardInput(
  expression: string
): CalculationFunctionInput | undefined {
  if (!expression.trim()) return undefined;
  try {
    const input = parseCalculationFunctionDslExpression(expression);
    if (!input) return undefined;
    const definition = getCalculationFunction(input.functionId);
    if (!definition) return undefined;
    validateCalculationFunctionInput(definition, input);
    const value = input.value?.trim();
    if (!value || value === '*') return input;
    const field = parseFieldRefExact(value);
    if (!field) return undefined;
    return { ...input, value: toFieldName(field), valueIsExpression: false };
  } catch {
    return undefined;
  }
}
