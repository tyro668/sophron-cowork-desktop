export function computeUsedFields<T>(
  items: T[],
  keyFn: (item: T) => string | undefined
): Set<string> {
  const used = new Set<string>();
  for (const item of items) {
    const key = keyFn(item);
    if (key) used.add(key);
  }
  return used;
}
