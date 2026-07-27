import { z } from 'zod';
import { AggregateFunctionSchema } from './common';

const PivotMetricSchema = z.object({
  function: AggregateFunctionSchema.optional().default('count'),
  expression: z.string().max(10_000).optional().default('*'),
  alias: z.string().max(256).optional(),
});

export const PivotConfigSchema = z.object({
  on: z.array(z.string().max(256)).max(50).default([]),
  using: z.array(PivotMetricSchema).max(100).default([]),
  groupBy: z.array(z.string().max(256)).max(100).default([]),
  values: z
    .array(z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]))
    .max(1_000)
    .default([]),
});
