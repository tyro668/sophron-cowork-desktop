import { z } from 'zod';
import { ConditionSchema, ConflictSchema, KeepItemSchema } from './common';

export const AsofConfigSchema = z.object({
  leftTime: z.string().optional().default(''),
  rightTime: z.string().optional().default(''),
  operator: z.string().optional(),
  direction: z.string().optional(),
  tolerance: z.string().optional(),
  by: z
    .array(
      z.object({
        left: z.string(),
        right: z.string(),
      })
    )
    .optional(),
});

export const JoinConfigSchema = z.object({
  joinType: z.string().default('left'),
  conditions: z.array(ConditionSchema).optional(),
  conflict: ConflictSchema.optional(),
  keep: z.array(KeepItemSchema).default([]),
  asof: z.unknown().optional(),
  rightAlias: z.string().optional(),
});
