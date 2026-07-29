import { z } from 'zod';

const MAX_MAPPING_COUNT = 100;

const MappingEntrySchema = z
  .object({
    source: z.string().optional().default(''),
    target: z.string().optional().default(''),
    targetMode: z.enum(['prefix', 'suffix', 'rename']).optional(),
    targetValue: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    if (!data.targetMode && data.target) return;
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
    mappings: z.array(MappingEntrySchema).max(MAX_MAPPING_COUNT).default([]),
  })
  .superRefine((data, ctx) => {
    const sources = data.mappings.map((m) => m.source).filter(Boolean);
    if (new Set(sources).size !== sources.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '源字段不能重复', path: ['mappings'] });
    }
    const targets = data.mappings
      .map((m) => {
        if (!m.source || !m.targetMode) return '';
        if (m.targetMode === 'rename') return m.targetValue || m.target || '';
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
