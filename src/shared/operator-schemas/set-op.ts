import { z } from 'zod';

export const SetOpConfigSchema = z.object({
  operation: z.string().default('union'),
  mode: z.string().default('all'),
  match: z.string().default('by_name'),
  rightInput: z.string().optional(),
  keep: z.array(z.object({}).passthrough()).default([]),
  conflict: z.object({}).passthrough().default({}),
  rightAlias: z.string().optional(),
});
