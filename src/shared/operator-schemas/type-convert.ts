import { z } from 'zod';

const ConversionEntrySchema = z.object({
  column: z.string().optional().default(''),
  type: z
    .enum(['text', 'integer', 'float', 'decimal', 'date', 'datetime', 'boolean'])
    .optional()
    .default('text'),
  onError: z.enum(['keep', 'fail', 'null']).optional(),
});

export const TypeConvertConfigSchema = z.object({
  conversions: z.array(ConversionEntrySchema).default([]),
});
