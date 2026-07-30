import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';
import { parseMetrics } from './metrics';

export const aggregateCodec: OperatorDslCodec = {
  type: 'aggregate',
  matches: (text) => text.startsWith('aggregate '),
  parse: ({ text }) => {
    const match = /^aggregate\s+(all|by\s+.+?)\s+metrics\s+(.+)$/s.exec(text);
    const groupBy =
      match?.[1] === 'all' ? [] : parseFields((match?.[1] ?? '').replace(/^by\s+/, ''));
    return createOperator('aggregate', text, {
      groupBy,
      metrics: parseMetrics(match?.[2] ?? '', { requireAlias: true }),
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

function parseFields(value: string): string[] {
  return splitTopLevel(value).flatMap((part) => {
    const field = parseFieldRef(part);
    return field ? [toFieldName(field)] : [];
  });
}
