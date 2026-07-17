import { z } from 'zod';
import { SortKeySchema } from './common';

export const DeduplicateConfigSchema = z.object({
  columns: z.array(z.string()).default([]),
  keep: z.string().default('first'),
  orderBy: z.array(SortKeySchema).default([]),
  strategy: z.string().optional(),
});
