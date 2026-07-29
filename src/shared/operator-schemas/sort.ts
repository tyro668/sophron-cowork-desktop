import { z } from 'zod';
import { SortKeySchema } from './common';

const MAX_SORT_KEY_COUNT = 100;

export const SortConfigSchema = z.object({
  keys: z
    .array(SortKeySchema)
    .max(MAX_SORT_KEY_COUNT)
    .refine(
      (items) => {
        const fields = items.map((k) => k.field);
        return new Set(fields).size === fields.length;
      },
      { message: 'Duplicate sort fields' }
    )
    .default([]),
});
