import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { quoteString, unquoteString } from '../syntax/literals';
import { prepDslLexer } from '../tokens';
import { createOperator, type OperatorDslCodec } from './codec';

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
  const clauses = parseUnnestClauses(text);
  if (clauses.sourceKind === 'json') {
    return createOperator('unnest', text, {
      sourceKind: 'json',
      column: fieldName(clauses.column),
      path: clauses.path ? unquoteString(clauses.path) : '',
      alias: fieldName(clauses.alias),
      withIndex: clauses.withIndex ? fieldName(clauses.withIndex) : undefined,
      keepParentNames: clauses.keepParentNames,
    });
  }
  return createOperator('unnest', text, {
    sourceKind: 'list',
    column: fieldName(clauses.column),
    alias: fieldName(clauses.alias),
    withIndex: clauses.withIndex ? fieldName(clauses.withIndex) : undefined,
    keepParentNames: clauses.keepParentNames,
  });
}

function fieldName(value: string | undefined): string {
  const field = value ? parseFieldRef(value) : null;
  return field ? toFieldName(field) : '';
}

interface UnnestClauses {
  sourceKind: 'json' | 'list';
  column?: string;
  path?: string;
  alias?: string;
  withIndex?: string;
  keepParentNames: boolean;
}

interface ClauseStart {
  kind: 'path' | 'alias' | 'withIndex' | 'keepParentNames';
  start: number;
  valueStart: number;
}

function parseUnnestClauses(text: string): UnnestClauses {
  const tokens = prepDslLexer.tokenize(text).tokens;
  const sourceKind =
    tokens[0]?.image.toLowerCase() === 'explode' && tokens[1]?.image.toLowerCase() === 'json'
      ? 'json'
      : 'list';
  const commandEndIndex = sourceKind === 'json' ? 1 : 0;
  const starts: ClauseStart[] = [];
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  for (let index = commandEndIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const tokenName = token.tokenType.name;
    if (tokenName === 'LSquare') {
      bracketDepth += 1;
      continue;
    }
    if (tokenName === 'RSquare') {
      bracketDepth -= 1;
      continue;
    }
    if (tokenName === 'LParen') {
      parenthesisDepth += 1;
      continue;
    }
    if (tokenName === 'RParen') {
      parenthesisDepth -= 1;
      continue;
    }
    if (bracketDepth !== 0 || parenthesisDepth !== 0) continue;

    const keyword = token.image.toLowerCase();
    if (keyword === 'path' || keyword === 'as') {
      starts.push({
        kind: keyword === 'as' ? 'alias' : 'path',
        start: token.startOffset,
        valueStart: tokenEnd(token),
      });
      continue;
    }
    if (keyword === 'with' && tokens[index + 1]?.image.toLowerCase() === 'index') {
      const indexToken = tokens[index + 1];
      starts.push({
        kind: 'withIndex',
        start: token.startOffset,
        valueStart: tokenEnd(indexToken),
      });
      index += 1;
      continue;
    }
    if (
      keyword === 'keep' &&
      tokens[index + 1]?.image.toLowerCase() === 'parent' &&
      tokens[index + 2]?.image.toLowerCase() === 'names'
    ) {
      const namesToken = tokens[index + 2];
      starts.push({
        kind: 'keepParentNames',
        start: token.startOffset,
        valueStart: tokenEnd(namesToken),
      });
      index += 2;
    }
  }

  const commandEnd = tokenEnd(tokens[commandEndIndex]);
  const values = Object.fromEntries(
    starts.map((clause, index) => [
      clause.kind,
      text.slice(clause.valueStart, starts[index + 1]?.start).trim(),
    ])
  ) as Partial<Record<ClauseStart['kind'], string>>;

  return {
    sourceKind,
    column: text.slice(commandEnd, starts[0]?.start).trim(),
    path: values.path,
    alias: values.alias,
    withIndex: values.withIndex,
    keepParentNames: values.keepParentNames?.toLowerCase() === 'true',
  };
}

function tokenEnd(token: { startOffset: number; endOffset?: number }): number {
  return (token.endOffset ?? token.startOffset) + 1;
}
