import { quoteIdentifier, literalToSql, stringArray } from './utils';

export function compileUnpivotSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const configured = stringArray(config.columns);
  const unpivotColumns =
    config.mode === 'except'
      ? columns.filter((column) => !configured.includes(column))
      : configured.filter((column) => columns.includes(column));
  if (unpivotColumns.length === 0) {
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}`;
  }

  const keepColumns = columns.filter((column) => !unpivotColumns.includes(column));

  let nameCol =
    typeof config.nameColumn === 'string' && config.nameColumn ? config.nameColumn : 'name';
  let valueCol =
    typeof config.valueColumn === 'string' && config.valueColumn ? config.valueColumn : 'value';

  if (keepColumns.includes(nameCol)) nameCol = '_' + nameCol;
  if (keepColumns.includes(valueCol)) valueCol = '_' + valueCol;

  // DuckDB v0.9 不支持 UNPIVOT INCLUDE NULLS，含 NULL 时回退 UNION ALL
  if (config.includeNulls) {
    const branches = unpivotColumns.map((column) => {
      const projection = [
        ...keepColumns.map(quoteIdentifier),
        `${literalToSql(column)} AS ${quoteIdentifier(nameCol)}`,
        `${quoteIdentifier(column)} AS ${quoteIdentifier(valueCol)}`,
      ].join(', ');
      return `SELECT ${projection} FROM ${input}`;
    });
    return `CREATE TEMP TABLE ${output} AS ${branches.join(' UNION ALL ')}`;
  }

  // DuckDB 原生 UNPIVOT（默认排除 NULL 行）
  const onClause = unpivotColumns.map(quoteIdentifier).join(', ');
  return `CREATE TEMP TABLE ${output} AS UNPIVOT ${input} ON ${onClause} INTO NAME ${quoteIdentifier(nameCol)} VALUE ${quoteIdentifier(valueCol)}`;
}
