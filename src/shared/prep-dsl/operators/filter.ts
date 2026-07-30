import { quoteString } from '../syntax/literals';
import { createOperator, type OperatorDslCodec } from './codec';

export const filterCodec: OperatorDslCodec = {
  type: 'filter',
  matches: (text) => text.startsWith('filter '),
  parse: ({ text }) => createOperator('filter', text, { condition: text.slice(7).trim() }),
  format: (config) => `filter ${normalizeBareLiterals(String(config?.condition ?? 'true'))}`,
};

function normalizeBareLiterals(condition: string): string {
  return condition.replace(
    /((?:=|!=|>=|<=|>|<)\s*)([\p{L}_][\p{L}\p{N}_ -]*?)(?=\s*(?:$|\)|\band\b|\bor\b))/giu,
    (_match, operator: string, value: string) => {
      const trimmed = value.trim();
      if (
        !trimmed ||
        /^(true|false|null)$/i.test(trimmed) ||
        /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)
      ) {
        return `${operator}${value}`;
      }
      return `${operator}${quoteString(trimmed)}`;
    }
  );
}
