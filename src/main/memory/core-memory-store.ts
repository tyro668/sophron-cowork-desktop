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
  mergeConfidenceSignals,
  normalizeConfidence,
  normalizeConfidenceSourceType,
  normalizeConfidenceSignals,
} from './memory-confidence';
import {
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
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): MemoryEvidenceRef | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const source = item as Record<string, unknown>;
      if (typeof source.sessionId !== 'string' && typeof source.session_id !== 'string') {
        return null;
      }
      const evidence: MemoryEvidenceRef = {
        sessionId: String(source.sessionId || source.session_id),
      };
      if (typeof source.sourceWorkspace === 'string') {
        evidence.sourceWorkspace = source.sourceWorkspace;
      } else if (typeof source.source_workspace === 'string') {
        evidence.sourceWorkspace = source.source_workspace;
      }
      if (typeof source.sourceSessionTitle === 'string') {
        evidence.sourceSessionTitle = source.sourceSessionTitle;
      } else if (typeof source.source_session_title === 'string') {
        evidence.sourceSessionTitle = source.source_session_title;
      }
      if (Array.isArray(source.sourceTurns)) {
        evidence.sourceTurns = source.sourceTurns.filter(
          (turn): turn is number => typeof turn === 'number'
        );
      } else if (Array.isArray(source.source_turns)) {
        evidence.sourceTurns = source.source_turns.filter(
          (turn): turn is number => typeof turn === 'number'
        );
      }
      if (typeof source.excerpt === 'string') {
        evidence.excerpt = source.excerpt;
      }
      if (typeof source.createdAt === 'string') {
        evidence.createdAt = source.createdAt;
      } else if (typeof source.created_at === 'string') {
        evidence.createdAt = source.created_at;
      }
      return evidence;
    })
    .filter((item): item is MemoryEvidenceRef => Boolean(item));
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
  const confidenceSignals = normalizeConfidenceSignals(item.confidenceSignals ?? item.confidence_signals);
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
    evidence: item.evidence.map((evidence) => ({
      session_id: evidence.sessionId,
      source_workspace: evidence.sourceWorkspace ?? null,
      source_session_title: evidence.sourceSessionTitle ?? '',
      source_turns: evidence.sourceTurns ?? [],
      excerpt: evidence.excerpt ?? '',
      created_at: evidence.createdAt ?? '',
    })),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function mergeEvidence(
  existing: MemoryEvidenceRef[],
  additions: MemoryEvidenceRef[]
): MemoryEvidenceRef[] {
  const seen = new Set<string>();
  const merged: MemoryEvidenceRef[] = [];
  for (const item of [...additions, ...existing]) {
    const key = [
      item.sessionId,
      item.sourceWorkspace || '',
      item.sourceSessionTitle || '',
      (item.sourceTurns || []).join(','),
      item.excerpt || '',
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 8);
}

export class CoreMemoryStore {
  private readonly entries = new Map<string, CoreMemoryEntry>();

  constructor(
    private readonly filePath: string,
    private readonly maxItems = 24
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

  getActiveEntries(): CoreMemoryEntry[] {
    return this.getEntries().filter((entry) => entry.status === ACTIVE_STATUS);
  }

  applyActions(
    actions: CoreMemoryActionInput[],
    evidence: MemoryEvidenceRef[] = []
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
      if (!value) {
        continue;
      }
      const sourceType = normalizeConfidenceSourceType(action.sourceType);
      const extractionConfidence = normalizeConfidence(action.confidence);
      if (!sourceType || extractionConfidence === null) {
        continue;
      }
      const incomingSignals = buildConfidenceSignals({
        sourceType,
        extractionConfidence,
        evidenceCount: evidence.length,
        corroborationCount: existing ? 1 : 0,
        reason: action.reason,
      });
      const confidenceSignals = existing?.confidenceSignals
        ? mergeConfidenceSignals(existing.confidenceSignals, incomingSignals)
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
        })
      );
      nextConfidence = calculateMemoryConfidence(nextConfidenceSignals);
    }
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
