import { z } from 'zod';
import { SortKeySchema } from './common';

export const DeduplicateConfigSchema = z
  .object({
    columns: z.array(z.string()).default([]),
    keep: z.enum(['first', 'last']).default('first'),
    orderBy: z.array(SortKeySchema).default([]),
    strategy: z.enum(['by_columns', 'all_columns']).optional(),
  })
  .refine((config) => config.columns.length > 0 || config.strategy === 'all_columns', {
    path: ['columns'],
    message: 'At least one deduplication field is required',
  });
