import { quoteIdentifier, literalToSql } from './utils';
import { MissingValueConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileMissingValueSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const parsed = parseOperatorConfig(MissingValueConfigSchema, config);
  if (parsed.strategy === 'drop_empty_rows' || parsed.strategy === 'drop_rows_by_nulls') {
    const targetColumns = parsed.columns && parsed.columns.length > 0 ? parsed.columns : columns;
    const isAllNull = parsed.condition === 'all_null';
    const connective = isAllNull ? ' OR ' : ' AND ';
    const nonEmptyFilter = targetColumns
      .map((column) => `${quoteIdentifier(column)} IS NOT NULL`)
      .join(connective);
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} WHERE ${nonEmptyFilter}`;
  }
  const rules = parsed.rules;
  const expressions = new Map(columns.map((column) => [column, quoteIdentifier(column)]));
  const filters: string[] = [];
  for (const rule of rules) {
    if (!rule.column || !columns.includes(rule.column)) continue;
    const current = expressions.get(rule.column) ?? quoteIdentifier(rule.column);
    switch (rule.method) {
      case 'nullify_values':
        expressions.set(
          rule.column,
          `CASE WHEN ${current} IN (${(rule.values ?? []).map(literalToSql).join(', ')}) THEN NULL ELSE ${current} END`
        );
        break;
      case 'literal_fill':
        expressions.set(rule.column, `COALESCE(${current}, ${literalToSql(rule.value)})`);
        break;
      case 'drop':
        filters.push(`${quoteIdentifier(rule.column)} IS NOT NULL`);
        break;
      default:
        break;
    }
  }
  const projections = columns.map(
    (column) =>
      `${expressions.get(column) ?? quoteIdentifier(column)} AS ${quoteIdentifier(column)}`
  );
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}${
    filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : ''
  }`;
}
