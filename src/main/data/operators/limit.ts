import { quoteIdentifier, positiveNumber, sortKeysToSql } from './utils';

function compileFixedSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>,
  limit: number
): string {
  const unit = config.unit as string;
  const orderBy = sortKeysToSql(config.orderBy);
  const groupBy = config?.groupBy as string[] | undefined;

  // 百分比模式
  if (unit === 'percent') {
    const projection = columns.map((column) => quoteIdentifier(column)).join(', ') || '*';
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT ${projection}
      FROM (
        SELECT *, ROW_NUMBER() OVER (${orderBy ? `ORDER BY ${orderBy}` : ''}) AS __rn,
               COUNT(*) OVER () AS __total_rows
        FROM ${input}
      )
      WHERE __rn <= CEIL(__total_rows * ${Math.min(limit, 100)} / 100.0)
    `;
  }

  // 分组模式
  if (groupBy?.length) {
    const projection = columns.map(quoteIdentifier).join(', ') || '*';
    const partitionBy = groupBy.map(quoteIdentifier).join(', ');
    const orderClause = orderBy ? ` ORDER BY ${orderBy}` : '';
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT ${projection}
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy}${orderClause}) AS __rn
        FROM ${input}
      )
      WHERE __rn <= ${Math.floor(limit)}
    `;
  }

  // 排序模式（含 WITH TIES）
  if (orderBy) {
    const ties = config?.ties ? ' WITH TIES' : '';
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} ORDER BY ${orderBy} LIMIT ${Math.floor(limit)}${ties}`;
  }

  // 简单 LIMIT + OFFSET
  const offset =
    typeof config.offset === 'number' && config.offset > 0 ? ` OFFSET ${config.offset}` : '';
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} LIMIT ${Math.floor(limit)}${offset}`;
}

function compileRandomSql(
  output: string,
  input: string,
  _columns: string[],
  config: Record<string, unknown>,
  limit: number
): string {
  if (config.unit === 'percent') {
    const method = config.method === 'system' ? 'SYSTEM' : 'BERNOULLI';
    const seed = typeof config.seed === 'number' ? ` REPEATABLE(${config.seed})` : '';
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} TABLESAMPLE ${method}(${Math.min(limit, 100)}%)${seed}`;
  }
  const rows = Math.floor(limit);
  const method = config.method === 'system' ? ' (system)' : '';
  const seed = typeof config.seed === 'number' ? ` REPEATABLE(${config.seed})` : '';
  if (seed) {
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} USING SAMPLE reservoir(${rows} ROWS)${seed}`;
  }
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} USING SAMPLE ${rows} ROWS${method}`;
}

export function compileLimitSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const limit = positiveNumber(config.limit, 100);

  if (config.mode === 'random') {
    return compileRandomSql(output, input, columns, config, limit);
  }
  return compileFixedSql(output, input, columns, config, limit);
}
