import type { CalculationFunctionParameter } from './function-registry';
import type { ParsedWindowFrameBound } from './window-frame';

export type CalculationFrameBoundType =
  | 'unbounded preceding'
  | 'preceding'
  | 'current row'
  | 'following'
  | 'unbounded following';

export const CALCULATION_FRAME_BOUND_TYPES: readonly CalculationFrameBoundType[] = [
  'unbounded preceding',
  'preceding',
  'current row',
  'following',
  'unbounded following',
];

export const CALCULATION_INTERVAL_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const;

export function formatCalculationFrameBound(
  type: CalculationFrameBoundType,
  offset: string,
  usesTemporalRangeUnit: boolean,
  unit: string
): string {
  if (type !== 'preceding' && type !== 'following') return type;
  const normalizedOffset = offset.trim();
  if (usesTemporalRangeUnit) return `interval ${normalizedOffset} ${unit} ${type}`;
  return `${normalizedOffset} ${type}`;
}

export function calculationFrameBoundType(
  bound: ParsedWindowFrameBound | undefined,
  fallback: CalculationFrameBoundType
): CalculationFrameBoundType {
  if (!bound) return fallback;
  switch (bound.position) {
    case 'unbounded-preceding':
      return 'unbounded preceding';
    case 'current-row':
      return 'current row';
    case 'unbounded-following':
      return 'unbounded following';
    case 'preceding':
    case 'following':
      return bound.position;
  }
}

export function defaultCalculationParameterValues(
  parameters: CalculationFunctionParameter[] | undefined
): Record<string, string> {
  return Object.fromEntries(
    (parameters ?? []).map((parameter) => [parameter.key, parameter.defaultValue ?? ''])
  );
}
