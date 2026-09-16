import { z } from 'zod';
import { nonEmptyTrimmed } from './common';

export const EXPECT_KINDS = ['expression', 'unique', 'row_count'] as const;
export const EXPECT_ROW_OPERATORS = ['>', '>=', '=', '!=', '<=', '<'] as const;

export const ExpectConfigSchema = z
  .object({
    kind: z.enum(EXPECT_KINDS).default('expression'),
    expression: z.string().optional(),
    columns: z.array(nonEmptyTrimmed('unique field is required')).optional(),
    operator: z.enum(EXPECT_ROW_OPERATORS).optional(),
    value: z.number().int().nonnegative().optional(),
    rejectStream: nonEmptyTrimmed('reject stream name is required').optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.kind === 'expression' && !config.expression?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['expression'],
        message: 'expect requires an expression',
      });
    }
    if (config.kind === 'unique' && (config.columns ?? []).length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['columns'],
        message: 'expect unique requires at least one field',
      });
    }
    if (
      config.kind === 'row_count' &&
      (config.operator === undefined || config.value === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'expect rows requires an operator and a count',
      });
    }
    // A row-count violation is not a per-row rejection — there is nothing to
    // route. Forbid the combination so `reject to` is never silently ignored.
    if (config.kind === 'row_count' && config.rejectStream) {
      context.addIssue({
        code: 'custom',
        path: ['rejectStream'],
        message:
          'expect rows assertions cannot use "reject to" — row counts have no violating rows to route',
      });
    }
  });
