import type { PrepDiagnostic } from '../ast';
import type { ExprToken } from '../../expression-tokenizer';
import { tokenizeExpression } from '../../expression-tokenizer';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, parseFieldRefExact, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';

interface ParsedMetric {
  function: string;
  expression: string;
  alias: string | null;
}

export function parseMetrics(
  value: string,
  options: { requireAlias: boolean; requireComplete?: boolean },
  line?: number,
  diagnostics?: PrepDiagnostic[]
): Array<Record<string, unknown>> {
  return splitTopLevel(value).flatMap((part) => {
    const metric = parseMetricEntry(part);
    const alias = metric?.alias ? parseFieldRefExact(metric.alias) : null;
    const fn = metric?.function?.trim() ?? '';
    const expression = metric?.expression?.trim() ?? '';
    const aliasName = alias ? toFieldName(alias).trim() : '';
    if (
      !metric ||
      (options.requireAlias && !metric.alias) ||
      (metric.alias && !alias) ||
      (options.requireComplete && (!fn || !expression || !aliasName))
    ) {
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
        function: metric.function,
        expression: metric.expression,
        alias: alias ? toFieldName(alias) : defaultAlias(metric.function, metric.expression),
      },
    ];
  });
}

function parseMetricEntry(part: string): ParsedMetric | null {
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

  const fnToken = body[0];
  if (!fnToken || fnToken.type !== 'Ident') return null;
  const openToken = body[1];
  if (!openToken || openToken.type !== 'ParenOpen') return null;

  let depth = 1;
  let closeIndex = -1;
  for (let index = 2; index < body.length; index += 1) {
    const token = body[index];
    if (token.type === 'ParenOpen') depth += 1;
    else if (token.type === 'ParenClose') {
      depth -= 1;
      if (depth === 0) {
        closeIndex = index;
        break;
      }
    }
  }
  if (closeIndex < 0) return null;

  const expression = trimmed.slice(openToken.end, body[closeIndex].start).trim();
  const tail = body.slice(closeIndex + 1);

  let alias: string | null = null;
  if (tail.length > 0) {
    const asToken = tail[0];
    if (asToken.type !== 'Ident' || asToken.value !== 'as') return null;
    const aliasToken = tail[1];
    if (!aliasToken || aliasToken.type !== 'FieldRef') return null;
    if (tail.length !== 2) return null;
    alias = aliasToken.value;
  }

  return { function: fnToken.value, expression, alias };
}

export function formatMetric(metric: Record<string, unknown>): string {
  const alias = typeof metric.alias === 'string' ? ` as ${formatFieldRef(metric.alias)}` : '';
  return `${String(metric.function ?? 'count')}(${String(metric.expression ?? '*')})${alias}`;
}

function defaultAlias(fn: string, expression: string): string {
  const field = parseFieldRef(expression.trim());
  return field ? `${fn}_${toFieldName(field)}` : fn;
}
