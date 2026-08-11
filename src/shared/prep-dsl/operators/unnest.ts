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
    let alias: string | undefined;
    if (isJson) {
      cursor.expect('path', 'invalidUnnestPath');
      const literal = cursor.expectStringLiteral('invalidUnnestPath');
      path = literal ? unquoteString(literal) : undefined;
    } else {
      cursor.expect('as', 'invalidUnnestAlias');
      const field = cursor.expectFieldRef('invalidUnnestAlias');
      alias = field ? toFieldName(field) : undefined;
    }

    let withIndex: string | undefined;
    if (!isJson && cursor.match('with')) {
      cursor.expect('index', 'invalidUnnestIndex');
      const field = cursor.expectFieldRef('invalidUnnestIndex');
      withIndex = field ? toFieldName(field) : undefined;
    }
    let keepParentNames = false;
    if (!isJson && cursor.match('keep')) {
      cursor.expect('parent', 'invalidUnnestKeep');
      cursor.expect('names', 'invalidUnnestKeep');
      keepParentNames = cursor.expectOneOf(['true', 'false'], 'invalidUnnestKeep') === 'true';
    }
    let preserveOrder = false;
    if (!isJson && cursor.match('preserve')) {
      cursor.expect('order', 'invalidUnnestOrder');
      preserveOrder = cursor.expectOneOf(['true', 'false'], 'invalidUnnestOrder') === 'true';
    }
    cursor.expectEof('unexpectedUnnestToken');
    if (!column || (!isJson && !alias)) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidUnnest', 'Unnest requires a source field and alias'),
        line: command.line,
      });
    }
    return createOperator('unnest', text, {
      sourceKind: isJson ? 'json' : 'list',
      column: column ? toFieldName(column) : '',
      path,
      alias: alias ?? '',
      withIndex,
      keepParentNames,
      preserveOrder,
    });
  },
  format: (config) => {
    const column = formatFieldRef(String(config?.column ?? ''));
    const isJson = config?.sourceKind === 'json';
    const suffix = isJson ? '' : ` as ${formatFieldRef(String(config?.alias ?? ''))}`;
    const withIndex =
      typeof config?.withIndex === 'string'
        ? ` with index ${formatFieldRef(config.withIndex)}`
        : '';
    const keepParentNames = config?.keepParentNames ? ' keep parent names true' : '';
    const preserveOrder = config?.preserveOrder ? ' preserve order true' : '';
    if (isJson) {
      return `explode json ${column} path ${quoteString(String(config.path ?? '$'))}`;
    }
    return `unnest ${column}${suffix}${withIndex}${keepParentNames}${preserveOrder}`;
  },
};
