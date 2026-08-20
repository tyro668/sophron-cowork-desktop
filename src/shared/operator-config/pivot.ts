import { translatePivotInput } from '../data-field-types';
import type { PivotAxisEntry, PivotLiteral } from '../operator-schemas/pivot';

function isPivotLiteral(value: unknown): value is PivotLiteral {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isPivotAxis(value: unknown): value is { field?: unknown; values?: unknown } {
  return Boolean(value) && typeof value === 'object';
}

export function normalizePivotAxes(value: unknown): PivotAxisEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ field: '', values: [] }];
  }
  const axes = value.filter(isPivotAxis).map((axis) => ({
    field: typeof axis.field === 'string' ? axis.field : '',
    values: Array.isArray(axis.values) ? axis.values.filter(isPivotLiteral) : [],
  }));
  return axes.length > 0 ? axes : [{ field: '', values: [] }];
}

function pivotLiteralDisplay(value: PivotLiteral): string {
  if (value === null) return 'null';
  if (value === '') return '""';
  return String(value);
}

export function addPivotValue(
  values: PivotLiteral[],
  raw: string,
  columnType?: string
): PivotLiteral[] {
  if (raw === '') return values;
  const translated = translatePivotInput(raw, columnType);
  if (translated === '') return values;
  if (values.some((value) => pivotLiteralDisplay(value) === pivotLiteralDisplay(translated))) {
    return values;
  }
  return [...values, translated];
}

export function addPivotCandidate(
  values: PivotLiteral[],
  raw: string,
  columnType?: string
): PivotLiteral[] {
  const translated = translatePivotInput(raw, columnType);
  if (values.some((value) => pivotLiteralDisplay(value) === pivotLiteralDisplay(translated))) {
    return values;
  }
  return [...values, translated];
}
