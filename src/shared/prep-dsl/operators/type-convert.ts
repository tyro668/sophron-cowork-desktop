import { DATA_FIELD_TYPES, isDataFieldType } from '../../data-field-types';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { unquoteString } from '../syntax/literals';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';
import { DATE_FORMAT_VALUES, SCALE_MIN, SCALE_MAX } from '../../operator-schemas/type-convert';
import { isCompleteTypeConversion } from '../../operator-completeness';

export const typeConvertCodec: OperatorDslCodec = {
  type: 'type_convert',
  matches: (text) => text.startsWith('cast '),
  parse: (command, diagnostics) => {
    const cursor = new PrepTokenCursor(command.text.slice(5), command.line, diagnostics);
    const conversions: Array<Record<string, string | number | undefined>> = [];
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
      let scale: number | undefined;
      let hasFormat = false;
      let hasOnError = false;
      let hasScale = false;
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
          if (
            format &&
            !DATE_FORMAT_VALUES.includes(format as (typeof DATE_FORMAT_VALUES)[number])
          ) {
            diagnostics.push({
              ...createPrepDiagnostic(
                'invalidCastFormat',
                `Invalid date format "${format}". Must be one of the supported presets.`,
                { format }
              ),
              line: command.line,
            });
          }
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
        } else if (cursor.match('scale')) {
          if (hasScale) {
            cursor.report('duplicateCastOption', 'Duplicate cast scale option');
            invalid = true;
            break;
          }
          hasScale = true;
          const num = cursor.expectNonNegativeInteger('invalidCastScale');
          if (num === null) {
            invalid = true;
            break;
          }
          scale = num;
          if (scale !== undefined && (scale < SCALE_MIN || scale > SCALE_MAX)) {
            diagnostics.push({
              ...createPrepDiagnostic(
                'invalidCastScale',
                `Scale must be between ${SCALE_MIN} and ${SCALE_MAX}, got ${scale}`,
                { scale }
              ),
              line: command.line,
            });
          }
        } else {
          cursor.expectEof('unexpectedCastToken');
          invalid = true;
          break;
        }
      }
      if (invalid) break;
      if (format && targetType !== 'date' && targetType !== 'datetime') {
        diagnostics.push({
          ...createPrepDiagnostic(
            'invalidCastFormat',
            `Format is only valid for date/datetime conversions, not ${targetType}`,
            { type: targetType }
          ),
          line: command.line,
        });
      }
      conversions.push({ field: toFieldName(field), type: targetType, format, onError, scale });
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
    const conversions = objectArray(config?.conversions).filter(isCompleteTypeConversion);
    if (conversions.length === 0) return null;
    return `cast ${conversions
      .map((conversion) => {
        const options = [
          typeof conversion.format === 'string' ? `format ${quoteString(conversion.format)}` : '',
          typeof conversion.scale === 'number' ? `scale ${conversion.scale}` : '',
          typeof conversion.onError === 'string' && conversion.onError !== 'null'
            ? `on_error ${conversion.onError}`
            : '',
        ].filter(Boolean);
        const suffix = options.length > 0 ? ` ${options.join(' ')}` : '';
        return `${formatFieldRef(String(conversion.field ?? 'field'))} as ${String(
          conversion.type ?? 'text'
        )}${suffix}`;
      })
      .join(', ')}`;
  },
};

function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
