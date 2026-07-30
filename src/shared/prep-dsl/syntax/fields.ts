import { tokenizeExpression } from '../../expression-tokenizer';
import type { PrepFieldRef } from '../ast';

export function parseFieldRef(value: string): PrepFieldRef | null {
  return parseFieldRefInternal(value, false);
}

export function parseFieldRefExact(value: string): PrepFieldRef | null {
  return parseFieldRefInternal(value, true);
}

function parseFieldRefInternal(value: string, requireEof: boolean): PrepFieldRef | null {
  try {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const tokens = tokenizeExpression(trimmed);
    let index = 0;
    if (tokens[index]?.type !== 'FieldRef') return null;

    const raw = tokens[index].value;
    index += 1;
    if (tokens[index]?.type === 'Dot' && tokens[index + 1]?.type === 'FieldRef') {
      index += 2;
      if (requireEof && tokens[index]?.type !== 'EOF') return null;
      return {
        raw: `${raw}.${tokens[index - 1].value}`,
        source: unwrapFieldName(raw),
        name: unwrapFieldName(tokens[index - 1].value),
      };
    }
    if (requireEof && tokens[index]?.type !== 'EOF') return null;
    return { raw, source: undefined, name: unwrapFieldName(raw) };
  } catch {
    return null;
  }
}

export function toFieldName(field: PrepFieldRef): string {
  return field.name;
}

export function toQualifiedName(field: PrepFieldRef): string {
  return field.source ? `${field.source}.${field.name}` : field.name;
}

export function unwrapFieldName(value: string): string {
  const inner = value.slice(1, -1);
  return inner.startsWith('`') && inner.endsWith('`')
    ? inner.slice(1, -1).replace(/\\`/g, '`')
    : inner;
}

export function formatFieldRef(value: string): string {
  const ref = parseFieldRef(value);
  if (ref) {
    const name = formatFieldName(ref.name);
    return ref.source ? `${formatFieldName(ref.source)}.${name}` : name;
  }
  return formatFieldName(value);
}

export function formatFieldName(value: string): string {
  const raw = unwrapFormattedFieldName(value);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) ? `[${raw}]` : `[\`${raw.replace(/`/g, '\\`')}\`]`;
}

function unwrapFormattedFieldName(value: string): string {
  if (!value.startsWith('[') || !value.endsWith(']')) return value;
  const inner = value.slice(1, -1);
  if (!inner.startsWith('`') || !inner.endsWith('`')) return inner;
  return inner.slice(1, -1).replace(/\\`/g, '`');
}
