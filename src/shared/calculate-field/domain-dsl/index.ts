import { buildCalculationFunctionExpression } from '../sql-expression-builder';
import { buildCalculationFunctionDslExpression } from './formatter';
import { parseDomainExpression } from './parser';
import type { CalculationFunctionInput } from '../function-registry';

export { buildCalculationFunctionDslExpression };

export function parseCalculationFunctionDslExpression(
  expression: string
): CalculationFunctionInput | null {
  return parseDomainExpression(expression);
}

export function expandCalculationDomainExpression(
  expression: string,
  options: { allowLegacySql?: boolean } = {}
): string {
  const parsed = parseDomainExpression(expression, {
    allowBareIdentifiers: true,
    allowLegacySql: options.allowLegacySql,
  });
  return parsed ? buildCalculationFunctionExpression(parsed) : expression;
}

export function normalizeCalculationDomainExpression(expression: string): string {
  const parsed = parseDomainExpression(expression);
  return parsed ? buildCalculationFunctionDslExpression(parsed) : expression;
}
