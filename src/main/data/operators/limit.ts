import { z } from 'zod';
import { quoteIdentifier, sortKeysToSql, uniqueAlias } from './utils';
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
  const ties = parsed.ties;
  const projection = columns.map((column) => quoteIdentifier(column)).join(', ') || '*';
  const pct = limit;
  const rows = Math.floor(limit);
  const rn = uniqueAlias('__rn', columns);
  const rk = uniqueAlias('__rk', columns);
  const total = uniqueAlias('__total', columns);
  const totalRows = uniqueAlias('__total_rows', columns);

  const projectionSub = `SELECT ${projection}`;
  const offsetStr = parsed.offset > 0 ? ` OFFSET ${parsed.offset}` : '';

  if (unit === 'percent' && ties && orderBy) {
    return `
      CREATE TEMP TABLE ${output} AS
      WITH cnt AS (SELECT COUNT(*) AS ${total} FROM ${input}),
      numbered AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS ${rn},
               RANK() OVER (ORDER BY ${orderBy}) AS ${rk}
        FROM ${input}
      )
      ${projectionSub}
      FROM numbered
      WHERE ${rk} <= (SELECT ${rk} FROM numbered, cnt WHERE ${rn} = CEIL(cnt.${total} * ${pct} / 100.0))`;
  }

  if (unit === 'percent') {
    return `
      CREATE TEMP TABLE ${output} AS
      ${projectionSub}
      FROM (
        SELECT *, ROW_NUMBER() OVER (${orderBy ? `ORDER BY ${orderBy}` : ''}) AS ${rn},
               COUNT(*) OVER () AS ${totalRows}
        FROM ${input}
      ) sub
      WHERE ${rn} <= CEIL(${totalRows} * ${pct} / 100.0)`;
  }

  if (orderBy) {
    if (ties) {
      return `CREATE TEMP TABLE ${output} AS
        WITH numbered AS (
          SELECT *,
            ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS ${rn},
            RANK() OVER (ORDER BY ${orderBy}) AS ${rk}
          FROM ${input}
        )
        ${projectionSub}
        FROM numbered
        WHERE ${rn} > ${parsed.offset}
          AND ${rk} <= COALESCE(
            (SELECT ${rk} FROM numbered WHERE ${rn} = ${parsed.offset + rows}),
            (SELECT ${rk} FROM numbered ORDER BY ${rn} DESC LIMIT 1)
          )
        ORDER BY ${orderBy}`;
    }
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} ORDER BY ${orderBy} LIMIT ${rows}${offsetStr}`;
  }

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
    const method = parsed.method === 'bernoulli' ? 'BERNOULLI' : 'SYSTEM';
    const seed = parsed.seed != null ? ` REPEATABLE(${parsed.seed})` : '';
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} TABLESAMPLE ${method}(${limit}%)${seed}`;
  }
  const rows = Math.floor(limit);
  const seed = parsed.seed != null ? ` REPEATABLE(${parsed.seed})` : '';
  if (seed) {
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} USING SAMPLE reservoir(${rows} ROWS)${seed}`;
  }
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} USING SAMPLE ${rows} ROWS`;
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

  if (parsed.sampling === 'random') {
    return compileRandomSql(output, input, columns, parsed, limit);
  }
  return compileFixedSql(output, input, columns, parsed, limit);
}
