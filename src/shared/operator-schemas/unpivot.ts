import { z } from 'zod';
import { nonEmptyTrimmed } from './common';

export const UnpivotConfigSchema = z
  .object({
    columns: z.array(nonEmptyTrimmed('Unpivot field is required')).default([]),
    mode: z.enum(['include', 'except']).default('include'),
    nameColumn: z.string().optional(),
    valueColumn: z.string().optional(),
    includeNulls: z.boolean().default(false),
  })
  .refine((config) => config.columns.length > 0, {
    path: ['columns'],
    message: 'At least one unpivot field is required',
  });
