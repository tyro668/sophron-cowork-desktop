import { isNumericDataFieldType, normalizeDataFieldType } from '../data-field-types';
import { tokenizeExpression } from '../expression-tokenizer';

function unquoteValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first !== last) return trimmed;
  if (first === "'") {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

// Splits a comma-separated value list, respecting quoted strings so that a
// comma inside "..." or '...' is preserved. Each element is unquoted;
// empty values (including a quoted "" ) are preserved.
export function splitInValues(val1: string): string[] {
  if (val1.trim() === '') return [];
  const values: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < val1.length; i++) {
    const ch = val1[i];
    if (inString) {
      current += ch;
      if (ch === stringChar && val1[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      values.push(unwrapQuotedValue(current.trim()));
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(unwrapQuotedValue(current.trim()));
  return values;
}

// Joins values into a comma-separated list, quoting any value that contains
// a comma, a quote, or is empty so that the result round-trips losslessly
// through splitInValues.
export function joinInValues(values: string[]): string {
  return values
    .map((v) => {
      const t = v.trim();
      if (t === '') return "''";
      if (/[,"']/.test(t)) return quoteDslString(unquoteValue(t));
      return t;
    })
    .join(', ');
}

export function formatFilterConditionValue(value: string, colType: string | undefined): string {
  const trimmed = value.trim();
  if (!trimmed) return "''";
  if (isDslFieldReference(trimmed)) return trimmed;

  const unquoted = unwrapQuotedValue(trimmed);
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
  try {
    const tokens = tokenizeExpression(value);
    const first = tokens[0];
    if (!first || first.type !== 'FieldRef') return false;
    // Simple: [field]
    if (tokens[1]?.type === 'EOF' || tokens[1]?.type === undefined) return true;
    // Qualified: [source].[field]
    if (tokens[1]?.type === 'Dot' && tokens[2]?.type === 'FieldRef') {
      return tokens[3]?.type === 'EOF' || tokens[3]?.type === undefined;
    }
    return false;
  } catch {
    return false;
  }
}

export function unwrapQuotedValue(value: string): string {
  // SQL semantics: only '…' is a text literal ('' escapes a quote); "…" is an identifier.
  if (value.length < 2 || value[0] !== "'" || value[value.length - 1] !== "'") return value;
  return value.slice(1, -1).replace(/''/g, "'");
}

function isNumberLiteral(value: string): boolean {
  return /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value);
}

function quoteDslString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
