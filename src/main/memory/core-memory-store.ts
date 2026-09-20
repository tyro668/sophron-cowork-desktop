import type {
  AppliedCoreMemoryAction,
  CoreMemoryActionInput,
  CoreMemoryEntry,
  MemoryEvidenceRef,
  MemoryItemStatus,
} from './memory-types';
import {
  buildConfidenceSignals,
  calculateMemoryConfidence,
  confidenceSignalsToFileRecord,
  countIndependentEvidenceSessions,
  memoryValuesEquivalent,
  mergeConfidenceSignals,
  normalizeConfidence,
  normalizeConfidenceSourceType,
  normalizeConfidenceSignals,
} from './memory-confidence';
import { hashMemoryValue, type MemoryTombstoneGate } from './memory-tombstone-store';
import { evidenceToFileRecord, mergeEvidenceRefs, normalizeEvidenceList } from './memory-evidence';
import type { MemoryManualOverlay } from './memory-manual-overlay-store';
import {
  containsSensitiveContent,
  coreMemoryToPromptBlock,
  isoNow,
  loadJsonFile,
  parseCoreCombinedKey,
  resolveCoreCombinedKey,
  saveJsonFile,
} from './memory-utils';

interface CoreMemoryFile {
  entries?: Array<Record<string, unknown>>;
}

type CoreMemoryUpdate = Partial<Pick<CoreMemoryEntry, 'key' | 'value' | 'confidence' | 'status'>>;

const ACTIVE_STATUS: MemoryItemStatus = 'active';
const MEMORY_STATUSES = new Set<MemoryItemStatus>(['active', 'pending', 'rejected', 'archived']);

function normalizeStatus(value: unknown): MemoryItemStatus {
  return typeof value === 'string' && MEMORY_STATUSES.has(value as MemoryItemStatus)
    ? (value as MemoryItemStatus)
    : ACTIVE_STATUS;
}

function normalizeEvidence(value: unknown): MemoryEvidenceRef[] {
  return normalizeEvidenceList(value);
}

function normalizeStructuredEntry(item: Record<string, unknown>): CoreMemoryEntry | null {
  const combinedKey =
    typeof item.combinedKey === 'string'
      ? item.combinedKey
      : typeof item.combined_key === 'string'
        ? item.combined_key
        : typeof item.key === 'string'
          ? resolveCoreCombinedKey(
              typeof item.category === 'string'
                ? (item.category as CoreMemoryEntry['category'])
                : undefined,
              item.key
            )
          : '';
  const value = typeof item.value === 'string' ? item.value.trim() : '';
  const parsed = parseCoreCombinedKey(combinedKey);
  if (!parsed.combinedKey || !value) {
    return null;
  }
  const now = isoNow();
  const evidence = normalizeEvidence(item.evidence);
  const confidenceSignals = normalizeConfidenceSignals(
    item.confidenceSignals ?? item.confidence_signals
  );
  if (!confidenceSignals) {
    return null;
  }
  return {
    ...parsed,
    value,
    confidence: calculateMemoryConfidence(confidenceSignals),
    confidenceSignals,
    status: normalizeStatus(item.status),
    evidence,
    createdAt:
      typeof item.createdAt === 'string'
        ? item.createdAt
        : typeof item.created_at === 'string'
          ? item.created_at
          : now,
    updatedAt:
      typeof item.updatedAt === 'string'
        ? item.updatedAt
        : typeof item.updated_at === 'string'
          ? item.updated_at
          : now,
  };
}

