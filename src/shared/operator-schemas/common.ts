import { z } from 'zod';

export const SortKeySchema = z.object({
  field: z.string().trim().min(1),
  direction: z.enum(['asc', 'desc']).default('asc'),
  nulls: z.enum(['first', 'last']).optional(),
});

export const ConditionSchema = z.object({
  left: z.string(),
  operator: z.string(),
  right: z.string(),
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

export const MetricEntrySchema = z.object({
  function: AggregateFunctionSchema.or(z.literal('')).optional().default(''),
  expression: z.string().max(10_000).optional().default(''),
  alias: z.string().max(256).optional().default(''),
});

export type SortKey = z.infer<typeof SortKeySchema>;

export const KeepItemSchema = z.object({
  side: z.string().optional(),
  wildcard: z.boolean().optional(),
  source: z.string().optional(),
  alias: z.string().optional(),
});
