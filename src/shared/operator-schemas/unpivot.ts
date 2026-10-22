import { z } from 'zod';
import { nonEmptyTrimmed } from './common';

export const UnpivotConfigSchema = z
  .object({
    fields: z.array(nonEmptyTrimmed('Unpivot field is required')).default([]),
    selection: z.enum(['include', 'exclude']).default('include'),
    nameColumn: z.string().optional(),
    valueColumn: z.string().optional(),
    includeNulls: z.boolean().default(false),
  })
  .refine((config) => config.fields.length > 0, {
    path: ['fields'],
    message: 'At least one unpivot field is required',
  });
