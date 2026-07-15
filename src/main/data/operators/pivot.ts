import { quoteIdentifier, literalToSql, stringArray, objectArray, unknownArray } from './utils';
import { compileScalarExpression } from './compute';

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
  const on = stringArray(config.on);
  const metrics = objectArray(config.using);
  const groupBy = stringArray(config.groupBy);
  const values = unknownArray(config.values);

  // 有值列表时：子查询先过滤再透视
  const source =
    on.length === 1 && values.length > 0
      ? `(SELECT * FROM ${input} WHERE ${quoteIdentifier(on[0])} IN (${values.map(literalToSql).join(', ')}))`
      : input;

  const onSql = on.map(quoteIdentifier).join(', ') || '1';
  const usingSql =
    metrics
      .map((metric) => {
        const fn = String(metric.function ?? 'count');
        const expression = compileAggExpr(String(metric.expression ?? '*'));
        const alias =
          typeof metric.alias === 'string' && metric.alias
            ? ` AS ${quoteIdentifier(metric.alias)}`
            : '';
        return `${formatAggFn(fn)}${expression})${alias}`;
      })
      .join(', ') || 'count(*)';
  const groupSql = groupBy.length > 0 ? ` GROUP BY ${groupBy.map(quoteIdentifier).join(', ')}` : '';
  return `CREATE TEMP TABLE ${output} AS PIVOT ${source} ON ${onSql} USING ${usingSql}${groupSql}`;
}
