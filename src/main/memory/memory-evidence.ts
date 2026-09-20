import type { MemoryEvidenceRef } from './memory-types';

/**
 * Shared file codec for memory evidence. Both the core and project stores
 * serialize evidence through these helpers so a field can never silently drop
 * on the disk round-trip — `messageIds` in particular is what makes evidence
 * traceable to stable message identities across restarts.
 */

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : [];
}

export function normalizeEvidenceRef(item: unknown): MemoryEvidenceRef | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const source = item as Record<string, unknown>;
  const sessionId = source.sessionId ?? source.session_id;
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return null;
  }
  const evidence: MemoryEvidenceRef = { sessionId };
  const sourceWorkspace = source.sourceWorkspace ?? source.source_workspace;
  const sourceSessionTitle = source.sourceSessionTitle ?? source.source_session_title;
  const sourceTurns = source.sourceTurns ?? source.source_turns;
  const messageIds = source.messageIds ?? source.message_ids;
  const createdAt = source.createdAt ?? source.created_at;
  if (typeof sourceWorkspace === 'string' && sourceWorkspace) {
    evidence.sourceWorkspace = sourceWorkspace;
  }
  if (typeof sourceSessionTitle === 'string' && sourceSessionTitle) {
    evidence.sourceSessionTitle = sourceSessionTitle;
  }
  if (Array.isArray(sourceTurns)) {
    evidence.sourceTurns = sourceTurns.filter(
      (turn): turn is number => typeof turn === 'number' && Number.isInteger(turn)
    );
  }
  const ids = toStringArray(messageIds);
  if (ids.length) {
    evidence.messageIds = ids;
  }
  if (typeof source.excerpt === 'string' && source.excerpt) {
    evidence.excerpt = source.excerpt;
  }
  if (typeof createdAt === 'string' && createdAt) {
    evidence.createdAt = createdAt;
  }
  return evidence;
}

export function normalizeEvidenceList(value: unknown): MemoryEvidenceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeEvidenceRef(item))
    .filter((item): item is MemoryEvidenceRef => Boolean(item));
}

export function evidenceToFileRecord(evidence: MemoryEvidenceRef): Record<string, unknown> {
  return {
    session_id: evidence.sessionId,
    source_workspace: evidence.sourceWorkspace ?? null,
    source_session_title: evidence.sourceSessionTitle ?? '',
    source_turns: evidence.sourceTurns ?? [],
    message_ids: evidence.messageIds ?? [],
    excerpt: evidence.excerpt ?? '',
    created_at: evidence.createdAt ?? '',
  };
}

/**
 * Dedupe + cap evidence lists. Two refs are the same observation only when
 * their session, workspace, turn range, message ids, and excerpt all agree.
 */
export function mergeEvidenceRefs(
  existing: MemoryEvidenceRef[],
  additions: MemoryEvidenceRef[],
  cap: number
): MemoryEvidenceRef[] {
  const seen = new Set<string>();
  const merged: MemoryEvidenceRef[] = [];
  for (const item of [...additions, ...existing]) {
    const key = [
      item.sessionId,
      item.sourceWorkspace || '',
      item.sourceSessionTitle || '',
      (item.sourceTurns || []).join(','),
      (item.messageIds || []).join(','),
      item.excerpt || '',
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, cap);
}
