import { DATA_FIELD_TYPES, isDataFieldType } from '../../data-field-types';
import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel, splitTopLevelKeyword } from '../syntax/scanner';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';

export const typeConvertCodec: OperatorDslCodec = {
  type: 'type_convert',
  matches: (text) => text.startsWith('cast '),
  parse: (command, diagnostics) => {
    const conversions = splitTopLevel(command.text.slice(5)).flatMap((part) => {
      const pieces = splitTopLevelKeyword(part, 'as');
      if (pieces.length !== 2) return [];
      const fieldText = pieces[0].trim();
      const typeAndOptions = pieces[1].trim();
      const optionStart = typeAndOptions.search(/\s/);
      const targetType = optionStart < 0 ? typeAndOptions : typeAndOptions.slice(0, optionStart);
      const options = optionStart < 0 ? '' : typeAndOptions.slice(optionStart);
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
      const field = parseFieldRef(fieldText);
      return [
        {
          column: field ? toFieldName(field) : fieldText,
          type: targetType,
          format: pickStringOption(options, 'format'),
          onError: pickWordOption(options, 'on_error') ?? 'null',
        },
      ];
    });
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

function pickWordOption(value: string, key: string): string | undefined {
  return new RegExp(`\\s${key}\\s+([A-Za-z_][A-Za-z0-9_]*)`).exec(value)?.[1];
}

function pickStringOption(value: string, key: string): string | undefined {
  const match = new RegExp(`\\s${key}\\s+("(?:[^"\\\\]|\\\\.)*"|\\S+)`).exec(value);
  if (!match) return undefined;
  const option = match[1].trim();
  return option.startsWith('"') && option.endsWith('"')
    ? option.slice(1, -1).replace(/\\"/g, '"')
    : option;
}

function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
