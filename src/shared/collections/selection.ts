export function toggleSelectAll(
  selectedValues: ReadonlySet<string>,
  availableValues: readonly string[]
): Set<string> {
  const hasSelectedAll =
    availableValues.length > 0 && availableValues.every((value) => selectedValues.has(value));
  return new Set(hasSelectedAll ? [] : availableValues);
}
