export const PREP_DSL_KEYWORDS = [
  'input',
  'source',
  'from',
  'select',
  'map',
  'rename',
  'to',
  'as',
  'filter',
  'or',
  'not',
  'in',
  'between',
  'like',
  'matches',
  'deduplicate',
  'by',
  'keep',
  'first',
  'last',
  'order',
  'missing',
  'value',
  'row',
  'when',
  'all_null',
  'any_null',
  'nullify',
  'values',
  'fill',
  'forward',
  'backward',
  'mean',
  'median',
  'mode',
  'cast',
  'on_error',
  'sort',
  'derive',
  'if',
  'then',
  'else',
  'over',
  'partition',
  'rows',
  'unbounded',
  'preceding',
  'aggregate',
  'all',
  'rollup',
  'cube',
  'grouping',
  'sets',
  'metrics',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'semi',
  'anti',
  'asof',
  'on',
  'and',
  'direction',
  'tolerance',
  'suffix',
  'right_prefix',
  'expect',
  'one_to_one',
  'one_to_many',
  'many_to_one',
  'many_to_many',
  'nearest',
  'limit',
  'top',
  'offset',
  'percent',
  'pivot',
  'using',
  'group',
  'unpivot',
  'into',
  'except',
  'nulls',
  'include',
  'union',
  'intersect',
  'position',
  'unnest',
  'explode',
  'json',
  'path',
  'with',
  'index',
  'recursive',
  'max_depth',
  'output',
  'table',
  'dataset',
  'file',
  'format',
  'name',
  'append',
  'error_if_exists',
] as const;

export interface OpenFieldReference {
  start: number;
  query: string;
}

export function findOpenFieldReference(value: string): OpenFieldReference | null {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let fieldStart = -1;
  let inBacktick = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (fieldStart >= 0) {
      if (inBacktick) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '`') inBacktick = false;
        continue;
      }
      if (char === '`' && index === fieldStart + 1) {
        inBacktick = true;
        continue;
      }
      if (char === ']') fieldStart = -1;
      continue;
    }
    if (char === '#') return null;
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') fieldStart = index;
  }
  if (fieldStart < 0) return null;
  const rawQuery = value.slice(fieldStart + 1);
  const query = rawQuery.startsWith('`') ? rawQuery.slice(1) : rawQuery;
  return { start: fieldStart, query: unescapePartialBacktick(query) };
}

function unescapePartialBacktick(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && (value[index + 1] === '\\' || value[index + 1] === '`')) {
      result += value[index + 1];
      index += 1;
    } else {
      result += value[index];
    }
  }
  return result;
}
