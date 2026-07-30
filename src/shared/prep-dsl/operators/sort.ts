import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { findFirstTopLevelKeyword, splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';

export const sortCodec: OperatorDslCodec = {
  type: 'sort',
  matches: (text) => text.startsWith('sort by '),
  parse: ({ text }) => createOperator('sort', text, { keys: parseSortKeys(text.slice(8)) }),
  format: (config) => `sort by ${formatSortKeys(config?.keys) || '[field] asc'}`,
};

export function parseSortKeys(value: string): Array<Record<string, string>> {
  return splitTopLevel(value).flatMap((part) => {
    const trimmed = part.trim();
    const optionStart = findFirstTopLevelKeyword(trimmed, ['asc', 'desc', 'nulls']);
    const field = parseFieldRef(optionStart ? trimmed.slice(0, optionStart.index).trim() : trimmed);
    if (!field) return [];
    const options = optionStart
      ? trimmed.slice(optionStart.index).trim().toLowerCase().split(/\s+/)
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
