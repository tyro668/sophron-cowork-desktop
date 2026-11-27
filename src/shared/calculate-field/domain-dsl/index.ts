import { buildCalculationFunctionExpression } from '../sql-expression-builder';
import { buildCalculationFunctionDslExpression } from './formatter';
import { parseDomainExpression } from './parser';
import { tokenizeExpression } from '../../expression-tokenizer';
import { findMatchingParenToken, type DomainParseOptions } from './token-cursor';
import { isCalculationSceneDslId, type CalculationFunctionInput } from '../function-registry';

export { buildCalculationFunctionDslExpression };

export function parseCalculationFunctionDslExpression(
  expression: string
): CalculationFunctionInput | null {
  return parseDomainExpression(expression);
}

/**
 * Expands both standalone domain DSL expressions (e.g. `group(sum([x])) over(...)`)
 * and domain DSL calls embedded inside larger formulas (e.g. `[x] - group(avg([x]))`),
 * such as those created via the wizard's "insert at cursor" action.
 */
export function expandCalculationDomainExpression(
  expression: string,
  options: { allowLegacySql?: boolean } = {}
): string {
  const parseOptions: DomainParseOptions = {
    allowBareIdentifiers: true,
    allowLegacySql: options.allowLegacySql,
  };
  const parsed = parseDomainExpression(expression, parseOptions);
  if (parsed) return buildCalculationFunctionExpression(parsed);

  const tokens = tokenizeExpression(expression);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];
    if (
      token.type !== 'Ident' ||
      nextToken.type !== 'ParenOpen' ||
      !isCalculationSceneDslId(token.value.toLowerCase())
    ) {
      continue;
    }
    const closeToken = findMatchingParenToken(tokens, index + 1);
    if (!closeToken) {
      throw new Error(
        `Calculation scene '${token.value.toLowerCase()}' has an unclosed argument list`
      );
    }
    let endTokenIndex = tokens.indexOf(closeToken);
    let endOffset = closeToken.end;
    const maybeOver = tokens[endTokenIndex + 1];
    const maybeOverOpen = tokens[endTokenIndex + 2];
    if (
      maybeOver?.type === 'Ident' &&
      maybeOver.value.toLowerCase() === 'over' &&
      maybeOverOpen?.type === 'ParenOpen'
    ) {
      const overClose = findMatchingParenToken(tokens, endTokenIndex + 2);
      if (!overClose) {
        throw new Error(
          `Calculation scene '${token.value.toLowerCase()}' has an unclosed over(...) clause`
        );
      }
      endTokenIndex = tokens.indexOf(overClose);
      endOffset = overClose.end;
    }
    const slice = expression.slice(token.start, endOffset);
    const embedded = parseDomainExpression(slice, parseOptions);
    if (embedded) {
      replacements.push({
        start: token.start,
        end: endOffset,
        text: `(${buildCalculationFunctionExpression(embedded)})`,
      });
      index = endTokenIndex;
    }
  }

  if (replacements.length === 0) return expression;
  let expanded = expression;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, text } = replacements[i];
    expanded = expanded.slice(0, start) + text + expanded.slice(end);
  }
  return expanded;
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
