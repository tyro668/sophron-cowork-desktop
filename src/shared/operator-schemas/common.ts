import { z } from 'zod';

export const SortKeySchema = z.object({
  field: z.string().trim().min(1),
  direction: z.enum(['asc', 'desc']).default('asc'),
  nulls: z.enum(['first', 'last']).optional(),
});

export const nonEmptyTrimmed = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, { message });

export const ConditionSchema = z.object({
  left: nonEmptyTrimmed('left field is required'),
  operator: z.string(),
  right: nonEmptyTrimmed('right field is required'),
});

export const ConflictSchema = z.object({
  strategy: z.string().default('suffix'),
  rightPrefix: z.string().optional(),
  leftSuffix: z.string().optional(),
  rightSuffix: z.string().optional(),
});

export const AGGREGATE_FUNCTIONS = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'count_distinct',
  'median',
  'first',
  'last',
  'stddev_samp',
  'stddev_pop',
  'var_samp',
  'var_pop',
  'mode',
  'list',
  'quantile_cont',
  'quantile_disc',
  'approx_count_distinct',
  'approx_quantile',
  'approx_top_k',
  'string_agg',
] as const;

export const AggregateFunctionSchema = z.enum(AGGREGATE_FUNCTIONS);

export const PIVOT_AGGREGATE_FUNCTIONS = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'count_distinct',
  'median',
  'var_samp',
  'stddev_samp',
  'mode',
] as const;

export const PivotFunctionSchema = z.enum(PIVOT_AGGREGATE_FUNCTIONS);

const MAX_METRIC_EXPRESSION_LENGTH = 10_000;
const MAX_METRIC_ALIAS_LENGTH = 256;
export const MAX_METRIC_ID_LENGTH = 64;

export function createMetricId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  return `metric_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// id 仅为前端行标识（稳定 React key），DSL 导出只读取 function/expression/alias。
export const MetricEntrySchema = z.object({
  id: z.string().max(MAX_METRIC_ID_LENGTH).optional(),
  function: AggregateFunctionSchema,
  expression: z.string().trim().min(1).max(MAX_METRIC_EXPRESSION_LENGTH),
  alias: z.string().trim().min(1).max(MAX_METRIC_ALIAS_LENGTH),
});

export type AggregateFunction = z.infer<typeof AggregateFunctionSchema>;
export type MetricEntry = z.infer<typeof MetricEntrySchema>;
export type SortKey = z.infer<typeof SortKeySchema>;

export const KeepItemSchema = z.object({
  side: z.string().optional(),
  wildcard: z.boolean().optional(),
  source: z.string().optional(),
  alias: z.string().optional(),
});

export type KeepItem = z.infer<typeof KeepItemSchema>;
