import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../data-field-types';
import type { MissingValueMethod } from '../operator-schemas/missing-value';

export function methodsForMissingValueType(colType: string | undefined): MissingValueMethod[] {
  const base: MissingValueMethod[] = ['skip', 'nullify_values', 'literal_fill', 'drop'];
  const ordered: MissingValueMethod[] = ['forward_fill', 'backward_fill'];
  const type = normalizeDataFieldType(colType);
  if (!colType || isNumericDataFieldType(type)) {
    return [...base, ...ordered, 'mean_fill', 'median_fill', 'mode_fill'];
  }
  if (isTemporalDataFieldType(type)) return [...base, ...ordered, 'mode_fill'];
  return [...base, ...ordered, 'mode_fill'];
}
