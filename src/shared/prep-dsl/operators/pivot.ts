import { createPrepDiagnostic } from '../diagnostics';
import type { PrepDiagnostic } from '../ast';
import { formatFieldRef, parseFieldRefExact, toFieldName } from '../syntax/fields';
import { formatLiteral, parseLiteralList } from '../syntax/literals';
import { findFirstTopLevelKeyword, splitTopLevel } from '../syntax/scanner';
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
    const onFields: string[] = [];
    const valueMap: Record<string, unknown[]> = {};
    for (const segment of splitTopLevel(match[1].trim())) {
      const trimmed = segment.trim();
      const inMatch = findFirstTopLevelKeyword(trimmed, ['in']);
      if (inMatch) {
        const fieldPart = trimmed.slice(0, inMatch.index).trim();
        const valuePart = trimmed.slice(inMatch.index + 'in'.length).trim();
        const field = parseSingleField(fieldPart, command.line, diagnostics);
        if (field) {
          onFields.push(field);
          valueMap[field] = parseLiteralList(valuePart);
        }
      } else {
        const field = parseSingleField(trimmed, command.line, diagnostics);
        if (field) onFields.push(field);
      }
    }
    return createOperator('pivot', command.text, {
      on: onFields,
      values: valueMap,
      using: parseMetrics(match[2], { requireAlias: false }, command.line, diagnostics),
      groupBy: match[3]
        ? parseFields(match[3], command.line, diagnostics, 'invalidPivotGroupField')
        : [],
    });
  },
  format: (config) => {
    const on = stringArray(config?.on);
    if (on.length === 0) return null;
    const valueMap =
      config?.values && typeof config.values === 'object' && !Array.isArray(config.values)
        ? (config.values as Record<string, unknown>)
        : {};
    const onDsl = on
      .map((field) => {
        const values =
          Array.isArray(valueMap[field]) && (valueMap[field] as unknown[]).length > 0
            ? ` in (${(valueMap[field] as unknown[]).map(formatLiteral).join(', ')})`
            : '';
        return `${formatFieldRef(field)}${values}`;
      })
      .join(', ');
    const using = objectArray(config?.using);
    if (using.length === 0) return null;
    const hasIncomplete = using.some(
      (metric) => !String(metric.function ?? '').trim() || !String(metric.expression ?? '').trim()
    );
    if (hasIncomplete) return null;
    const usingDsl = using.map(formatMetric).join(', ');
    const groupBy = stringArray(config?.groupBy).map(formatFieldRef).join(', ');
    return `pivot on ${onDsl} using ${usingDsl}${groupBy ? ` group by ${groupBy}` : ''}`;
  },
};

function parseFields(
  value: string,
  line: number,
  diagnostics: PrepDiagnostic[],
  code: string
): string[] {
  return splitTopLevel(value).flatMap((part) => {
    const field = parseSingleField(part, line, diagnostics, code);
    return field ? [field] : [];
  });
}

function parseSingleField(
  value: string,
  line: number,
  diagnostics: PrepDiagnostic[],
  code = 'invalidPivotField'
): string | null {
  const field = parseFieldRefExact(value.trim());
  if (!field || !toFieldName(field).trim()) {
    diagnostics.push({
      ...createPrepDiagnostic(code, `Invalid field reference: ${value}`, { value }),
      line,
    });
    return null;
  }
  return toFieldName(field);
}
