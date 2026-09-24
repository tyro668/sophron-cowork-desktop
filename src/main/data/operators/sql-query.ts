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
  const prepared = await statements.prepare(0);
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
