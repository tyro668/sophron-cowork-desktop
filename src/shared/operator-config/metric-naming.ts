/**
 * One naming rule for every metric output (aggregate, pivot, DSL):
 * - `[field]` → `field_fn` (e.g. `销售额_sum`, `客户_count_distinct`)
 * - count(*) / count() → the row-count label (`行数` in the zh UI, `row_count` otherwise)
 * - any other expression → `fn`
 */
export const DEFAULT_ROW_COUNT_ALIAS = 'row_count';

function plainField(expression: string): string | null {
  const match = /^\[([^[\]]+)\]$/.exec(expression.trim());
  return match ? match[1] : null;
}

export function isCountAllRows(fn: string, expression: string): boolean {
  const trimmed = expression.trim();
  return fn.trim().toLowerCase() === 'count' && (trimmed === '' || trimmed === '*');
}

export function defaultMetricAlias(
  fn: string,
  expression: string,
  rowsLabel: string = DEFAULT_ROW_COUNT_ALIAS
): string {
  const normalized = fn.trim().toLowerCase();
  const field = plainField(expression);
  if (field) return `${field}_${normalized}`;
  if (isCountAllRows(normalized, expression)) return rowsLabel;
  return normalized;
}
