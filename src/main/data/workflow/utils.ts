import { DataCommandError } from '../data-command-types';
import type { PrepDiagnostic } from '../../../shared/prep-dsl';
import {
  extractExpressionFieldNames,
  normalizePlanDslType,
} from '../../../shared/workflow-plan/expression-fields';
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
  return /[`\]\\]/.test(name)
    ? `[\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`]`
    : `[${name}]`;
}

export function literalToDsl(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function extractFieldNamesFromExpression(expression: string): string[] {
  return extractExpressionFieldNames(expression);
}

export function unescapeDslBacktickField(name: string): string {
  return name.replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

export function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function normalizeDslTypeName(type: string): string {
  return normalizePlanDslType(type);
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
