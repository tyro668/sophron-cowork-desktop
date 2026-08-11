import { z } from 'zod';

const MAX_FIELD_COUNT = 1000;

export const FieldSelectConfigSchema = z
  .object({
    columns: z
      .array(z.string().trim().min(1))
      .max(MAX_FIELD_COUNT)
      .refine((items) => new Set(items).size === items.length, {
        message: 'Duplicate columns',
      })
      .default([]),
    mode: z.enum(['include', 'exclude']).default('include'),
  })
  .refine((config) => config.columns.length > 0, {
    path: ['columns'],
    message: 'At least one field must be selected',
  });
