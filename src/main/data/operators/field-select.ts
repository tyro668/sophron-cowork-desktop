import { quoteColumnList } from './utils';
import { FieldSelectConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileFieldSelectSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const { columns: selected, mode } = parseOperatorConfig(FieldSelectConfigSchema, config);
  const outputColumns =
    mode === 'exclude'
      ? columns.filter((column) => !selected.includes(column))
      : selected.length > 0
        ? selected
        : columns;
  return `CREATE TEMP TABLE ${output} AS SELECT ${quoteColumnList(outputColumns)} FROM ${input}`;
}
