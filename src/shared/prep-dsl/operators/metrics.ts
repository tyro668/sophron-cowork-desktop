import type { PrepDiagnostic } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, parseFieldRefExact, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';

export function parseMetrics(
  value: string,
  options: { requireAlias: boolean },
  line?: number,
  diagnostics?: PrepDiagnostic[]
): Array<Record<string, unknown>> {
  return splitTopLevel(value).flatMap((part) => {
    const metric = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)(?:\s+as\s+(.+))?$/.exec(part.trim());
    const alias = metric?.[3] ? parseFieldRefExact(metric[3]) : null;
    if (!metric || (options.requireAlias && !metric[3]) || (metric[3] && !alias)) {
      if (diagnostics) {
        diagnostics.push({
          ...createPrepDiagnostic('invalidMetric', `Cannot parse metric: ${part}`, {
            value: part,
          }),
          line,
        });
      }
      return [];
    }
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
