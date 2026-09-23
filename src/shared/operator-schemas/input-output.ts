import { z } from 'zod';

/**
 * Typed configs for the boundary operators. `looseObject` keeps GUI metadata
 * and forward-compatible fields in the parsed result while validating the
 * contract fields the runtime depends on.
 */
export const InputSourceConfigSchema = z
  .looseObject({
    source: z
      .enum(['dataset', 'task', 'file'])
      .describe(
        '"dataset" reads a bound input table, "task" the task source file, "file" a literal filePath'
      )
      .optional(),
    datasetId: z
      .string()
      .trim()
      .min(1)
      .describe('Bound input table id; usually set via resources.inputs[alias]')
      .optional(),
    filePath: z.string().trim().describe('Literal file path for source=file').optional(),
    alias: z
      .string()
      .trim()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'alias must be a simple identifier')
      .describe('Stream name this source produces')
      .optional(),
    incrementalBy: z
      .string()
      .trim()
      .min(1)
      .describe('For task/file sources only: reads rows newer than the last committed watermark')
      .optional(),
  })
  .superRefine((config, context) => {
    if (config.source === 'dataset' && !config.datasetId) {
      context.addIssue({
        code: 'custom',
        path: ['datasetId'],
        message: 'input source "dataset" requires a bound datasetId (or resources.inputs binding)',
      });
    }
    if (config.source === 'file' && !config.filePath?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['filePath'],
        message: 'input source "file" requires filePath',
      });
    }
  });

export const OutputConfigSchema = z
  .looseObject({
    destination: z
      .enum(['duckdb_table'])
      .describe('Only "duckdb_table" (output table) is executable')
      .optional(),
    table: z.string().trim().describe('Output table name').optional(),
    mode: z.enum(['replace', 'append', 'error_if_exists', 'merge']).optional(),
    mergeKeys: z
      .array(z.string().trim().min(1))
      .describe('Business keys; required when mode=merge')
      .optional(),
    schemaPolicy: z.enum(['extend', 'strict', 'ignore']).optional(),
    outputDatasetId: z
      .string()
      .trim()
      .describe('Real output table id (from data_list_output_tables)')
      .optional(),
    outputTableId: z.string().trim().optional(),
    outputStrategy: z.enum(['existing', 'auto']).optional(),
    outputTableName: z.string().trim().optional(),
  })
  .superRefine((config, context) => {
    if (config.mode === 'merge' && (!config.mergeKeys || config.mergeKeys.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['mergeKeys'],
        message: 'mode "merge" requires at least one mergeKeys business key',
      });
    }
    // mergeKeys without mode fall back to mode "replace" at runtime and fail
    // there — reject them at validation time instead.
    if (config.mergeKeys && config.mergeKeys.length > 0 && config.mode !== 'merge') {
      context.addIssue({
        code: 'custom',
        path: ['mergeKeys'],
        message: 'mergeKeys are only valid with mode "merge"',
      });
    }
  });
