import { z } from 'zod';
import { MAX_ROW_ID_LENGTH, nonEmptyTrimmed } from './common';

export const DATE_FORMAT_VALUES = [
  '%Y-%m-%d',
  '%Y/%m/%d',
  '%m/%d/%Y',
  '%m/%d/%y',
  '%d/%m/%Y',
  '%Y%m%d',
  '%Y年%m月%d日',
  '%d-%m-%Y',
  '%Y.%m.%d',
  '%d.%m.%Y',
  '%B %d, %Y',
  '%b %d, %Y',
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%dT%H:%M:%S',
] as const;

export type DateFormat = (typeof DATE_FORMAT_VALUES)[number];

export const DATE_FORMAT_PRESETS: Array<{ value: DateFormat; example: string }> = [
  { value: '%Y-%m-%d', example: '2024-03-15' },
  { value: '%Y/%m/%d', example: '2024/03/15' },
  { value: '%m/%d/%Y', example: '03/15/2024' },
  { value: '%m/%d/%y', example: '03/15/24' },
  { value: '%d/%m/%Y', example: '15/03/2024' },
  { value: '%Y%m%d', example: '20240315' },
  { value: '%Y年%m月%d日', example: '2025年01月12日' },
  { value: '%d-%m-%Y', example: '15-03-2024' },
  { value: '%Y.%m.%d', example: '2024.03.15' },
  { value: '%d.%m.%Y', example: '15.03.2024' },
  { value: '%B %d, %Y', example: 'March 15, 2024' },
  { value: '%b %d, %Y', example: 'Mar 15, 2024' },
  { value: '%Y-%m-%d %H:%M:%S', example: '2024-03-15 10:30:00' },
  { value: '%Y-%m-%dT%H:%M:%S', example: '2024-03-15T10:30:00' },
];

export const SCALE_MIN = 0;
export const SCALE_MAX = 18;

export const TypeConversionEntrySchema = z
  .object({
    id: z.string().max(MAX_ROW_ID_LENGTH).optional(),
    column: nonEmptyTrimmed('Source column is required'),
    type: z
      .enum(['text', 'integer', 'float', 'decimal', 'date', 'datetime', 'boolean'])
      .optional()
      .default('text'),
    onError: z.enum(['keep', 'fail', 'null']).optional(),
    format: z.preprocess((v) => (v === '' ? undefined : v), z.enum(DATE_FORMAT_VALUES).optional()),
    scale: z.preprocess(
      (v) => (v === '' || v === undefined ? undefined : Number(v)),
      z.number().int().min(SCALE_MIN).max(SCALE_MAX).optional()
    ),
  })
  .superRefine((data, ctx) => {
    if (data.format && data.type !== 'date' && data.type !== 'datetime') {
      ctx.addIssue({
        code: 'custom',
        message: `Format is only valid for date/datetime conversions, not ${data.type}`,
        path: ['format'],
      });
    }
    if (data.scale !== undefined && data.type !== 'decimal') {
      ctx.addIssue({
        code: 'custom',
        message: `Scale is only valid for decimal conversions, not ${data.type}`,
        path: ['scale'],
      });
    }
  });

export const TypeConvertConfigSchema = z
  .object({
    conversions: z.array(TypeConversionEntrySchema).default([]),
  })
  .refine((config) => config.conversions.length > 0, {
    path: ['conversions'],
    message: 'At least one type conversion is required',
  });

export type TypeConversionEntry = z.infer<typeof TypeConversionEntrySchema>;
