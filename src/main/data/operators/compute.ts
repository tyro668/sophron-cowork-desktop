import { quoteValueIdentifier, unwrapFieldToken, unquoteDslString, literalToSql } from './utils';
import { tokenizeExpression } from '../../../shared/expression-tokenizer';

const DSL_KEYWORD_MAP: Record<string, string> = {
  if: 'CASE WHEN',
  then: 'THEN',
  else: 'ELSE',
  end: 'END',
};

const BLOCKED_KEYWORDS = new Set([
  'select',
  'delete',
  'update',
  'insert',
  'create',
  'drop',
  'alter',
  'truncate',
  'copy',
  'attach',
  'detach',
  'install',
  'load',
  'pragma',
  'call',
  'export',
  'import',
  'set',
  'grant',
  'revoke',
  'read_csv',
  'read_parquet',
  'read_json',
  'read_csv_auto',
  'read_parquet_auto',
  'read_json_auto',
  'values',
  'table',
  'glob',
  'query',
]);

function isBlockedIdentifier(value: string): boolean {
  return (
    BLOCKED_KEYWORDS.has(value) ||
    value.startsWith('read_') ||
    value.endsWith('_scan') ||
    value.endsWith('_attach')
  );
}

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
      const lower = token.value.toLowerCase();
      const mapped = DSL_KEYWORD_MAP[lower];
      if (mapped) {
        replacements.push([token.start, token.end, mapped]);
      } else if (isBlockedIdentifier(lower)) {
        throw new Error(`Unsupported SQL keyword '${token.value}' in expression`);
      }
    }
  }

  let result = expression;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [start, end, replacement] = replacements[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}
