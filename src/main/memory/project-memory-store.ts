import { randomUUID } from 'node:crypto';
import type { MemoryEvidenceRef, MemoryItemStatus, ProjectMemoryEntry } from './memory-types';
import {
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

const DEFAULT_CONFIDENCE = 0.68;
const MEMORY_STATUSES = new Set<MemoryItemStatus>(['active', 'pending', 'rejected', 'archived']);

function normalizeStatus(value: unknown): MemoryItemStatus {
  return typeof value === 'string' && MEMORY_STATUSES.has(value as MemoryItemStatus)
    ? (value as MemoryItemStatus)
    : 'active';
}

function normalizeConfidence(value: unknown, fallback = DEFAULT_CONFIDENCE): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
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
      const sessionId = source.sessionId || source.session_id;
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return null;
      }
      const evidence: MemoryEvidenceRef = { sessionId };
      const sourceWorkspace = source.sourceWorkspace || source.source_workspace;
      const sourceSessionTitle = source.sourceSessionTitle || source.source_session_title;
      const sourceTurns = source.sourceTurns || source.source_turns;
      const createdAt = source.createdAt || source.created_at;
      if (typeof sourceWorkspace === 'string') {
        evidence.sourceWorkspace = sourceWorkspace;
      }
      if (typeof sourceSessionTitle === 'string') {
        evidence.sourceSessionTitle = sourceSessionTitle;
      }
      if (Array.isArray(sourceTurns)) {
        evidence.sourceTurns = sourceTurns.filter(
          (turn): turn is number => typeof turn === 'number'
        );
      }
      if (typeof source.excerpt === 'string') {
        evidence.excerpt = source.excerpt;
      }
      if (typeof createdAt === 'string') {
        evidence.createdAt = createdAt;
      }
      return evidence;
    })
    .filter((item): item is MemoryEvidenceRef => Boolean(item));
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
  return merged.slice(0, 10);
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
    confidence: normalizeConfidence(item.confidence),
    status: normalizeStatus(item.status),
    evidence: normalizeEvidence(item.evidence),
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

  constructor(private readonly filePath: string) {
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

  upsertFromExperience(input: {
    workspaceKey: string | null;
    workspaceLabel?: string;
    sessionId: string;
    sessionTitle?: string;
    summary: string;
    keywords: string[];
    sourceTurns?: number[];
  }): ProjectMemoryEntry | null {
    const workspaceKey = normalizeWorkspaceKey(input.workspaceKey);
    const summary = input.summary.trim();
    if (!workspaceKey || !summary) {
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
    const evidence: MemoryEvidenceRef = {
      sessionId: input.sessionId,
      sourceWorkspace: workspaceKey,
      sourceSessionTitle: input.sessionTitle,
      sourceTurns: input.sourceTurns,
      excerpt: summarizeText(summary, 180),
      createdAt: now,
    };
    const existing = this.findMergeTarget(workspaceKey, key, summary);
    const next: ProjectMemoryEntry = existing
      ? {
          ...existing,
          workspaceLabel: input.workspaceLabel || existing.workspaceLabel,
          key: existing.key || key,
          value: summary.length >= existing.value.length ? summary : existing.value,
          confidence: Math.max(existing.confidence, DEFAULT_CONFIDENCE),
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
          confidence: DEFAULT_CONFIDENCE,
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
    const next: ProjectMemoryEntry = {
      ...existing,
      key,
      value,
      confidence:
        updates.confidence === undefined
          ? existing.confidence
          : normalizeConfidence(updates.confidence, existing.confidence),
      status: updates.status === undefined ? existing.status : normalizeStatus(updates.status),
      updatedAt: isoNow(),
    };
    this.entries.set(id, next);
    this.save();
    return next;
  }

  deleteEntry(id: string): { success: boolean } {
    const existing = this.entries.get(id);
    if (!existing) {
      return { success: false };
    }
    this.entries.set(id, {
      ...existing,
      status: 'archived',
      updatedAt: isoNow(),
    });
    this.save();
    return { success: true };
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
