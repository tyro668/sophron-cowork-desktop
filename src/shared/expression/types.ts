import { dataFieldTypeOfSpelling } from '../data-field-types';
/** Result types the expression layer reasons about (aligned with DataFieldType). */
export type ExprType =
  'text' | 'integer' | 'float' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'null' | 'unknown';

export const NUMERIC_TYPES: ReadonlySet<ExprType> = new Set(['integer', 'float', 'decimal']);
export const TEMPORAL_TYPES: ReadonlySet<ExprType> = new Set(['date', 'datetime']);

/** Map a DataFieldType / DuckDB type spelling to an ExprType (shared spelling table). */
export function exprTypeOf(raw: string | undefined): ExprType {
  if (!(raw ?? '').trim()) return 'unknown';
  return dataFieldTypeOfSpelling(raw) ?? 'unknown';
}

/** Numeric widening used by arithmetic, coalesce and conditional branches. */
export function widen(a: ExprType, b: ExprType): ExprType {
  if (a === b) return a;
  if (a === 'null' || a === 'unknown') return b === 'null' ? a : b;
  if (b === 'null' || b === 'unknown') return a;
  if (NUMERIC_TYPES.has(a) && NUMERIC_TYPES.has(b)) {
    if (a === 'float' || b === 'float') return 'float';
    return 'decimal';
  }
  if (TEMPORAL_TYPES.has(a) && TEMPORAL_TYPES.has(b)) return 'datetime';
  return 'unknown';
}
