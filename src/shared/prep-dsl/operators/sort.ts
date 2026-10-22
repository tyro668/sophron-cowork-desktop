import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { PrepTokenCursor } from '../syntax/token-cursor';
import type { PrepDiagnostic } from '../ast';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';
import { isCompleteSortKey } from '../../operator-completeness';

export const sortCodec: OperatorDslCodec = {
  type: 'sort',
  matches: (text) => text.startsWith('sort by '),
  parse: (command, diagnostics) => {
    const keys = parseSortKeys(command.text.slice(8), command.line, diagnostics);
    if (keys.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic('sortMissingField', 'Sort requires at least one field'),
        line: command.line,
      });
    }
    return createOperator('sort', command.text, { orderBy: keys });
  },
  format: (config) => {
    const keys = formatSortKeys(config?.orderBy);
    return keys ? `sort by ${keys}` : null;
  },
};

export function parseSortKeys(
  value: string,
  line = 1,
  diagnostics: PrepDiagnostic[] = []
): Array<Record<string, string>> {
  const cursor = new PrepTokenCursor(value, line, diagnostics);
  const keys: Array<Record<string, string>> = [];

  while (!cursor.eof) {
    const field = cursor.expectFieldRef('invalidSortField');
    if (!field || !toFieldName(field).trim()) break;

    const direction = cursor.expectOneOfIfPresent(['asc', 'desc']) ?? 'asc';
    let nulls: string | undefined;
    if (cursor.match('nulls')) {
      nulls = cursor.expectOneOf(['first', 'last'], 'invalidSortNulls') ?? undefined;
      if (!nulls) break;
    }
    keys.push({
      field: toFieldName(field),
      direction,
      ...(nulls ? { nulls } : {}),
    });

    if (cursor.eof) break;
    if (cursor.peek()?.tokenType.name !== 'Comma') {
      cursor.expectEof('unexpectedSortToken');
      break;
    }
    cursor.consume();
    if (cursor.eof) {
      cursor.report('sortMissingField', 'Sort requires a field after ","');
      break;
    }
  }

  return keys;
}

export function formatSortKeys(value: unknown): string {
  return objectArray(value)
    .filter(isCompleteSortKey)
    .map((key) => {
      const nulls = typeof key.nulls === 'string' ? ` nulls ${key.nulls}` : '';
      return `${formatFieldRef(String(key.field))} ${String(key.direction ?? 'asc')}${nulls}`;
    })
    .join(', ');
}
