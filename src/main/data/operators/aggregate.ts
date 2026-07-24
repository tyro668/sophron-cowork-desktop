import { quoteIdentifier } from './utils';
import { compileScalarExpression } from './compute';
import { AggregateConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileAggregateSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const { groupBy, metrics, dateGranularity } = parseOperatorConfig(AggregateConfigSchema, config);
  const metricSqls = metrics.flatMap((metric) => {
    if (!metric.function || !metric.expression || !metric.alias) {
      return [];
    }
    const expression = metric.expression === '*' ? '*' : compileScalarExpression(metric.expression);
    return [
      metric.function === 'count_distinct'
        ? `COUNT(DISTINCT ${expression}) AS ${quoteIdentifier(metric.alias)}`
        : `${metric.function.toUpperCase()}(${expression}) AS ${quoteIdentifier(metric.alias)}`,
    ];
  });
  const granularity = dateGranularity ?? {};
  const groupExprs = groupBy.map((col) => {
    const gran = granularity[col];
    return gran ? `date_trunc('${gran}', ${quoteIdentifier(col)})` : quoteIdentifier(col);
  });
  const groupProjections = groupBy.map((col, i) => {
    const gran = granularity[col];
    const expr = groupExprs[i];
    return gran ? `${expr} AS ${quoteIdentifier(col)}` : expr;
  });
  const projection = [...groupProjections, ...metricSqls].join(', ') || 'COUNT(*) AS "row_count"';
  return `CREATE TEMP TABLE ${output} AS SELECT ${projection} FROM ${input}${
    groupBy.length > 0 ? ` GROUP BY ${groupExprs.join(', ')}` : ''
  }`;
}
