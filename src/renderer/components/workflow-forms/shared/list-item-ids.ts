export interface ListItemWithId {
  id?: string;
}

export function createStableListItemId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeListItemsWithIds<T extends ListItemWithId>(
  items: readonly T[] | null | undefined,
  prefix: string
): Array<T & { id: string }> {
  const seen = new Set<string>();
  return (items ?? []).map((item) => {
    const currentId = typeof item.id === 'string' ? item.id.trim() : '';
    let id = currentId || createStableListItemId(prefix);
    while (seen.has(id)) {
      id = createStableListItemId(prefix);
    }
    seen.add(id);
    return {
      ...item,
      id,
    };
  });
}

export function needsListItemIdNormalization<T extends ListItemWithId>(
  items: readonly T[] | null | undefined
): boolean {
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || seen.has(id)) {
      return true;
    }
    seen.add(id);
  }
  return false;
}
