import { z } from 'zod';

export const UnnestConfigSchema = z.object({
  sourceKind: z.enum(['list', 'json']).default('list'),
  column: z.string().default('items'),
  alias: z.string().default('item'),
  path: z.string().default('$'),
  withIndex: z.string().optional(),
  keepParentNames: z.boolean().default(false),
  recursive: z.boolean().default(false),
  maxDepth: z.number().optional(),
});
