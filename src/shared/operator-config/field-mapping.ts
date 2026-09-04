import type { FieldMappingEntry } from '../operator-schemas/field-mapping';

export const EMPTY_FIELD_MAPPING: Readonly<FieldMappingEntry> = {
  source: '',
  targetMode: 'rename',
  targetValue: '',
};

export function computeFieldMappingTarget(mapping: FieldMappingEntry): string {
  if (!mapping.source) return '';
  if (mapping.targetMode === 'rename') return mapping.targetValue;
  return mapping.targetMode === 'prefix'
    ? `${mapping.targetValue}${mapping.source}`
    : `${mapping.source}${mapping.targetValue}`;
}

export function normalizeFieldMappingEntry(entry: Record<string, unknown>): FieldMappingEntry {
  const id = typeof entry.id === 'string' ? entry.id : undefined;
  const source = typeof entry.source === 'string' ? entry.source : '';
  const targetMode = entry.targetMode;
  if (targetMode === 'prefix' || targetMode === 'suffix' || targetMode === 'rename') {
    return {
      id,
      source,
      targetMode,
      targetValue: typeof entry.targetValue === 'string' ? entry.targetValue : '',
    };
  }
  throw new Error(`Unsupported field mapping target mode: ${String(targetMode)}`);
}