function entryToFileRecord(item: CoreMemoryEntry): Record<string, unknown> {
  return {
    combined_key: item.combinedKey,
    category: item.category ?? '',
    key: item.key,
    value: item.value,
    confidence: item.confidence,
    confidence_signals: confidenceSignalsToFileRecord(item.confidenceSignals),
    status: item.status,
    evidence: item.evidence.map((evidence) => evidenceToFileRecord(evidence)),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function mergeEvidence(
  existing: MemoryEvidenceRef[],
  additions: MemoryEvidenceRef[]
): MemoryEvidenceRef[] {
  return mergeEvidenceRefs(existing, additions, 8);
}

export class CoreMemoryStore {
  private readonly entries = new Map<string, CoreMemoryEntry>();

  constructor(
    private readonly filePath: string,
    private readonly maxItems = 24,
    private readonly tombstones?: MemoryTombstoneGate
  ) {
    const raw = loadJsonFile<unknown>(filePath, {});
    if (raw && typeof raw === 'object' && Array.isArray((raw as CoreMemoryFile).entries)) {
      for (const item of (raw as CoreMemoryFile).entries || []) {
        const entry = normalizeStructuredEntry(item);
        if (entry) {
          this.entries.set(entry.combinedKey, entry);
        }
      }
      return;
    }
  }

  getPath(): string {
    return this.filePath;
  }

  getRaw(): Record<string, string> {
    return Object.fromEntries(
      this.getActiveEntries().map((entry) => [entry.combinedKey, entry.value])
    );
  }

  getEntries(): CoreMemoryEntry[] {
    return [...this.entries.values()].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === ACTIVE_STATUS ? -1 : 1;
      }
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  }

  getEntry(combinedKey: string): CoreMemoryEntry | undefined {
    return this.entries.get(combinedKey);
  }

  removeEvidenceWhere(predicate: (evidence: MemoryEvidenceRef) => boolean): CoreMemoryEntry[] {
    const removed: CoreMemoryEntry[] = [];
    const now = isoNow();
    let changed = false;
    for (const [key, entry] of this.entries) {
      const remaining = entry.evidence.filter((item) => !predicate(item));
      if (remaining.length === entry.evidence.length) {
        continue;
      }
      changed = true;
      if (!remaining.length && !entry.confidenceSignals.userVerified) {
        removed.push(entry);
        this.entries.delete(key);
        continue;
      }
      const confidenceSignals: typeof entry.confidenceSignals = {
        ...entry.confidenceSignals,
        evidenceCount: remaining.length,
        corroborationCount: Math.min(
          entry.confidenceSignals.corroborationCount,
          countIndependentEvidenceSessions(remaining)
        ),
      };
      this.entries.set(key, {
        ...entry,
        evidence: remaining,
        confidence: calculateMemoryConfidence(confidenceSignals),
        confidenceSignals,
        updatedAt: now,
      });
    }
    if (changed) {
      this.save();
    }
    return removed;
  }

  getActiveEntries(): CoreMemoryEntry[] {
    return this.getEntries().filter((entry) => entry.status === ACTIVE_STATUS);
  }

  applyActions(
    actions: CoreMemoryActionInput[],
    evidence: MemoryEvidenceRef[] = [],
    options?: {
      /**
       * Epoch-ms of the user turn supporting each action (from its verified
       * `sourceTurns`). Required to lift a tombstone: a deletion marker is
       * only revoked by a newer explicit re-assertion, never by replaying the
       * old evidence it was created against.
       */
      supportTimeOf?: (action: CoreMemoryActionInput) => number | undefined;
    }
  ): AppliedCoreMemoryAction[] {
    const applied: AppliedCoreMemoryAction[] = [];
    const now = isoNow();
    const appliedKeys = new Set<string>();

    for (const action of actions) {
      const combinedKey = resolveCoreCombinedKey(action.category, action.key);
      if (!combinedKey) {
        continue;
      }
      const parsed = parseCoreCombinedKey(combinedKey);
      const existing = this.entries.get(combinedKey);

      if (action.op === 'delete') {
        if (existing) {
          this.entries.set(combinedKey, {
            ...existing,
            status: 'archived',
            updatedAt: now,
            evidence: mergeEvidence(existing.evidence, evidence),
          });
        }
        applied.push({
          op: action.op,
          category: parsed.category,
          key: parsed.key,
          combinedKey,
        });
        appliedKeys.add(combinedKey);
        continue;
      }

      const value = typeof action.value === 'string' ? action.value.trim() : '';
      // Values that are essentially credentials must never be persisted —
      // the extractor occasionally surfaces api keys/tokens as "facts".
      if (!value || containsSensitiveContent(value)) {
        continue;
      }
      const sourceType = normalizeConfidenceSourceType(action.sourceType);
      const extractionConfidence = normalizeConfidence(action.confidence);
      if (!sourceType || extractionConfidence === null) {
        continue;
      }
      const tombstone = this.tombstones?.findMatch({
        kind: 'core',
        identity: combinedKey,
        valueHash: hashMemoryValue(value),
        sessionId: evidence[0]?.sessionId ?? null,
      });
      if (tombstone) {
        // An explicit re-assertion whose supporting user turn postdates the
        // deletion revokes the tombstone; old-evidence replays stay blocked.
        const supportAt = options?.supportTimeOf?.(action);
        const authoritative =
          sourceType === 'explicit_user_statement' || sourceType === 'manual_edit';
        const tombstoneAt = Date.parse(tombstone.createdAt);
        if (
          !authoritative ||
          supportAt === undefined ||
          !Number.isFinite(tombstoneAt) ||
          tombstoneAt >= supportAt
        ) {
          continue;
        }
        this.tombstones?.remove(tombstone);
      }
      const incomingSignals = buildConfidenceSignals({
        sourceType,
        extractionConfidence,
        evidenceCount: evidence.length,
        corroborationCount: 0,
        reason: action.reason,
      });
      const valueChanged = existing ? !memoryValuesEquivalent(existing.value, value) : false;
      const independentEvidence =
        !existing ||
        evidence.some(
          (item) => !existing.evidence.some((recorded) => recorded.sessionId === item.sessionId)
        );

      // An authoritative correction — an explicit user statement or a manual
      // edit — may replace even a verified value; inferred sources may not.
      const authoritativeCorrection =
        sourceType === 'explicit_user_statement' || sourceType === 'manual_edit';
      // Verification is bound to a value, not a key: entries whose recorded
      // verifiedValueHash no longer matches their value are treated as
      // unverified (legacy entries without a hash keep their flag).
      const verifiedValueIntact = existing
        ? existing.confidenceSignals.userVerified &&
          (!existing.confidenceSignals.verifiedValueHash ||
            existing.confidenceSignals.verifiedValueHash === hashMemoryValue(existing.value))
        : false;
      if (existing && valueChanged && verifiedValueIntact && !authoritativeCorrection) {
        // userVerified is bound to the confirmed value: a conflicting
        // auto-extraction records a contradiction instead of overwriting it,
        // and the kept value retains its verification.
        const conflictedSignals = mergeConfidenceSignals(
          existing.confidenceSignals,
          incomingSignals,
          { resolution: 'conflict', independentEvidence }
        );
        conflictedSignals.userVerified = true;
        conflictedSignals.lastVerifiedAt = existing.confidenceSignals.lastVerifiedAt;
        conflictedSignals.verifiedValueHash =
          existing.confidenceSignals.verifiedValueHash ?? hashMemoryValue(existing.value);
        this.entries.set(combinedKey, {
          ...existing,
          confidence: calculateMemoryConfidence(conflictedSignals),
          confidenceSignals: conflictedSignals,
          updatedAt: now,
        });
        applied.push({
          op: action.op,
          category: parsed.category,
          key: parsed.key,
          value: existing.value,
          combinedKey,
        });
        appliedKeys.add(combinedKey);
        continue;
      }

      const confidenceSignals = existing?.confidenceSignals
        ? mergeConfidenceSignals(existing.confidenceSignals, incomingSignals, {
            resolution: valueChanged
              ? authoritativeCorrection
                ? 'correction'
                : 'conflict'
              : 'equivalent',
            independentEvidence,
          })
        : incomingSignals;

      this.entries.set(combinedKey, {
        ...parsed,
        value,
        confidence: calculateMemoryConfidence(confidenceSignals),
        confidenceSignals,
        status: ACTIVE_STATUS,
        evidence: mergeEvidence(existing?.evidence ?? [], evidence),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      applied.push({
        op: action.op,
        category: parsed.category,
        key: parsed.key,
        value,
        combinedKey,
      });
      appliedKeys.add(combinedKey);
    }

    this.trim(appliedKeys);
    this.save();
    return applied;
  }

  updateEntry(combinedKey: string, updates: CoreMemoryUpdate): CoreMemoryEntry | null {
    const existing = this.entries.get(combinedKey);
    if (!existing) {
      return null;
    }
    const nextValue = typeof updates.value === 'string' ? updates.value.trim() : existing.value;
    if (!nextValue) {
      return null;
    }
    const nextKey =
      typeof updates.key === 'string' && updates.key.trim()
        ? resolveCoreCombinedKey(existing.category, updates.key)
        : combinedKey;
    if (!nextKey) {
      return null;
    }
    const parsed = parseCoreCombinedKey(nextKey);
    let nextConfidence = existing.confidence;
    let nextConfidenceSignals = existing.confidenceSignals;
    if (updates.confidence !== undefined) {
      const extractionConfidence = normalizeConfidence(updates.confidence);
      if (extractionConfidence === null) {
        return null;
      }
      nextConfidenceSignals = mergeConfidenceSignals(
        existing.confidenceSignals,
        buildConfidenceSignals({
          sourceType: 'manual_edit',
          extractionConfidence,
          evidenceCount: existing.evidence.length,
          userVerified: true,
          lastVerifiedAt: isoNow(),
          reason: 'Manually adjusted confidence',
        }),
        {
          resolution: memoryValuesEquivalent(existing.value, nextValue)
            ? 'equivalent'
            : 'correction',
        }
      );
      nextConfidence = calculateMemoryConfidence(nextConfidenceSignals);
    }
    // Verification binds to the value it was made on — bind the hash whenever
    // the entry is verified, clear it when verification is absent.
    nextConfidenceSignals = nextConfidenceSignals.userVerified
      ? { ...nextConfidenceSignals, verifiedValueHash: hashMemoryValue(nextValue) }
      : { ...nextConfidenceSignals, verifiedValueHash: undefined };
    const updated: CoreMemoryEntry = {
      ...existing,
      ...parsed,
      value: nextValue,
      confidence: nextConfidence,
      confidenceSignals: nextConfidenceSignals,
      status: updates.status === undefined ? existing.status : normalizeStatus(updates.status),
      updatedAt: isoNow(),
    };
    if (nextKey !== combinedKey) {
      this.entries.delete(combinedKey);
    }
    this.entries.set(nextKey, updated);
    this.save();
    return updated;
  }

  deleteEntry(combinedKey: string): { success: boolean } {
    if (!this.entries.has(combinedKey)) {
      return { success: false };
    }
    this.entries.delete(combinedKey);
    this.save();
    return { success: true };
  }

  /**
   * Re-apply a persisted human override onto a (possibly freshly rebuilt)
   * generation. Manual state wins over re-derived content: the overlay value,
   * status, and verification flags replace whatever extraction produced for
   * the same identity, and 'delete' removes a resurrected entry outright.
   */
  applyManualOverride(overlay: MemoryManualOverlay): void {
    const combinedKey = overlay.identity;
    if (!combinedKey) {
      return;
    }
    if (overlay.action === 'delete') {
      if (this.entries.delete(combinedKey)) {
        this.save();
      }
      return;
    }
    const value = typeof overlay.value === 'string' ? overlay.value.trim() : '';
    if (!value) {
      return;
    }
    const existing = this.entries.get(combinedKey);
    // Idempotent replay: overlays are re-applied on every ingest commit, so a
    // no-op reapplication must not churn the file's updatedAt/save.
    if (
      existing &&
      memoryValuesEquivalent(existing.value, value) &&
      existing.status === (overlay.status ?? existing.status) &&
      existing.confidenceSignals.userVerified === (overlay.userVerified === true)
    ) {
      return;
    }
    const parsed = parseCoreCombinedKey(combinedKey);
    const now = isoNow();
    const userVerified = overlay.userVerified === true;
    const confidenceSignals = buildConfidenceSignals({
      sourceType: 'manual_edit',
      extractionConfidence: overlay.confidence ?? existing?.confidence ?? 0.95,
      evidenceCount: existing?.evidence.length ?? 0,
      corroborationCount: existing?.confidenceSignals.corroborationCount ?? 0,
      contradictionCount: existing?.confidenceSignals.contradictionCount ?? 0,
      userVerified,
      lastVerifiedAt:
        existing?.confidenceSignals.lastVerifiedAt ?? (userVerified ? now : undefined),
      verifiedValueHash: userVerified
        ? (overlay.verifiedValueHash ?? hashMemoryValue(value))
        : undefined,
      reason: 'Manual edit restored across rebuild',
    });
    this.entries.set(combinedKey, {
      ...parsed,
      value,
      confidence: calculateMemoryConfidence(confidenceSignals),
      confidenceSignals,
      status: overlay.status ?? existing?.status ?? ACTIVE_STATUS,
      evidence: existing?.evidence ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.save();
  }

  clear(): void {
    this.entries.clear();
    this.save();
  }

  toPromptBlock(): string {
    return coreMemoryToPromptBlock(this.getRaw());
  }

  save(): void {
    saveJsonFile(this.filePath, {
      entries: this.getEntries().map(entryToFileRecord),
    });
  }

  private trim(appliedKeys: Set<string>): void {
    const ordered = [
      ...[...appliedKeys]
        .map((key) => this.entries.get(key))
        .filter((entry): entry is CoreMemoryEntry => Boolean(entry)),
      ...this.getEntries().filter((entry) => !appliedKeys.has(entry.combinedKey)),
    ];
    const retainedKeys = new Set(ordered.slice(0, this.maxItems).map((entry) => entry.combinedKey));
    for (const key of this.entries.keys()) {
      if (!retainedKeys.has(key)) {
        this.entries.delete(key);
      }
    }
  }
}
