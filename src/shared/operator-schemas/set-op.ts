import { z } from 'zod';
import { ConflictSchema } from './common';

export const SetOpConfigSchema = z.object({
  operation: z.enum(['union', 'intersect', 'except']).default('union'),
  mode: z.enum(['all', 'distinct']).default('all'),
  match: z.enum(['by_name', 'by_position']).default('by_name'),
  rightInput: z.string().optional(),
  keep: z.array(z.object({}).passthrough()).default([]),
  conflict: ConflictSchema.optional(),
  rightAlias: z.string().optional(),
});
