import { z } from 'zod';

export const UnpivotConfigSchema = z.object({
  columns: z.array(z.string()).default([]),
  mode: z.enum(['include', 'except']).default('include'),
  nameColumn: z.string().optional(),
  valueColumn: z.string().optional(),
  includeNulls: z.boolean().default(false),
});
