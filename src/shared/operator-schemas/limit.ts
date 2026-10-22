import { z } from 'zod';
import { SortKeySchema } from './common';

export const LimitConfigSchema = z
  .object({
    limit: z.number().int().min(1),
    sampling: z.enum(['fixed', 'random']).default('fixed'),
    unit: z.enum(['rows', 'percent']).default('rows'),
    orderBy: z.array(SortKeySchema).default([]),
    ties: z.boolean().default(false),
    offset: z.number().int().min(0).default(0),
    method: z.enum(['system', 'bernoulli']).optional(),
    seed: z.number().optional(),
  })
  .superRefine((config, context) => {
    if (config.unit === 'percent' && config.limit > 100) {
      context.addIssue({
        code: 'custom',
        path: ['limit'],
        message: 'Percentage cannot exceed 100',
      });
    }
  })
  .transform((config) =>
    config.unit === 'rows'
      ? {
          ...config,
          method: undefined,
        }
      : {
          ...config,
          offset: 0,
        }
  );
