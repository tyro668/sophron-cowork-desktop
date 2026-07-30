import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { quoteString, unquoteString } from '../syntax/literals';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, type OperatorDslCodec } from './codec';

export const unnestCodec: OperatorDslCodec = {
  type: 'unnest',
  matches: (text) => text.startsWith('unnest ') || text.startsWith('explode '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    const isJson = cursor.match('explode');
    if (isJson) cursor.expect('json', 'invalidUnnest');
    else cursor.expect('unnest', 'invalidUnnest');
    const column = cursor.expectFieldRef('invalidUnnestField');

    let path: string | undefined;
    if (isJson) {
      cursor.expect('path', 'invalidUnnestPath');
      const literal = cursor.expectStringLiteral('invalidUnnestPath');
      path = literal ? unquoteString(literal) : undefined;
    }
    cursor.expect('as', 'invalidUnnestAlias');
    const alias = cursor.expectFieldRef('invalidUnnestAlias');

    let withIndex: string | undefined;
    if (cursor.match('with')) {
      cursor.expect('index', 'invalidUnnestIndex');
      const field = cursor.expectFieldRef('invalidUnnestIndex');
      withIndex = field ? toFieldName(field) : undefined;
    }
    let keepParentNames = false;
    if (cursor.match('keep')) {
      cursor.expect('parent', 'invalidUnnestKeep');
      cursor.expect('names', 'invalidUnnestKeep');
      keepParentNames = cursor.expectOneOf(['true', 'false'], 'invalidUnnestKeep') === 'true';
    }
    cursor.expectEof('unexpectedUnnestToken');
    if (!column || !alias) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidUnnest', 'Unnest requires a source field and alias'),
        line: command.line,
      });
    }
    return createOperator('unnest', text, {
      sourceKind: isJson ? 'json' : 'list',
      column: column ? toFieldName(column) : '',
      path,
      alias: alias ? toFieldName(alias) : '',
      withIndex,
      keepParentNames,
    });
  },
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
