import type { MutableRefObject } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { formatIpcError } from '../../../utils/ipc-error';
import type {
  DataRawTablePreview,
  PersonalAnalysisConfig,
  PersonalAnalysisDriveFile,
  PersonalAnalysisTable,
} from '../../../types';

export interface SelectedProject {
  spaceId: string;
  projectId: string;
}

/** Deep-link target: expand the space, open the project, highlight the table. */
export interface CloudFocusTarget {
  spaceId: string;
  projectId: string;
  tableId: string;
  /** Unique value per request so repeated focuses on the same table re-run. */
  nonce: number;
}

export type CloudConnection = Pick<PersonalAnalysisConfig, 'apiOrigin'> & {
  apiKey?: string;
  connectionMode?: 'account' | 'apiKey';
};

export const CLOUD_TABLE_SOURCE_TYPE_LABELS: Record<string, string> = {
  csv: 'Csv',
  xls: 'Excel',
  xlsx: 'Excel',
  json: 'JSON',
  parquet: 'Parquet',
};

export interface NoticeState {
  type: 'success' | 'error' | 'info';
  message: string;
  rawTableId?: string;
}

export const CLOUD_TABLE_PAGE_SIZE = 10;
export const CLOUD_PREVIEW_PAGE_SIZE = 20;
export const PROJECT_CACHE_KEYWORD_PROBE = '\u0000cache-probe\u0000';

export type ListTab = 'tables' | 'files';

export interface PreviewState {
  kind: 'table' | 'file';
  name: string;
  table?: PersonalAnalysisTable;
  loading: boolean;
  error: string | null;
  data: DataRawTablePreview | null;
}

export interface PagedPageInfo {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PagedCacheEntry<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PagedLane<T> {
  cache: Map<string, PagedCacheEntry<T>>;
  requestSeq: MutableRefObject<number>;
  itemsRef: MutableRefObject<T[]>;
  applyItems: (items: T[]) => void;
  clearItems: () => void;
  setPageInfo: (info: PagedPageInfo) => void;
  setLoading: (value: boolean) => void;
  setLoadingMore: (value: boolean) => void;
}

export interface TableQueryOptions {
  forceRefresh?: boolean;
  page?: number;
  append?: boolean;
}

export interface PagedQueryInput<T> {
  lane: PagedLane<T>;
  cacheKey: string;
  options?: TableQueryOptions;
  fetchItems: (input: { page: number }) => Promise<PagedCacheEntry<T>>;
  onResourceNotFound?: () => void;
}

export const EMPTY_TABLE_PAGE_INFO: PagedPageInfo = {
  page: 1,
  pageSize: CLOUD_TABLE_PAGE_SIZE,
  total: 0,
  hasMore: false,
};

export function getCloudTableSourceType(table: PersonalAnalysisTable, fallback: string): string {
  if (typeof table.sourceType === 'string' && table.sourceType.trim()) {
    return table.sourceType.trim();
  }
  const source = [table.sourceObjectKey, table.source].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  if (!source) return fallback;
  const normalizedSource = source.trim().toLowerCase();
  const extension = normalizedSource.match(/\.([a-z0-9]+)(?:[?#].*)?$/)?.[1];
  if (extension && CLOUD_TABLE_SOURCE_TYPE_LABELS[extension]) {
    return CLOUD_TABLE_SOURCE_TYPE_LABELS[extension];
  }
  if (normalizedSource.includes('csv')) return CLOUD_TABLE_SOURCE_TYPE_LABELS.csv;
  if (normalizedSource.includes('excel')) return CLOUD_TABLE_SOURCE_TYPE_LABELS.xlsx;
  return fallback;
}

export function getDriveFileMeta(file: PersonalAnalysisDriveFile) {
  return file.fileType === 'csv'
    ? { Icon: FileText, label: 'Csv', badgeClassName: 'bg-accent-muted text-accent' }
    : {
        Icon: FileSpreadsheet,
        label: 'Excel',
        badgeClassName: 'bg-success/10 text-success',
      };
}

export function isResourceNotFoundError(error: unknown): boolean {
  const status = readErrorStatus(error);
  if (status === 404) return true;

  const code = readErrorCode(error);
  if (code === 'RESOURCE_NOT_FOUND') return true;

  const message = formatIpcError(error, String(error));
  return /^\[RESOURCE_NOT_FOUND\]/.test(message) || /\bHTTP 404\b/i.test(message);
}

export function readErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number' && Number.isFinite(status)) return status;

  const details = (error as { details?: { status?: unknown } })?.details;
  return typeof details?.status === 'number' && Number.isFinite(details.status)
    ? details.status
    : undefined;
}

export function readErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && code) return code;

  const details = (error as { details?: { code?: unknown } })?.details;
  if (typeof details?.code === 'string' && details.code) return details.code;

  const message = formatIpcError(error, String(error));
  return message.match(/^\[([A-Z_]+)\]/)?.[1];
}
