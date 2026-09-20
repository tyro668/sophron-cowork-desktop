import { randomUUID } from 'node:crypto';
import type { MemoryEvidenceRef, MemoryItemStatus, ProjectMemoryEntry } from './memory-types';
import {
  buildConfidenceSignals,
  calculateMemoryConfidence,
  confidenceSignalsToFileRecord,
  countIndependentEvidenceSessions,
  memoryValuesEquivalent,
  mergeConfidenceSignals,
  normalizeConfidence,
  normalizeConfidenceSignals,
} from './memory-confidence';
import {
  hashMemoryValue,
  projectTombstoneIdentity,
  type MemoryTombstoneGate,
} from './memory-tombstone-store';
import { evidenceToFileRecord, mergeEvidenceRefs, normalizeEvidenceList } from './memory-evidence';
import type { MemoryManualOverlay } from './memory-manual-overlay-store';
import {
  containsSensitiveContent,
  extractKeywords,
  isoNow,
  lexicalScore,
  loadJsonFile,
  normalizeWorkspaceKey,
  saveJsonFile,
  summarizeText,
} from './memory-utils';

interface ProjectMemoryFile {
  projects?: Array<Record<string, unknown>>;
}

type ProjectMemoryUpdate = Partial<
  Pick<ProjectMemoryEntry, 'key' | 'value' | 'confidence' | 'status'>
>;

const MEMORY_STATUSES = new Set<MemoryItemStatus>(['active', 'pending', 'rejected', 'archived']);

function normalizeStatus(value: unknown): MemoryItemStatus {
  return typeof value === 'string' && MEMORY_STATUSES.has(value as MemoryItemStatus)
    ? (value as MemoryItemStatus)
    : 'active';
}

function normalizeEvidence(value: unknown): MemoryEvidenceRef[] {
  return normalizeEvidenceList(value);
}

function mergeEvidence(
  existing: MemoryEvidenceRef[],
  additions: MemoryEvidenceRef[]
): MemoryEvidenceRef[] {
  return mergeEvidenceRefs(existing, additions, 10);
}

