import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';

export function parseMetrics(
  value: string,
  options: { requireAlias: boolean }
): Array<Record<string, unknown>> {
  return splitTopLevel(value).flatMap((part) => {
    const metric = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)(?:\s+as\s+(.+))?$/.exec(part.trim());
    if (!metric || (options.requireAlias && !metric[3])) return [];
    const alias = metric[3] ? parseFieldRef(metric[3]) : null;
    return [
      {
        function: metric[1],
        expression: metric[2].trim(),
        alias: alias ? toFieldName(alias) : defaultAlias(metric[1], metric[2]),
      },
    ];
  });
}

export function formatMetric(metric: Record<string, unknown>): string {
  const alias = typeof metric.alias === 'string' ? ` as ${formatFieldRef(metric.alias)}` : '';
  return `${String(metric.function ?? 'count')}(${String(metric.expression ?? '*')})${alias}`;
}

function defaultAlias(fn: string, expression: string): string {
  const field = parseFieldRef(expression.trim());
  return field ? `${fn}_${toFieldName(field)}` : fn;
}
