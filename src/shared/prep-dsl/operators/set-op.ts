import { createPrepDiagnostic } from '../diagnostics';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, type OperatorDslCodec } from './codec';
import { DEFAULT_MODE, DEFAULT_MATCH } from '../../operator-schemas/set-op';

function readTableName(cursor: PrepTokenCursor): string | null {
  if (cursor.eof) return null;
  const token = cursor.peek();
  if (!token) return null;
  cursor.consume();
  return token.image;
}

export const setOpCodec: OperatorDslCodec = {
  type: 'set_op',
  matches: (text) =>
    text.startsWith('union ') || text.startsWith('intersect ') || text.startsWith('except '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    const operation = cursor.expectOneOf(['union', 'intersect', 'except'], 'invalidSetOperation');
    const rightInput = readTableName(cursor) ?? '';
    let mode = DEFAULT_MODE;
    let match = operation === 'union' ? DEFAULT_MATCH : 'by_position';
    if (cursor.match('mode')) {
      mode = cursor.expectOneOf(['all', 'distinct'], 'invalidSetOperationMode') ?? mode;
    }
    if (operation === 'union' && cursor.match('by')) {
      const matchWord = cursor.expectOneOf(['name', 'position'], 'invalidSetOperationMatch');
      if (matchWord) match = matchWord === 'name' ? 'by_name' : 'by_position';
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
      match: match === 'by_name' ? 'by_name' : 'by_position',
    });
  },
  format: (config) => {
    const rightInput = String(config?.rightInput ?? '').trim();
    if (!rightInput) return null;
    const operation = String(config?.operation ?? 'union');
    const mode = String(config?.mode ?? DEFAULT_MODE);
    const match = operation === 'union' ? (config?.match ?? DEFAULT_MATCH) : 'by_position';
    return `${operation} ${rightInput} mode ${mode}${operation === 'union' ? ` by ${match === 'by_name' ? 'name' : 'position'}` : ''}`;
  },
};
