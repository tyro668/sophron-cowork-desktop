import { z } from 'zod';

const MAX_CALCULATION_ID_LENGTH = 64;
const MAX_CALCULATION_FIELD_LENGTH = 256;
const MAX_CALCULATION_EXPRESSION_LENGTH = 10_000;
export const MAX_CALCULATION_COUNT = 100;

export const CalculationSchema = z
  .object({
    id: z.string().max(MAX_CALCULATION_ID_LENGTH).optional(),
    field: z
      .string()
      .max(MAX_CALCULATION_FIELD_LENGTH)
      .refine((value) => value.trim().length > 0, 'Calculated field name is required'),
    expression: z
      .string()
      .max(MAX_CALCULATION_EXPRESSION_LENGTH)
      .refine((value) => value.trim().length > 0, 'Calculation expression is required'),
    action: z.enum(['add', 'replace']).optional(),
  })
  .strict();

export const CalculateFieldConfigSchema = z
  .object({
    calculations: z.array(CalculationSchema).max(MAX_CALCULATION_COUNT).default([]),
  })
  .strict()
  .refine((config) => config.calculations.length > 0, {
    path: ['calculations'],
    message: 'At least one calculated field is required',
  });
