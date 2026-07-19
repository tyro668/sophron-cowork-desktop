import { z } from 'zod';
import { SortKeySchema } from './common';

export const SortConfigSchema = z.object({
  keys: z.array(SortKeySchema).default([]),
});
