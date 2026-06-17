import {
  isNumericDataFieldType,
  normalizeDataFieldType,
} from '../../../../shared/data-field-types';

export type FilterConditionConnective = 'and' | 'or';

export interface FilterConditionRow {
  field: string;
  op: string;
  val1: string;
  val2: string;
  connective: FilterConditionConnective;
}

export function buildFilterCondition(
  rows: FilterConditionRow[],
  columnTypes: Record<string, string> = {}
): string | undefined {
  const parts: { expr: string; connective: FilterConditionConnective }[] = [];

  for (const row of rows) {
    const field = row.field.trim();
    const op = row.op;
    const firstRawValue = row.val1.trim();
    const secondRawValue = row.val2.trim();
    if (!field || !op || !firstRawValue) continue;
    if (op === 'between' && !secondRawValue) continue;

    const colType = columnTypes[field];
    const firstValue = formatFilterConditionValue(row.val1, colType);
    const secondValue = formatFilterConditionValue(row.val2, colType);
    const expr =
      op === 'between'
        ? `[${field}] between ${firstValue} and ${secondValue}`
        : `[${field}] ${op} ${firstValue}`;
    parts.push({ expr, connective: row.connective });
  }

  if (parts.length === 0) return undefined;

  let out = parts[0].expr;
  for (let i = 1; i < parts.length; i++) {
    out += ` ${parts[i].connective} ${parts[i].expr}`;
  }
  return out;
}

export function formatFilterConditionValue(value: string, colType: string | undefined): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (isDslFieldReference(trimmed)) return trimmed;

  const unquoted = unwrapQuotedValue(trimmed);
  // Only output bare `null` when the original input was the literal keyword
  // (unquoted). Quoted `"null"` or `'null'` stays as a string value.
  if (trimmed.toLowerCase() === 'null') return 'null';
  const normalizedType = colType ? normalizeDataFieldType(colType) : undefined;
  const lower = unquoted.toLowerCase();

  const isBoolLike = /^(true|false)$/i.test(unquoted);
  const isNumLike = isNumberLiteral(unquoted);

  if (normalizedType === 'boolean' && isBoolLike) return lower;
  if (isNumericDataFieldType(normalizedType) && isNumLike) return unquoted;
  if (!normalizedType && (isBoolLike || isNumLike)) return unquoted;

  return quoteDslString(unquoted);
}

function isDslFieldReference(value: string): boolean {
  return /^\[(?:`(?:[^`\\]|\\.)+`|[^\]]+)\](?:\.\[(?:`(?:[^`\\]|\\.)+`|[^\]]+)\])?$/.test(value);
}

function unwrapQuotedValue(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first !== last || (first !== '"' && first !== "'")) return value;
  if (first === '"') {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function isNumberLiteral(value: string): boolean {
  return /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value);
}

function quoteDslString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
