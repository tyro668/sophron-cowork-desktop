import { z } from 'zod';

const MAX_MAPPING_COUNT = 100;

export const FieldMappingEntrySchema = z
  .object({
    source: z.string().optional().default(''),
    targetMode: z.enum(['prefix', 'suffix', 'rename']),
    targetValue: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    if (!data.source) return;
    if (data.targetMode === 'rename' && !data.targetValue?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '重命名模式必须填写新字段名',
        path: ['targetValue'],
      });
    }
    if (
      (data.targetMode === 'prefix' || data.targetMode === 'suffix') &&
      !data.targetValue?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '加前缀/后缀模式必须填写前后缀',
        path: ['targetValue'],
      });
    }
  });

export const FieldMappingConfigSchema = z
  .object({
    mappings: z.array(FieldMappingEntrySchema).max(MAX_MAPPING_COUNT).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.mappings.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field mapping is required',
        path: ['mappings'],
      });
    }
    data.mappings.forEach((mapping, index) => {
      if (!mapping.source.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Source field is required',
          path: ['mappings', index, 'source'],
        });
      }
    });
    const sources = data.mappings.map((m) => m.source).filter(Boolean);
    if (new Set(sources).size !== sources.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '源字段不能重复', path: ['mappings'] });
    }
    const targets = data.mappings
      .map((m) => {
        if (!m.source) return '';
        if (m.targetMode === 'rename') return m.targetValue;
        if (m.targetMode === 'prefix') return `${m.targetValue}${m.source}`;
        if (m.targetMode === 'suffix') return `${m.source}${m.targetValue}`;
        return '';
      })
      .filter(Boolean);
    if (new Set(targets).size !== targets.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '映射后的目标字段不能重复',
        path: ['mappings'],
      });
    }
  });

export type FieldMappingEntry = z.infer<typeof FieldMappingEntrySchema>;
