export function computeUsedFields<T>(
  items: readonly T[],
  getField: (item: T) => string | undefined
): Set<string> {
  const usedFields = new Set<string>();
  for (const item of items) {
    const field = getField(item);
    if (field) usedFields.add(field);
  }
  return usedFields;
}
