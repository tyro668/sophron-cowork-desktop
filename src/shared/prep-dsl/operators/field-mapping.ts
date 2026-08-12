import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';
import { isCompleteFieldMapping } from '../../operator-completeness';

export const fieldMappingCodec: OperatorDslCodec = {
  type: 'field_mapping',
  matches: (text) => text.startsWith('map ') || text.startsWith('rename '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const isMap = text.startsWith('map ');
    const cursor = new PrepTokenCursor(text.slice(isMap ? 4 : 7), command.line, diagnostics);
    const mappings: Array<{ source: string; target: string }> = [];
    while (!cursor.eof) {
      const source = cursor.expectFieldRef('invalidFieldMapping');
      if (!source || !cursor.expect(isMap ? 'to' : 'as', 'invalidFieldMapping')) break;
      const target = cursor.expectFieldRef('invalidFieldMapping');
      if (!target || !toFieldName(source).trim() || !toFieldName(target).trim()) {
        cursor.report('invalidFieldMapping', 'Field mapping requires non-empty fields');
        break;
      }
      mappings.push({ source: toFieldName(source), target: toFieldName(target) });
      if (cursor.eof) break;
      if (!cursor.matchType('Comma')) {
        cursor.expectEof('unexpectedFieldMappingToken');
        break;
      }
      if (cursor.eof) {
        cursor.report('invalidFieldMapping', 'Field mapping requires an entry after ","');
      }
    }
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
    const mappings = objectArray(config?.mappings).filter(isCompleteFieldMapping);
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
