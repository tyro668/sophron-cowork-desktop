export function insertRowAfter<T>(items: readonly T[], index: number, item: T): T[] {
  const next = [...items];
  next.splice(index + 1, 0, item);
  return next;
}

export function removeRowAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function canAppendRow(itemCount: number, maxItemCount: number): boolean {
  return itemCount < maxItemCount;
}
