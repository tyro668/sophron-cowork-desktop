import { quoteValueIdentifier, unwrapFieldToken, unquoteDslString, literalToSql } from './utils';
import { tokenizeExpression } from '../../../shared/expression-tokenizer';

const DSL_KEYWORD_SQL = new Map([
  ['if', 'CASE WHEN'],
  ['then', 'THEN'],
  ['else', 'ELSE'],
  ['end', 'END'],
]);

export function compileScalarExpression(expression: string): string {
  const tokens = tokenizeExpression(expression);
  const replacements: Array<[number, number, string]> = [];

  for (const token of tokens) {
    if (token.type === 'EOF') break;
    if (token.type === 'FieldRef') {
      replacements.push([
        token.start,
        token.end,
        quoteValueIdentifier(unwrapFieldToken(token.value)),
      ]);
    } else if (token.type === 'StringLiteral') {
      replacements.push([token.start, token.end, literalToSql(unquoteDslString(token.value))]);
    } else if (token.type === 'Ident') {
      const keyword = DSL_KEYWORD_SQL.get(token.value.toLowerCase());
      if (keyword) replacements.push([token.start, token.end, keyword]);
    }
  }

  let result = expression;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [start, end, replacement] = replacements[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}
