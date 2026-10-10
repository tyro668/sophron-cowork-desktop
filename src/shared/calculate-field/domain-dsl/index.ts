import { buildCalculationFunctionExpression } from '../sql-expression-builder';
import { buildCalculationFunctionDslExpression } from './formatter';
import { parseDomainExpression } from './parser';
import { tokenizeExpression } from '../../expression-tokenizer';
import type { DomainParseOptions } from './token-cursor';
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

export function normalizeCalculationDomainExpression(
  expression: string,
  options: DomainParseOptions = {}
): string {
  const parsed = parseDomainExpression(expression, options);
  const canonical = parsed ? buildCalculationFunctionDslExpression(parsed) : expression;
  // Change function identifiers only; field names and string literals are data.
  const tokens = tokenizeExpression(canonical);
  let normalized = canonical;
  for (let index = tokens.length - 2; index >= 0; index--) {
    const token = tokens[index];
    if (token.type === 'Ident' && tokens[index + 1].type === 'ParenOpen') {
      normalized =
        normalized.slice(0, token.start) + token.value.toLowerCase() + normalized.slice(token.end);
    }
  }
  return normalized;
}
