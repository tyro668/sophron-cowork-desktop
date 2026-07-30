import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';

export const fieldSelectCodec: OperatorDslCodec = {
  type: 'field_select',
  matches: (text) => text.startsWith('select ') || text.startsWith('drop '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const mode = text.startsWith('select ') ? 'include' : 'exclude';
    const body = text.slice(mode === 'include' ? 7 : 5);
    const columns = splitTopLevel(body).flatMap((part) => {
      const field = parseFieldRef(part);
      const name = field ? toFieldName(field).trim() : '';
      return name ? [name] : [];
    });
    if (columns.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'fieldSelectMissingField',
          'Field selection requires at least one field'
        ),
        line: command.line,
      });
    }
    return createOperator('field_select', text, { mode, columns });
  },
  format: (config) => {
    const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
    if (!columns) return null;
    return `${config?.mode === 'exclude' ? 'drop' : 'select'} ${columns}`;
  },
};
