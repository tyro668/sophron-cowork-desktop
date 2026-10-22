import { z } from 'zod';

const MAX_FIELD_COUNT = 1000;

export const FieldSelectConfigSchema = z
  .object({
    fields: z
      .array(z.string().trim().min(1))
      .max(MAX_FIELD_COUNT)
      .refine((items) => new Set(items).size === items.length, {
        message: 'Duplicate fields',
      })
      .default([]),
    selection: z.enum(['include', 'exclude']).default('include'),
  })
  .refine((config) => config.fields.length > 0, {
    path: ['fields'],
    message: 'At least one field must be selected',
  });
