import { quoteIdentifier, literalToSql } from './utils';
import { compileScalarExpression } from './compute';
import { PivotConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

function formatAggFn(metricFn: string): string {
  return metricFn === 'count_distinct' ? 'COUNT(DISTINCT ' : `${metricFn.toUpperCase()}(`;
}

function compileAggExpr(expression: string): string {
  return expression === '*' ? '*' : compileScalarExpression(expression);
}

export function compilePivotSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const parsed = parseOperatorConfig(PivotConfigSchema, config);
  const on = parsed.on;
  const metrics = parsed.using;
  const groupBy = parsed.groupBy;

  const onSql = on
    .map((axis) => {
      const fieldValues = Array.isArray(axis.values) ? (axis.values as unknown[]) : [];
      const inClause =
        fieldValues.length > 0 ? ` IN (${fieldValues.map(literalToSql).join(', ')})` : '';
      return `${quoteIdentifier(axis.field)}${inClause}`;
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
