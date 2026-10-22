import { z } from 'zod';

export const UnnestConfigSchema = z
  .object({
    sourceKind: z.enum(['list', 'json']).default('list'),
    field: z.string().trim().min(1, 'Source column is required'),
    alias: z.string().trim().optional().default(''),
    path: z.string().default('$'),
    withIndex: z.string().trim().optional(),
    keepParentNames: z.boolean().default(false),
    preserveOrder: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.sourceKind === 'list' && !data.alias?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Alias is required for list mode',
        path: ['alias'],
      });
    }
    if (data.sourceKind === 'list' && data.withIndex !== undefined && !data.withIndex.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Index column name cannot be empty',
        path: ['withIndex'],
      });
    }
  });
