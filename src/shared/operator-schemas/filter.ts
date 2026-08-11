import { z } from 'zod';

export const FilterConfigSchema = z
  .object({
    condition: z.string().trim().default(''),
  })
  .refine((config) => config.condition.length > 0, {
    path: ['condition'],
    message: 'Filter requires a condition',
  });
