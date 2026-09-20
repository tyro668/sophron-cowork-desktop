import type { MemoryItemStatus } from './memory-types';
import { isoNow, loadJsonFile, normalizeWorkspaceKey, saveJsonFile } from './memory-utils';

/**
 * Persistent record of human-authored memory state. Model-derived core and
 * project entries are fully rebuilt from session transcripts, so manual edits,
 * confirmations, and deletions would be silently overwritten by every rebuild
 * if they only lived in the derived files. This overlay keeps the manual layer
 * separate: rebuilds regenerate the derived part, then re-apply these records.
 */
export interface MemoryManualOverlay {
  kind: 'core' | 'project';
  /**
   * Stable identity across rebuilds — core: the combinedKey; project:
   * `workspaceKey|normalizedKey` (entry ids are random and must not be used).
   */
  identity: string;
  action: 'upsert' | 'delete';
  value?: string;
  key?: string;
  category?: 'identity' | 'preferences' | 'skills' | 'interests';
  workspaceKey?: string | null;
  workspaceLabel?: string;
  /** Confidence value at the time of the manual edit. */
  confidence?: number;
  status?: MemoryItemStatus;
  userVerified?: boolean;
  /** Hash of the value the user verified — verification never transfers. */
  verifiedValueHash?: string;
  updatedAt: string;
}

interface OverlayFile {
  overlays?: Array<Record<string, unknown>>;
}

const MAX_OVERLAYS = 500;

function normalizeOverlay(item: unknown): MemoryManualOverlay | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, unknown>;
  const kind = record.kind === 'core' || record.kind === 'project' ? record.kind : null;
  const identity = typeof record.identity === 'string' ? record.identity : '';
  const action =
    record.action === 'delete' ? 'delete' : record.action === 'upsert' ? 'upsert' : null;
  if (!kind || !identity || !action) {
    return null;
  }
  const overlay: MemoryManualOverlay = {
    kind,
    identity,
    action,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : isoNow(),
  };
  if (typeof record.value === 'string') {
    overlay.value = record.value;
  }
  if (typeof record.key === 'string') {
    overlay.key = record.key;
  }
  if (
    record.category === 'identity' ||
    record.category === 'preferences' ||
    record.category === 'skills' ||
    record.category === 'interests'
  ) {
    overlay.category = record.category;
  }
  if (typeof record.workspaceKey === 'string') {
    overlay.workspaceKey = normalizeWorkspaceKey(record.workspaceKey);
  }
  if (typeof record.workspaceLabel === 'string') {
    overlay.workspaceLabel = record.workspaceLabel;
  }
  if (typeof record.confidence === 'number' && Number.isFinite(record.confidence)) {
    overlay.confidence = record.confidence;
  }
  if (
    record.status === 'active' ||
    record.status === 'pending' ||
    record.status === 'rejected' ||
    record.status === 'archived'
  ) {
    overlay.status = record.status;
  }
  if (typeof record.userVerified === 'boolean') {
    overlay.userVerified = record.userVerified;
  }
  if (typeof record.verifiedValueHash === 'string' && record.verifiedValueHash) {
    overlay.verifiedValueHash = record.verifiedValueHash;
  }
  return overlay;
}

export class MemoryManualOverlayStore {
  private readonly overlays = new Map<string, MemoryManualOverlay>();

  constructor(private readonly filePath: string) {
    const raw = loadJsonFile<OverlayFile>(filePath, {});
    for (const item of raw.overlays || []) {
      const overlay = normalizeOverlay(item);
      if (overlay) {
        this.overlays.set(`${overlay.kind}|${overlay.identity}`, overlay);
      }
    }
  }

  getPath(): string {
    return this.filePath;
  }

  getAll(): MemoryManualOverlay[] {
    return [...this.overlays.values()];
  }

  get(kind: MemoryManualOverlay['kind'], identity: string): MemoryManualOverlay | undefined {
    return this.overlays.get(`${kind}|${identity}`);
  }

  record(overlay: Omit<MemoryManualOverlay, 'updatedAt'>): void {
    const mapKey = `${overlay.kind}|${overlay.identity}`;
    this.overlays.set(mapKey, { ...overlay, updatedAt: isoNow() });
    if (this.overlays.size > MAX_OVERLAYS) {
      // Evict oldest records first — overlays are small and bounded.
      const ordered = [...this.overlays.values()].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt)
      );
      for (const stale of ordered.slice(0, this.overlays.size - MAX_OVERLAYS)) {
        this.overlays.delete(`${stale.kind}|${stale.identity}`);
      }
    }
    this.save();
  }

  remove(kind: MemoryManualOverlay['kind'], identity: string): void {
    if (this.overlays.delete(`${kind}|${identity}`)) {
      this.save();
    }
  }

  /** Batch removal in ONE write — candidate changesets land atomically. */
  removeAll(entries: Array<{ kind: MemoryManualOverlay['kind']; identity: string }>): void {
    let changed = false;
    for (const entry of entries) {
      changed = this.overlays.delete(`${entry.kind}|${entry.identity}`) || changed;
    }
    if (changed) {
      this.save();
    }
  }

  save(): void {
    saveJsonFile(this.filePath, { overlays: this.getAll() });
  }
}
