import { z } from 'zod';
import { DEFAULT_SQL_QUERY, MAX_SQL_QUERY_LENGTH, normalizeSqlQuery } from '../sql-query';

export const SqlQueryConfigSchema = z
  .object({
    sql: z
      .string()
      .max(MAX_SQL_QUERY_LENGTH)
      .default(DEFAULT_SQL_QUERY)
      .superRefine((value, ctx) => {
        try {
          normalizeSqlQuery(value);
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
  })
  .strict();
