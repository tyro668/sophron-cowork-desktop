import { DataCommandError } from '../data-command-types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';

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
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const content = fenced[1].trim();
    if (content.startsWith('{') && content.endsWith('}')) return content;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('No JSON object found in LLM response');
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

const DSL_FIELD_REF_TOKEN_PATTERN = '\\[(?:`((?:[^`\\\\]|\\\\.)*)`|([\\p{L}_][\\p{L}\\p{N}_]*))\\]';
const DSL_FIELD_REF_PATTERN = new RegExp(
  `${DSL_FIELD_REF_TOKEN_PATTERN}(?:\\.${DSL_FIELD_REF_TOKEN_PATTERN})?`,
  'gu'
);
const DSL_STRING_LITERAL_PATTERN = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

export function extractFieldNamesFromExpression(expression: string): string[] {
  const withoutStrings = expression.replace(DSL_STRING_LITERAL_PATTERN, '');
  const names: string[] = [];
  for (const match of withoutStrings.matchAll(DSL_FIELD_REF_PATTERN)) {
    const first = match[1] ?? match[2] ?? '';
    const second = match[3] ?? match[4] ?? '';
    const name = unescapeDslBacktickField(second || first);
    if (name) names.push(name);
  }
  return names;
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
