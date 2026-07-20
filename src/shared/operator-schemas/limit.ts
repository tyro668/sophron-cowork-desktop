import { z } from 'zod';
import { SortKeySchema } from './common';

export const LimitConfigSchema = z.object({
  limit: z.number().default(100),
  mode: z.enum(['fixed', 'random']).default('fixed'),
  unit: z.enum(['rows', 'percent']).default('rows'),
  orderBy: z.array(SortKeySchema).default([]),
  ties: z.boolean().default(false),
  offset: z.number().default(0),
  method: z.enum(['system', 'bernoulli']).default('system'),
  seed: z.number().optional(),
});
