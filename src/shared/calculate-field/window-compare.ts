/**
 * Wizard scenario 「与整体/分组汇总比较」: a row-level window value — the aggregate of a field
 * over all rows (`over ()`) or per group (`over (by: [区域])`) — optionally compared with the
 * row's own value. Generates plain expressions that the calculate-field compiler runs as
 * `agg(...) OVER (PARTITION BY ...)`.
 */
import type { CalculationOrderField } from './function-registry';
import { formatCalculationField } from './expression-format';

export const WINDOW_COMPARE_FUNCTIONS = ['avg', 'sum', 'median', 'min', 'max', 'count'] as const;
export type WindowCompareFunction = (typeof WINDOW_COMPARE_FUNCTIONS)[number];

export const WINDOW_COMPARE_MODES = ['value', 'difference', 'ratio', 'flag'] as const;
export type WindowCompareMode = (typeof WINDOW_COMPARE_MODES)[number];

export interface WindowCompareInput {
  fn: WindowCompareFunction;
  field: string;
  /** Empty = all rows. */
  partitionBy?: string[];
  /** Optional (collapsed in the UI): makes the value running within the window. */
  orderBy?: CalculationOrderField[];
  mode?: WindowCompareMode;
  /** Labels for mode `flag`: [at-or-above, below]. */
  flagLabels?: [string, string];
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** ` over ()` / ` over (by: [a], [b] sort: -[x])`. */
export function formatWindowOver(
  partitionBy: readonly string[] = [],
  orderBy: readonly CalculationOrderField[] = []
): string {
  const parts: string[] = [];
  const by = partitionBy.filter((field) => field.trim());
  const sort = orderBy.filter((item) => item.field.trim());
  if (by.length) parts.push(`by: ${by.map(formatCalculationField).join(', ')}`);
  if (sort.length) {
    parts.push(
      `sort: ${sort
        .map(
          (item) => `${item.direction === 'desc' ? '-' : ''}${formatCalculationField(item.field)}`
        )
        .join(', ')}`
    );
  }
  return ` over (${parts.join(' ')})`;
}

export function buildWindowCompareExpression(input: WindowCompareInput): string {
  if (!WINDOW_COMPARE_FUNCTIONS.includes(input.fn)) {
    throw new Error(`Unsupported window aggregate '${input.fn}'`);
  }
  const field = input.field.trim();
  if (!field) throw new Error('A value field is required');
  const value = field === '*' ? '*' : formatCalculationField(field);
  if (value === '*' && input.fn !== 'count') throw new Error('* only works with count');
  const windowValue = `${input.fn}(${value})${formatWindowOver(input.partitionBy, input.orderBy)}`;
  const mode = input.mode ?? 'value';
  if (mode === 'value' || value === '*') return windowValue;
  if (mode === 'difference') return `${value} - ${windowValue}`;
  if (mode === 'ratio') return `${value} / nullif(${windowValue}, 0)`;
  const [above, below] = input.flagLabels ?? ['达标', '不达标'];
  return `if ${value} >= ${windowValue} then ${quote(above)} else ${quote(below)} end`;
}

/** 「平均值（全部行）」/「合计（按 区域）」 — label for field lists and lineage. */
export function describeWindowPartition(partitionBy: readonly string[]): string {
  return partitionBy.length ? `按 ${partitionBy.join('、')}` : '全部行';
}
