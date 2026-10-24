import type { DataRawTable } from '../../shared/contracts';

export interface RawTableReimportStore {
  getRawTableRecord(id: string): Promise<DataRawTable | null>;
  updateRawTable(input: { id: string; filePath: string }): Promise<unknown>;
  refreshRawSource(id: string): Promise<unknown>;
}

/**
 * File-watch reimport for a raw table linked to a table-change automation. A member of a
 * 1:N source refreshes its whole source, so sibling tables stay in sync and vanished /
 * renamed sheets or files are flagged (E_SOURCE_MEMBER_MISSING) instead of the member being
 * re-read in isolation. Concurrent watcher hits on members of one source share one refresh.
 */
export function createRawTableReimporter(store: RawTableReimportStore) {
  const inflight = new Map<string, Promise<unknown>>();
  return async (rawTableId: string): Promise<void> => {
    const record = await store.getRawTableRecord(rawTableId);
    if (!record?.sourcePath) return;
    const sourceId = record.sourceId;
    if (!sourceId) {
      await store.updateRawTable({ id: rawTableId, filePath: record.sourcePath });
      return;
    }
    let pending = inflight.get(sourceId);
    if (!pending) {
      pending = store.refreshRawSource(sourceId).finally(() => inflight.delete(sourceId));
      inflight.set(sourceId, pending);
    }
    await pending;
  };
}