function normalizeEntry(item: Record<string, unknown>): ProjectMemoryEntry | null {
  const workspaceKey = normalizeWorkspaceKey(
    typeof item.workspaceKey === 'string'
      ? item.workspaceKey
      : typeof item.workspace_key === 'string'
        ? item.workspace_key
        : null
  );
  const id =
    typeof item.id === 'string' && item.id.trim()
      ? item.id
      : typeof item.key === 'string' && workspaceKey
        ? `${workspaceKey}:${item.key}`
        : '';
  const key = typeof item.key === 'string' ? item.key.trim() : '';
  const value = typeof item.value === 'string' ? item.value.trim() : '';
  if (!id || !workspaceKey || !key || !value) {
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
    id,
    workspaceKey,
    workspaceLabel:
      typeof item.workspaceLabel === 'string'
        ? item.workspaceLabel
        : typeof item.workspace_label === 'string'
          ? item.workspace_label
          : undefined,
    key,
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

function entryToFileRecord(item: ProjectMemoryEntry): Record<string, unknown> {
  return {
    id: item.id,
    workspace_key: item.workspaceKey,
    workspace_label: item.workspaceLabel ?? '',
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

function normalizeLookupKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function buildProjectMemoryKey(input: {
  sessionTitle?: string;
  summary: string;
  keywords: string[];
}): string {
  const title = input.sessionTitle?.trim();
  if (title && !/^untitled|new chat|新会话|未命名/i.test(title)) {
    return summarizeText(title, 42);
  }
  const keyword =
    input.keywords.find((item) => item.trim()) || extractKeywords(input.summary, 1)[0];
  return keyword ? summarizeText(keyword, 42) : summarizeText(input.summary, 42);
}

export class ProjectMemoryStore {
  private readonly entries = new Map<string, ProjectMemoryEntry>();

  constructor(
    private readonly filePath: string,
    private readonly tombstones?: MemoryTombstoneGate
  ) {
    const raw = loadJsonFile<ProjectMemoryFile>(filePath, { projects: [] });
    for (const item of raw.projects || []) {
      const entry = normalizeEntry(item);
      if (entry) {
        this.entries.set(entry.id, entry);
      }
    }
  }

  getPath(): string {
    return this.filePath;
  }

  getEntries(workspaceKey?: string | null): ProjectMemoryEntry[] {
    const normalized = normalizeWorkspaceKey(workspaceKey);
    return [...this.entries.values()]
      .filter((entry) => !normalized || entry.workspaceKey === normalized)
      .sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === 'active' ? -1 : 1;
        }
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
  }

  getActiveEntries(workspaceKey?: string | null): ProjectMemoryEntry[] {
    return this.getEntries(workspaceKey).filter((entry) => entry.status === 'active');
  }

  getEntry(id: string): ProjectMemoryEntry | undefined {
    return this.entries.get(id);
  }

  removeEvidenceWhere(predicate: (evidence: MemoryEvidenceRef) => boolean): ProjectMemoryEntry[] {
    const removed: ProjectMemoryEntry[] = [];
    const now = isoNow();
    let changed = false;
    for (const [id, entry] of this.entries) {
      const remaining = entry.evidence.filter((item) => !predicate(item));
      if (remaining.length === entry.evidence.length) {
        continue;
      }
      changed = true;
      if (!remaining.length && !entry.confidenceSignals.userVerified) {
        removed.push(entry);
        this.entries.delete(id);
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
      this.entries.set(id, {
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

  upsertFromExperience(input: {
    workspaceKey: string | null;
    workspaceLabel?: string;
    sessionId: string;
    sessionTitle?: string;
    summary: string;
    keywords: string[];
    sourceTurns?: number[];
    messageIds?: string[];
    extractionConfidence?: number;
  }): ProjectMemoryEntry | null {
    const workspaceKey = normalizeWorkspaceKey(input.workspaceKey);
    const summary = input.summary.trim();
    if (!workspaceKey || !summary || containsSensitiveContent(summary)) {
      return null;
    }
    const now = isoNow();
    const key = buildProjectMemoryKey({
      sessionTitle: input.sessionTitle,
      summary,
      keywords: input.keywords,
    });
    if (!key) {
      return null;
    }
    const extractionConfidence = normalizeConfidence(input.extractionConfidence);
    if (extractionConfidence === null) {
      return null;
    }
    const evidence: MemoryEvidenceRef = {
      sessionId: input.sessionId,
      sourceWorkspace: workspaceKey,
      sourceSessionTitle: input.sessionTitle,
      sourceTurns: input.sourceTurns,
      messageIds: input.messageIds,
      excerpt: summarizeText(summary, 180),
      createdAt: now,
    };
    if (
      this.tombstones?.matches({
        kind: 'project',
        identity: projectTombstoneIdentity(workspaceKey, key),
        valueHash: hashMemoryValue(summary),
        sessionId: input.sessionId,
      })
    ) {
      return null;
    }
    const existing = this.findMergeTarget(workspaceKey, key, summary);
    const incomingSignals = buildConfidenceSignals({
      sourceType: 'conversation_summary',
      extractionConfidence,
      evidenceCount: 1,
      corroborationCount: 0,
      reason: 'Derived from summarized workspace experience',
    });
    const valueChanged = existing ? !memoryValuesEquivalent(existing.value, summary) : false;
    const independentEvidence =
      !existing || !existing.evidence.some((item) => item.sessionId === input.sessionId);
    // Verification binds to the value it confirmed: a mismatched stored hash
    // means the value drifted after verification and no longer counts.
    const verifiedValueIntact = existing
      ? existing.confidenceSignals.userVerified &&
        (!existing.confidenceSignals.verifiedValueHash ||
          existing.confidenceSignals.verifiedValueHash === hashMemoryValue(existing.value))
      : false;
    if (existing && valueChanged && verifiedValueIntact) {
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
      const conflicted: ProjectMemoryEntry = {
        ...existing,
        confidence: calculateMemoryConfidence(conflictedSignals),
        confidenceSignals: conflictedSignals,
        updatedAt: now,
      };
      this.entries.set(conflicted.id, conflicted);
      this.save();
      return conflicted;
    }
    const mergedSignals = existing?.confidenceSignals
      ? mergeConfidenceSignals(existing.confidenceSignals, incomingSignals, {
          resolution: valueChanged ? 'conflict' : 'equivalent',
          independentEvidence,
        })
      : incomingSignals;
    const next: ProjectMemoryEntry = existing
      ? {
          ...existing,
          workspaceLabel: input.workspaceLabel || existing.workspaceLabel,
          key: existing.key || key,
          // The latest extraction wins: a shorter correction must replace an
          // older, longer summary (length is not evidence of correctness).
          value: summary,
          confidence: calculateMemoryConfidence(mergedSignals),
          confidenceSignals: mergedSignals,
          status: existing.status === 'archived' ? 'active' : existing.status,
          evidence: mergeEvidence(existing.evidence, [evidence]),
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          workspaceKey,
          workspaceLabel: input.workspaceLabel,
          key,
          value: summary,
          confidence: calculateMemoryConfidence(mergedSignals),
          confidenceSignals: mergedSignals,
          status: 'active',
          evidence: [evidence],
          createdAt: now,
          updatedAt: now,
        };
    this.entries.set(next.id, next);
    this.save();
    return next;
  }

  updateEntry(id: string, updates: ProjectMemoryUpdate): ProjectMemoryEntry | null {
    const existing = this.entries.get(id);
    if (!existing) {
      return null;
    }
    const key = typeof updates.key === 'string' ? updates.key.trim() : existing.key;
    const value = typeof updates.value === 'string' ? updates.value.trim() : existing.value;
    if (!key || !value) {
      return null;
    }
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
          resolution: memoryValuesEquivalent(existing.value, value) ? 'equivalent' : 'correction',
        }
      );
      nextConfidence = calculateMemoryConfidence(nextConfidenceSignals);
    }
    // Verification binds to the value it was made on — bind the hash whenever
    // the entry is verified, clear it when verification is absent.
    nextConfidenceSignals = nextConfidenceSignals.userVerified
      ? { ...nextConfidenceSignals, verifiedValueHash: hashMemoryValue(value) }
      : { ...nextConfidenceSignals, verifiedValueHash: undefined };
    const next: ProjectMemoryEntry = {
      ...existing,
      key,
      value,
      confidence: nextConfidence,
      confidenceSignals: nextConfidenceSignals,
      status: updates.status === undefined ? existing.status : normalizeStatus(updates.status),
      updatedAt: isoNow(),
    };
    this.entries.set(id, next);
    this.save();
    return next;
  }

  deleteEntry(id: string): { success: boolean } {
    if (!this.entries.has(id)) {
      return { success: false };
    }
    this.entries.delete(id);
    this.save();
    return { success: true };
  }

  /**
   * Re-apply a persisted human override onto a (possibly freshly rebuilt)
   * generation. Entries are matched by workspace + normalized key — the random
   * entry id is not stable across rebuilds and is never part of the identity.
   */
  applyManualOverride(overlay: MemoryManualOverlay): void {
    const workspaceKey = normalizeWorkspaceKey(overlay.workspaceKey);
    const key = overlay.key?.trim();
    if (!workspaceKey || !key) {
      return;
    }
    const existing = this.findMergeTarget(workspaceKey, key, overlay.value || key);
    if (overlay.action === 'delete') {
      if (existing && this.entries.delete(existing.id)) {
        this.save();
      }
      return;
    }
    const value = typeof overlay.value === 'string' ? overlay.value.trim() : '';
    if (!value) {
      return;
    }
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
    const next: ProjectMemoryEntry = existing
      ? {
          ...existing,
          value,
          confidence: calculateMemoryConfidence(confidenceSignals),
          confidenceSignals,
          status: overlay.status ?? existing.status,
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          workspaceKey,
          workspaceLabel: overlay.workspaceLabel,
          key,
          value,
          confidence: calculateMemoryConfidence(confidenceSignals),
          confidenceSignals,
          status: overlay.status ?? 'active',
          evidence: [],
          createdAt: now,
          updatedAt: now,
        };
    this.entries.set(next.id, next);
    this.save();
  }

  removeByWorkspace(workspaceKey: string): void {
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (!normalized) {
      return;
    }
    for (const [id, entry] of this.entries.entries()) {
      if (entry.workspaceKey === normalized) {
        this.entries.delete(id);
      }
    }
    this.save();
  }

  clear(): void {
    this.entries.clear();
    this.save();
  }

  toPromptBlock(workspaceKey?: string | null): string {
    const entries = this.getActiveEntries(workspaceKey);
    if (!entries.length) {
      return 'None';
    }
    return entries.map((entry) => `- ${entry.key}: ${entry.value}`).join('\n');
  }

  save(): void {
    saveJsonFile(this.filePath, {
      projects: this.getEntries().map(entryToFileRecord),
    });
  }

  private findMergeTarget(
    workspaceKey: string,
    key: string,
    value: string
  ): ProjectMemoryEntry | undefined {
    const normalizedKey = normalizeLookupKey(key);
    const candidates = this.getEntries(workspaceKey);
    const exact = candidates.find((entry) => normalizeLookupKey(entry.key) === normalizedKey);
    if (exact) {
      return exact;
    }
    return candidates.find((entry) => lexicalScore(value, entry.value) >= 0.86);
  }
}
