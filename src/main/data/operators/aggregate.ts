import { quoteIdentifier } from './utils';
import { compileScalarExpression } from './compute';
import { AggregateConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileAggregateSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const { groupBy, metrics } = parseOperatorConfig(AggregateConfigSchema, config);
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
  const groupProjection = groupBy.map(quoteIdentifier);
  const projection = [...groupProjection, ...metricSqls].join(', ') || 'COUNT(*) AS "row_count"';
  return `CREATE TEMP TABLE ${output} AS SELECT ${projection} FROM ${input}${
    groupBy.length > 0 ? ` GROUP BY ${groupProjection.join(', ')}` : ''
  }`;
}
