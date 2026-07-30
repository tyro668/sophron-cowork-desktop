import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel } from '../syntax/scanner';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';

export const unpivotCodec: OperatorDslCodec = {
  type: 'unpivot',
  matches: (text) => text.startsWith('unpivot '),
  parse: ({ text }) => {
    const includeNulls = text.startsWith('unpivot include nulls ');
    const body = text.slice(includeNulls ? 'unpivot include nulls '.length : 'unpivot '.length);
    const match = /^(.+?)\s+into\s+name\s+(.+?)\s+value\s+(.+)$/.exec(body);
    const columnSpec = match?.[1].trim() ?? '';
    const except = columnSpec.startsWith('columns except ');
    const columnsText = except ? columnSpec.slice('columns except '.length) : columnSpec;
    const nameColumn = match ? parseFieldRef(match[2]) : null;
    const valueColumn = match ? parseFieldRef(match[3]) : null;
    const columns = splitTopLevel(columnsText).flatMap((part) => {
      const field = parseFieldRef(part);
      return field ? [toFieldName(field)] : [];
    });
    return createOperator('unpivot', text, {
      mode: except ? 'except' : 'include',
      columns,
      nameColumn: nameColumn ? toFieldName(nameColumn) : '',
      valueColumn: valueColumn ? toFieldName(valueColumn) : '',
      includeNulls,
    });
  },
  format: (config) => {
    const includeNulls = config?.includeNulls ? 'include nulls ' : '';
    const mode = config?.mode === 'except' ? 'columns except ' : '';
    const columns = stringArray(config?.columns).map(formatFieldRef).join(', ') || '[field]';
    return `unpivot ${includeNulls}${mode}${columns} into name ${formatFieldRef(
      String(config?.nameColumn ?? 'name')
    )} value ${formatFieldRef(String(config?.valueColumn ?? 'value'))}`;
  },
};
