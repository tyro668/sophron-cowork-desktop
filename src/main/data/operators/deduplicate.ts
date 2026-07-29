import { quoteIdentifier, quoteColumnList, sortKeysToSql } from './utils';
import { DeduplicateConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileDeduplicateSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const { columns: keys, keep, orderBy } = parseOperatorConfig(DeduplicateConfigSchema, config);
  if (keys.length === 0) {
    return `CREATE TEMP TABLE ${output} AS SELECT DISTINCT * FROM ${input}`;
  }
  const validOrderBy = orderBy.filter((k) => k.field?.trim());
  const projection = quoteColumnList(columns);
  const partitionBy = keys.map(quoteIdentifier).join(', ');

  if (keep === 'last' && validOrderBy.length === 0) {
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT ${projection}
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY __rn_inner DESC) AS __rn
        FROM (
          SELECT *, ROW_NUMBER() OVER () AS __rn_inner
          FROM ${input}
        )
      )
      WHERE __rn = 1
    `;
  }

  const adjustedOrderBy =
    keep === 'last'
      ? validOrderBy.map((key) => ({
          ...key,
          direction: key.direction === 'desc' ? 'asc' : 'desc',
          nulls: key.nulls === 'first' ? 'last' : key.nulls === 'last' ? 'first' : undefined,
        }))
      : validOrderBy;
  const orderBySql = sortKeysToSql(adjustedOrderBy);
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
