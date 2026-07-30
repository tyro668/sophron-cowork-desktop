import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';
import { formatSortKeys, parseSortKeys } from './sort';

export const deduplicateCodec: OperatorDslCodec = {
  type: 'deduplicate',
  matches: (text) => text.startsWith('deduplicate'),
  parse: ({ text }) => {
    const byMatch = /\s+by\s+(.+?)(?:\s+keep\s+|\s+order\s+by\s+|$)/.exec(text);
    const keepMatch = /\s+keep\s+(first|last)/.exec(text);
    const orderMatch = /\s+order\s+by\s+(.+)$/.exec(text);
    const columns = byMatch
      ? splitTopLevel(byMatch[1]).flatMap((part) => {
          const field = parseFieldRef(part);
          return field ? [toFieldName(field)] : [];
        })
      : undefined;
    return createOperator('deduplicate', text, {
      strategy: byMatch ? 'by_columns' : 'all_columns',
      columns,
      keep: keepMatch?.[1] ?? 'first',
      orderBy: orderMatch ? parseSortKeys(orderMatch[1]) : undefined,
    });
  },
  format: (config) => {
    const parts = ['deduplicate'];
    const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
    if (columns) parts.push(`by ${columns}`);
    if (typeof config?.keep === 'string') parts.push(`keep ${config.keep}`);
    const orderBy = formatSortKeys(config?.orderBy);
    if (orderBy) parts.push(`order by ${orderBy}`);
    return parts.join(' ');
  },
};
