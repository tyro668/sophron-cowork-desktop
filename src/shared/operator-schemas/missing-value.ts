import { z } from 'zod';

const MissingRuleSchema = z.object({
  id: z.string().optional(),
  column: z.string().optional().default(''),
  method: z.string().optional().default('literal_fill'),
  values: z.array(z.string()).optional(),
  value: z.unknown().optional(),
});

export const MissingValueConfigSchema = z.object({
  strategy: z.string().default('by_column'),
  rules: z.array(MissingRuleSchema).default([]),
  columns: z.array(z.string()).optional(),
  condition: z.string().optional(),
});
