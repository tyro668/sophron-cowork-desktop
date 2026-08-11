import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, stringArray, type OperatorDslCodec } from './codec';

export const unpivotCodec: OperatorDslCodec = {
  type: 'unpivot',
  matches: (text) => text.startsWith('unpivot '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const cursor = new PrepTokenCursor(text, command.line, diagnostics);
    cursor.expect('unpivot', 'invalidUnpivot');
    let includeNulls = false;
    if (cursor.match('include')) {
      cursor.expect('nulls', 'invalidUnpivot');
      includeNulls = true;
    }
    let mode = 'include';
    if (cursor.match('columns')) {
      cursor.expect('except', 'invalidUnpivot');
      mode = 'except';
    }

    const columns: string[] = [];
    const seen = new Set<string>();
    while (!cursor.eof) {
      const field = cursor.expectFieldRef('invalidUnpivotField');
      if (!field || !toFieldName(field).trim()) break;
      const name = toFieldName(field);
      if (seen.has(name.toLowerCase())) {
        diagnostics.push({
          ...createPrepDiagnostic(
            'duplicateUnpivotField',
            `Duplicate field "${name}" in unpivot columns`
          ),
          line: command.line,
        });
      }
      seen.add(name.toLowerCase());
      columns.push(name);
      if (!cursor.matchType('Comma')) break;
      if (cursor.eof) cursor.report('invalidUnpivotField', 'Unpivot requires a field after ","');
    }

    cursor.expect('into', 'invalidUnpivot');
    cursor.expect('name', 'invalidUnpivot');
    const nameColumn = cursor.expectFieldRef('invalidUnpivotNameField');
    cursor.expect('value', 'invalidUnpivot');
    const valueColumn = cursor.expectFieldRef('invalidUnpivotValueField');
    cursor.expectEof('unexpectedUnpivotToken');
    if (columns.length === 0 || !nameColumn || !valueColumn) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'invalidUnpivot',
          'Unpivot requires source, name, and value fields'
        ),
        line: command.line,
      });
    }
    return createOperator('unpivot', text, {
      mode,
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
