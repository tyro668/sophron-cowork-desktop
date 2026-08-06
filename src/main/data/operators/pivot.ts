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
  const values = parsed.values;

  const onSql = on
    .map((field) => {
      const fieldValues = Array.isArray(values[field]) ? (values[field] as unknown[]) : [];
      const inClause =
        fieldValues.length > 0 ? ` IN (${fieldValues.map(literalToSql).join(', ')})` : '';
      return `${quoteIdentifier(field)}${inClause}`;
    })
    .join(', ');
  const usingSql = metrics
    .map((metric) => {
      const fn = metric.function;
      const expression = compileAggExpr(metric.expression);
      const alias = metric.alias ? ` AS ${quoteIdentifier(metric.alias)}` : '';
      return `${formatAggFn(fn)}${expression})${alias}`;
    })
    .join(', ');
  const groupSql = groupBy.length > 0 ? ` GROUP BY ${groupBy.map(quoteIdentifier).join(', ')}` : '';
  return `CREATE TEMP TABLE ${output} AS PIVOT ${input} ON ${onSql} USING ${usingSql}${groupSql}`;
}
