import { z } from 'zod';

export const FieldSelectConfigSchema = z.object({
  columns: z.array(z.string()).default([]),
  mode: z.enum(['include', 'exclude']).default('include'),
});
