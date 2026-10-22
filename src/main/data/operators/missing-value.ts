import { quoteIdentifier, literalToSql, uniqueAlias } from './utils';
import { MissingValueConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileMissingValueSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>,
  columnTypes?: Record<string, string>
): string {
  const parsed = parseOperatorConfig(MissingValueConfigSchema, config);
  if (parsed.strategy === 'drop_empty_rows' || parsed.strategy === 'drop_rows_by_nulls') {
    const targetColumns = parsed.fields && parsed.fields.length > 0 ? parsed.fields : columns;
    if (targetColumns.length === 0) {
      throw new Error('Missing-value row deletion requires at least one input field');
    }
    const isAllNull = parsed.strategy === 'drop_empty_rows' || parsed.condition === 'all_null';
    const connective = isAllNull ? ' OR ' : ' AND ';
    const nonEmptyFilter = targetColumns
      .map((column) => `${quoteIdentifier(column)} IS NOT NULL`)
      .join(connective);
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} WHERE ${nonEmptyFilter}`;
  }

  const stages: string[] = [];
  let currentInput = input;
  for (const rule of parsed.rules) {
    if (!rule.field || !columns.includes(rule.field)) continue;
    if (
      (rule.method === 'mean_fill' || rule.method === 'median_fill') &&
      columnTypes?.[rule.field] &&
      !['integer', 'float', 'decimal'].includes(columnTypes[rule.field])
    ) {
      throw new Error(
        `Missing-value ${rule.method} requires a numeric field, but "${rule.field}" is ${columnTypes[rule.field]}`
      );
    }
    const column = quoteIdentifier(rule.field);
    let stageQuery: string | null = null;
    switch (rule.method) {
      case 'nullify_values':
        stageQuery = `SELECT * REPLACE (CASE WHEN ${compileNullifyValuesPredicate(column, rule.values ?? [])} THEN NULL ELSE ${column} END AS ${column}) FROM ${currentInput}`;
        break;
      case 'literal_fill':
        stageQuery = `SELECT * REPLACE (COALESCE(${column}, cast_to_type(${literalToSql(rule.value)}, ${column})) AS ${column}) FROM ${currentInput}`;
        break;
      case 'mean_fill':
        stageQuery = compileStatisticalFillStage(currentInput, column, 'avg');
        break;
      case 'median_fill':
        stageQuery = compileStatisticalFillStage(currentInput, column, 'median');
        break;
      case 'mode_fill':
        stageQuery = compileStatisticalFillStage(currentInput, column, 'mode');
        break;
      case 'forward_fill':
      case 'backward_fill':
        stageQuery = compileOrderedFillStage(
          currentInput,
          column,
          columns,
          rule.method === 'forward_fill'
        );
        break;
      case 'drop':
        stageQuery = `SELECT * FROM ${currentInput} WHERE ${column} IS NOT NULL`;
        break;
      default:
        break;
    }

    if (!stageQuery) continue;
    const stageName = quoteIdentifier(`__missing_step_${stages.length + 1}`);
    stages.push(`${stageName} AS (${stageQuery})`);
    currentInput = stageName;
  }

  if (stages.length === 0) {
    const projections = columns.map(
      (column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`
    );
    return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
  }

  return `CREATE TEMP TABLE ${output} AS WITH ${stages.join(', ')} SELECT * FROM ${currentInput}`;
}

function compileNullifyValuesPredicate(column: string, values: unknown[]): string {
  if (values.length === 0) return 'FALSE';

  const predicates: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined) {
      predicates.push(`${column} IS NULL`);
    } else if (typeof value === 'string') {
      predicates.push(`CAST(${column} AS VARCHAR) = ${literalToSql(value)}`);
    } else {
      predicates.push(`${column} = ${literalToSql(value)}`);
    }
  }
  return predicates.length === 1 ? predicates[0] : `(${predicates.join(' OR ')})`;
}

function compileStatisticalFillStage(
  input: string,
  column: string,
  aggregate: 'avg' | 'median' | 'mode'
): string {
  const aggregateArgument = aggregate === 'mode' ? `${column} ORDER BY ${column} ASC` : column;
  const statistic = `(SELECT ${aggregate}(${aggregateArgument}) FROM ${input})`;
  return `SELECT * REPLACE (COALESCE(${column}, cast_to_type(${statistic}, ${column})) AS ${column}) FROM ${input}`;
}

function compileOrderedFillStage(
  input: string,
  column: string,
  columns: string[],
  forward: boolean
): string {
  const rowNumber = quoteIdentifier(uniqueAlias('__missing_row_number', columns));
  const value = forward
    ? `last_value(${column} IGNORE NULLS)`
    : `first_value(${column} IGNORE NULLS)`;
  const frame = forward
    ? 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'
    : 'ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING';
  return `SELECT * EXCLUDE (${rowNumber}) FROM (SELECT * REPLACE (${value} OVER (ORDER BY ${rowNumber} ${frame}) AS ${column}) FROM (SELECT *, row_number() OVER () AS ${rowNumber} FROM ${input})) ORDER BY ${rowNumber}`;
}
