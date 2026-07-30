import { DATA_FIELD_TYPES, isDataFieldType } from '../../data-field-types';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { unquoteString } from '../syntax/literals';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';

export const typeConvertCodec: OperatorDslCodec = {
  type: 'type_convert',
  matches: (text) => text.startsWith('cast '),
  parse: (command, diagnostics) => {
    const cursor = new PrepTokenCursor(command.text.slice(5), command.line, diagnostics);
    const conversions: Array<Record<string, string | undefined>> = [];
    while (!cursor.eof) {
      const field = cursor.expectFieldRef('invalidCastField');
      if (!field || !cursor.expect('as', 'invalidCast')) break;
      const targetType = cursor.expectIdentifier('invalidCastTargetType');
      if (!targetType) break;
      if (!isDataFieldType(targetType)) {
        diagnostics.push({
          ...createPrepDiagnostic(
            'invalidCastTargetType',
            `Unsupported cast target type: ${targetType}. Use one of ${DATA_FIELD_TYPES.join(', ')}.`,
            { type: targetType }
          ),
          line: command.line,
        });
      }
      let format: string | undefined;
      let onError = 'null';
      let hasFormat = false;
      let hasOnError = false;
      let invalid = false;
      while (!cursor.eof && cursor.tokenType() !== 'Comma') {
        if (cursor.match('format')) {
          if (hasFormat) {
            cursor.report('duplicateCastOption', 'Duplicate cast format option');
            invalid = true;
            break;
          }
          hasFormat = true;
          const literal = cursor.expectStringLiteral('invalidCastFormat');
          if (!literal) {
            invalid = true;
            break;
          }
          format = unquoteString(literal);
        } else if (cursor.match('on_error')) {
          if (hasOnError) {
            cursor.report('duplicateCastOption', 'Duplicate cast on_error option');
            invalid = true;
            break;
          }
          hasOnError = true;
          const value = cursor.expectOneOf(['keep', 'fail', 'null'], 'invalidCastOnError');
          if (!value) {
            invalid = true;
            break;
          }
          onError = value;
        } else {
          cursor.expectEof('unexpectedCastToken');
          invalid = true;
          break;
        }
      }
      if (invalid) break;
      conversions.push({ column: toFieldName(field), type: targetType, format, onError });
      if (cursor.eof) break;
      cursor.consume();
      if (cursor.eof) cursor.report('invalidCast', 'Cast requires a conversion after ","');
    }
    if (conversions.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic('invalidCast', 'Cast requires at least one complete conversion'),
        line: command.line,
      });
    }
    return createOperator('type_convert', command.text, { conversions });
  },
  format: (config) => {
    const conversions = objectArray(config?.conversions);
    if (conversions.length === 0) return 'cast [field] as text';
    return `cast ${conversions
      .map((conversion) => {
        const options = [
          typeof conversion.format === 'string' ? `format ${quoteString(conversion.format)}` : '',
          typeof conversion.onError === 'string' ? `on_error ${conversion.onError}` : '',
        ].filter(Boolean);
        const suffix = options.length > 0 ? ` ${options.join(' ')}` : '';
        return `${formatFieldRef(String(conversion.column ?? 'field'))} as ${String(
          conversion.type ?? 'text'
        )}${suffix}`;
      })
      .join(', ')}`;
  },
};

function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
