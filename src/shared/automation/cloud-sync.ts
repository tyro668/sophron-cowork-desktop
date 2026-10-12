import { z } from 'zod';

export const CLOUD_SYNC_ACTION = 'cloud.sync';
const name = z.string().trim().min(1);
const optionalName = name.optional();

const cloudInputSyncShape = z.object({
  syncKey: optionalName,
  spaceId: name,
  projectId: name,
  tableId: name,
  tableKind: z.enum(['analysis', 'base']),
  tableName: optionalName,
  rawTableId: optionalName,
  rawTableName: optionalName,
  // Run the automation when the linked input table's data commits.
  runOnChange: z.boolean().optional(),
});

const cloudOutputSyncShape = z.object({
  resultTableId: name,
  type: z.literal('drive_file'),
  writeMode: z.enum(['create', 'replace', 'append']).optional(),
  // Preserves legacy remote idempotency keys during migration.
  syncKey: optionalName,
  spaceId: name,
  projectId: name,
  fileId: optionalName,
  fileName: optionalName,
  version: z.number().int().nonnegative().optional(),
});

// Direction-free shapes used by the data command layer; node configs add `direction`.
export const cloudInputSyncSchema = cloudInputSyncShape.refine(
  (config) => config.rawTableId || config.rawTableName,
  { message: 'Choose an input table or name a new input table' }
);
export const cloudOutputSyncSchema = cloudOutputSyncShape
  .refine((config) => config.writeMode !== 'create' || !config.fileId, {
    message: 'Create requires a new drive file',
  })
  .refine((config) => !['replace', 'append'].includes(config.writeMode ?? '') || !!config.fileId, {
    message: 'Replace and append require a drive file',
  });

export const cloudSyncSchema = z
  .discriminatedUnion('direction', [
    cloudInputSyncShape.extend({ direction: z.literal('input') }),
    cloudOutputSyncShape.extend({ direction: z.literal('output') }),
  ])
  .superRefine((config, ctx) => {
    if (config.direction === 'input' && !config.rawTableId && !config.rawTableName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose an input table or name a new input table',
      });
    }
    if (config.direction === 'output') {
      if (config.writeMode === 'create' && config.fileId)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Create requires a new drive file',
        });
      if (['replace', 'append'].includes(config.writeMode ?? '') && !config.fileId)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Replace and append require a drive file',
        });
    }
  });
export type CloudInputSyncConfig = z.infer<typeof cloudInputSyncSchema>;
export type CloudOutputSyncConfig = z.infer<typeof cloudOutputSyncSchema>;
export type CloudSyncConfig = z.infer<typeof cloudSyncSchema>;
