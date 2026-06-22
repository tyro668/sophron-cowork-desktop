import { quoteIdentifier, positiveNumber, sortKeysToSql } from './utils';

export function compileLimitSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const limit = positiveNumber(config.limit, 100);
  if (config.unit === 'percent') {
    const projection = columns.map((column) => quoteIdentifier(column)).join(', ') || '*';
    const orderBy = sortKeysToSql(config.orderBy);
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT ${projection}
      FROM (
        SELECT *, ROW_NUMBER() OVER (${orderBy ? `ORDER BY ${orderBy}` : ''}) AS __rn, COUNT(*) OVER () AS __total_rows
        FROM ${input}
      )
      WHERE __rn <= CEIL(__total_rows * ${Math.min(limit, 100)} / 100.0)
    `;
  }
  const orderBy = config.mode === 'top' ? sortKeysToSql(config.orderBy) : '';
  const offset =
    typeof config.offset === 'number' && config.offset > 0 ? ` OFFSET ${config.offset}` : '';
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}${
    orderBy ? ` ORDER BY ${orderBy}` : ''
  } LIMIT ${Math.floor(limit)}${offset}`;
}
