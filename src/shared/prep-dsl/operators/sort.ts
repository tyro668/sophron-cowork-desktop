import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { findFirstTopLevelKeyword, splitTopLevel } from '../syntax/scanner';
import { prepDslLexer } from '../tokens';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';

export const sortCodec: OperatorDslCodec = {
  type: 'sort',
  matches: (text) => text.startsWith('sort by '),
  parse: (command, diagnostics) => {
    const keys = parseSortKeys(command.text.slice(8));
    if (keys.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic('sortMissingField', 'Sort requires at least one field'),
        line: command.line,
      });
    }
    return createOperator('sort', command.text, { keys });
  },
  format: (config) => {
    const keys = formatSortKeys(config?.keys);
    return keys ? `sort by ${keys}` : null;
  },
};

export function parseSortKeys(value: string): Array<Record<string, string>> {
  return splitTopLevel(value).flatMap((part) => {
    const trimmed = part.trim();
    const optionStart = findFirstTopLevelKeyword(trimmed, ['asc', 'desc', 'nulls']);
    const field = parseFieldRef(optionStart ? trimmed.slice(0, optionStart.index).trim() : trimmed);
    if (!field || !toFieldName(field).trim()) return [];
    const options = optionStart
      ? prepDslLexer
          .tokenize(trimmed.slice(optionStart.index))
          .tokens.map((token) => token.image.toLowerCase())
      : [];
    const direction = options.find((option) => option === 'asc' || option === 'desc') ?? 'asc';
    const nullsIndex = options.indexOf('nulls');
    const nulls = nullsIndex >= 0 ? options[nullsIndex + 1] : undefined;
    return [
      {
        field: toFieldName(field),
        direction,
        ...(nulls ? { nulls } : {}),
      },
    ];
  });
}

export function formatSortKeys(value: unknown): string {
  return objectArray(value)
    .filter((key) => key.field)
    .map((key) => {
      const nulls = typeof key.nulls === 'string' ? ` nulls ${key.nulls}` : '';
      return `${formatFieldRef(String(key.field))} ${String(key.direction ?? 'asc')}${nulls}`;
    })
    .join(', ');
}
