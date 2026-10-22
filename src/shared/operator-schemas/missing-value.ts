import { z } from 'zod';

export const MissingValueMethodSchema = z.enum([
  'skip',
  'nullify_values',
  'literal_fill',
  'drop',
  'mean_fill',
  'median_fill',
  'mode_fill',
  'forward_fill',
  'backward_fill',
]);

export type MissingValueMethod = z.infer<typeof MissingValueMethodSchema>;

export const MissingValueRuleSchema = z.object({
  id: z.string().optional(),
  field: z.string().trim().min(1),
  method: MissingValueMethodSchema.default('literal_fill'),
  values: z.array(z.unknown()).optional(),
  value: z.unknown().optional(),
});

export const MissingValueConfigSchema = z
  .object({
    strategy: z.enum(['by_column', 'drop_empty_rows', 'drop_rows_by_nulls']).default('by_column'),
    rules: z.array(MissingValueRuleSchema).default([]),
    fields: z.array(z.string().trim().min(1)).optional(),
    condition: z.enum(['all_null', 'any_null']).optional(),
  })
  .superRefine((config, context) => {
    if (config.strategy === 'drop_rows_by_nulls' && !config.condition) {
      context.addIssue({
        code: 'custom',
        path: ['condition'],
        message: 'Row deletion requires an explicit all_null or any_null condition',
      });
    }
    if (config.strategy === 'drop_empty_rows' && config.condition === 'any_null') {
      context.addIssue({
        code: 'custom',
        path: ['condition'],
        message: 'drop_empty_rows only supports the all_null condition',
      });
    }
    if (config.strategy !== 'by_column' && config.fields) {
      const seenColumns = new Set<string>();
      config.fields.forEach((column, index) => {
        if (seenColumns.has(column)) {
          context.addIssue({
            code: 'custom',
            path: ['fields', index],
            message: `Row deletion field "${column}" is duplicated`,
          });
        } else {
          seenColumns.add(column);
        }
      });
    }
    if (config.strategy !== 'by_column') return;
    if (config.rules.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['rules'],
        message: 'Column-based missing-value processing requires at least one rule',
      });
      return;
    }
    config.rules.forEach((rule, index) => {
      if (rule.method === 'nullify_values' && (!rule.values || rule.values.length === 0)) {
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'values'],
          message: 'Nullify values requires at least one value',
        });
      }
      if (
        rule.method === 'literal_fill' &&
        (rule.value === null || rule.value === undefined || rule.value === '')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'value'],
          message: 'Literal fill requires a non-null value',
        });
      }
    });
  });

export type MissingValueRule = z.infer<typeof MissingValueRuleSchema>;
