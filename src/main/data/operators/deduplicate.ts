import { quoteIdentifier, quoteColumnList, stringArray, sortKeysToSql } from './utils';

export function compileDeduplicateSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const keys = stringArray(config.columns);
  if (keys.length === 0) {
    return `CREATE TEMP TABLE ${output} AS SELECT DISTINCT * FROM ${input}`;
  }
  const partitionBy = keys.map(quoteIdentifier).join(', ');
  const orderBy = sortKeysToSql(config.orderBy);
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT ${quoteColumnList(columns)}
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy}${orderBy ? ` ORDER BY ${orderBy}` : ''}) AS __rn
      FROM ${input}
    )
    WHERE __rn = 1
  `;
}
