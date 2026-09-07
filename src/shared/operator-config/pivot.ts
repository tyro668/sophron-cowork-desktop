import { translatePivotInput } from '../data-field-types';
import type { PivotAxisEntry, PivotLiteral } from '../operator-schemas/pivot';

const PIVOT_METRIC_DEFAULT_SUFFIXES: Record<string, string> = {
  sum: 'sum',
  avg: 'avg',
  min: 'min',
  max: 'max',
  count: 'count',
  count_distinct: 'distinct_count',
};

export function getPivotMetricDefaultSuffix(fn: string): string {
  const normalized = fn.trim().toLowerCase();
  return PIVOT_METRIC_DEFAULT_SUFFIXES[normalized] ?? normalized;
}

export function withPivotMetricDefaultSuffix<T extends { function: string; alias?: string }>(
  metric: T
): T & { alias: string } {
  return metric.alias?.trim()
    ? { ...metric, alias: metric.alias }
    : { ...metric, alias: getPivotMetricDefaultSuffix(metric.function) };
}

export interface PivotAxisSelectionSummary {
  selected: number | null;
  total: number | null;
}

export function getPivotAxisSelectionSummary(
  values: PivotLiteral[],
  distinctValues: string[],
  loaded: boolean,
  customValues: PivotLiteral[] = []
): PivotAxisSelectionSummary {
  if (!loaded) {
    return { selected: values.length > 0 ? values.length : null, total: null };
  }
  const total = new Set([
    ...distinctValues.map((value) => pivotLiteralDisplay(value)),
    ...values.map((value) => pivotLiteralDisplay(value)),
    ...customValues.map((value) => pivotLiteralDisplay(value)),
  ]).size;
  return { selected: values.length === 0 ? distinctValues.length : values.length, total };
}

export function getPivotPreservedValues(
  values: PivotLiteral[],
  customValues: PivotLiteral[],
  distinctValues: string[],
  loaded: boolean
): PivotLiteral[] {
  const preserved = [...customValues];
  if (!loaded) {
    for (const value of values) {
      const display = pivotLiteralDisplay(value);
      if (!preserved.some((item) => pivotLiteralDisplay(item) === display)) {
        preserved.push(value);
      }
    }
    return preserved;
  }
  const sourceDisplays = new Set(distinctValues.map(pivotLiteralDisplay));
  for (const value of values) {
    const display = pivotLiteralDisplay(value);
    if (
      !sourceDisplays.has(display) &&
      !preserved.some((preservedValue) => pivotLiteralDisplay(preservedValue) === display)
    ) {
      preserved.push(value);
    }
  }
  return preserved;
}

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
    return [{ field: '', values: [], customValues: [] }];
  }
  const axes = value.filter(isPivotAxis).map((axis) => ({
    field: typeof axis.field === 'string' ? axis.field : '',
    values: Array.isArray(axis.values) ? axis.values.filter(isPivotLiteral) : [],
    customValues:
      'customValues' in axis && Array.isArray(axis.customValues)
        ? axis.customValues.filter(isPivotLiteral)
        : [],
  }));
  return axes.length > 0 ? axes : [{ field: '', values: [], customValues: [] }];
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

/**
 * Add a value entered by the user without dropping the implicit "include all" selection.
 * An empty value list represents all source values, so it must first be materialized before
 * the custom value can be appended to the explicit allow-list.
 */
export interface PivotCustomValueResult {
  values: PivotLiteral[];
  customValues: PivotLiteral[];
}

export function removePivotCustomValue(
  values: PivotLiteral[],
  customValues: PivotLiteral[],
  display: string
): PivotCustomValueResult {
  return {
    values: values.filter((value) => pivotLiteralDisplay(value) !== display),
    customValues: customValues.filter((value) => pivotLiteralDisplay(value) !== display),
  };
}

export function addCustomPivotAxisValue(
  values: PivotLiteral[],
  customValues: PivotLiteral[],
  raw: string,
  sourceCandidates: Array<{ raw: string }>,
  columnType?: string
): PivotCustomValueResult {
  const translated = addPivotValue([], raw, columnType);
  if (translated.length === 0) return { values, customValues };
  const display = pivotLiteralDisplay(translated[0]);
  const sourceDisplays = new Set(
    sourceCandidates.flatMap((candidate) =>
      addPivotCandidate([], candidate.raw, columnType).map(pivotLiteralDisplay)
    )
  );
  if (sourceDisplays.has(display)) {
    return {
      values: addPivotValue(values, raw, columnType),
      customValues,
    };
  }
  const selected =
    values.length > 0
      ? values
      : sourceCandidates.reduce<PivotLiteral[]>(
          (result, candidate) => addPivotCandidate(result, candidate.raw, columnType),
          []
        );
  return {
    values: addPivotValue(selected, raw, columnType),
    customValues: addPivotValue(customValues, raw, columnType),
  };
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

/** Toggle one explicitly selected value. An empty list remains the default-all configuration. */
export function togglePivotAxisValue(
  values: PivotLiteral[],
  display: string,
  raw: string,
  columnType?: string
): PivotLiteral[] {
  const selectedDisplays = new Set(values.map((value) => pivotLiteralDisplay(value)));
  if (selectedDisplays.has(display)) {
    return values.filter((value) => pivotLiteralDisplay(value) !== display);
  }
  return addPivotCandidate(values, raw, columnType);
}

export function togglePivotVisibleValues(
  values: PivotLiteral[],
  candidates: Array<{ display: string; raw: string }>,
  visibleDisplays: Set<string>,
  columnType?: string
): PivotLiteral[] {
  if (visibleDisplays.size === 0) return values;
  const selectedDisplays = new Set(values.map(pivotLiteralDisplay));
  const isSelected = (display: string) => selectedDisplays.has(display);
  const allVisibleSelected = [...visibleDisplays].every(isSelected);
  const nextCandidates = candidates.filter((candidate) =>
    allVisibleSelected
      ? isSelected(candidate.display) && !visibleDisplays.has(candidate.display)
      : isSelected(candidate.display) || visibleDisplays.has(candidate.display)
  );
  const next = nextCandidates.reduce<PivotLiteral[]>(
    (result, candidate) => addPivotCandidate(result, candidate.raw, columnType),
    []
  );
  return next;
}
