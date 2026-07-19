import { z } from 'zod';

const CalculationSchema = z.object({
  field: z.string().optional().default(''),
  expression: z.string().optional().default(''),
  action: z.string().optional(),
  id: z.string().optional(),
  type: z.string().optional(),
  fn: z.string().optional(),
  fnArg: z.string().optional(),
  fnArg2: z.string().optional(),
  scenario: z.string().optional(),
  partitionBy: z.array(z.string()).optional(),
  orderBy: z.array(z.object({}).passthrough()).optional(),
  frameType: z.string().optional(),
  frameStart: z.string().optional(),
  frameEnd: z.string().optional(),
  frameExclude: z.string().optional(),
  fiscalStartMonth: z.number().optional(),
});

export const CalculateFieldConfigSchema = z.object({
  calculations: z.array(CalculationSchema).default([]),
  _activeMode: z.string().optional(),
  _activeScenario: z.string().optional(),
});
