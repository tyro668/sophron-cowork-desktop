import {
  isNumericDataFieldType,
  isTemporalDataFieldType,
  normalizeDataFieldType,
} from '../data-field-types';
import type { MissingValueMethod, MissingValueRule } from '../operator-schemas/missing-value';

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

/**
 * A rule's method may become invalid after its column type changes (DSL
 * imports, upstream schema changes). Returns rules with such methods reset to
 * the first method the column type supports, so the config stays consistent
 * with what the form displays.
 */
export function normalizeMissingValueMethods(
  rules: MissingValueRule[],
  columnTypes: Record<string, string>
): { rules: MissingValueRule[]; changed: boolean } {
  let changed = false;
  const next = rules.map((rule) => {
    const colType = rule.field ? columnTypes[rule.field] : undefined;
    if (!colType) return rule;
    const allowed = methodsForMissingValueType(colType);
    if (allowed.includes(rule.method)) return rule;
    changed = true;
    return { ...rule, method: allowed[0] };
  });
  return { rules: changed ? next : rules, changed };
}
