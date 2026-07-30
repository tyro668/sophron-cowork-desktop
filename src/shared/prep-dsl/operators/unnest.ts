import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { quoteString, unquoteString } from '../syntax/literals';
import { createOperator, type OperatorDslCodec } from './codec';

const FIELD_REF = '\\[[^\\]]*\\]';
const QUALIFIED_FIELD_REF = `${FIELD_REF}(?:\\.${FIELD_REF})?`;

export const unnestCodec: OperatorDslCodec = {
  type: 'unnest',
  matches: (text) => text.startsWith('unnest ') || text.startsWith('explode '),
  parse: ({ text }) => parseUnnest(text),
  format: (config) => {
    const column = formatFieldRef(String(config?.column ?? 'items'));
    const alias = formatFieldRef(String(config?.alias ?? 'item'));
    const withIndex =
      typeof config?.withIndex === 'string'
        ? ` with index ${formatFieldRef(config.withIndex)}`
        : '';
    const keepParentNames = config?.keepParentNames ? ' keep parent names true' : '';
    return config?.sourceKind === 'json'
      ? `explode json ${column} path ${quoteString(
          String(config.path ?? '$')
        )} as ${alias}${withIndex}${keepParentNames}`
      : `unnest ${column} as ${alias}${withIndex}${keepParentNames}`;
  },
};

function parseUnnest(text: string) {
  if (text.startsWith('explode json ')) {
    const match = new RegExp(
      `^explode\\s+json\\s+(${QUALIFIED_FIELD_REF})\\s+path\\s+("(?:[^"\\\\]|\\\\.)*")\\s+as\\s+(${QUALIFIED_FIELD_REF})(.*)$`,
      'u'
    ).exec(text);
    return createOperator('unnest', text, {
      sourceKind: 'json',
      column: fieldName(match?.[1]),
      path: match ? unquoteString(match[2]) : '',
      alias: fieldName(match?.[3]),
      ...parseOptions(match?.[4] ?? ''),
    });
  }
  const match = new RegExp(
    `^(unnest|explode)\\s+(${QUALIFIED_FIELD_REF})\\s+as\\s+(${QUALIFIED_FIELD_REF})(.*)$`,
    'u'
  ).exec(text);
  return createOperator('unnest', text, {
    sourceKind: 'list',
    column: fieldName(match?.[2]),
    alias: fieldName(match?.[3]),
    ...parseOptions(match?.[4] ?? ''),
  });
}

function fieldName(value: string | undefined): string {
  const field = value ? parseFieldRef(value) : null;
  return field ? toFieldName(field) : '';
}

function parseOptions(value: string): Record<string, unknown> {
  const withIndex = /\s+with\s+index\s+(.+?)(?:\s+keep\s+parent\s+names\s+|$)/.exec(value);
  return {
    withIndex: withIndex ? fieldName(withIndex[1]) : undefined,
    keepParentNames: /keep\s+parent\s+names\s+true/.test(value),
  };
}
