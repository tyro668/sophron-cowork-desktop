import type { PrepDiagnostic } from '../ast';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRefExact, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';
import { parseMetrics } from './metrics';

export const aggregateCodec: OperatorDslCodec = {
  type: 'aggregate',
  matches: (text) => text.startsWith('aggregate '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const match = /^aggregate\s+(all|by\s+.+?)\s+metrics\s+(.+)$/s.exec(text);
    if (!match) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidAggregate', `Cannot parse aggregate: ${text}`),
        line: command.line,
      });
    }
    const groupBy =
      match?.[1] === 'all'
        ? []
        : parseFields((match?.[1] ?? '').replace(/^by\s+/, ''), command.line, diagnostics);
    return createOperator('aggregate', text, {
      groupBy,
      metrics: parseMetrics(match?.[2] ?? '', { requireAlias: true }, command.line, diagnostics),
    });
  },
  format: (config) => {
    const groupBy = stringArray(config?.groupBy).map(formatFieldRef).join(', ');
    const metrics = objectArray(config?.metrics).map(
      (metric) =>
        `${String(metric.function ?? 'count')}(${String(
          metric.expression ?? '*'
        )}) as ${formatFieldRef(String(metric.alias ?? 'row_count'))}`
    );
    return `aggregate ${groupBy ? `by ${groupBy}` : 'all'} metrics ${
      metrics.join(', ') || 'count(*) as [row_count]'
    }`;
  },
};

function parseFields(value: string, line: number, diagnostics: PrepDiagnostic[]): string[] {
  return splitTopLevel(value).flatMap((part) => {
    const field = parseFieldRefExact(part);
    if (!field || !toFieldName(field).trim()) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidAggregateField', `Invalid aggregate field: ${part}`),
        line,
      });
      return [];
    }
    return field ? [toFieldName(field)] : [];
  });
}
