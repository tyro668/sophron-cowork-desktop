import type { PrepDiagnostic } from '../ast';
import type { ExprToken } from '../../expression-tokenizer';
import { tokenizeExpression } from '../../expression-tokenizer';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRefExact, toFieldName, unwrapFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';
import { parseMetrics } from './metrics';
import { isCompleteAggregateMetric } from '../../operator-completeness';

const GRANULARITIES = new Set(['year', 'quarter', 'month', 'week', 'day']);

interface ParsedGroupBy {
  groupBy: string[];
  dateGranularity: Record<string, string>;
}

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
    const isAll = match?.[1] === 'all';
    const parsedGroupBy = isAll
      ? { groupBy: [], dateGranularity: {} }
      : parseFields((match?.[1] ?? '').replace(/^by\s+/, ''), command.line, diagnostics);
    const config: Record<string, unknown> = {
      groupBy: parsedGroupBy.groupBy,
      metrics: parseMetrics(
        match?.[2] ?? '',
        { requireAlias: true, requireComplete: true },
        command.line,
        diagnostics
      ),
    };
    if (Object.keys(parsedGroupBy.dateGranularity).length > 0) {
      config.dateGranularity = parsedGroupBy.dateGranularity;
    }
    return createOperator('aggregate', text, config);
  },
  format: (config) => {
    const groupBy = stringArray(config?.groupBy);
    const dateGranularity = (config?.dateGranularity as Record<string, string> | undefined) ?? {};
    const groupByDsl = groupBy
      .map((field) => {
        const gran = dateGranularity[field];
        return gran ? `${gran}(${formatFieldRef(field)})` : formatFieldRef(field);
      })
      .join(', ');
    const metrics = objectArray(config?.metrics).filter(isCompleteAggregateMetric);
    const parts: string[] = [];
    for (const metric of metrics) {
      const fn = String(metric.function ?? '').trim();
      const expression = String(metric.expression ?? '').trim();
      const alias = String(metric.alias ?? '').trim();
      parts.push(`${fn}(${expression}) as ${formatFieldRef(alias)}`);
    }
    if (parts.length === 0) return null;
    return `aggregate ${groupByDsl ? `by ${groupByDsl}` : 'all'} metrics ${parts.join(', ')}`;
  },
};

function parseFields(value: string, line: number, diagnostics: PrepDiagnostic[]): ParsedGroupBy {
  const groupBy: string[] = [];
  const dateGranularity: Record<string, string> = {};
  const seen = new Set<string>();
  for (const part of splitTopLevel(value)) {
    const parsed = parseGroupByItem(part);
    if (!parsed) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidAggregateField', `Invalid aggregate field: ${part}`),
        line,
      });
      continue;
    }
    if (seen.has(parsed.field)) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'duplicateAggregateGroupField',
          `Aggregate group field "${parsed.field}" can only appear once`
        ),
        line,
      });
      continue;
    }
    seen.add(parsed.field);
    groupBy.push(parsed.field);
    if (parsed.granularity) {
      dateGranularity[parsed.field] = parsed.granularity;
    }
  }
  return { groupBy, dateGranularity };
}

function parseGroupByItem(part: string): { field: string; granularity: string | null } | null {
  const trimmed = part.trim();
  if (!trimmed) return null;
  let tokens: ExprToken[];
  try {
    tokens = tokenizeExpression(trimmed);
  } catch {
    return null;
  }
  const eofIndex = tokens.findIndex((token) => token.type === 'EOF');
  const body = eofIndex >= 0 ? tokens.slice(0, eofIndex) : tokens;

  // granularity([field]) — Ident(gran) ParenOpen FieldRef ParenClose (to EOF)
  if (body.length === 4) {
    const [granToken, open, refToken, close] = body;
    if (
      granToken.type === 'Ident' &&
      GRANULARITIES.has(granToken.value.toLowerCase()) &&
      open.type === 'ParenOpen' &&
      refToken.type === 'FieldRef' &&
      close.type === 'ParenClose'
    ) {
      const field = toFieldName({ name: unwrapFieldName(refToken.value), raw: refToken.value });
      if (field.trim()) {
        return { field, granularity: granToken.value.toLowerCase() };
      }
    }
  }

  // bare [field] — FieldRef (to EOF)
  const fieldRef = parseFieldRefExact(trimmed);
  if (fieldRef && toFieldName(fieldRef).trim()) {
    return { field: toFieldName(fieldRef), granularity: null };
  }

  return null;
}
