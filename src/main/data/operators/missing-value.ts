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
          `CASE WHEN ${compileNullifyValuesPredicate(current, rule.values ?? [])} THEN NULL ELSE ${current} END`
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

function compileNullifyValuesPredicate(current: string, values: unknown[]): string {
  if (values.length === 0) return 'FALSE';

  // Missing-value markers originate in text files, but an earlier workflow step may already have
  // converted the column to DECIMAL, DATE, BOOLEAN, etc. Comparing that typed column directly with
  // a marker such as 'NULL' makes DuckDB cast the marker to the column type and can abort the whole
  // query. Compare canonical text representations instead so malformed markers never participate in
  // an implicit typed conversion. SQL NULL is handled separately because CAST(NULL AS VARCHAR) is NULL.
  const includesNull = values.some((value) => value === null || value === undefined);
  const textValues = values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => literalToSql(String(value)));
  const predicates: string[] = [];
  if (includesNull) predicates.push(`${current} IS NULL`);
  if (textValues.length > 0) {
    predicates.push(`CAST(${current} AS VARCHAR) IN (${textValues.join(', ')})`);
  }
  return predicates.length === 1 ? predicates[0] : `(${predicates.join(' OR ')})`;
}
