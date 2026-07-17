import { z } from 'zod';
import { ConditionSchema, ConflictSchema, KeepItemSchema } from './common';

export const AsofConfigSchema = z.object({
  leftTime: z.string().optional().default(''),
  rightTime: z.string().optional().default(''),
  operator: z.enum(['>=', '<=', 'nearest']).optional(),
  direction: z.enum(['forward', 'backward']).optional(),
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
  joinType: z
    .enum(['inner', 'left', 'right', 'full', 'cross', 'semi', 'anti', 'asof'])
    .default('left'),
  conditions: z.array(ConditionSchema).optional(),
  conflict: ConflictSchema.optional(),
  keep: z.array(KeepItemSchema).default([]),
  asof: z.unknown().optional(),
  rightAlias: z.string().optional(),
});
