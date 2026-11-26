/**
 * Optional post-delete hook (registered by 云连接 at runtime) so deleting a raw
 * table can prune stale refs. applyRefs then unpublishes them by omission.
 */
type RawTableDeletedHook = (tableIds: string[]) => Promise<void>;

let hook: RawTableDeletedHook | undefined;

export function setRawTableDeletedHook(next?: RawTableDeletedHook): void {
  hook = next;
}

export async function notifyRawTablesDeleted(tableIds: string[]): Promise<void> {
  if (!hook || tableIds.length === 0) return;
  try {
    await hook(tableIds);
  } catch {
    // Cloud cleanup must not fail the table delete itself.
  }
}
