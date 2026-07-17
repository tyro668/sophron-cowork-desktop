import { quoteIdentifier, quoteColumnList, sortKeysToSql } from './utils';
import { DeduplicateConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileDeduplicateSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const { columns: keys, orderBy } = parseOperatorConfig(DeduplicateConfigSchema, config);
  if (keys.length === 0) {
    return `CREATE TEMP TABLE ${output} AS SELECT DISTINCT * FROM ${input}`;
  }
  const partitionBy = keys.map(quoteIdentifier).join(', ');
  const orderBySql = sortKeysToSql(orderBy);
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT ${quoteColumnList(columns)}
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy}${orderBySql ? ` ORDER BY ${orderBySql}` : ''}) AS __rn
      FROM ${input}
    )
    WHERE __rn = 1
  `;
}
