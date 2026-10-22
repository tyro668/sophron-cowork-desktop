import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';
import { formatSortKeys, parseSortKeys } from './sort';

export const deduplicateCodec: OperatorDslCodec = {
  type: 'deduplicate',
  matches: (text) => text.startsWith('deduplicate'),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    cursor.expect('deduplicate', 'invalidDeduplicate');

    let columns: string[] | undefined;
    if (cursor.match('by')) {
      columns = [];
      while (!cursor.eof) {
        const field = cursor.expectFieldRef('deduplicateMissingField');
        if (!field || !toFieldName(field).trim()) break;
        columns.push(toFieldName(field));
        if (!cursor.matchType('Comma')) break;
        if (cursor.eof) {
          cursor.report('deduplicateMissingField', 'Deduplicate by requires a field after ","');
        }
      }
    }

    let keep = 'first';
    if (cursor.match('keep')) {
      keep = cursor.expectOneOf(['first', 'last'], 'invalidDeduplicateKeep') ?? keep;
    }

    let orderBy: Array<Record<string, string>> | undefined;
    if (cursor.match('order')) {
      if (cursor.expect('by', 'invalidDeduplicateOrder')) {
        orderBy = parseSortKeys(
          cursor.slice(cursor.index, cursor.tokens.length),
          command.line,
          diagnostics
        );
      }
    } else {
      cursor.expectEof('unexpectedDeduplicateToken');
    }

    if (columns !== undefined && columns.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'deduplicateMissingField',
          'Deduplicate by requires at least one field'
        ),
        line: command.line,
      });
    }
    return createOperator('deduplicate', text, {
      strategy: columns ? 'by_columns' : 'all_columns',
      fields: columns,
      keep,
      orderBy,
    });
  },
  format: (config) => {
    const columns = stringArray(config?.fields).map(formatFieldRef).join(', ');
    if (!columns && config?.strategy !== 'all_columns') return null;
    const parts = ['deduplicate'];
    if (columns) parts.push(`by ${columns}`);
    if (typeof config?.keep === 'string' && config.keep !== 'first') {
      parts.push(`keep ${config.keep}`);
    }
    const orderBy = formatSortKeys(config?.orderBy);
    if (orderBy) parts.push(`order by ${orderBy}`);
    return parts.join(' ');
  },
};
