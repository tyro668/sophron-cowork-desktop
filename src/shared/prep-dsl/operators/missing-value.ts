import type { PrepDiagnostic } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { formatLiteral, parseLiteral } from '../syntax/literals';
import { splitTopLevel } from '../syntax/scanner';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';

export const missingValueCodec: OperatorDslCodec = {
  type: 'missing_value',
  matches: (text) => text.startsWith('missing value '),
  parse: (command, diagnostics) => {
    const body = command.text.slice('missing value '.length);
    if (body.startsWith('row ')) {
      return parseRowRule(command.text, body, command.line, diagnostics);
    }
    const rules = splitTopLevel(body).flatMap((part) => {
      const rule = parseColumnRule(part, command.line, diagnostics);
      return rule ? [rule] : [];
    });
    if (rules.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidMissingValue', 'Missing value requires at least one rule'),
        line: command.line,
      });
    }
    return createOperator('missing_value', command.text, { strategy: 'by_column', rules });
  },
  format: (config) => {
    if (config?.strategy === 'drop_empty_rows') return 'missing value row drop when all_null';
    if (config?.strategy === 'drop_rows_by_nulls') {
      const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
      return `missing value row drop when ${String(config.condition ?? 'any_null')}${
        columns ? ` in ${columns}` : ''
      }`;
    }
    const rules = objectArray(config?.rules).map(formatRule);
    return `missing value ${rules.join(', ') || '[field] skip'}`;
  },
};

function parseRowRule(text: string, body: string, line: number, diagnostics: PrepDiagnostic[]) {
  const cursor = new PrepTokenCursor(body, line, diagnostics);
  cursor.expect('row', 'invalidMissingValueRowRule');
  cursor.expect('drop', 'invalidMissingValueRowRule');
  cursor.expect('when', 'invalidMissingValueRowRule');
  const condition =
    cursor.expectOneOf(['all_null', 'any_null'], 'invalidMissingValueCondition') ?? '';
  const columns: string[] = [];
  if (cursor.match('in')) {
    while (!cursor.eof) {
      const field = cursor.expectFieldRef('invalidMissingValueField');
      if (!field || !toFieldName(field).trim()) break;
      columns.push(toFieldName(field));
      if (!cursor.matchType('Comma')) break;
    }
  }
  cursor.expectEof('unexpectedMissingValueToken');
  return createOperator('missing_value', text, {
    strategy: condition === 'all_null' ? 'drop_empty_rows' : 'drop_rows_by_nulls',
    condition,
    columns: columns.length > 0 ? columns : undefined,
  });
}

function parseColumnRule(
  part: string,
  line: number,
  diagnostics: PrepDiagnostic[]
): Record<string, unknown> | null {
  const cursor = new PrepTokenCursor(part, line, diagnostics);
  const field = cursor.expectFieldRef('invalidMissingValueField');
  if (!field || !toFieldName(field).trim()) return null;
  const column = toFieldName(field);
  if (cursor.match('skip')) {
    cursor.expectEof('unexpectedMissingValueToken');
    return { column, method: 'skip' };
  }
  if (cursor.match('drop')) {
    cursor.expect('rows', 'invalidMissingValueRule');
    cursor.expectEof('unexpectedMissingValueToken');
    return { column, method: 'drop' };
  }
  if (cursor.match('fill')) {
    const method = cursor.expectOneOfIfPresent(['forward', 'backward', 'mean', 'median', 'mode']);
    if (method) {
      cursor.expectEof('unexpectedMissingValueToken');
      const methods: Record<string, string> = {
        forward: 'forward_fill',
        backward: 'backward_fill',
        mean: 'mean_fill',
        median: 'median_fill',
        mode: 'mode_fill',
      };
      return { column, method: methods[method] };
    }
    const literal = cursor.consume();
    if (!literal) {
      cursor.report('invalidMissingValueLiteral', 'Fill requires a literal value');
      return null;
    }
    cursor.expectEof('unexpectedMissingValueToken');
    return { column, method: 'literal_fill', value: parseLiteral(literal.image) };
  }
  if (cursor.match('nullify')) {
    cursor.expect('values', 'invalidMissingValueRule');
    cursor.expectType('LParen', 'invalidMissingValueValues');
    const values: unknown[] = [];
    while (!cursor.eof && cursor.tokenType() !== 'RParen') {
      const literal = cursor.consume();
      if (!literal || literal.tokenType.name === 'Comma') {
        cursor.report('invalidMissingValueValues', 'Expected a literal value');
        return null;
      }
      values.push(parseLiteral(literal.image));
      if (!cursor.matchType('Comma')) break;
    }
    cursor.expectType('RParen', 'invalidMissingValueValues');
    cursor.expectEof('unexpectedMissingValueToken');
    return { column, method: 'nullify_values', values };
  }
  cursor.report('invalidMissingValueRule', 'Unknown missing-value rule');
  return null;
}

function formatRule(rule: Record<string, unknown>): string {
  const column = formatFieldRef(String(rule.column ?? 'field'));
  const method = String(rule.method ?? 'skip');
  if (method === 'skip') return `${column} skip`;
  if (method === 'drop') return `${column} drop rows`;
  if (method === 'nullify_values') {
    const values = Array.isArray(rule.values) ? rule.values : [];
    return `${column} nullify values (${values.map(formatLiteral).join(', ')})`;
  }
  const fillMethods: Record<string, string> = {
    forward_fill: 'forward',
    backward_fill: 'backward',
    mean_fill: 'mean',
    median_fill: 'median',
    mode_fill: 'mode',
  };
  return method in fillMethods
    ? `${column} fill ${fillMethods[method]}`
    : `${column} fill ${formatLiteral(rule.value ?? null)}`;
}
