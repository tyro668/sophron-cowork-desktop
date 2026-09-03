import { z } from 'zod';
import { nonEmptyTrimmed } from './common';

const MAX_MAPPING_COUNT = 100;

export const FieldMappingEntrySchema = z.object({
  source: nonEmptyTrimmed('Source field is required'),
  targetMode: z.enum(['prefix', 'suffix', 'rename']),
  targetValue: nonEmptyTrimmed('Target value is required'),
});

export const FieldMappingConfigSchema = z
  .object({
    mappings: z.array(FieldMappingEntrySchema).max(MAX_MAPPING_COUNT).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.mappings.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one field mapping is required',
        path: ['mappings'],
      });
    }
    const sources = data.mappings.map((m) => m.source).filter(Boolean);
    if (new Set(sources).size !== sources.length) {
      ctx.addIssue({ code: 'custom', message: 'Source fields must be unique', path: ['mappings'] });
    }
    const targets = data.mappings
      .map((m) => {
        if (!m.source) return '';
        if (m.targetMode === 'rename') return m.targetValue;
        if (m.targetMode === 'prefix') return `${m.targetValue}${m.source}`;
        return `${m.source}${m.targetValue}`;
      })
      .filter(Boolean);
    if (new Set(targets).size !== targets.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Mapped target fields must be unique',
        path: ['mappings'],
      });
    }
  });

export type FieldMappingEntry = z.infer<typeof FieldMappingEntrySchema>;
