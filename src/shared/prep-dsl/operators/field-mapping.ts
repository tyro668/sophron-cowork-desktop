import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, parseFieldRef, toFieldName } from '../syntax/fields';
import { splitTopLevel, splitTopLevelKeyword } from '../syntax/scanner';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';

export const fieldMappingCodec: OperatorDslCodec = {
  type: 'field_mapping',
  matches: (text) => text.startsWith('map ') || text.startsWith('rename '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const isMap = text.startsWith('map ');
    const mappings = splitTopLevel(text.slice(isMap ? 4 : 7)).flatMap((part) => {
      const pieces = splitTopLevelKeyword(part, isMap ? 'to' : 'as');
      if (pieces.length !== 2) {
        diagnostics.push({
          ...createPrepDiagnostic('invalidFieldMapping', `Cannot parse field mapping: ${part}`, {
            value: part,
          }),
          line: command.line,
        });
        return [];
      }
      const source = parseFieldRef(pieces[0]);
      const target = parseFieldRef(pieces[1]);
      const sourceName = source ? toFieldName(source).trim() : '';
      const targetName = target ? toFieldName(target).trim() : '';
      if (!sourceName || !targetName) {
        diagnostics.push({
          ...createPrepDiagnostic('invalidFieldMapping', `Cannot parse field mapping: ${part}`, {
            value: part,
          }),
          line: command.line,
        });
        return [];
      }
      return [{ source: sourceName, target: targetName }];
    });
    if (mappings.length === 0) {
      diagnostics.push({
        ...createPrepDiagnostic(
          'fieldMappingMissingEntry',
          'Field mapping requires at least one complete mapping'
        ),
        line: command.line,
      });
    }
    return createOperator('field_mapping', text, { mappings });
  },
  format: (config) => {
    const mappings = objectArray(config?.mappings);
    if (mappings.length === 0) return null;
    const formatted = mappings.map((mapping) => {
      const source = typeof mapping.source === 'string' ? mapping.source.trim() : '';
      const target = computeTarget(mapping).trim();
      return source && target ? `${formatFieldRef(source)} to ${formatFieldRef(target)}` : '';
    });
    return formatted.every(Boolean) ? `map ${formatted.join(', ')}` : null;
  },
};

function computeTarget(mapping: Record<string, unknown>): string {
  const source = typeof mapping.source === 'string' ? mapping.source : '';
  const target = typeof mapping.target === 'string' ? mapping.target : '';
  const mode = typeof mapping.targetMode === 'string' ? mapping.targetMode : '';
  const value = typeof mapping.targetValue === 'string' ? mapping.targetValue : '';
  if (target && !mode) return target;
  if (!source || !mode) return target;
  if (mode === 'rename') return value || target;
  if (mode === 'prefix') return `${value}${source}`;
  if (mode === 'suffix') return `${source}${value}`;
  return target;
}
