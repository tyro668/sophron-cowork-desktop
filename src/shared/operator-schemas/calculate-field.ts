import { z } from 'zod';

export const CalculationSchema = z
  .object({
    id: z.string().max(64).optional(),
    field: z.string().max(256).optional().default(''),
    expression: z.string().max(10000).optional().default(''),
    action: z.enum(['add', 'replace']).optional(),
  })
  .strict();

export const CalculateFieldConfigSchema = z
  .object({
    calculations: z.array(CalculationSchema).max(100).default([]),
    dsl: z.string().optional(),
  })
  .strict();
