import { createPrepDiagnostic } from '../diagnostics';
import { formatFieldRef, toFieldName } from '../syntax/fields';
import { PrepTokenCursor } from '../syntax/token-cursor';
import { createOperator, objectArray, type OperatorDslCodec } from './codec';
import { isCompleteFieldMapping } from '../../operator-completeness';
import {
  computeFieldMappingTarget,
  normalizeFieldMappingEntry,
} from '../../operator-config/field-mapping';

export const fieldMappingCodec: OperatorDslCodec = {
  type: 'field_mapping',
  matches: (text) => text.startsWith('map ') || text.startsWith('rename '),
  parse: (command, diagnostics) => {
    const { text } = command;
    const isMap = text.startsWith('map ');
    const cursor = new PrepTokenCursor(text.slice(isMap ? 4 : 7), command.line, diagnostics);
    const mappings: Array<{
      source: string;
      targetMode: 'rename';
      targetValue: string;
    }> = [];
    while (!cursor.eof) {
      const source = cursor.expectFieldRef('invalidFieldMapping');
      if (!source || !cursor.expect(isMap ? 'to' : 'as', 'invalidFieldMapping')) break;
      const target = cursor.expectFieldRef('invalidFieldMapping');
      if (!target || !toFieldName(source).trim() || !toFieldName(target).trim()) {
        cursor.report('invalidFieldMapping', 'Field mapping requires non-empty fields');
        break;
      }
      mappings.push({
        source: toFieldName(source),
        targetMode: 'rename',
        targetValue: toFieldName(target),
      });
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
      const target = computeFieldMappingTarget(normalizeFieldMappingEntry(mapping)).trim();
      return source && target ? `${formatFieldRef(source)} to ${formatFieldRef(target)}` : '';
    });
    return formatted.every(Boolean) ? `map ${formatted.join(', ')}` : null;
  },
};
