import { z } from 'zod';
import { AggregateFunctionSchema } from './common';

const MAX_FIELD_NAME_LENGTH = 256;
const MAX_ON_COUNT = 50;
const MAX_USING_COUNT = 100;
const MAX_GROUP_BY_COUNT = 100;
const MAX_EXPRESSION_LENGTH = 10_000;
const MAX_ALIAS_LENGTH = 256;
const MAX_VALUE_LENGTH = 10_000;
const MAX_VALUES_PER_FIELD = 1_000;

export const PivotLiteralSchema = z.union([
  z.string().max(MAX_VALUE_LENGTH),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const PivotAxisEntrySchema = z.object({
  field: z.string().trim().min(1).max(MAX_FIELD_NAME_LENGTH),
  values: z.array(PivotLiteralSchema).max(MAX_VALUES_PER_FIELD).default([]),
});

const PivotMetricSchema = z.object({
  function: AggregateFunctionSchema,
  expression: z.string().trim().min(1).max(MAX_EXPRESSION_LENGTH),
  alias: z.string().trim().max(MAX_ALIAS_LENGTH).optional(),
});

export const PivotConfigSchema = z.object({
  on: z
    .array(PivotAxisEntrySchema)
    .min(1)
    .max(MAX_ON_COUNT)
    .refine((entries) => {
      const seen = new Set<string>();
      for (const entry of entries) {
        const key = entry.field.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    }, 'Pivot axis fields must be unique'),
  using: z.array(PivotMetricSchema).min(1).max(MAX_USING_COUNT),
  groupBy: z.array(z.string().max(MAX_FIELD_NAME_LENGTH)).max(MAX_GROUP_BY_COUNT).default([]),
});
