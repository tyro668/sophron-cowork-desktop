import crypto from 'node:crypto';
import type { MemoryTombstone } from './memory-types';
import { isoNow, loadJsonFile, normalizeWorkspaceKey, saveJsonFile } from './memory-utils';

interface TombstoneFile {
  tombstones?: Array<Record<string, unknown>>;
}

const MAX_TOMBSTONES = 1000;

export function hashMemoryValue(value: string): string {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

export function projectTombstoneIdentity(workspaceKey: string | null, key: string): string {
  return `${normalizeWorkspaceKey(workspaceKey) || ''}|${key.normalize('NFKC').trim().toLowerCase()}`;
}

function normalizeTombstone(item: Record<string, unknown>): MemoryTombstone | null {
  const kind = item.kind === 'core' || item.kind === 'project' ? item.kind : null;
  const identity = typeof item.identity === 'string' ? item.identity : '';
  const valueHash = typeof item.valueHash === 'string' ? item.valueHash : '';
  if (!kind || !identity || !valueHash) {
    return null;
  }
  return {
    kind,
    identity,
    valueHash,
    sourceSessionIds: Array.isArray(item.sourceSessionIds)
      ? item.sourceSessionIds.filter((id): id is string => typeof id === 'string')
      : [],
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : isoNow(),
  };
}

interface TombstoneQuery {
  kind: MemoryTombstone['kind'];
  identity: string;
  valueHash: string;
  sessionId?: string | null;
}

/**
 * Narrow surface the memory stores consult — a rebuild candidate wraps this
 * to intercept lifts/removals into a changeset without writing the live
 * ledger before the candidate commits.
 */
export interface MemoryTombstoneGate {
  matches(input: TombstoneQuery): boolean;
  findMatch(input: TombstoneQuery): MemoryTombstone | undefined;
  remove(tombstone: MemoryTombstone): void;
}

export class MemoryTombstoneStore {
  private tombstones: MemoryTombstone[] = [];

  constructor(private readonly filePath: string) {
    const raw = loadJsonFile<TombstoneFile>(filePath, { tombstones: [] });
    this.tombstones = (raw.tombstones || [])
      .map((item) => (item && typeof item === 'object' ? normalizeTombstone(item) : null))
      .filter((item): item is MemoryTombstone => Boolean(item));
  }

  getPath(): string {
    return this.filePath;
  }

  getAll(): MemoryTombstone[] {
    return [...this.tombstones];
  }

  add(input: Omit<MemoryTombstone, 'createdAt'>): void {
    this.tombstones = this.tombstones.filter(
      (item) =>
        !(
          item.kind === input.kind &&
          item.identity === input.identity &&
          item.valueHash === input.valueHash
        )
    );
    this.tombstones.unshift({ ...input, createdAt: isoNow() });
    if (this.tombstones.length > MAX_TOMBSTONES) {
      this.tombstones.length = MAX_TOMBSTONES;
    }
    this.save();
  }

  matches(input: TombstoneQuery): boolean {
    return Boolean(this.findMatch(input));
  }

  /** The matching record — callers needing its timestamp/lifting it use this. */
  findMatch(input: TombstoneQuery): MemoryTombstone | undefined {
    return this.tombstones.find(
      (item) =>
        item.kind === input.kind &&
        item.identity === input.identity &&
        item.valueHash === input.valueHash &&
        (!input.sessionId ||
          !item.sourceSessionIds.length ||
          item.sourceSessionIds.includes(input.sessionId))
    );
  }

  /**
   * Lift a specific tombstone — a newer authoritative re-assertion of the
   * same value revokes the deletion marker. Old-source replays still match
   * remaining tombstones.
   */
  remove(tombstone: MemoryTombstone): void {
    const next = this.tombstones.filter((item) => item !== tombstone);
    if (next.length !== this.tombstones.length) {
      this.tombstones = next;
      this.save();
    }
  }

  /** Batch lift — one write for a whole candidate changeset. */
  removeAll(tombstones: MemoryTombstone[]): void {
    const drop = new Set(tombstones);
    const next = this.tombstones.filter((item) => !drop.has(item));
    if (next.length !== this.tombstones.length) {
      this.tombstones = next;
      this.save();
    }
  }

  save(): void {
    saveJsonFile(this.filePath, { tombstones: this.tombstones });
  }
}
