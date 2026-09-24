import { createOperator, type OperatorDslCodec } from './codec';
import { createPrepDiagnostic } from '../diagnostics';

/** A JSON string preserves SQL whitespace, comments, quotes and DSL pipe characters. */
export const sqlQueryCodec: OperatorDslCodec = {
  type: 'sql_query',
  matches: (text) => text === 'sql' || text.startsWith('sql '),
  parse: (command, diagnostics) => {
    try {
      const sql: unknown = JSON.parse(command.text.slice(3).trim());
      if (typeof sql !== 'string') throw new Error('Expected SQL string');
      return createOperator('sql_query', `sql ${JSON.stringify(sql)}`, { sql });
    } catch {
      diagnostics.push({
        ...createPrepDiagnostic('invalidSqlQueryDsl', 'SQL requires a JSON-quoted query string'),
        line: command.line,
      });
      return null;
    }
  },
  format: (config) =>
    typeof config?.sql === 'string' && config.sql.trim()
      ? `sql ${JSON.stringify(config.sql)}`
      : null,
};
