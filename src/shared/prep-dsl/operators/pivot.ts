import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { formatLiteral, parseLiteralList } from '../syntax/literals';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';
import { formatMetric, parseMetrics } from './metrics';

export const pivotCodec: OperatorDslCodec = {
  type: 'pivot',
  matches: (text) => text.startsWith('pivot '),
  parse: (command, diagnostics) => {
    const match = /^pivot\s+on\s+(.+?)\s+using\s+(.+?)(?:\s+group\s+by\s+(.+))?$/s.exec(
      command.text
    );
    if (!match) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidPivot', `Cannot parse pivot: ${command.text}`, {
          value: command.text,
        }),
        line: command.line,
      });
      return null;
    }
    const onMatch = /^(.+?)(?:\s+in\s+(\(.+\)))?$/.exec(match[1].trim());
    return createOperator('pivot', command.text, {
      on: parseFields(onMatch?.[1] ?? ''),
      values: onMatch?.[2] ? parseLiteralList(onMatch[2]) : [],
      using: parseMetrics(match[2], { requireAlias: false }),
      groupBy: match[3] ? parseFields(match[3]) : [],
    });
  },
  format: (config) => {
    const on = stringArray(config?.on).map(formatFieldRef).join(', ') || '[field]';
    const values =
      Array.isArray(config?.values) && config.values.length > 0
        ? ` in (${config.values.map(formatLiteral).join(', ')})`
        : '';
    const using = objectArray(config?.using).map(formatMetric).join(', ') || 'count(*)';
    const groupBy = stringArray(config?.groupBy).map(formatFieldRef).join(', ');
    return `pivot on ${on}${values} using ${using}${groupBy ? ` group by ${groupBy}` : ''}`;
  },
};

function parseFields(value: string): string[] {
  return splitTopLevel(value).flatMap((part) => {
    const field = parseFieldRef(part);
    return field ? [toFieldName(field)] : [];
  });
}
