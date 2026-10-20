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

export function ensureStableRowIds<T extends { id?: string }>(
  items: readonly T[],
  createId: () => string = createStableRowId
): T[] {
  const seenIds = new Set<string>();
  return items.map((item) => {
    let id = item.id?.trim();
    while (!id || seenIds.has(id)) id = createId();
    seenIds.add(id);
    return id === item.id ? item : { ...item, id };
  });
}

export function createStableRowId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  return `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Patch one row against the LATEST persisted rows (read inside a functional
 * config update), not a render-time snapshot. Using the snapshot drops
 * earlier queued edits (e.g. lost keystrokes). Rows missing an id reuse the id
 * the form rendered for that index so React keys — and input focus — stay
 * stable; when nothing is persisted yet, the rendered placeholder rows are used.
 */
export function patchRowAt<T extends { id?: string }>(
  currentRows: readonly T[],
  renderedRows: readonly T[],
  index: number,
  patch: Partial<T>
): T[] {
  const base =
    currentRows.length > 0
      ? currentRows.map((row, i) =>
          row.id?.trim() || !renderedRows[i]?.id ? row : { ...row, id: renderedRows[i].id }
        )
      : [...renderedRows];
  return base.map((row, i) => (i === index ? { ...row, ...patch } : row));
}
