import { z } from 'zod';

export const SortKeySchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']).default('asc'),
  nulls: z.enum(['first', 'last']).optional(),
});

export const ConditionSchema = z.object({
  left: z.string(),
  operator: z.string(),
  right: z.string(),
});

export const ConflictSchema = z.object({
  strategy: z.string().default('suffix'),
  rightPrefix: z.string().optional(),
  leftSuffix: z.string().optional(),
  rightSuffix: z.string().optional(),
});

export const MetricEntrySchema = z.object({
  function: z.string().optional().default(''),
  expression: z.string().optional().default(''),
  alias: z.string().optional().default(''),
});

export type SortKey = z.infer<typeof SortKeySchema>;

export const KeepItemSchema = z.object({
  side: z.string().optional(),
  wildcard: z.boolean().optional(),
  source: z.string().optional(),
  alias: z.string().optional(),
});
