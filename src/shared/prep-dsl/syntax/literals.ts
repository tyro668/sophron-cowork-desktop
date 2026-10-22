import { splitTopLevel } from './scanner';

export function parseLiteralList(value: string): unknown[] {
  const trimmed = value.trim();
  const body = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  return splitTopLevel(body).map((item) => parseLiteral(item.trim()));
}

export function parseLiteral(value: string): unknown {
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^null$/i.test(value)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    // SQL semantics: "x" names an identifier; text values use single quotes.
    throw new Error(
      `Text values use single quotes ('…'); "${value.slice(1, -1)}" is an identifier`
    );
  }
  return value;
}

export function formatLiteral(value: unknown): string {
  if (typeof value === 'string') return quoteSqlString(value);
  if (value === null) return 'null';
  return String(value);
}

/** SQL-style text literal: 'it''s'. */
export function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Double-quoted name (table, file path, JSON path, format) — SQL identifier style. */
export function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function unquoteString(value: string): string {
  return value.slice(1, -1).replace(/\\"/g, '"');
}

/** Unquote a single-quoted SQL text literal ('it''s'). */
export function unquoteText(value: string): string {
  return value.slice(1, -1).replace(/''/g, "'");
}

export function isNameLiteral(value: string): boolean {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"');
}

export function isTextLiteral(value: string): boolean {
  return value.length >= 2 && value.startsWith("'") && value.endsWith("'");
}
