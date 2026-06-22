import { sortKeysToSql } from './utils';

export function compileSortSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const orderBy = sortKeysToSql(config.keys);
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}${orderBy ? ` ORDER BY ${orderBy}` : ''}`;
}
