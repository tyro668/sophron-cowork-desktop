import { z } from 'zod';
import { MetricEntrySchema } from './common';

export const AggregateConfigSchema = z.object({
  groupBy: z.array(z.string().max(256)).max(100).default([]),
  metrics: z.array(MetricEntrySchema).max(100).default([]),
  dateGranularity: z
    .record(z.string(), z.enum(['year', 'quarter', 'month', 'week', 'day']))
    .optional(),
});
