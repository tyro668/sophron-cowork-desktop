import { z } from 'zod';
import { isAllowedCalculationFunction, parseBound } from '../calculate-field/index';

const OrderByEntrySchema = z.object({
  field: z.string().min(1),
  direction: z.enum(['asc', 'desc']).optional(),
});

function isValidFrameBound(v: string | undefined): boolean {
  if (!v) return true;
  const result = parseBound(v);
  return result.type !== 'invalid';
}

export const CalculationSchema = z.object({
  field: z.string().max(256).optional().default(''),
  expression: z.string().max(10000).optional().default(''),
  action: z.enum(['add', 'replace']).optional(),
  id: z.string().max(64).optional(),
  type: z.enum(['row', 'agg', 'window', 'cross']).optional(),
  fn: z
    .string()
    .refine((v) => !v || isAllowedCalculationFunction(v), {
      message: 'Unsupported function in calculation',
    })
    .optional(),
  fnArg: z.string().max(256).optional(),
  fnArg2: z.string().max(256).optional(),
  scenario: z
    .enum([
      'group_metrics',
      'ranking',
      'cumulative',
      'offset',
      'moving_window',
      'period_compare',
      'time_intel',
    ])
    .optional(),
  partitionBy: z.array(z.string().max(256)).max(50).optional(),
  orderBy: z.array(OrderByEntrySchema).max(50).optional(),
  frameType: z.enum(['rows', 'range', 'groups']).optional(),
  frameStart: z.string().refine(isValidFrameBound, 'Invalid frame bound').max(64).optional(),
  frameEnd: z.string().refine(isValidFrameBound, 'Invalid frame bound').max(64).optional(),
  frameExclude: z.enum(['current row', 'group', 'ties', 'no others']).optional(),
  fiscalStartMonth: z.number().int().min(1).max(12).optional(),
});

export const CalculateFieldConfigSchema = z.object({
  calculations: z.array(CalculationSchema).max(100).default([]),
  _activeMode: z.enum(['row', 'cross']).optional(),
  _activeScenario: z
    .enum([
      'group_metrics',
      'ranking',
      'cumulative',
      'offset',
      'moving_window',
      'period_compare',
      'time_intel',
    ])
    .optional(),
});
