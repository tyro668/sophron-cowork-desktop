import { quoteIdentifier, literalToSql, uniqueAlias } from './utils';
import { compileScalarExpression } from './compute';
import { PivotConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

function formatAggFn(metricFn: string): string {
  return metricFn === 'count_distinct' ? 'COUNT(DISTINCT ' : `${metricFn.toUpperCase()}(`;
}

function compileAggExpr(expression: string): string {
  return expression === '*' ? '*' : compileScalarExpression(expression);
}

const EMPTY_STRING_PIVOT_COLUMN = 'empty';
export const RESOLVED_DYNAMIC_PIVOT_VALUES = '_resolvedDynamicPivotValues';

function compilePivotValue(value: unknown, emptyStringAlias: string): string {
  const literal = literalToSql(value);
  return value === '' ? `${literal} AS ${quoteIdentifier(emptyStringAlias)}` : literal;
}

export function compilePivotSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const dynamicValuesResolved = config[RESOLVED_DYNAMIC_PIVOT_VALUES] === true;
  const parsed = parseOperatorConfig(PivotConfigSchema, config);
  const on = parsed.on;
  const metrics = parsed.using;
  const groupBy = parsed.groupBy;

  const onSql = on
    .map((axis) => {
      const fieldValues = Array.isArray(axis.values) ? (axis.values as unknown[]) : [];
      if (fieldValues.length === 0) {
        if (dynamicValuesResolved) return quoteIdentifier(axis.field);
        throw new Error(
          `Pivot field '${axis.field}' has unresolved dynamic values; resolve its distinct values before SQL compilation`
        );
      }
      const occupiedNames = fieldValues
        .filter((value) => value !== '' && value !== null && value !== undefined)
        .map(String);
      const emptyStringAlias = uniqueAlias(EMPTY_STRING_PIVOT_COLUMN, occupiedNames);
      const inClause = fieldValues
        .map((value) => compilePivotValue(value, emptyStringAlias))
        .join(', ');
      return `${quoteIdentifier(axis.field)} IN (${inClause})`;
    })
    .join(', ');
  const usingSql = metrics
    .map((metric) => {
      const fn = metric.function;
      const expression = compileAggExpr(metric.expression);
      if (expression === '*' && fn !== 'count') {
        throw new Error(
          `Aggregate function '${fn}' cannot use '*' as its expression in a pivot; only count may count all rows`
        );
      }
      const alias = metric.alias ? ` AS ${quoteIdentifier(metric.alias)}` : '';
      return `${formatAggFn(fn)}${expression})${alias}`;
    })
    .join(', ');
  const groupSql = groupBy.length > 0 ? ` GROUP BY ${groupBy.map(quoteIdentifier).join(', ')}` : '';
  return `CREATE TEMP TABLE ${output} AS PIVOT ${input} ON ${onSql} USING ${usingSql}${groupSql}`;
}
