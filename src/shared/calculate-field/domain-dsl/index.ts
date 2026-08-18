import { buildCalculationFunctionExpression } from '../function-registry';
import { buildCalculationFunctionDslExpression } from './formatter';
import { parseDomainExpression } from './parser';

export { buildCalculationFunctionDslExpression };

export function expandCalculationDomainExpression(expression: string): string {
  const parsed = parseDomainExpression(expression, {
    allowBareIdentifiers: true,
  });
  return parsed ? buildCalculationFunctionExpression(parsed) : expression;
}

export function normalizeCalculationDomainExpression(expression: string): string {
  const parsed = parseDomainExpression(expression);
  return parsed ? buildCalculationFunctionDslExpression(parsed) : expression;
}
