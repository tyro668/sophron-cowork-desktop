import { sortKeysToSql } from './utils';
import { SortConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileSortSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const { keys } = parseOperatorConfig(SortConfigSchema, config);
  const orderBy = sortKeysToSql(keys);
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}${orderBy ? ` ORDER BY ${orderBy}` : ''}`;
}
