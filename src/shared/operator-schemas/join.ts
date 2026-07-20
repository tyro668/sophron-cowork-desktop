import { z } from 'zod';
import { ConditionSchema, ConflictSchema, KeepItemSchema } from './common';

export const AsofConfigSchema = z.object({
  leftTime: z.string().optional().default(''),
  rightTime: z.string().optional().default(''),
  operator: z.enum(['>=', '<=', 'nearest']).optional(),
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
  asof: AsofConfigSchema.optional(),
  rightAlias: z.string().optional(),
});

function msToParts(ms: number): { d: number; h: number; m: number; s: number; ms: number } {
  let r = ms;
  const d = Math.floor(r / 86_400_000);
  r -= d * 86_400_000;
  const h = Math.floor(r / 3_600_000);
  r -= h * 3_600_000;
  const m = Math.floor(r / 60_000);
  r -= m * 60_000;
  const s = Math.floor(r / 1_000);
  r -= s * 1_000;
  return { d, h, m, s, ms: r };
}

export function parseDuration(value: string): {
  d: number;
  h: number;
  m: number;
  s: number;
  ms: number;
} {
  if (!value) return { d: 0, h: 0, m: 0, s: 0, ms: 0 };
  if (/^\d+$/.test(value)) return msToParts(Number(value));
  let totalMs = 0;
  let i = 0;
  while (i < value.length) {
    let numStr = '';
    while (i < value.length && /[0-9.]/.test(value[i])) {
      numStr += value[i];
      i++;
    }
    if (!numStr) {
      i++;
      continue;
    }
    const num = Number(numStr);
    if (value.startsWith('ms', i)) {
      totalMs += num;
      i += 2;
    } else if (value[i] === 'd') {
      totalMs += num * 86_400_000;
      i += 1;
    } else if (value[i] === 'h') {
      totalMs += num * 3_600_000;
      i += 1;
    } else if (value[i] === 'm') {
      totalMs += num * 60_000;
      i += 1;
    } else if (value[i] === 's') {
      totalMs += num * 1_000;
      i += 1;
    } else i++;
  }
  return msToParts(totalMs);
}

export function normalizeDuration(value: string): string {
  if (!value) return '';
  const { d, h, m, s, ms } = parseDuration(value);
  const totalMs = d * 86_400_000 + h * 3_600_000 + m * 60_000 + s * 1_000 + ms;
  if (totalMs <= 0) return '';
  const partValues = [ms, s, m, h, d];
  const units: [number, string][] = [
    [1, 'ms'],
    [1_000, 's'],
    [60_000, 'm'],
    [3_600_000, 'h'],
    [86_400_000, 'd'],
  ];
  for (let i = 0; i < partValues.length; i++) {
    if (partValues[i] > 0) {
      const [div, unit] = units[i];
      return `${totalMs / div}${unit}`;
    }
  }
  return '';
}
