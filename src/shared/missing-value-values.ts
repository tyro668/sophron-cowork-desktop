import { normalizeDataFieldType } from './data-field-types';
import { formatLiteral, parseLiteral } from './expression-syntax/literals';
import { splitTopLevel } from './expression-syntax/scanner';

export type MissingValueInputError = 'required' | 'number' | 'boolean';

export function parseMissingValueInput(raw: string, fieldType?: string): unknown {
  const trimmed = raw.trim();
  const type = fieldType ? normalizeDataFieldType(fieldType) : undefined;
  if (type === 'text' || type === 'date' || type === 'datetime') {
    return trimmed.startsWith("'") && trimmed.endsWith("'") ? parseLiteral(trimmed) : trimmed;
  }
  const value = parseLiteral(trimmed);
  if (typeof value !== 'string') return value;

  if (type === 'integer' || type === 'float' || type === 'decimal') {
    const number = Number(value);
    return value.trim() !== '' && Number.isFinite(number) ? number : value;
  }
  if (type === 'boolean') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return value;
}

export function parseMissingValueListInput(raw: string, fieldType?: string): unknown[] {
  return splitTopLevel(raw).flatMap((token) => {
    const trimmed = token.trim();
    if (!trimmed) return [];
    return [parseMissingValueInput(trimmed, fieldType)];
  });
}

export function formatMissingValueListInput(values: unknown[]): string {
  return values.map(formatLiteral).join(', ');
}

export function validateMissingValueInput(
  raw: string,
  fieldType?: string
): MissingValueInputError | null {
  if (!fieldType) return null;
  const value = raw.trim();
  const type = normalizeDataFieldType(fieldType);
  if (type === 'integer' || type === 'float' || type === 'decimal') {
    return value !== '' && Number.isFinite(Number(value)) ? null : 'number';
  }
  if (type === 'boolean') {
    return value.toLowerCase() === 'true' || value.toLowerCase() === 'false' ? null : 'boolean';
  }
  return null;
}

export function validateMissingValueListInput(
  raw: string,
  fieldType?: string
): MissingValueInputError | null {
  const tokens = splitTopLevel(raw)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return 'required';
  return (
    tokens
      .map((token) => validateMissingValueInput(token, fieldType))
      .find((error): error is MissingValueInputError => error !== null) ?? null
  );
}
