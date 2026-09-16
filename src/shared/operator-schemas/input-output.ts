import { z } from 'zod';

/**
 * Typed configs for the boundary operators. `looseObject` keeps GUI metadata
 * and forward-compatible fields in the parsed result while validating the
 * contract fields the runtime depends on.
 */
export const InputSourceConfigSchema = z
  .looseObject({
    source: z.enum(['dataset', 'task', 'file']).optional(),
    datasetId: z.string().trim().min(1).optional(),
    filePath: z.string().trim().optional(),
    alias: z
      .string()
      .trim()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'alias must be a simple identifier')
      .optional(),
    incrementalBy: z.string().trim().min(1).optional(),
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
    destination: z.enum(['duckdb_table', 'dataset', 'file']).optional(),
    table: z.string().trim().optional(),
    mode: z.enum(['replace', 'append', 'error_if_exists', 'merge']).optional(),
    mergeKeys: z.array(z.string().trim().min(1)).optional(),
    schemaPolicy: z.enum(['extend', 'strict', 'ignore']).optional(),
    outputDatasetId: z.string().trim().optional(),
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
    if (config.mergeKeys && config.mergeKeys.length > 0 && config.mode && config.mode !== 'merge') {
      context.addIssue({
        code: 'custom',
        path: ['mergeKeys'],
        message: 'mergeKeys are only valid with mode "merge"',
      });
    }
  });
