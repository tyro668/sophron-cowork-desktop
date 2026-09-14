import { DataCommandError } from '../data-command-types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import { unwrapFieldName } from '../../../shared/prep-dsl';
import { tokenizeExpression } from '../../../shared/expression-tokenizer';
import { extractJsonObjectText } from '../../../shared/structured-text';

export function normalizeColumnType(type: string): string {
  return type.trim().toLowerCase();
}

export function normalizeRequiredName(name: string, message: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new DataCommandError('INVALID_ARGUMENT', message);
  }
  return normalized;
}

export function extractJsonObject(text: string): string {
  return extractJsonObjectText(text);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function diagnosticsWithSeverity(
  diagnostics: PrepDiagnostic[],
  severity: PrepDiagnostic['severity']
): PrepDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity);
}

export function summarizeDiagnostics(diagnostics: PrepDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'DSL validation failed';
  }
  return diagnostics
    .slice(0, 3)
    .map((diagnostic) => {
      const location =
        diagnostic.line || diagnostic.column
          ? ` at ${diagnostic.line ?? '?'}:${diagnostic.column ?? '?'}`
          : '';
      return `${diagnostic.code ?? diagnostic.severity}${location}: ${diagnostic.message}`;
    })
    .join('\n');
}

export function escapeDslString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function formatDslField(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)
    ? `[${name}]`
    : `[\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`]`;
}

export function literalToDsl(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function extractFieldNamesFromExpression(expression: string): string[] {
  try {
    const tokens = tokenizeExpression(expression);
    const names: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== 'FieldRef') continue;
      const qualifiedName =
        tokens[index + 1]?.type === 'Dot' && tokens[index + 2]?.type === 'FieldRef'
          ? tokens[index + 2].value
          : token.value;
      if (qualifiedName !== token.value) index += 2;
      const name = unwrapFieldName(qualifiedName);
      if (name) names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

export function unescapeDslBacktickField(name: string): string {
  return name.replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

export function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function normalizeDslTypeName(type: string): string {
  const normalized = normalizeColumnType(type);
  if (['varchar', 'char', 'string', 'text'].includes(normalized)) return 'text';
  if (['int', 'integer', 'bigint', 'smallint', 'tinyint'].includes(normalized)) return 'integer';
  if (['double', 'float', 'real'].includes(normalized)) return 'float';
  if (normalized === 'number') return 'decimal';
  if (normalized.startsWith('decimal') || normalized.startsWith('numeric')) return 'decimal';
  if (normalized.includes('timestamp') || normalized === 'datetime') return 'datetime';
  if (normalized === 'date') return 'date';
  if (['bool', 'boolean'].includes(normalized)) return 'boolean';
  return normalized;
}

export function isNumericDslType(type: string): boolean {
  return ['integer', 'float', 'decimal'].includes(normalizeDslTypeName(type));
}

export function isDecimalLikeDslType(type: string): boolean {
  return ['float', 'decimal'].includes(normalizeDslTypeName(type));
}

export function inferUnpivotValueType(columns: Array<{ type?: string }>): string | undefined {
  const types = columns
    .map((column) => column.type)
    .filter((type): type is string => Boolean(type));
  if (types.length === 0) return undefined;

  const normalized = types.map(normalizeDslTypeName);
  if (normalized.every((type) => type === normalized[0])) return normalized[0];
  if (normalized.every(isNumericDslType)) {
    return normalized.some(isDecimalLikeDslType) ? 'decimal' : 'integer';
  }
  throw new DataCommandError(
    'VALIDATION_FAILED',
    `Generated unpivot columns have incompatible types: ${types.join(', ')}`
  );
}
