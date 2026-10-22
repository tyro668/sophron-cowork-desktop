import { tokenizeExpression } from '../expression-tokenizer';
/** A `[field]` / `[source].[field]` reference. */
export interface FieldRef {
  raw: string;
  source?: string;
  name: string;
}

export function parseFieldRef(value: string): FieldRef | null {
  return parseFieldRefInternal(value, false);
}

export function parseFieldRefExact(value: string): FieldRef | null {
  return parseFieldRefInternal(value, true);
}

function parseFieldRefInternal(value: string, requireEof: boolean): FieldRef | null {
  try {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const tokens = tokenizeExpression(trimmed);
    let index = 0;

    // 情况 1: [A].[I] — FieldRef . FieldRef
    if (tokens[index]?.type === 'FieldRef') {
      const raw = tokens[index].value;
      index += 1;
      if (tokens[index]?.type === 'Dot' && tokens[index + 1]?.type === 'FieldRef') {
        index += 2;
        if (tokens[index]?.type !== 'EOF') return null;
        return {
          raw: `${raw}.${tokens[index - 1].value}`,
          source: unwrapFieldName(raw),
          name: unwrapFieldName(tokens[index - 1].value),
        };
      }
      if (requireEof && tokens[index]?.type !== 'EOF') return null;
      return { raw, source: undefined, name: unwrapFieldName(raw) };
    }

    // 情况 2: A.[I] 或 A.I — Ident (.) FieldRef | Ident
    if (tokens[index]?.type === 'Ident') {
      const sourceToken = tokens[index];
      index += 1;
      if (tokens[index]?.type === 'Dot' && tokens[index + 1]?.type === 'FieldRef') {
        index += 2;
        if (tokens[index]?.type !== 'EOF') return null;
        return {
          raw: `${sourceToken.value}.${tokens[index - 1].value}`,
          source: sourceToken.value,
          name: unwrapFieldName(tokens[index - 1].value),
        };
      }
      if (tokens[index]?.type === 'Dot' && tokens[index + 1]?.type === 'Ident') {
        index += 2;
        if (tokens[index]?.type !== 'EOF') return null;
        return {
          raw: `${sourceToken.value}.${tokens[index - 1].value}`,
          source: sourceToken.value,
          name: tokens[index - 1].value,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function toFieldName(field: FieldRef): string {
  return field.name;
}

export function toQualifiedName(field: FieldRef): string {
  return field.source
    ? `${formatFieldName(field.source)}.${formatFieldName(field.name)}`
    : formatFieldName(field.name);
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
  // Plain brackets hold the raw name; backtick-quoting inside brackets is
  // only the escape hatch for names containing ], a backtick, or a backslash.
  return /[`\]\\]/.test(raw)
    ? `[\`${raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`]`
    : `[${raw}]`;
}

function unwrapFormattedFieldName(value: string): string {
  if (!value.startsWith('[') || !value.endsWith(']')) return value;
  const inner = value.slice(1, -1);
  if (!inner.startsWith('`') || !inner.endsWith('`')) return inner;
  return inner.slice(1, -1).replace(/\\`/g, '`');
}
