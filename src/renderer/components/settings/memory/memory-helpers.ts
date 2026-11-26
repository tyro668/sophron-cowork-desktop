import type { TFunction } from 'i18next';
import type {
  CoreMemoryEntry,
  MemoryConfidenceSignals,
  MemoryEvidenceRef,
  ProjectMemoryEntry,
} from '../../../types';
import { formatAppDateTime } from '../../../utils/i18n-format';

export type ManagedMemoryEntry = CoreMemoryEntry | ProjectMemoryEntry;
export type MemoryTab = 'all' | 'core' | 'project';
export type ConfidenceLevel = 'high' | 'medium' | 'pending';

export interface MemoryRecord {
  id: string;
  kind: 'core' | 'project';
  title: string;
  summary: string;
  confidence: number;
  confidenceSignals: MemoryConfidenceSignals;
  tags: string[];
  sourceLabel?: string;
  evidence: MemoryEvidenceRef[];
  raw: ManagedMemoryEntry;
}

export const MEMORY_PAGE_SIZE = 5;

export function isRecordConfirmable(record: MemoryRecord): boolean {
  return getConfidenceLevel(record.confidence) === 'pending' || record.raw.status === 'pending';
}

export function toMemoryRecord(
  entry: ManagedMemoryEntry,
  kind: MemoryRecord['kind'],
  t: TFunction
): MemoryRecord {
  const title =
    kind === 'core'
      ? formatCoreTitle(entry as CoreMemoryEntry)
      : formatProjectTitle(entry as ProjectMemoryEntry, t);
  const sourceLabel =
    kind === 'project'
      ? (entry as ProjectMemoryEntry).workspaceLabel || (entry as ProjectMemoryEntry).workspaceKey
      : (entry as CoreMemoryEntry).combinedKey;

  return {
    id: `${kind}:${kind === 'core' ? (entry as CoreMemoryEntry).combinedKey : (entry as ProjectMemoryEntry).id}`,
    kind,
    title,
    summary: entry.value,
    confidence: normalizeConfidence(entry.confidence),
    confidenceSignals: entry.confidenceSignals,
    tags: buildMemoryTags(entry, kind, t),
    sourceLabel,
    evidence: entry.evidence || [],
    raw: entry,
  };
}

function formatCoreTitle(entry: CoreMemoryEntry): string {
  if (entry.category && entry.key) {
    return `${entry.category}. ${entry.key}`;
  }
  return entry.combinedKey || entry.key;
}

function formatProjectTitle(entry: ProjectMemoryEntry, t: TFunction): string {
  return `${t('memory.projectPrefix')}: ${entry.key}`;
}

function buildMemoryTags(
  entry: ManagedMemoryEntry,
  kind: MemoryRecord['kind'],
  t: TFunction
): string[] {
  const tags = new Set<string>();
  tags.add(kind === 'core' ? t('memory.coreCapabilityTab') : t('memory.projectContextTab'));
  if ('category' in entry && entry.category) {
    tags.add(categoryLabel(entry.category, t));
  }
  for (const token of entry.key
    .split(/[._:\s/,-]+/)
    .filter(Boolean)
    .slice(0, 2)) {
    tags.add(token);
  }
  return [...tags].slice(0, 3);
}

function categoryLabel(category: CoreMemoryEntry['category'], t: TFunction): string {
  if (category === 'skills') return t('memory.categorySkills');
  if (category === 'preferences') return t('memory.categoryPreferences');
  if (category === 'interests') return t('memory.categoryInterests');
  if (category === 'identity') return t('memory.categoryIdentity');
  return t('memory.coreCapabilityTab');
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return Math.min(1, value / 100);
  return Math.min(1, Math.max(0, value));
}

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.82) return 'high';
  if (confidence >= 0.65) return 'medium';
  return 'pending';
}

export function getConfidenceLevelLabel(level: ConfidenceLevel, t: TFunction): string {
  if (level === 'high') return t('memory.confidenceHigh');
  if (level === 'medium') return t('memory.confidenceMedium');
  return t('memory.confidencePending');
}

export function getConfidenceReason(signals: MemoryConfidenceSignals, t: TFunction): string {
  if (signals.reason) {
    return signals.reason;
  }
  if (signals.userVerified) {
    return t('memory.confidenceReasonManual');
  }
  if (signals.sourceType === 'explicit_user_statement') {
    return t('memory.confidenceReasonExplicit');
  }
  if (signals.sourceType === 'conversation_summary') {
    return t('memory.confidenceReasonSummary');
  }
  if (signals.sourceType === 'llm_inference') {
    return t('memory.confidenceReasonInference');
  }
  return t('memory.confidenceReasonSummary');
}

export function getEntryTime(entry: ManagedMemoryEntry): number {
  const updatedAt = Date.parse(entry.updatedAt);
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(entry.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

export function formatMemoryDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return formatAppDateTime(date);
}

export function countDuplicateMemories(records: MemoryRecord[]): number {
  const seen = new Map<string, number>();
  for (const record of records) {
    const key = record.title.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].reduce((count, value) => count + Math.max(0, value - 1), 0);
}
