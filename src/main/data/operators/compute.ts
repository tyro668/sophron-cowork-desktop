import { quoteValueIdentifier, unwrapFieldToken, unquoteDslString, literalToSql } from './utils';

const SQL_FIELD_REF_TOKEN_PATTERN =
  '(?:\\[`(?:[^`\\\\]|\\\\.)*`\\]|\\[[\\p{L}_][\\p{L}\\p{N}_]*\\])';
const SQL_SCALAR_TOKEN_PATTERN = new RegExp(
  `"(?:[^"\\\\]|\\\\.)*"|(${SQL_FIELD_REF_TOKEN_PATTERN})(?:\\.(${SQL_FIELD_REF_TOKEN_PATTERN}))?`,
  'gu'
);

export function compileScalarExpression(expression: string): string {
  return expression.replace(
    SQL_SCALAR_TOKEN_PATTERN,
    (match, first: string | undefined, second: string | undefined) => {
      if (match.startsWith('"')) {
        return literalToSql(unquoteDslString(match));
      }
      return quoteValueIdentifier(unwrapFieldToken(second ?? first ?? match));
    }
  );
}
