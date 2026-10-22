import { z } from 'zod';
import { nonEmptyTrimmed, SortKeySchema } from './common';

export const DeduplicateConfigSchema = z
  .object({
    fields: z.array(nonEmptyTrimmed('Deduplication field is required')).default([]),
    keep: z.enum(['first', 'last']).default('first'),
    orderBy: z.array(SortKeySchema).default([]),
    strategy: z.enum(['by_columns', 'all_columns']).optional(),
  })
  .refine((config) => config.fields.length > 0 || config.strategy === 'all_columns', {
    path: ['fields'],
    message: 'At least one deduplication field is required',
  });
