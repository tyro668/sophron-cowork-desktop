import { z } from 'zod';
import { quoteIdentifier, sortKeysToSql } from './utils';
import { LimitConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

type LimitParsed = z.infer<typeof LimitConfigSchema>;

function compileFixedSql(
  output: string,
  input: string,
  columns: string[],
  parsed: LimitParsed,
  limit: number
): string {
  const unit = parsed.unit;
  const orderBy = sortKeysToSql(parsed.orderBy);
  const groupBy = parsed.groupBy;
  const ties = parsed.ties;
  const projection = columns.map((column) => quoteIdentifier(column)).join(', ') || '*';
  const pct = Math.min(limit, 100);
  const rows = Math.floor(limit);

  // 创建子查询别名
  const projectionSub = `SELECT ${projection}`;

  // 百分比 + 分组 + 排序 + WITH TIES
  if (unit === 'percent' && groupBy?.length && ties && orderBy) {
    const partitionBy = groupBy.map(quoteIdentifier).join(', ');
    return `
      CREATE TEMP TABLE ${output} AS
      WITH numbered AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY ${orderBy}) AS __rn,
               RANK() OVER (PARTITION BY ${partitionBy} ORDER BY ${orderBy}) AS __rk,
               COUNT(*) OVER (PARTITION BY ${partitionBy}) AS __group_total
        FROM ${input}
      ),
      boundary AS (
        SELECT ${partitionBy}, __rk AS __bound_rk
        FROM numbered
        WHERE __rn = CEIL(__group_total * ${pct} / 100.0)
      )
      ${projectionSub}
      FROM numbered JOIN boundary USING (${partitionBy})
      WHERE __rk <= __bound_rk`;
  }

  // 百分比 + 分组 + 排序（无 TIES）
  if (unit === 'percent' && groupBy?.length) {
    const partitionBy = groupBy.map(quoteIdentifier).join(', ');
    const orderClause = orderBy ? ` ORDER BY ${orderBy}` : '';
    return `
      CREATE TEMP TABLE ${output} AS
      ${projectionSub}
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy}${orderClause}) AS __rn,
               COUNT(*) OVER (PARTITION BY ${partitionBy}) AS __group_total
        FROM ${input}
      ) sub
      WHERE __rn <= CEIL(__group_total * ${pct} / 100.0)`;
  }

  // 百分比 + 排序 + WITH TIES
  if (unit === 'percent' && ties && orderBy) {
    return `
      CREATE TEMP TABLE ${output} AS
      WITH cnt AS (SELECT COUNT(*) AS __total FROM ${input}),
      numbered AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS __rn,
               RANK() OVER (ORDER BY ${orderBy}) AS __rk
        FROM ${input}
      )
      ${projectionSub}
      FROM numbered
      WHERE __rk <= (SELECT __rk FROM numbered, cnt WHERE __rn = CEIL(cnt.__total * ${pct} / 100.0))`;
  }

  // 百分比
  if (unit === 'percent') {
    return `
      CREATE TEMP TABLE ${output} AS
      ${projectionSub}
      FROM (
        SELECT *, ROW_NUMBER() OVER (${orderBy ? `ORDER BY ${orderBy}` : ''}) AS __rn,
               COUNT(*) OVER () AS __total_rows
        FROM ${input}
      ) sub
      WHERE __rn <= CEIL(__total_rows * ${pct} / 100.0)`;
  }

  // 分组模式（行数） + WITH TIES
  if (groupBy?.length && ties && orderBy) {
    const partitionBy = groupBy.map(quoteIdentifier).join(', ');
    return `
      CREATE TEMP TABLE ${output} AS
      WITH numbered AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY ${orderBy}) AS __rn,
               RANK() OVER (PARTITION BY ${partitionBy} ORDER BY ${orderBy}) AS __rk
        FROM ${input}
      ),
      boundary AS (
        SELECT ${partitionBy}, __rk AS __bound_rk
        FROM numbered
        WHERE __rn = ${rows}
      )
      ${projectionSub}
      FROM numbered JOIN boundary USING (${partitionBy})
      WHERE __rk <= __bound_rk`;
  }

  // 分组模式（行数）
  if (groupBy?.length) {
    const partitionBy = groupBy.map(quoteIdentifier).join(', ');
    const orderClause = orderBy ? ` ORDER BY ${orderBy}` : '';
    return `
      CREATE TEMP TABLE ${output} AS
      ${projectionSub}
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy}${orderClause}) AS __rn
        FROM ${input}
      ) sub
      WHERE __rn <= ${rows}`;
  }

  if (orderBy) {
    const offsetStr = parsed.offset > 0 ? ` OFFSET ${parsed.offset}` : '';
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} ORDER BY ${orderBy} LIMIT ${rows}${ties ? ' WITH TIES' : ''}${offsetStr}`;
  }

  const offsetStr = parsed.offset > 0 ? ` OFFSET ${parsed.offset}` : '';
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} LIMIT ${rows}${offsetStr}`;
}

function compileRandomSql(
  output: string,
  input: string,
  _columns: string[],
  parsed: LimitParsed,
  limit: number
): string {
  if (parsed.unit === 'percent') {
    const method = parsed.method === 'system' ? 'SYSTEM' : 'BERNOULLI';
    const seed = parsed.seed != null ? ` REPEATABLE(${parsed.seed})` : '';
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} TABLESAMPLE ${method}(${Math.min(limit, 100)}%)${seed}`;
  }
  const rows = Math.floor(limit);
  const method = parsed.method === 'system' ? ' (system)' : '';
  const seed = parsed.seed != null ? ` REPEATABLE(${parsed.seed})` : '';
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
  const parsed = parseOperatorConfig(LimitConfigSchema, config);
  if (parsed.limit === 0) {
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} LIMIT 0`;
  }
  const limit = parsed.limit;

  if (parsed.mode === 'random') {
    return compileRandomSql(output, input, columns, parsed, limit);
  }
  return compileFixedSql(output, input, columns, parsed, limit);
}
