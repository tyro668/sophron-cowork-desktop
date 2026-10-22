import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';

export const fieldSelectCodec: OperatorDslCodec = {
  type: 'field_select',
  matches: (text) => text.startsWith('select ') || text.startsWith('drop '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const mode = text.startsWith('select ') ? 'include' : 'exclude';
    const cursor = new PrepTokenCursor(
      text.slice(mode === 'include' ? 7 : 5),
      command.line,
      diagnostics
    );
    const columns: string[] = [];
    while (!cursor.eof) {
      const field = cursor.expectFieldRef('invalidFieldSelectField');
      if (!field || !toFieldName(field).trim()) break;
      columns.push(toFieldName(field));
      if (cursor.eof) break;
      if (!cursor.matchType('Comma')) {
        cursor.expectEof('unexpectedFieldSelectToken');
        break;
      }
      if (cursor.eof) {
        cursor.report('fieldSelectMissingField', 'Field selection requires a field after ","');
      }
    }
    if (columns.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'fieldSelectMissingField',
          'Field selection requires at least one field'
        ),
        line: command.line,
      });
    }
    return createOperator('field_select', text, { selection: mode, fields: columns });
  },
  format: (config) => {
    const columns = stringArray(config?.fields).map(formatFieldRef).join(', ');
    if (!columns) return null;
    return `${config?.selection === 'exclude' ? 'drop' : 'select'} ${columns}`;
  },
};
