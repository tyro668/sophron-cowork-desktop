import { createPrepDiagnostic } from '../diagnostics';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, type OperatorDslCodec } from './codec';

export const setOpCodec: OperatorDslCodec = {
  type: 'set_op',
  matches: (text) =>
    text.startsWith('union ') || text.startsWith('intersect ') || text.startsWith('except '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    const operation = cursor.expectOneOf(['union', 'intersect', 'except'], 'invalidSetOperation');
    const rightInput = cursor.expectIdentifier('invalidSetOperationInput');
    let mode = 'distinct';
    let match = 'position';
    if (cursor.match('mode')) {
      mode = cursor.expectOneOf(['all', 'distinct'], 'invalidSetOperationMode') ?? mode;
    }
    if (cursor.match('by')) {
      match = cursor.expectOneOf(['name', 'position'], 'invalidSetOperationMatch') ?? match;
    }
    cursor.expectEof('unexpectedSetOperationToken');
    if (!operation || !rightInput) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidSetOperation', 'Set operation is incomplete'),
        line: command.line,
      });
    }
    return createOperator('set_op', text, {
      operation: operation ?? 'union',
      rightInput: rightInput ?? '',
      mode,
      match: match === 'name' ? 'by_name' : 'by_position',
    });
  },
  format: (config) => {
    const operation = String(config?.operation ?? 'union');
    const rightInput = String(config?.rightInput ?? 'right_source');
    const mode = typeof config?.mode === 'string' ? ` mode ${config.mode}` : '';
    const match =
      operation === 'union' ? ` by ${config?.match === 'by_name' ? 'name' : 'position'}` : '';
    return `${operation} ${rightInput}${mode}${match}`;
  },
};
