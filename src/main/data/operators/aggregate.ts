import { quoteIdentifier, stringArray, objectArray } from './utils';
import { compileScalarExpression } from './compute';

export function compileAggregateSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const groupBy = stringArray(config.groupBy);
  const metrics = objectArray(config.metrics).flatMap((metric) => {
    if (
      typeof metric.function !== 'string' ||
      typeof metric.expression !== 'string' ||
      typeof metric.alias !== 'string'
    ) {
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
  const projection = [...groupProjection, ...metrics].join(', ') || 'COUNT(*) AS "row_count"';
  return `CREATE TEMP TABLE ${output} AS SELECT ${projection} FROM ${input}${
    groupBy.length > 0 ? ` GROUP BY ${groupProjection.join(', ')}` : ''
  }`;
}
