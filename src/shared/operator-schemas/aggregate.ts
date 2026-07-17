import { z } from 'zod';
import { MetricEntrySchema } from './common';

export const AggregateConfigSchema = z.object({
  groupBy: z.array(z.string()).default([]),
  metrics: z.array(MetricEntrySchema).default([]),
});
