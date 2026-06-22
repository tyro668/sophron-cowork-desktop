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
  const keepColumns = columns.filter((column) => !unpivotColumns.includes(column));
  const nameColumn = typeof config.nameColumn === 'string' ? config.nameColumn : 'name';
  const valueColumn = typeof config.valueColumn === 'string' ? config.valueColumn : 'value';
  const branches = unpivotColumns.map((column) => {
    const projection = [
      ...keepColumns.map(quoteIdentifier),
      `${literalToSql(column)} AS ${quoteIdentifier(nameColumn)}`,
      `${quoteIdentifier(column)} AS ${quoteIdentifier(valueColumn)}`,
    ].join(', ');
    return `SELECT ${projection} FROM ${input}${
      config.includeNulls ? '' : ` WHERE ${quoteIdentifier(column)} IS NOT NULL`
    }`;
  });
  return `CREATE TEMP TABLE ${output} AS ${branches.join(' UNION ALL ') || `SELECT * FROM ${input}`}`;
}
