import { z } from 'zod';
import { SortKeySchema } from './common';

/**
 * Limit is a discriminated union on `sampling`: each mode owns only its fields.
 * - fixed:  limit, unit, orderBy, ties, offset (offset only for rows)
 * - random: limit, unit, method (percent only), seed
 */
const LimitBase = {
  limit: z.number().int().min(1),
  unit: z.enum(['rows', 'percent']).default('rows'),
};

export const FixedLimitConfigSchema = z.object({
  sampling: z.literal('fixed'),
  ...LimitBase,
  orderBy: z.array(SortKeySchema).default([]),
  ties: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
});

export const RandomLimitConfigSchema = z.object({
  sampling: z.literal('random'),
  ...LimitBase,
  method: z.enum(['system', 'bernoulli']).optional(),
  seed: z.number().optional(),
});

export const LimitConfigSchema = z
  .preprocess(
    (value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? { sampling: 'fixed', ...(value as Record<string, unknown>) }
        : value,
    z.discriminatedUnion('sampling', [FixedLimitConfigSchema, RandomLimitConfigSchema])
  )
  .superRefine((config, context) => {
    if (config.unit === 'percent' && config.limit > 100) {
      context.addIssue({
        code: 'custom',
        path: ['limit'],
        message: 'Percentage cannot exceed 100',
      });
    }
  })
  .transform((config) => {
    if (config.sampling === 'fixed') {
      return config.unit === 'percent' ? { ...config, offset: 0 } : config;
    }
    return config.unit === 'rows' ? { ...config, method: undefined } : config;
  });

export type LimitConfig = z.infer<typeof LimitConfigSchema>;
export type FixedLimitConfig = Extract<LimitConfig, { sampling: 'fixed' }>;
export type RandomLimitConfig = Extract<LimitConfig, { sampling: 'random' }>;
