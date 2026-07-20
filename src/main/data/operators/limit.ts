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
  const ties = parsed.ties;
  const projection = columns.map((column) => quoteIdentifier(column)).join(', ') || '*';
  const pct = Math.min(limit, 100);
  const rows = Math.floor(limit);

  const projectionSub = `SELECT ${projection}`;

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

  if (orderBy) {
    const offsetStr = parsed.offset > 0 ? ` OFFSET ${parsed.offset}` : '';
    if (ties) {
      return `CREATE TEMP TABLE ${output} AS SELECT * FROM (SELECT *, RANK() OVER (ORDER BY ${orderBy}) AS __rn FROM ${input}) sub WHERE __rn <= ${rows}${offsetStr} ORDER BY ${orderBy}`;
    }
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} ORDER BY ${orderBy} LIMIT ${rows}${offsetStr}`;
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
