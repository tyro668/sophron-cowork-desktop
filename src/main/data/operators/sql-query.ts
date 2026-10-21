import { StatementType, type DuckDBConnection } from '@duckdb/node-api';
import { normalizeSqlQuery } from '../../../shared/sql-query';
import { dataFieldTypeFromDuckDbType } from '../../../shared/data-field-types';

export function buildSqlQuery(sql: string, inputQuery: string): string {
  return `WITH "input" AS (${inputQuery}) SELECT * FROM (\n${normalizeSqlQuery(sql)}\n) AS "__sql_result"`;
}

/** Parse and bind without running the query, including a native single-statement check. */
export async function describeSqlQuery(connection: DuckDBConnection, query: string) {
  const statements = await connection.extractStatements(query);
  if (statements.count !== 1) throw new Error('SQL operator accepts only one query');
  let prepared: Awaited<ReturnType<typeof statements.prepare>>;
  try {
    prepared = await statements.prepare(0);
  } catch (error) {
    throw withSqlInputHint(error);
  }
  try {
    if (prepared.statementType !== StatementType.SELECT || prepared.parameterCount !== 0) {
      throw new Error('SQL operator requires a query without unbound parameters');
    }
    return Array.from({ length: prepared.columnCount }, (_, index) => {
      const storageType = prepared.columnType(index).toString();
      return {
        name: prepared.columnName(index),
        type: dataFieldTypeFromDuckDbType(storageType),
        storageType,
      };
    });
  } finally {
    prepared.destroySync();
  }
}

const UNKNOWN_RELATION =
  /Table with name "?([^"\s]+)"? does not exist|Referenced table "?([^"\s]+)"? not found/i;

/**
 * The SQL operator sees exactly one upstream relation named `input`. Agents often
 * reference input aliases (e.g. `erp`, `bank`) directly; explain how to combine sources.
 */
export function withSqlInputHint(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const match = UNKNOWN_RELATION.exec(message);
  const name = match?.[1] ?? match?.[2];
  if (!name || name.toLowerCase() === 'input') {
    return error instanceof Error ? error : new Error(message);
  }
  return new Error(
    `${message}\nHint: the SQL operator reads exactly one upstream relation, named "input" ` +
      `("${name}" is not visible). To combine several sources, connect a join or set_op (union) ` +
      'node upstream and query its output as "input"; columns from both sides keep their names ' +
      '(conflicting names get the join conflict suffix).'
  );
}
