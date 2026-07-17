import { quoteIdentifier, literalToSql } from './utils';
import { UnpivotConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileUnpivotSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const parsed = parseOperatorConfig(UnpivotConfigSchema, config);
  const configured = parsed.columns;
  const unpivotColumns =
    parsed.mode === 'except'
      ? columns.filter((column) => !configured.includes(column))
      : configured.filter((column) => columns.includes(column));
  if (unpivotColumns.length === 0) {
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}`;
  }

  const keepColumns = columns.filter((column) => !unpivotColumns.includes(column));

  let nameCol = parsed.nameColumn || 'name';
  let valueCol = parsed.valueColumn || 'value';

  if (keepColumns.includes(nameCol)) nameCol = '_' + nameCol;
  if (keepColumns.includes(valueCol)) valueCol = '_' + valueCol;

  // DuckDB v0.9 不支持 UNPIVOT INCLUDE NULLS，含 NULL 时回退 UNION ALL
  if (parsed.includeNulls) {
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
