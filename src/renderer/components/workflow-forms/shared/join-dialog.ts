export function toggleSelectAll(
  prev: ReadonlySet<string>,
  allFields: readonly string[]
): Set<string> {
  return new Set(prev.size === allFields.length ? [] : allFields);
}
