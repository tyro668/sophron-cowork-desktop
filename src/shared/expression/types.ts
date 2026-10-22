/** Result types the expression layer reasons about (aligned with DataFieldType). */
export type ExprType =
  'text' | 'integer' | 'float' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'null' | 'unknown';

export const NUMERIC_TYPES: ReadonlySet<ExprType> = new Set(['integer', 'float', 'decimal']);
export const TEMPORAL_TYPES: ReadonlySet<ExprType> = new Set(['date', 'datetime']);

/** Map a DataFieldType / DuckDB type spelling to an ExprType. */
export function exprTypeOf(raw: string | undefined): ExprType {
  const t = (raw ?? '').trim().toLowerCase().replace(/\(.*$/, '');
  if (!t) return 'unknown';
  if (['text', 'varchar', 'string', 'char', 'bpchar', 'uuid', 'json'].includes(t)) return 'text';
  if (
    [
      'integer',
      'int',
      'int4',
      'int8',
      'bigint',
      'smallint',
      'tinyint',
      'hugeint',
      'ubigint',
      'uinteger',
      'usmallint',
      'utinyint',
      'long',
      'short',
    ].includes(t)
  )
    return 'integer';
  if (['float', 'double', 'real', 'float4', 'float8', 'double precision'].includes(t))
    return 'float';
  if (['decimal', 'numeric'].includes(t)) return 'decimal';
  if (['boolean', 'bool', 'logical'].includes(t)) return 'boolean';
  if (t === 'date') return 'date';
  if (['datetime', 'timestamp', 'timestamptz', 'timestamp with time zone'].includes(t))
    return 'datetime';
  return 'unknown';
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
