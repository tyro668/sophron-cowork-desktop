import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';

export const fieldSelectCodec: OperatorDslCodec = {
  type: 'field_select',
  matches: (text) => text.startsWith('select ') || text.startsWith('drop '),
  parse: ({ text }) => {
    const mode = text.startsWith('select ') ? 'include' : 'exclude';
    const body = text.slice(mode === 'include' ? 7 : 5);
    const columns = splitTopLevel(body).flatMap((part) => {
      const field = parseFieldRef(part);
      return field ? [toFieldName(field)] : [];
    });
    return createOperator('field_select', text, { mode, columns });
  },
  format: (config) => {
    const columns = stringArray(config?.columns).map(formatFieldRef).join(', ');
    if (!columns && config?.mode !== 'exclude') return null;
    return `${config?.mode === 'exclude' ? 'drop' : 'select'} ${columns}`;
  },
};
