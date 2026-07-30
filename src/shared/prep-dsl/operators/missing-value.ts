import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { formatLiteral, parseLiteral, parseLiteralList } from '../syntax/literals';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, objectArray, stringArray, type OperatorDslCodec } from './codec';

export const missingValueCodec: OperatorDslCodec = {
  type: 'missing_value',
  matches: (text) => text.startsWith('missing value '),
  parse: ({ text }) => parseMissingValue(text),
  format: (config) => {
    if (config?.strategy === 'drop_empty_rows') return 'missing value row drop when all_null';
    if (config?.strategy === 'drop_rows_by_nulls') {
      const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
      return `missing value row drop when ${String(config.condition ?? 'any_null')}${
        columns ? ` in ${columns}` : ''
      }`;
    }
    const rules = objectArray(config?.rules).map(formatRule);
    return `missing value ${rules.join(', ') || '[field] skip'}`;
  },
};

function parseMissingValue(text: string) {
  const body = text.slice('missing value '.length);
  if (body.startsWith('row drop when ')) {
    const raw = body.slice('row drop when '.length).trim();
    const inMatch = /\s+in\s+(.+)$/i.exec(raw);
    const condition = inMatch ? raw.slice(0, inMatch.index).trim() : raw;
    const columns = inMatch
      ? splitTopLevel(inMatch[1]).flatMap((part) => {
          const field = parseFieldRef(part);
          return field ? [toFieldName(field)] : [];
        })
      : undefined;
    return createOperator('missing_value', text, {
      strategy: condition === 'all_null' ? 'drop_empty_rows' : 'drop_rows_by_nulls',
      condition,
      columns,
    });
  }
  const rules = splitTopLevel(body).map((part) => parseRule(part));
  return createOperator('missing_value', text, { strategy: 'by_column', rules });
}

function parseRule(part: string): Record<string, unknown> {
  const field = parseFieldRef(part);
  const column = field ? toFieldName(field) : '';
  const suffix = field ? part.slice(field.raw.length).trim() : part;
  if (suffix.startsWith('nullify values ')) {
    return { column, method: 'nullify_values', values: parseLiteralList(suffix.slice(15).trim()) };
  }
  if (suffix.startsWith('fill ')) {
    const value = suffix.slice(5).trim();
    const methods: Record<string, string> = {
      forward: 'forward_fill',
      backward: 'backward_fill',
      mean: 'mean_fill',
      median: 'median_fill',
      mode: 'mode_fill',
    };
    return {
      column,
      method: methods[value] ?? 'literal_fill',
      value: methods[value] ? undefined : parseLiteral(value),
    };
  }
  if (suffix === 'drop rows') return { column, method: 'drop' };
  return { column, method: 'skip' };
}

function formatRule(rule: Record<string, unknown>): string {
  const column = formatFieldRef(String(rule.column ?? 'field'));
  const method = String(rule.method ?? 'skip');
  if (method === 'skip') return `${column} skip`;
  if (method === 'drop') return `${column} drop rows`;
  if (method === 'nullify_values') {
    const values = Array.isArray(rule.values) ? rule.values : [];
    return `${column} nullify values (${values.map(formatLiteral).join(', ')})`;
  }
  const fillMethods: Record<string, string> = {
    forward_fill: 'forward',
    backward_fill: 'backward',
    mean_fill: 'mean',
    median_fill: 'median',
    mode_fill: 'mode',
  };
  return method in fillMethods
    ? `${column} fill ${fillMethods[method]}`
    : `${column} fill ${formatLiteral(rule.value ?? null)}`;
}
