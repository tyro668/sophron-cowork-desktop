import { quoteIdentifier, literalToSql, stringArray, objectArray, unknownArray } from './utils';
import { compileScalarExpression } from './compute';

export function compilePivotSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const on = stringArray(config.on);
  const metrics = objectArray(config.using);
  const groupBy = stringArray(config.groupBy);
  const values = unknownArray(config.values);
  if (on.length === 1 && values.length > 0) {
    const onColumn = quoteIdentifier(on[0]);
    const groupProjection = groupBy.map(quoteIdentifier);
    const metric = metrics[0] ?? { function: 'count', expression: '*', alias: 'row_count' };
    const fn = String(metric.function ?? 'count').toUpperCase();
    const expression =
      String(metric.expression ?? '*') === '*'
        ? '*'
        : compileScalarExpression(String(metric.expression ?? '*'));
    const alias = typeof metric.alias === 'string' ? metric.alias : fn.toLowerCase();
    const pivotColumns = values.map((value) => {
      const columnName = `${String(value)}_${alias}`;
      const valueSql = literalToSql(value);
      const aggregateExpression =
        expression === '*'
          ? `${fn}(CASE WHEN ${onColumn} = ${valueSql} THEN 1 ELSE NULL END)`
          : `${fn}(CASE WHEN ${onColumn} = ${valueSql} THEN ${expression} ELSE NULL END)`;
      return `${aggregateExpression} AS ${quoteIdentifier(columnName)}`;
    });
    return `CREATE TEMP TABLE ${output} AS SELECT ${[...groupProjection, ...pivotColumns].join(
      ', '
    )} FROM ${input}${groupProjection.length > 0 ? ` GROUP BY ${groupProjection.join(', ')}` : ''}`;
  }
  const onSql = on.map(quoteIdentifier).join(', ') || '1';
  const usingSql = metrics.map((metric) => formatAggregateCall(metric)).join(', ') || 'count(*)';
  const groupSql = groupBy.length > 0 ? ` GROUP BY ${groupBy.map(quoteIdentifier).join(', ')}` : '';
  return `CREATE TEMP TABLE ${output} AS PIVOT ${input} ON ${onSql} USING ${usingSql}${groupSql}`;
}

function formatAggregateCall(metric: Record<string, unknown>): string {
  const fn = String(metric.function ?? 'count').toUpperCase();
  const expression =
    String(metric.expression ?? '*') === '*'
      ? '*'
      : compileScalarExpression(String(metric.expression ?? '*'));
  return `${fn}(${expression})`;
}
