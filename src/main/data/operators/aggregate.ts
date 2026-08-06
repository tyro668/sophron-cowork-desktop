import { quoteIdentifier } from './utils';
import { compileScalarExpression } from './compute';
import { AggregateConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

export function compileAggregateSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const { groupBy, metrics, dateGranularity } = parseOperatorConfig(AggregateConfigSchema, config);
  if (metrics.length === 0) {
    throw new Error('Aggregate requires at least one metric');
  }
  const metricSqls = metrics.map((metric, index) => {
    const fn = metric.function?.trim();
    const expression = metric.expression?.trim();
    const alias = metric.alias?.trim();
    if (!fn || !expression || !alias) {
      throw new Error(`Aggregate metric ${index + 1} is incomplete`);
    }
    const compiledExpression = expression === '*' ? '*' : compileScalarExpression(expression);
    return fn === 'count_distinct'
      ? `COUNT(DISTINCT ${compiledExpression}) AS ${quoteIdentifier(alias)}`
      : `${fn.toUpperCase()}(${compiledExpression}) AS ${quoteIdentifier(alias)}`;
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
  const projection = [...groupProjections, ...metricSqls].join(', ');
  return `CREATE TEMP TABLE ${output} AS SELECT ${projection} FROM ${input}${
    groupBy.length > 0 ? ` GROUP BY ${groupExprs.join(', ')}` : ''
  }`;
}
