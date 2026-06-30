import { duckDbTypeForDataFieldType, type DataFieldType } from '../../../shared/data-field-types';
import type { DataColumnTypeInfo } from '../../../renderer/types';

export function quoteIdentifier(identifier: string): string {
  return quoteValueIdentifier(identifier);
}

export function quoteValueIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteColumnList(columns: string[]): string {
  return columns.map(quoteIdentifier).join(', ') || '*';
}

export function literalToSql(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function positiveNumber(value: unknown, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

export function lastQualifiedPart(value: string): string {
  const raw = value.includes('.') ? (value.split('.').at(-1) ?? value) : value;
  return raw.replace(/^\[|\]$/g, '');
}

export function unwrapFieldToken(token: string): string {
  const inner = token.slice(1, -1);
  return inner.startsWith('`') && inner.endsWith('`') ? inner.slice(1, -1) : inner;
}

export function unquoteDslString(value: string): string {
  try {
    return JSON.parse(value) as string;
  } catch {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

export function getRightPrefix(conflict: unknown): string {
  if (isRecord(conflict) && typeof conflict.rightPrefix === 'string') {
    return conflict.rightPrefix;
  }
  return 'right_';
}

export function getConflictAlias(
  conflict: unknown,
  side: 'left' | 'right',
  fieldName: string
): string {
  if (isRecord(conflict) && conflict.strategy === 'suffix') {
    const leftSuffix = typeof conflict.leftSuffix === 'string' ? conflict.leftSuffix : '_left';
    const rightSuffix = typeof conflict.rightSuffix === 'string' ? conflict.rightSuffix : '_right';
    const suffix = side === 'left' ? leftSuffix : rightSuffix;
    return `${fieldName}${suffix}`;
  }
  if (side === 'right') {
    const prefix = getRightPrefix(conflict);
    return `${prefix}${fieldName}`;
  }
  return fieldName;
}

export function durationToMilliseconds(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (multipliers[unit] ?? 0);
}

export function sortKeysToSql(value: unknown): string {
  return objectArray(value)
    .flatMap((key) =>
      typeof key.field === 'string'
        ? [
            `${quoteIdentifier(key.field)} ${
              key.direction === 'desc' ? 'DESC' : 'ASC'
            }${key.nulls === 'first' || key.nulls === 'last' ? ` NULLS ${String(key.nulls).toUpperCase()}` : ''}`,
          ]
        : []
    )
    .join(', ');
}

export function compileTypedProjection(
  column: DataColumnTypeInfo,
  sourceExpression: string
): string {
  const targetType = duckDbTypeForDataFieldType(column.type);
  const expression =
    column.type === 'text'
      ? `CAST(${sourceExpression} AS VARCHAR)`
      : `TRY_CAST(${sourceExpression} AS ${targetType})`;
  return `${expression} AS ${quoteIdentifier(column.name)}`;
}

export function normalizeDuckDbDateFormat(format: string): string {
  return format
    .replace(/yyyy/g, '%Y')
    .replace(/YYYY/g, '%Y')
    .replace(/MM/g, '%m')
    .replace(/dd/g, '%d')
    .replace(/DD/g, '%d')
    .replace(/HH/g, '%H')
    .replace(/hh/g, '%H')
    .replace(/mm/g, '%M')
    .replace(/ss/g, '%S')
    .replace(/SSS/g, '%f');
}

export function normalizeStatus(
  value: string
): 'running' | 'completed' | 'stopped' | 'draft' | 'pending' | 'failed' {
  if (
    value === 'running' ||
    value === 'completed' ||
    value === 'stopped' ||
    value === 'draft' ||
    value === 'pending' ||
    value === 'failed'
  ) {
    return value;
  }
  return 'draft';
}

export function toNumber(value: number | string | bigint | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toFiniteNumber(
  value: number | string | null | undefined,
  fallback: number
): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeListWindow(
  offset: number | null | undefined,
  limit: number | null | undefined
): { offset: number; limit: number } {
  const normalizedOffset = Math.max(0, Math.floor(toFiniteNumber(offset, 0)));
  const normalizedLimit =
    limit === 0 ? 0 : Math.min(200, Math.max(1, Math.floor(toFiniteNumber(limit, 200))));
  return { offset: normalizedOffset, limit: normalizedLimit };
}

export type DataTaskStatus = 'running' | 'completed' | 'stopped' | 'draft' | 'pending' | 'failed';

export type { DataFieldType };
