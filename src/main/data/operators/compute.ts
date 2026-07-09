import { quoteValueIdentifier, unwrapFieldToken, unquoteDslString, literalToSql } from './utils';
import { tokenizeExpression } from '../../../shared/expression-tokenizer';

function transformDslKeywords(expr: string): string {
  const refs: string[] = [];
  const masked = expr.replace(/\[[^\]]*\]/g, (m) => {
    refs.push(m);
    return '@@' + String(refs.length - 1) + '@@';
  });
  const transformed = masked
    .replace(/\bif\b/gi, 'CASE WHEN')
    .replace(/\bthen\b/gi, 'THEN')
    .replace(/\belse\b/gi, 'ELSE')
    .replace(/\bend\b/gi, 'END');
  return transformed.replace(/@@(\d+)@@/g, (_, i) => refs[Number(i)]);
}

export function compileScalarExpression(expression: string): string {
  const sqlExpr = transformDslKeywords(expression);
  const tokens = tokenizeExpression(sqlExpr);
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
    }
  }

  let result = sqlExpr;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [start, end, replacement] = replacements[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}
