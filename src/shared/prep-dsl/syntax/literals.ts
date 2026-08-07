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
  if (value.startsWith('"') && value.endsWith('"')) return unquoteString(value);
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return value;
}

export function formatLiteral(value: unknown): string {
  if (typeof value === 'string') return quoteString(value);
  if (value === null) return 'null';
  return String(value);
}

export function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function unquoteString(value: string): string {
  return value.slice(1, -1).replace(/\\"/g, '"');
}
