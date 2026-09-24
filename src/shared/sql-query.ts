export const DEFAULT_SQL_QUERY = 'SELECT *\nFROM input';
export const MAX_SQL_QUERY_LENGTH = 100_000;

/** Lexical framing only. DuckDB remains the authority for SQL syntax and binding. */
export function normalizeSqlQuery(value: string): string {
  const sql = value.trim();
  let visible = '';
  let i = 0;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      visible += ' '.repeat(i - start);
    } else if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new Error('Unterminated SQL comment');
      visible += ' '.repeat(i - start);
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      const escaped = quote === "'" && /(?:^|\W)[eE]$/.test(sql.slice(0, start));
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i++] === quote) {
          if (sql[i] === quote) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error('Unterminated SQL quoted value');
      visible += 'x' + ' '.repeat(i - start - 1);
    } else {
      const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (dollar) {
        const end = sql.indexOf(dollar, i + dollar.length);
        if (end < 0) throw new Error('Unterminated SQL dollar-quoted value');
        i = end + dollar.length;
        visible += 'x' + ' '.repeat(i - start - 1);
      } else {
        visible += sql[i++];
      }
    }
  }
  if (!visible.trim()) throw new Error('SQL query is required');
  if (!/^\s*(?:select\b|with\b|from\b|values\b|table\b|pivot\b|unpivot\b|\()/i.test(visible)) {
    throw new Error(
      'SQL operator requires a query (SELECT or WITH); write statements are not supported'
    );
  }
  const delimiter = visible.indexOf(';');
  if (delimiter >= 0) {
    if (visible.slice(delimiter + 1).trim()) throw new Error('SQL operator accepts only one query');
    return sql.slice(0, delimiter) + sql.slice(delimiter + 1);
  }
  return sql;
}
