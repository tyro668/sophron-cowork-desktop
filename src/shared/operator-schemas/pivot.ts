import { z } from 'zod';

const PivotMetricSchema = z.object({
  function: z.string().optional().default('count'),
  expression: z.string().optional().default('*'),
  alias: z.string().optional(),
});

export const PivotConfigSchema = z.object({
  on: z.array(z.string()).default([]),
  using: z.array(PivotMetricSchema).default([]),
  groupBy: z.array(z.string()).default([]),
  values: z.array(z.unknown()).default([]),
});
