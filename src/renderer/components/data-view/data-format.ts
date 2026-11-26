import { formatAppDateTime, formatClockTime } from '../../utils/i18n-format';
import type { DataResultTable } from '../../types';

export function isMatchingSearchText(value: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return value.toLowerCase().includes(normalizedQuery);
}

export function formatTimestamp(timestamp: number | null, t: (key: string) => string): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const time = formatClockTime(date);

  if (timestamp >= startToday) {
    return `${t('data.relative.today')} ${time}`;
  }
  if (timestamp >= startYesterday) {
    return `${t('data.relative.yesterday')} ${time}`;
  }
  return formatAppDateTime(date);
}

export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '—';
  return formatAppDateTime(timestamp);
}

export function formatRelatedPipelineNames(
  names: string[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (names.length === 0) return t('data.rawTables.noRelatedPipelines');
  return names.join(', ');
}

export function formatResultTableRelatedPipelineNames(
  resultTable: DataResultTable,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (resultTable.relatedPipelineNames.length > 0) {
    return formatRelatedPipelineNames(resultTable.relatedPipelineNames, t);
  }
  if (resultTable.sourceRawTableId) {
    return t('data.resultTables.relatedRawTable');
  }
  return t('data.rawTables.noRelatedPipelines');
}

export function formatDisplayPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/^\/Users\/[^/]+/, '~');
}
