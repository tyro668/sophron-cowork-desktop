import { quoteColumnList, stringArray } from './utils';

export function compileFieldSelectSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const selected = stringArray(config.columns);
  const outputColumns =
    config.mode === 'exclude'
      ? columns.filter((column) => !selected.includes(column))
      : selected.length > 0
        ? selected
        : columns;
  return `CREATE TEMP TABLE ${output} AS SELECT ${quoteColumnList(outputColumns)} FROM ${input}`;
}
