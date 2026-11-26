import type { TFunction } from 'i18next';
import type { CoreMemoryEntry, MemoryEvidenceRef, ProjectMemoryEntry } from '../../../types';
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
  sourceLabel?: string;
  evidence: MemoryEvidenceRef[];
  raw: ManagedMemoryEntry;
}

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
    sourceLabel,
    evidence: entry.evidence || [],
    raw: entry,
  };
}

function formatCoreTitle(entry: CoreMemoryEntry): string {
  if (entry.category && entry.key) {
    return `${entry.category} · ${entry.key}`;
  }
  return entry.combinedKey || entry.key;
}

function formatProjectTitle(entry: ProjectMemoryEntry, t: TFunction): string {
  return `${t('memory.projectPrefix')} · ${entry.key}`;
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
