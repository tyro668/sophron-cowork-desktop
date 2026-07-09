import { quoteIdentifier, literalToSql, objectArray, unknownArray } from './utils';

export function compileMissingValueSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  if (config.strategy === 'drop_empty_rows') {
    const nonEmptyFilter =
      columns.length > 0
        ? columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' OR ')
        : 'true';
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} WHERE ${nonEmptyFilter}`;
  }
  const rules = objectArray(config.rules);
  const expressions = new Map(columns.map((column) => [column, quoteIdentifier(column)]));
  const filters: string[] = [];
  for (const rule of rules) {
    if (typeof rule.column !== 'string' || !columns.includes(rule.column)) continue;
    const current = expressions.get(rule.column) ?? quoteIdentifier(rule.column);
    switch (rule.method) {
      case 'nullify_values':
        expressions.set(
          rule.column,
          `CASE WHEN ${current} IN (${unknownArray(rule.values).map(literalToSql).join(', ')}) THEN NULL ELSE ${current} END`
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
