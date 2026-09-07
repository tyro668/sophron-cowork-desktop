import { z } from 'zod';
import { MetricEntrySchema } from './common';

const MAX_FIELD_NAME_LENGTH = 256;
const MAX_GROUP_BY_COUNT = 100;
export const MAX_METRIC_COUNT = 100;

export const AggregateConfigSchema = z.object({
  groupBy: z
    .array(z.string().max(MAX_FIELD_NAME_LENGTH))
    .max(MAX_GROUP_BY_COUNT)
    .refine((items) => new Set(items).size === items.length, {
      message: 'Duplicate aggregate group fields',
    })
    .default([]),
  metrics: z.array(MetricEntrySchema).min(1).max(MAX_METRIC_COUNT),
  dateGranularity: z
    .record(z.string(), z.enum(['year', 'quarter', 'month', 'week', 'day']))
    .optional(),
});
