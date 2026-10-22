import { quoteIdentifier } from './utils';
import { compileMetricArguments } from './compute';
import { AggregateConfigSchema, parseOperatorConfig } from '../../../shared/operator-schemas';

const AGGREGATE_FUNCTION_DEFAULT_PARAMETERS: Record<string, string[]> = {
  string_agg: ["','"],
  quantile_cont: ['0.5'],
  quantile_disc: ['0.5'],
  approx_quantile: ['0.5'],
  approx_top_k: ['3'],
};

export function compileAggregateSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const { groupBy, metrics, dateGranularity } = parseOperatorConfig(AggregateConfigSchema, config);
  const metricSqls = metrics.map((metric) => {
    const fn = metric.function?.trim();
    const expression = metric.expression?.trim();
    const alias = metric.alias?.trim();
    const compiledExpression = expression === '*' ? '*' : compileMetricArguments(expression);
    if (fn === 'count_distinct') {
      return `COUNT(DISTINCT ${compiledExpression}) AS ${quoteIdentifier(alias)}`;
    }
    const defaults = AGGREGATE_FUNCTION_DEFAULT_PARAMETERS[fn];
    const args =
      defaults && !expression?.includes(',')
        ? `${compiledExpression}, ${defaults.join(', ')}`
        : compiledExpression;
    return `${fn.toUpperCase()}(${args}) AS ${quoteIdentifier(alias)}`;
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
