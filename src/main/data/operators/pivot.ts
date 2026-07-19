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

  // 有值列表时：子查询先过滤再透视
  const source =
    on.length === 1 && values.length > 0
      ? `(SELECT * FROM ${input} WHERE ${quoteIdentifier(on[0])} IN (${values.map(literalToSql).join(', ')}))`
      : input;

  const onSql = on.map(quoteIdentifier).join(', ') || '1';
  const usingSql =
    metrics
      .map((metric) => {
        const fn = metric.function || 'count';
        const expression = compileAggExpr(metric.expression || '*');
        const alias = metric.alias ? ` AS ${quoteIdentifier(metric.alias)}` : '';
        return `${formatAggFn(fn)}${expression})${alias}`;
      })
      .join(', ') || 'count(*)';
  const groupSql = groupBy.length > 0 ? ` GROUP BY ${groupBy.map(quoteIdentifier).join(', ')}` : '';
  return `CREATE TEMP TABLE ${output} AS PIVOT ${source} ON ${onSql} USING ${usingSql}${groupSql}`;
}
