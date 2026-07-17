import { z } from 'zod';

const MappingEntrySchema = z.object({
  source: z.string().optional().default(''),
  target: z.string().optional().default(''),
  targetMode: z.string().optional(),
  targetValue: z.string().optional().default(''),
});

export const FieldMappingConfigSchema = z.object({
  mappings: z.array(MappingEntrySchema).default([]),
});
