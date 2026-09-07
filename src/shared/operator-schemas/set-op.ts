import { z } from 'zod';
import { ConflictSchema } from './common';

export const DEFAULT_OPERATION = 'union';
export const DEFAULT_MODE = 'all';
export const DEFAULT_MATCH = 'by_name';

export const SetOpConfigSchema = z.object({
  operation: z.enum(['union', 'intersect', 'except']).default(DEFAULT_OPERATION),
  mode: z.enum(['all', 'distinct']).default(DEFAULT_MODE),
  match: z.enum(['by_name', 'by_position']).default(DEFAULT_MATCH),
  rightInput: z.string().trim().min(1),
  keep: z.array(z.looseObject({})).default([]),
  conflict: ConflictSchema.optional(),
  rightAlias: z.string().optional(),
});
