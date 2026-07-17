import { z } from 'zod';

const ConversionEntrySchema = z.object({
  column: z.string().optional().default(''),
  type: z.string().optional().default('text'),
  onError: z.string().optional(),
});

export const TypeConvertConfigSchema = z.object({
  conversions: z.array(ConversionEntrySchema).default([]),
});
