import { Badge } from '../ui/badge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  CalendarClock,
  ChevronRight,
  Cloud,
  Database,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  KeyRound,
  ListChecks,
  ListPlus,
  LogIn,
  Loader2,
  MessageSquarePlus,
  MoreVertical,
  RefreshCw,
  Settings,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import type {
  CloudTableChatAttachment,
  DataRawTablePreview,
  PersonalAnalysisConfig,
  PersonalAnalysisDriveFile,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../../types';
import {
  EMPTY_PERSONAL_ANALYSIS_CONFIG,
  hasPersonalAnalysisConnection,
  isPersonalAnalysisServerError,
  getPersonalAnalysisErrorMessage,
} from '../../../shared/personal-analysis';
import { RawTablePreviewDialog } from './raw-tables';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import {
  DataMoreMenu,
  DataToolbarButton,
  EmptyState,
  LoadingState,
  formatDateTime,
} from './shared';
import { Button } from '../ui/button';
import { showToast } from '../../utils/toast';
import { dataClient } from '../../features/data/api/data-client';

interface SelectedProject {
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

type CloudConnection = Pick<PersonalAnalysisConfig, 'apiOrigin'> & {
  apiKey?: string;
  connectionMode?: 'account' | 'apiKey';
};

const CLOUD_TABLE_SOURCE_TYPE_LABELS: Record<string, string> = {
  csv: 'CSV',
  xls: 'Excel',
  xlsx: 'Excel',
  json: 'JSON',
  parquet: 'Parquet',
};

interface NoticeState {
  type: 'success' | 'error' | 'info';
  message: string;
  rawTableId?: string;
}

const CLOUD_TABLE_PAGE_SIZE = 10;
const CLOUD_PREVIEW_PAGE_SIZE = 20;
const PROJECT_CACHE_KEYWORD_PROBE = '\u0000cache-probe\u0000';

type ListTab = 'tables' | 'files';

interface PreviewState {
  kind: 'table' | 'file';
  name: string;
  table?: PersonalAnalysisTable;
  loading: boolean;
  error: string | null;
  data: DataRawTablePreview | null;
}

interface PagedPageInfo {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface PagedCacheEntry<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface PagedLane<T> {
  cache: Map<string, PagedCacheEntry<T>>;
  requestSeq: MutableRefObject<number>;
  itemsRef: MutableRefObject<T[]>;
  applyItems: (items: T[]) => void;
  clearItems: () => void;
  setPageInfo: (info: PagedPageInfo) => void;
  setLoading: (value: boolean) => void;
  setLoadingMore: (value: boolean) => void;
}

interface TableQueryOptions {
  forceRefresh?: boolean;
  page?: number;
  append?: boolean;
}

interface PagedQueryInput<T> {
  lane: PagedLane<T>;
  cacheKey: string;
  options?: TableQueryOptions;
  fetchItems: (input: { page: number }) => Promise<PagedCacheEntry<T>>;
  onResourceNotFound?: () => void;
}

function getCloudTableSourceType(table: PersonalAnalysisTable, fallback: string): string {
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

function getDriveFileMeta(file: PersonalAnalysisDriveFile) {
  return file.fileType === 'csv'
    ? { Icon: FileText, label: 'CSV', badgeClassName: 'bg-accent-muted text-accent' }
    : {
        Icon: FileSpreadsheet,
        label: 'Excel',
        badgeClassName: 'bg-success/10 text-success',
      };
}

function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EMPTY_TABLE_PAGE_INFO = {
  page: 1,
  pageSize: CLOUD_TABLE_PAGE_SIZE,
  total: 0,
  hasMore: false,
};

function isResourceNotFoundError(error: unknown) {
  const status = readErrorStatus(error);
  if (status === 404) return true;

  const code = readErrorCode(error);
  if (code === 'RESOURCE_NOT_FOUND') return true;

  const message = error instanceof Error ? error.message : String(error);
  return /^\[RESOURCE_NOT_FOUND\]/.test(message) || /\bHTTP 404\b/i.test(message);
}

function readErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number' && Number.isFinite(status)) return status;

  const details = (error as { details?: { status?: unknown } })?.details;
  return typeof details?.status === 'number' && Number.isFinite(details.status)
    ? details.status
    : undefined;
}

function readErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && code) return code;

  const details = (error as { details?: { code?: unknown } })?.details;
  if (typeof details?.code === 'string' && details.code) return details.code;

  const message = error instanceof Error ? error.message : String(error);
  return message.match(/^\[([A-Z_]+)\]/)?.[1];
}

export function CloudAnalysisPanel({ focusTarget }: { focusTarget?: CloudFocusTarget | null }) {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const setDesktopAuthStatus = useAppStore((state) => state.setDesktopAuthStatus);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const navigateToCloudAutomationTemplate = useAppStore(
    (state) => state.navigateToCloudAutomationTemplate
  );
  const navigateToTableAutomation = useAppStore((state) => state.navigateToTableAutomation);
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
  const addCloudTablesToChat = useAppStore((state) => state.addCloudTablesToChat);
  const addCloudTablesToWelcomeChat = useAppStore((state) => state.addCloudTablesToWelcomeChat);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projectsBySpace, setProjectsBySpace] = useState<Record<string, PersonalAnalysisProject[]>>(
    {}
  );
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [listTab, setListTab] = useState<ListTab>('tables');
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [tableLookupStarted, setTableLookupStarted] = useState(false);
  const [driveFiles, setDriveFiles] = useState<PersonalAnalysisDriveFile[]>([]);
  const [driveFileLookupStarted, setDriveFileLookupStarted] = useState(false);
  const [loadingDriveFiles, setLoadingDriveFiles] = useState(false);
  const [loadingMoreDriveFiles, setLoadingMoreDriveFiles] = useState(false);
  const [driveFilePageInfo, setDriveFilePageInfo] = useState<PagedPageInfo>(EMPTY_TABLE_PAGE_INFO);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<string[]>([]);
  const [loadingProjectsBySpace, setLoadingProjectsBySpace] = useState<Record<string, boolean>>({});
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [retryingConnection, setRetryingConnection] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingMoreTables, setLoadingMoreTables] = useState(false);
  const [tablePageInfo, setTablePageInfo] = useState(EMPTY_TABLE_PAGE_INFO);
  const [loginBusy, setLoginBusy] = useState(false);
  const [focusedTableId, setFocusedTableId] = useState<string | null>(null);
  const handledFocusNonce = useRef(0);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [addingToChat, setAddingToChat] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const catalogRequestSeq = useRef(0);
  const projectRequestSeq = useRef<Record<string, number>>({});
  const tableRequestSeq = useRef(0);
  const fileRequestSeq = useRef(0);
  const previewRequestSeq = useRef(0);
  const selectedProjectRef = useRef<SelectedProject | null>(null);
  const expandedSpaceIdsRef = useRef<string[]>([]);
  const tableLookupStartedRef = useRef(false);
  const driveFileLookupStartedRef = useRef(false);
  const tablesRef = useRef<PersonalAnalysisTable[]>([]);
  const driveFilesRef = useRef<PersonalAnalysisDriveFile[]>([]);
  const tableCacheRef = useRef<Map<string, PagedCacheEntry<PersonalAnalysisTable>>>(new Map());
  const fileCacheRef = useRef<Map<string, PagedCacheEntry<PersonalAnalysisDriveFile>>>(new Map());

  const storedConnection = useMemo(
    () => appConfig?.personalAnalysis || EMPTY_PERSONAL_ANALYSIS_CONFIG,
    [appConfig?.personalAnalysis]
  );
  // API Key 是独立的访问服务：配置后即可使用，不依赖账号登录。
  // 优先级：已配置的 API Key 连接 > 登录账号；断开 API Key 后自动回退账号服务。
  // 两者按配置自动选择，不提供手动切换。
  const hasStoredConnection = hasPersonalAnalysisConnection(storedConnection);
  const hasDesktopAuthConnection = Boolean(
    desktopAuthStatus.authenticated && desktopAuthStatus.apiOrigin
  );
  const effectiveConnectionMode = hasStoredConnection
    ? 'apiKey'
    : hasDesktopAuthConnection
      ? 'account'
      : null;
  const usesDesktopAuthConnection = effectiveConnectionMode === 'account';
  const usesStoredConnection = effectiveConnectionMode === 'apiKey';
  const isConnected = usesStoredConnection || usesDesktopAuthConnection;
  const authDisplayName =
    desktopAuthStatus.user?.displayName?.trim() ||
    desktopAuthStatus.user?.username?.trim() ||
    desktopAuthStatus.user?.userId?.trim() ||
    t('cloudData.currentAccount');
  const accessModeLabel = usesStoredConnection
    ? desktopAuthStatus.authenticated
      ? t('cloudData.apiKeyModeWithAccount', { account: authDisplayName })
      : t('cloudData.apiKeyMode')
    : t('cloudData.accountMode', { account: authDisplayName });
  const connectionLabel =
    (usesDesktopAuthConnection ? desktopAuthStatus.apiOrigin : storedConnection.apiOrigin) ||
    t('cloudData.notConnected');

  const connectionPayload = useMemo<CloudConnection>(
    () => ({
      apiOrigin:
        (usesDesktopAuthConnection
          ? desktopAuthStatus.apiOrigin
          : usesStoredConnection
            ? storedConnection.apiOrigin
            : '') || '',
      ...(effectiveConnectionMode ? { connectionMode: effectiveConnectionMode } : {}),
      ...(usesStoredConnection && storedConnection.apiKey
        ? { apiKey: storedConnection.apiKey }
        : {}),
    }),
    [
      desktopAuthStatus.apiOrigin,
      storedConnection.apiKey,
      storedConnection.apiOrigin,
      effectiveConnectionMode,
      usesDesktopAuthConnection,
      usesStoredConnection,
    ]
  );

  const sharesAccountServer = Boolean(
    connectionPayload.apiOrigin && connectionPayload.apiOrigin === desktopAuthStatus.apiOrigin
  );
  const accountServerDisconnected =
    sharesAccountServer &&
    desktopAuthStatus.authenticated &&
    desktopAuthStatus.connectionStatus === 'disconnected';
  const serverUnavailable = isConnected && (serverError || accountServerDisconnected);

  const setNotice = useCallback(
    (next: NoticeState | null) => {
      if (!next) return;
      if (next.type === 'error' && next.message === t('cloudData.serverUnavailable')) {
        setServerError(true);
        const status = useAppStore.getState().desktopAuthStatus;
        if (status.authenticated && status.apiOrigin === connectionPayload.apiOrigin) {
          useAppStore
            .getState()
            .setDesktopAuthStatus({ ...status, connectionStatus: 'disconnected' });
        }
        return;
      }
      showToast(
        next.type,
        next.message,
        next.rawTableId
          ? {
              actionLabel: t('cloudData.viewRawTable'),
              onAction: () => {
                if (next.rawTableId) {
                  navigateToDataElement({ kind: 'raw_table', id: next.rawTableId });
                }
              },
            }
          : undefined
      );
    },
    [connectionPayload.apiOrigin, navigateToDataElement, t]
  );

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    expandedSpaceIdsRef.current = expandedSpaceIds;
  }, [expandedSpaceIds]);

  useEffect(() => {
    tableLookupStartedRef.current = tableLookupStarted;
  }, [tableLookupStarted]);

  useEffect(() => {
    driveFileLookupStartedRef.current = driveFileLookupStarted;
  }, [driveFileLookupStarted]);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  useEffect(() => {
    driveFilesRef.current = driveFiles;
  }, [driveFiles]);

  const selectedSpace = spaces.find((space) => space.spaceId === selectedProject?.spaceId) ?? null;
  const selectedProjectRecord =
    selectedProject && projectsBySpace[selectedProject.spaceId]
      ? (projectsBySpace[selectedProject.spaceId].find(
          (project) => project.projectId === selectedProject.projectId
        ) ?? null)
      : null;

  const selectedTableIdSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
  const selectedTables = useMemo(
    () => tables.filter((table) => selectedTableIdSet.has(table.tableId)),
    [selectedTableIdSet, tables]
  );
  const selectedFileIdSet = useMemo(() => new Set(selectedFileIds), [selectedFileIds]);
  const selectedFiles = useMemo(
    () => driveFiles.filter((file) => selectedFileIdSet.has(file.fileId)),
    [selectedFileIdSet, driveFiles]
  );

  const openSettings = useCallback(() => {
    setSettingsTab('personal-analysis');
    setShowSettings(true);
  }, [setSettingsTab, setShowSettings]);

  const handleLogin = useCallback(async () => {
    if (!dataClient.hasAuth() || loginBusy) return;

    setLoginBusy(true);
    setNotice(null);
    try {
      const status = await dataClient.authLogin();
      setDesktopAuthStatus(status);
      if (!status.authenticated) {
        setNotice({
          type: 'info',
          message: t('cloudData.loginNotCompleted'),
        });
      }
    } catch (error) {
      const isCancelled = error instanceof Error && error.message === 'Login cancelled';
      setNotice({
        type: isCancelled ? 'info' : 'error',
        message: isCancelled
          ? t('cloudData.loginCancelled')
          : error instanceof Error
            ? error.message
            : t('cloudData.loginFailed'),
      });
    } finally {
      setLoginBusy(false);
    }
  }, [loginBusy, setDesktopAuthStatus, setNotice, t]);

  const applyTables = useCallback((items: PersonalAnalysisTable[]) => {
    tablesRef.current = items;
    setTables(items);
  }, []);

  const applyDriveFiles = useCallback((items: PersonalAnalysisDriveFile[]) => {
    driveFilesRef.current = items;
    setDriveFiles(items);
  }, []);

  const clearTableResults = useCallback(() => {
    applyTables([]);
    setTablePageInfo(EMPTY_TABLE_PAGE_INFO);
  }, [applyTables]);

  const clearFileResults = useCallback(() => {
    applyDriveFiles([]);
    setDriveFilePageInfo(EMPTY_TABLE_PAGE_INFO);
  }, [applyDriveFiles]);

  const resetTableResults = useCallback(
    (options: { cancelRequests?: boolean } = {}) => {
      if (options.cancelRequests) {
        tableRequestSeq.current += 1;
      }
      setLoadingTables(false);
      setLoadingMoreTables(false);
      clearTableResults();
    },
    [clearTableResults]
  );

  const resetFileResults = useCallback(
    (options: { cancelRequests?: boolean } = {}) => {
      if (options.cancelRequests) {
        fileRequestSeq.current += 1;
      }
      setLoadingDriveFiles(false);
      setLoadingMoreDriveFiles(false);
      clearFileResults();
    },
    [clearFileResults]
  );

  const getProjectListCacheKey = useCallback(
    (
      target: SelectedProject,
      connection: CloudConnection = connectionPayload,
      kind: 'tables' | 'files' = 'tables'
    ) =>
      [
        usesDesktopAuthConnection ? 'account' : 'api-key',
        connection.apiOrigin || '',
        storedConnection.updatedAt ?? '',
        target.spaceId,
        target.projectId,
        kind,
        CLOUD_TABLE_PAGE_SIZE,
      ].join(':'),
    [connectionPayload, storedConnection.updatedAt, usesDesktopAuthConnection]
  );

  const runPagedQuery = useCallback(
    async <T,>({
      lane,
      cacheKey,
      options = {},
      fetchItems,
      onResourceNotFound,
    }: PagedQueryInput<T>) => {
      if (!dataClient.isAvailable()) return;

      const requestId = ++lane.requestSeq.current;
      const page = options.page ?? 1;
      const cached = lane.cache.get(cacheKey);
      if (!options.forceRefresh && !options.append && cached) {
        lane.applyItems(cached.items);
        lane.setPageInfo({
          page: cached.page,
          pageSize: cached.pageSize,
          total: cached.total,
          hasMore: cached.hasMore,
        });
        lane.setLoading(false);
        return;
      }

      if (options.append) {
        lane.setLoadingMore(true);
      } else {
        lane.setLoading(true);
      }

      try {
        const result = await fetchItems({ page });
        if (requestId !== lane.requestSeq.current) return;
        const nextItems = options.append
          ? [...lane.itemsRef.current, ...result.items]
          : result.items;
        const nextEntry: PagedCacheEntry<T> = {
          ...result,
          items: nextItems,
        };
        lane.cache.set(cacheKey, nextEntry);
        lane.applyItems(nextItems);
        lane.setPageInfo({
          page: nextEntry.page,
          pageSize: nextEntry.pageSize,
          total: nextEntry.total,
          hasMore: nextEntry.hasMore,
        });
      } catch (error) {
        if (requestId !== lane.requestSeq.current) return;
        if (!options.append) {
          lane.clearItems();
        }
        if (isResourceNotFoundError(error) && onResourceNotFound) {
          onResourceNotFound();
          return;
        }
        setNotice({
          type: 'error',
          message: getPersonalAnalysisErrorMessage(error, t),
        });
      } finally {
        if (requestId === lane.requestSeq.current) {
          lane.setLoading(false);
          lane.setLoadingMore(false);
        }
      }
    },
    [setNotice, t]
  );

  const tableLane = useMemo<PagedLane<PersonalAnalysisTable>>(
    () => ({
      cache: tableCacheRef.current,
      requestSeq: tableRequestSeq,
      itemsRef: tablesRef,
      applyItems: applyTables,
      clearItems: clearTableResults,
      setPageInfo: setTablePageInfo,
      setLoading: setLoadingTables,
      setLoadingMore: setLoadingMoreTables,
    }),
    [applyTables, clearTableResults]
  );

  const fileLane = useMemo<PagedLane<PersonalAnalysisDriveFile>>(
    () => ({
      cache: fileCacheRef.current,
      requestSeq: fileRequestSeq,
      itemsRef: driveFilesRef,
      applyItems: applyDriveFiles,
      clearItems: clearFileResults,
      setPageInfo: setDriveFilePageInfo,
      setLoading: setLoadingDriveFiles,
      setLoadingMore: setLoadingMoreDriveFiles,
    }),
    [applyDriveFiles, clearFileResults]
  );

  const loadTables = useCallback(
    async (
      target: SelectedProject,
      connection: CloudConnection = connectionPayload,
      options: TableQueryOptions = {}
    ) => {
      const cacheKey = getProjectListCacheKey(target, connection, 'tables');
      await runPagedQuery({
        lane: tableLane,
        cacheKey,
        options,
        fetchItems: async ({ page }) => {
          const result = await dataClient.listCloudTables({
            ...connection,
            spaceId: target.spaceId,
            projectId: target.projectId,
            keyword: '',
            page,
            pageSize: CLOUD_TABLE_PAGE_SIZE,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          });
          return {
            items: result.tables,
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            hasMore: result.hasMore,
          };
        },
      });
    },
    [connectionPayload, getProjectListCacheKey, runPagedQuery, tableLane]
  );

  const loadDriveFiles = useCallback(
    async (
      target: SelectedProject,
      connection: CloudConnection = connectionPayload,
      options: TableQueryOptions = {}
    ) => {
      const cacheKey = getProjectListCacheKey(target, connection, 'files');
      await runPagedQuery({
        lane: fileLane,
        cacheKey,
        options,
        fetchItems: async ({ page }) => {
          const result = await dataClient.listCloudDriveFiles({
            ...connection,
            spaceId: target.spaceId,
            projectId: target.projectId,
            page,
            pageSize: CLOUD_TABLE_PAGE_SIZE,
          });
          return {
            items: result.files,
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            hasMore: result.hasMore,
          };
        },
      });
    },
    [connectionPayload, fileLane, getProjectListCacheKey, runPagedQuery]
  );

  const loadProjectsForSpace = useCallback(
    async (
      spaceId: string,
      connection: CloudConnection = connectionPayload,
      options: { forceRefresh?: boolean } = {}
    ) => {
      if (!dataClient.isAvailable() || !connection.apiOrigin) return;
      if (!options.forceRefresh && projectsBySpace[spaceId]) return;

      const requestId = (projectRequestSeq.current[spaceId] ?? 0) + 1;
      projectRequestSeq.current = {
        ...projectRequestSeq.current,
        [spaceId]: requestId,
      };
      setLoadingProjectsBySpace((current) => ({ ...current, [spaceId]: true }));
      try {
        const result = await dataClient.listCloudProjects({
          ...connection,
          spaceId,
        });
        if (projectRequestSeq.current[spaceId] !== requestId) return;
        setProjectsBySpace((current) => ({
          ...current,
          [spaceId]: result.projects,
        }));
      } catch (error) {
        if (projectRequestSeq.current[spaceId] !== requestId) return;
        setNotice({
          type: 'error',
          message: getPersonalAnalysisErrorMessage(error, t),
        });
      } finally {
        if (projectRequestSeq.current[spaceId] === requestId) {
          setLoadingProjectsBySpace((current) => ({ ...current, [spaceId]: false }));
        }
      }
    },
    [connectionPayload, projectsBySpace, setNotice, t]
  );

  const toggleSpace = useCallback(
    (spaceId: string) => {
      setExpandedSpaceIds((current) => {
        const expanded = current.includes(spaceId);
        return expanded ? current.filter((id) => id !== spaceId) : [...current, spaceId];
      });
      if (!projectsBySpace[spaceId]) {
        void loadProjectsForSpace(spaceId);
      }
    },
    [loadProjectsForSpace, projectsBySpace]
  );

  const loadCatalog = useCallback(
    async (
      options: {
        announceSuccess?: boolean;
        connection?: CloudConnection;
        forceRefresh?: boolean;
      } = {}
    ) => {
      const connection = options.connection ?? connectionPayload;
      if (!dataClient.isAvailable() || !connection.apiOrigin) return;
      const preserveView = Boolean(options.forceRefresh);
      const viewSnapshot = preserveView
        ? {
            expandedSpaceIds: expandedSpaceIdsRef.current,
            selectedProject: selectedProjectRef.current,
            tableLookupStarted: tableLookupStartedRef.current,
            driveFileLookupStarted: driveFileLookupStartedRef.current,
          }
        : null;
      if (options.forceRefresh) {
        tableCacheRef.current.clear();
        fileCacheRef.current.clear();
        projectRequestSeq.current = {};
      }
      const requestId = ++catalogRequestSeq.current;
      setLoadingCatalog(true);
      setNotice(null);
      try {
        const spaceResult = await dataClient.listCloudSpaces(connection);
        const nextSpaces = spaceResult.spaces;
        if (requestId !== catalogRequestSeq.current) return;
        setServerError(false);
        const nextSpaceIds = new Set(nextSpaces.map((space) => space.spaceId));
        const preservedSelectedProject =
          viewSnapshot?.selectedProject && nextSpaceIds.has(viewSnapshot.selectedProject.spaceId)
            ? viewSnapshot.selectedProject
            : null;
        const preservedExpandedSpaceIds = viewSnapshot
          ? Array.from(
              new Set([
                ...viewSnapshot.expandedSpaceIds.filter((spaceId) => nextSpaceIds.has(spaceId)),
                ...(preservedSelectedProject ? [preservedSelectedProject.spaceId] : []),
              ])
            )
          : [];
        setSpaces(nextSpaces);
        setProjectsBySpace((current) => {
          if (!viewSnapshot) return {};
          return preservedExpandedSpaceIds.reduce<Record<string, PersonalAnalysisProject[]>>(
            (next, spaceId) => {
              if (current[spaceId]) {
                next[spaceId] = current[spaceId];
              }
              return next;
            },
            {}
          );
        });
        setExpandedSpaceIds(preservedExpandedSpaceIds);
        setLoadingProjectsBySpace({});
        setSelectedProject(preservedSelectedProject);

        const projectCount = nextSpaces.reduce(
          (count, space) => count + (space.projectCount || 0),
          0
        );
        if (options.announceSuccess) {
          setNotice({
            type: 'success',
            message: t('cloudData.connectionSuccess', {
              spaces: nextSpaces.length,
              projects: projectCount,
            }),
          });
        }
        if (viewSnapshot) {
          for (const spaceId of preservedExpandedSpaceIds) {
            const projectRequestId = (projectRequestSeq.current[spaceId] ?? 0) + 1;
            projectRequestSeq.current = {
              ...projectRequestSeq.current,
              [spaceId]: projectRequestId,
            };
            setLoadingProjectsBySpace((current) => ({ ...current, [spaceId]: true }));
            void dataClient
              .listCloudProjects({
                ...connection,
                spaceId,
              })
              .then((result) => {
                if (projectRequestSeq.current[spaceId] !== projectRequestId) return;
                setProjectsBySpace((current) => ({
                  ...current,
                  [spaceId]: result.projects,
                }));
              })
              .catch((error) => {
                if (projectRequestSeq.current[spaceId] !== projectRequestId) return;
                setNotice({
                  type: 'error',
                  message: getPersonalAnalysisErrorMessage(error, t),
                });
              })
              .finally(() => {
                if (projectRequestSeq.current[spaceId] === projectRequestId) {
                  setLoadingProjectsBySpace((current) => ({ ...current, [spaceId]: false }));
                }
              });
          }

          if (viewSnapshot.tableLookupStarted && preservedSelectedProject) {
            void loadTables(preservedSelectedProject, connection, {
              forceRefresh: true,
            });
          }
          if (viewSnapshot.driveFileLookupStarted && preservedSelectedProject) {
            void loadDriveFiles(preservedSelectedProject, connection, {
              forceRefresh: true,
            });
          }
        } else {
          resetTableResults({ cancelRequests: true });
          resetFileResults({ cancelRequests: true });
          setTableLookupStarted(false);
          setDriveFileLookupStarted(false);
        }
      } catch (error) {
        if (requestId !== catalogRequestSeq.current) return;
        setSpaces([]);
        setProjectsBySpace({});
        resetTableResults();
        resetFileResults();
        setSelectedProject(null);
        setNotice({
          type: 'error',
          message: getPersonalAnalysisErrorMessage(error, t),
        });
      } finally {
        if (requestId === catalogRequestSeq.current) {
          setLoadingCatalog(false);
        }
      }
    },
    [
      connectionPayload,
      loadDriveFiles,
      loadTables,
      resetFileResults,
      resetTableResults,
      setNotice,
      t,
    ]
  );

  const resetConnectionState = useCallback(() => {
    setSpaces([]);
    setProjectsBySpace({});
    setExpandedSpaceIds([]);
    setLoadingProjectsBySpace({});
    projectRequestSeq.current = {};
    setSelectedProject(null);
    setTableLookupStarted(false);
    setDriveFileLookupStarted(false);
    resetTableResults({ cancelRequests: true });
    resetFileResults({ cancelRequests: true });
  }, [resetFileResults, resetTableResults]);

  useEffect(() => {
    previewRequestSeq.current += 1;
    setPreview(null);
    setNotice(null);
    setPreviewPage(1);
    setSelectedTableIds([]);
    setSelectedFileIds([]);
    tableCacheRef.current.clear();
    fileCacheRef.current.clear();
    setServerError(false);

    if (connectionPayload.apiOrigin && !accountServerDisconnected) {
      resetConnectionState();
      void loadCatalog({ connection: connectionPayload });
      return;
    }

    catalogRequestSeq.current += 1;
    setLoadingCatalog(false);
    resetConnectionState();
  }, [accountServerDisconnected, connectionPayload, loadCatalog, resetConnectionState, setNotice]);

  const retryConnection = async () => {
    setRetryingConnection(true);
    try {
      if (sharesAccountServer) {
        const before = useAppStore.getState().desktopAuthStatus;
        const status = await dataClient.authGetStatus();
        if (useAppStore.getState().desktopAuthStatus === before) setDesktopAuthStatus(status);
        if (!status.authenticated || status.connectionStatus === 'disconnected') return;
        // A disconnected-to-connected transition triggers a fresh catalog effect.
        if (before.connectionStatus === 'disconnected') return;
      }
      resetConnectionState();
      tableCacheRef.current.clear();
      fileCacheRef.current.clear();
      await loadCatalog();
    } catch {
      setServerError(true);
    } finally {
      setRetryingConnection(false);
    }
  };

  const selectProject = useCallback(
    (target: SelectedProject) => {
      setSelectedProject(target);
      setFocusedTableId(null);
      setSelectedTableIds([]);
      setSelectedFileIds([]);
      resetTableResults({ cancelRequests: true });
      resetFileResults({ cancelRequests: true });
      const hasCachedLists =
        tableCacheRef.current.has(getProjectListCacheKey(target, connectionPayload, 'tables')) ||
        fileCacheRef.current.has(getProjectListCacheKey(target, connectionPayload, 'files'));
      setTableLookupStarted(hasCachedLists);
      setDriveFileLookupStarted(hasCachedLists);
      if (hasCachedLists) {
        void loadTables(target, connectionPayload);
        void loadDriveFiles(target, connectionPayload);
      }
    },
    [
      connectionPayload,
      getProjectListCacheKey,
      loadDriveFiles,
      loadTables,
      resetFileResults,
      resetTableResults,
    ]
  );

  // Deep-link ("view original table" on a cloud-mirrored input): expand the
  // space, select the project, load the tables list, highlight the row.
  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === handledFocusNonce.current) return;
    handledFocusNonce.current = focusTarget.nonce;
    const target = { spaceId: focusTarget.spaceId, projectId: focusTarget.projectId };
    setExpandedSpaceIds((current) =>
      current.includes(target.spaceId) ? current : [...current, target.spaceId]
    );
    void loadProjectsForSpace(target.spaceId);
    setListTab('tables');
    setSelectedProject(target);
    setSelectedTableIds([]);
    setSelectedFileIds([]);
    resetTableResults({ cancelRequests: true });
    resetFileResults({ cancelRequests: true });
    setTableLookupStarted(true);
    void loadTables(target, connectionPayload);
    setFocusedTableId(focusTarget.tableId);
  }, [
    focusTarget,
    connectionPayload,
    loadProjectsForSpace,
    loadTables,
    resetFileResults,
    resetTableResults,
  ]);

  // Scroll the highlighted table into view once it appears in the loaded page.
  useEffect(() => {
    if (!focusedTableId || !tables.some((table) => table.tableId === focusedTableId)) return;
    document.getElementById(`cloud-table-row-${focusedTableId}`)?.scrollIntoView({
      block: 'center',
    });
  }, [focusedTableId, tables]);

  const evictProjectListCaches = useCallback(
    (target: SelectedProject) => {
      const probe = getProjectListCacheKey(
        target,
        connectionPayload,
        PROJECT_CACHE_KEYWORD_PROBE as 'tables' | 'files'
      );
      const prefix = probe.slice(0, probe.indexOf(PROJECT_CACHE_KEYWORD_PROBE));
      for (const cache of [tableCacheRef.current, fileCacheRef.current]) {
        for (const key of Array.from(cache.keys())) {
          if (key.startsWith(prefix)) {
            cache.delete(key);
          }
        }
      }
    },
    [connectionPayload, getProjectListCacheKey]
  );

  const startProjectLookup = useCallback(() => {
    setTableLookupStarted(true);
    setDriveFileLookupStarted(true);
  }, []);

  const refreshProjectTables = useCallback(
    (target: SelectedProject) => {
      const isActiveProject =
        selectedProjectRef.current?.spaceId === target.spaceId &&
        selectedProjectRef.current?.projectId === target.projectId;
      evictProjectListCaches(target);
      if (isActiveProject) {
        setTableLookupStarted(true);
        setDriveFileLookupStarted(true);
        void loadTables(target, connectionPayload, { forceRefresh: true });
        void loadDriveFiles(target, connectionPayload, { forceRefresh: true });
        return;
      }
      setSelectedProject(target);
      setSelectedTableIds([]);
      setSelectedFileIds([]);
      resetTableResults({ cancelRequests: true });
      resetFileResults({ cancelRequests: true });
      setTableLookupStarted(true);
      setDriveFileLookupStarted(true);
    },
    [
      connectionPayload,
      evictProjectListCaches,
      loadDriveFiles,
      loadTables,
      resetFileResults,
      resetTableResults,
    ]
  );

  useEffect(() => {
    if (!tableLookupStarted || !selectedProject) return;
    if (!connectionPayload.apiOrigin) return;

    const timeout = window.setTimeout(() => {
      void loadTables(selectedProject, connectionPayload);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [connectionPayload, loadTables, selectedProject, tableLookupStarted]);

  useEffect(() => {
    if (!driveFileLookupStarted || !selectedProject) return;
    if (!connectionPayload.apiOrigin) return;

    const timeout = window.setTimeout(() => {
      void loadDriveFiles(selectedProject, connectionPayload);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [connectionPayload, driveFileLookupStarted, loadDriveFiles, selectedProject]);

  const loadMoreTables = useCallback(() => {
    if (loadingTables || loadingMoreTables || !tablePageInfo.hasMore) return;
    if (!selectedProject) return;
    void loadTables(selectedProject, connectionPayload, {
      append: true,
      page: tablePageInfo.page + 1,
    });
  }, [
    connectionPayload,
    loadTables,
    loadingMoreTables,
    loadingTables,
    selectedProject,
    tablePageInfo.hasMore,
    tablePageInfo.page,
  ]);

  const loadMoreFiles = useCallback(() => {
    if (loadingDriveFiles || loadingMoreDriveFiles || !driveFilePageInfo.hasMore) return;
    if (!selectedProject) return;
    void loadDriveFiles(selectedProject, connectionPayload, {
      append: true,
      page: driveFilePageInfo.page + 1,
    });
  }, [
    connectionPayload,
    driveFilePageInfo.hasMore,
    driveFilePageInfo.page,
    loadDriveFiles,
    loadingDriveFiles,
    loadingMoreDriveFiles,
    selectedProject,
  ]);

  const previewTable = useCallback(
    async (table: PersonalAnalysisTable, page = 1) => {
      if (!dataClient.isAvailable()) return;
      const requestId = ++previewRequestSeq.current;
      setPreviewPage(page);
      setPreview({
        kind: 'table',
        name: table.tableName,
        table,
        loading: true,
        error: null,
        data: null,
      });
      try {
        const result = await dataClient.previewCloudTable({
          ...connectionPayload,
          tableId: table.tableId,
          limit: CLOUD_PREVIEW_PAGE_SIZE,
          offset: (page - 1) * CLOUD_PREVIEW_PAGE_SIZE,
        });
        if (requestId !== previewRequestSeq.current) return;
        setPreview({
          kind: 'table',
          name: table.tableName,
          table,
          loading: false,
          error: null,
          data: result.preview,
        });
      } catch (error) {
        if (requestId !== previewRequestSeq.current) return;
        if (isPersonalAnalysisServerError(error)) {
          setPreview(null);
          setNotice({ type: 'error', message: t('cloudData.serverUnavailable') });
          return;
        }
        setPreview({
          kind: 'table',
          name: table.tableName,
          table,
          loading: false,
          error: getPersonalAnalysisErrorMessage(error, t),
          data: null,
        });
      }
    },
    [connectionPayload, setNotice, t]
  );

  const previewFile = useCallback(
    async (file: PersonalAnalysisDriveFile) => {
      if (!dataClient.isAvailable() || !selectedProjectRef.current) return;
      const requestId = ++previewRequestSeq.current;
      setPreviewPage(1);
      setPreview({ kind: 'file', name: file.fileName, loading: true, error: null, data: null });
      try {
        const result = await dataClient.previewCloudDriveFile({
          ...connectionPayload,
          spaceId: selectedProjectRef.current.spaceId,
          projectId: selectedProjectRef.current.projectId,
          fileId: file.fileId,
        });
        if (requestId !== previewRequestSeq.current) return;
        setPreview({
          kind: 'file',
          name: file.fileName,
          loading: false,
          error: null,
          data: result.preview,
        });
      } catch (error) {
        if (requestId !== previewRequestSeq.current) return;
        if (isPersonalAnalysisServerError(error)) {
          setPreview(null);
          setNotice({ type: 'error', message: t('cloudData.serverUnavailable') });
          return;
        }
        setPreview({
          kind: 'file',
          name: file.fileName,
          loading: false,
          error: getPersonalAnalysisErrorMessage(error, t),
          data: null,
        });
      }
    },
    [connectionPayload, setNotice, t]
  );

  const importTable = useCallback(
    (table: PersonalAnalysisTable) => {
      const targetSpaceId = table.spaceId || selectedProject?.spaceId;
      const targetProjectId = table.projectId || selectedProject?.projectId;
      if (!targetSpaceId || !targetProjectId) return;
      const targetSpaceName =
        spaces.find((space) => space.spaceId === targetSpaceId)?.spaceName ??
        selectedSpace?.spaceName;
      const targetProjectName =
        projectsBySpace[targetSpaceId]?.find((project) => project.projectId === targetProjectId)
          ?.projectName ?? selectedProjectRecord?.projectName;
      navigateToTableAutomation({
        newRawTableName: table.tableName,
        cloudSource: {
          spaceId: targetSpaceId,
          projectId: targetProjectId,
          tableId: table.tableId,
          tableKind: table.kind ?? 'analysis',
          tableName: table.tableName,
          spaceName: targetSpaceName,
          projectName: targetProjectName,
        },
      });
    },
    [
      navigateToTableAutomation,
      selectedProject,
      selectedProjectRecord?.projectName,
      selectedSpace?.spaceName,
      spaces,
      projectsBySpace,
    ]
  );

  const startCloudTableAutomation = useCallback(
    (table: PersonalAnalysisTable) => {
      const targetSpaceId = table.spaceId || selectedProject?.spaceId || '';
      const targetProjectId = table.projectId || selectedProject?.projectId || '';
      const payload = {
        createdAt: Date.now(),
        source: {
          tableId: table.tableId,
          tableName: table.tableName,
          spaceId: targetSpaceId,
          spaceName: selectedSpace?.spaceName || '',
          projectId: targetProjectId,
          projectName: selectedProjectRecord?.projectName || '',
          datasourceId: table.datasourceId,
          rowCount: table.rowCount,
          columns: table.columns ?? [],
        },
        accessModeLabel,
        connectionLabel,
      };
      const rawTemplate = JSON.stringify(payload);
      navigateToCloudAutomationTemplate(rawTemplate);
    },
    [
      accessModeLabel,
      connectionLabel,
      navigateToCloudAutomationTemplate,
      selectedProject,
      selectedProjectRecord?.projectName,
      selectedSpace?.spaceName,
    ]
  );

  const handleTableRowSelect = useCallback(
    (tableId: string) => {
      setSelectedTableIds((current) =>
        batchSelectMode
          ? current.includes(tableId)
            ? current.filter((id) => id !== tableId)
            : [...current, tableId]
          : [tableId]
      );
    },
    [batchSelectMode]
  );

  const toggleBatchSelectMode = useCallback(() => {
    setBatchSelectMode((current) => {
      if (current) {
        setSelectedTableIds((ids) => ids.slice(0, 1));
        setSelectedFileIds((ids) => ids.slice(0, 1));
      }
      return !current;
    });
  }, []);

  const addSelectedTablesToChat = useCallback(async () => {
    if (!dataClient.isAvailable() || selectedTables.length === 0) return;

    setAddingToChat(true);
    setNotice(null);
    try {
      const attachments = await Promise.all(
        selectedTables.map(async (table): Promise<CloudTableChatAttachment> => {
          let sampleRows: Array<Record<string, unknown>> = [];
          let columns = table.columns ?? [];
          try {
            const result = await dataClient.previewCloudTable({
              ...connectionPayload,
              tableId: table.tableId,
              limit: 5,
              offset: 0,
            });
            sampleRows = result.preview.rows;
            columns = result.preview.columns.length ? result.preview.columns : columns;
          } catch {
            // The table reference is still useful even when preview sampling fails.
          }

          return {
            id: `${table.projectId || selectedProject?.projectId || 'global'}:${table.tableId}`,
            tableId: table.tableId,
            tableName: table.tableName,
            spaceId: table.spaceId || selectedProject?.spaceId,
            spaceName: selectedSpace?.spaceName,
            projectId: table.projectId || selectedProject?.projectId,
            projectName: selectedProjectRecord?.projectName,
            datasourceId: table.datasourceId,
            folderId: table.folderId,
            rowCount: table.rowCount,
            columns,
            sampleRows,
            accessModeLabel,
            connectionLabel,
          };
        })
      );

      if (activeSessionId) {
        addCloudTablesToChat(activeSessionId, attachments);
      } else {
        addCloudTablesToWelcomeChat(attachments);
      }
      setSelectedTableIds([]);
    } catch (error) {
      setNotice({
        type: 'error',
        message: getPersonalAnalysisErrorMessage(error, t),
      });
    } finally {
      setAddingToChat(false);
    }
  }, [
    accessModeLabel,
    activeSessionId,
    addCloudTablesToChat,
    addCloudTablesToWelcomeChat,
    connectionLabel,
    connectionPayload,
    selectedProject,
    selectedProjectRecord?.projectName,
    selectedSpace?.spaceName,
    selectedTables,
    setNotice,
    t,
  ]);

  const closePreview = useCallback(() => {
    previewRequestSeq.current += 1;
    setPreview(null);
    setPreviewPage(1);
  }, []);

  const handleFileRowSelect = useCallback(
    (fileId: string) => {
      setSelectedFileIds((current) =>
        batchSelectMode
          ? current.includes(fileId)
            ? current.filter((id) => id !== fileId)
            : [...current, fileId]
          : [fileId]
      );
    },
    [batchSelectMode]
  );

  const showTableLocator = !selectedProject || !tableLookupStarted;
  const showFileLocator = !selectedProject || !driveFileLookupStarted;
  const showListLocator = showTableLocator && showFileLocator;

  const singleSelectedTable = selectedTables.length === 1 ? selectedTables[0] : null;
  const singleSelectedFile = selectedFiles.length === 1 ? selectedFiles[0] : null;
  const visibleTableIds = tables.map((table) => table.tableId);
  const allVisibleTablesSelected =
    visibleTableIds.length > 0 && visibleTableIds.every((id) => selectedTableIdSet.has(id));

  const toggleAllVisibleTables = () => {
    setSelectedTableIds((current) =>
      allVisibleTablesSelected
        ? current.filter((id) => !visibleTableIds.includes(id))
        : Array.from(new Set([...current, ...visibleTableIds]))
    );
  };

  const visibleFileIds = driveFiles.map((file) => file.fileId);
  const allVisibleFilesSelected =
    visibleFileIds.length > 0 && visibleFileIds.every((id) => selectedFileIdSet.has(id));

  const toggleAllVisibleFiles = () => {
    setSelectedFileIds((current) =>
      allVisibleFilesSelected
        ? current.filter((id) => !visibleFileIds.includes(id))
        : Array.from(new Set([...current, ...visibleFileIds]))
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      {serverUnavailable ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 py-5">
          <div className="flex flex-col items-center gap-4 text-center">
            <Cloud className="h-8 w-8 text-text-muted" />
            <p role="alert" className="text-sm text-text-secondary">
              {t('cloudData.serverUnavailable')}
            </p>
            <Button
              onClick={() => void retryConnection()}
              disabled={retryingConnection || loadingCatalog}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {t('cloudData.retryConnection')}
            </Button>
          </div>
        </div>
      ) : !isConnected ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-5">
          <div className="flex w-full max-w-[340px] flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-muted text-accent-text">
              <Cloud className="h-6 w-6" />
            </div>

            <h3 className="mt-4 text-[16px] font-semibold leading-tight text-text-primary">
              {t('cloudData.connectTitle')}
            </h3>
            <p className="mt-1.5 text-[13px] leading-6 text-text-secondary">
              {t('cloudData.connectDescription')}
            </p>

            <div className="mt-6 flex w-full flex-col gap-2.5">
              <button
                type="button"
                onClick={() => void handleLogin()}
                disabled={loginBusy}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
              >
                {loginBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {t('cloudData.startConnect')}
              </button>
              <button
                type="button"
                onClick={openSettings}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-muted bg-surface px-4 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                <KeyRound className="h-4 w-4" />
                {t('cloudData.configureApiKey')}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-[12px] text-text-muted">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{t('cloudData.privacyHint')}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-table flex min-h-0 flex-1 flex-col rounded-none border-0">
          <div className="flex min-h-0 flex-1">
            <aside className="flex min-h-0 w-60 flex-shrink-0 flex-col border-r border-border-muted">
              <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-border-subtle pl-3 pr-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
                  {t('cloudData.spaceProject')}
                  <Badge tone={usesStoredConnection ? 'accent' : 'success'}>
                    {t(
                      usesStoredConnection ? 'cloudData.apiModeBadge' : 'cloudData.accountModeBadge'
                    )}
                  </Badge>
                </span>
                <GlassDropdownMenu
                  align="end"
                  contentClassName="w-44"
                  trigger={
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                      aria-label={t('data.actions.more')}
                      title={t('data.actions.more')}
                    >
                      {loadingCatalog ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MoreVertical className="h-3.5 w-3.5" />
                      )}
                    </button>
                  }
                >
                  <GlassMenuItem
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    disabled={loadingCatalog}
                    onSelect={() => void loadCatalog({ forceRefresh: true })}
                  >
                    {t('data.actions.refresh')}
                  </GlassMenuItem>
                </GlassDropdownMenu>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {spaces.length === 0 && !loadingCatalog ? (
                  <div className="px-2 py-6 text-[13px] text-text-muted">
                    <div>{t('cloudData.noSpaces')}</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {spaces.map((space) => {
                      const projects = projectsBySpace[space.spaceId] ?? [];
                      const expanded = expandedSpaceIds.includes(space.spaceId);
                      const projectsLoaded = Object.prototype.hasOwnProperty.call(
                        projectsBySpace,
                        space.spaceId
                      );
                      const projectCount = projectsLoaded
                        ? projects.length
                        : space.projectCount || 0;
                      const loadingProjects = Boolean(loadingProjectsBySpace[space.spaceId]);

                      return (
                        <section key={space.spaceId} className="space-y-1">
                          <button
                            type="button"
                            onClick={() => toggleSpace(space.spaceId)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${
                                expanded ? 'rotate-90' : ''
                              }`}
                            />
                            <Database className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
                            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary">
                              {space.spaceName}
                            </span>
                            {loadingProjects ? (
                              <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-text-muted" />
                            ) : (
                              <span className="flex-shrink-0 text-[11px] font-medium text-text-muted">
                                {t('cloudData.projectCount', { count: projectCount })}
                              </span>
                            )}
                          </button>
                          {expanded && (
                            <div className="ml-[21px] space-y-0.5 border-l border-border-subtle pl-2">
                              {!projectsLoaded || loadingProjects ? (
                                <div className="h-8 px-2 py-2 text-[12px] text-text-muted">
                                  {t('cloudData.loadingProjects')}
                                </div>
                              ) : projects.length === 0 ? (
                                <div className="h-8 px-2 py-2 text-[12px] text-text-muted">
                                  {t('cloudData.noProjects')}
                                </div>
                              ) : (
                                projects.map((project) => {
                                  const active =
                                    selectedProject?.spaceId === space.spaceId &&
                                    selectedProject.projectId === project.projectId;
                                  const refreshing = active && (loadingTables || loadingDriveFiles);
                                  return (
                                    <div
                                      key={project.projectId}
                                      className={`group flex h-8 items-center rounded-lg transition-colors ${
                                        active
                                          ? 'bg-accent-muted ring-1 ring-inset ring-accent/15'
                                          : 'hover:bg-surface-hover'
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          selectProject({
                                            spaceId: space.spaceId,
                                            projectId: project.projectId,
                                          })
                                        }
                                        className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-[13px] font-medium ${
                                          active
                                            ? 'text-accent-text'
                                            : 'text-text-secondary group-hover:text-text-primary'
                                        }`}
                                      >
                                        <FolderKanban className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="min-w-0 flex-1 truncate">
                                          {project.projectName}
                                        </span>
                                      </button>
                                      <GlassDropdownMenu
                                        align="start"
                                        side="right"
                                        sideOffset={4}
                                        contentClassName="w-44"
                                        trigger={
                                          <button
                                            type="button"
                                            className={`mr-1.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-all hover:bg-surface-active hover:text-accent ${
                                              refreshing
                                                ? 'opacity-100'
                                                : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100'
                                            }`}
                                            aria-label={t('data.actions.more')}
                                            title={t('data.actions.more')}
                                          >
                                            {refreshing ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <MoreVertical className="h-3 w-3" />
                                            )}
                                          </button>
                                        }
                                      >
                                        <GlassMenuItem
                                          icon={<RefreshCw className="h-3.5 w-3.5" />}
                                          disabled={refreshing}
                                          onSelect={() =>
                                            refreshProjectTables({
                                              spaceId: space.spaceId,
                                              projectId: project.projectId,
                                            })
                                          }
                                        >
                                          {t('data.actions.refresh')}
                                        </GlassMenuItem>
                                      </GlassDropdownMenu>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-10 flex-shrink-0 items-center justify-end gap-2 border-b border-border-subtle px-3">
                <DataToolbarButton
                  icon={<Eye className="h-3.5 w-3.5" />}
                  label={t('cloudData.preview')}
                  disabled={listTab === 'files' ? !singleSelectedFile : !singleSelectedTable}
                  onClick={() => {
                    if (listTab === 'files') {
                      if (singleSelectedFile) void previewFile(singleSelectedFile);
                    } else if (singleSelectedTable) {
                      void previewTable(singleSelectedTable, 1);
                    }
                  }}
                />
                <DataToolbarButton
                  icon={<Database className="h-3.5 w-3.5" />}
                  label={t('cloudData.importAsInput')}
                  disabled={listTab !== 'tables' || !singleSelectedTable}
                  onClick={() => {
                    if (singleSelectedTable) {
                      importTable(singleSelectedTable);
                    }
                  }}
                />
                <DataToolbarButton
                  icon={<CalendarClock className="h-3.5 w-3.5" />}
                  label={t('cloudData.autoProcess')}
                  disabled={listTab !== 'tables' || !singleSelectedTable}
                  onClick={() => {
                    if (singleSelectedTable) {
                      startCloudTableAutomation(singleSelectedTable);
                    }
                  }}
                />
                <DataToolbarButton
                  icon={
                    addingToChat ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                    )
                  }
                  label={
                    selectedTables.length > 0
                      ? `${t('cloudData.addToChat')} (${selectedTables.length})`
                      : t('cloudData.addToChat')
                  }
                  disabled={listTab !== 'tables' || selectedTables.length === 0 || addingToChat}
                  onClick={() => void addSelectedTablesToChat()}
                />
                <DataToolbarButton
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  label={t('cloudData.batchSelect')}
                  onClick={toggleBatchSelectMode}
                />
                <DataMoreMenu
                  items={[
                    {
                      key: 'manage',
                      label: t('cloudData.manageConnection'),
                      icon: <Settings className="h-3.5 w-3.5" />,
                      onClick: openSettings,
                    },
                  ]}
                />
              </div>
              {showListLocator ? (
                <div className="flex min-h-0 flex-1 flex-col justify-center overflow-auto">
                  <EmptyState
                    label={
                      selectedProject ? t('cloudData.listNotLoaded') : t('cloudData.locateTitle')
                    }
                    description={
                      selectedProject
                        ? t('cloudData.locateTablesInProjectDesc', {
                            project: selectedProjectRecord?.projectName ?? '',
                          })
                        : t('cloudData.locateTablesDesc')
                    }
                    action={
                      selectedProject ? (
                        <Button
                          variant="primary"
                          className="shadow-soft"
                          onClick={startProjectLookup}
                        >
                          <ListPlus className="h-4 w-4" />
                          {t('cloudData.loadList')}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {listTab === 'files' ? (
                      loadingDriveFiles ? (
                        <LoadingState label={t('cloudData.loadingFiles')} />
                      ) : driveFiles.length === 0 ? (
                        <EmptyState label={t('cloudData.noFiles')} />
                      ) : (
                        <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
                          <thead className="sticky top-0 z-10">
                            <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
                              {batchSelectMode && (
                                <th className="w-[4.5rem] px-4">
                                  <input
                                    type="checkbox"
                                    checked={allVisibleFilesSelected}
                                    onChange={toggleAllVisibleFiles}
                                    className="h-3.5 w-3.5 accent-accent"
                                    aria-label={t('cloudData.selectAllTables')}
                                    title={t('cloudData.selectAllTables')}
                                  />
                                </th>
                              )}
                              <th className="whitespace-nowrap px-2">{t('cloudData.fileName')}</th>
                              <th className="w-[13%] whitespace-nowrap px-2">
                                {t('cloudData.fileType')}
                              </th>
                              <th className="w-[12%] whitespace-nowrap px-2">
                                {t('cloudData.fileSize')}
                              </th>
                              <th className="w-[20%] whitespace-nowrap px-2">
                                {t('data.columns.updatedAt')}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {driveFiles.map((file) => {
                              const isSelected = selectedFileIdSet.has(file.fileId);
                              const fileMeta = getDriveFileMeta(file);
                              const updatedAt = file.updatedAt ? Date.parse(file.updatedAt) : NaN;

                              return (
                                <tr
                                  key={file.fileId}
                                  onClick={() => handleFileRowSelect(file.fileId)}
                                  className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                                    isSelected
                                      ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
                                      : 'hover:bg-surface-hover/35'
                                  }`}
                                >
                                  {batchSelectMode && (
                                    <td className="px-4">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => handleFileRowSelect(file.fileId)}
                                        onClick={(event) => event.stopPropagation()}
                                        className="h-3.5 w-3.5 accent-accent"
                                        aria-label={file.fileName}
                                      />
                                    </td>
                                  )}
                                  <td className="px-2 py-1.5">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <div
                                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${fileMeta.badgeClassName}`}
                                      >
                                        <fileMeta.Icon className="h-4 w-4" />
                                      </div>
                                      <div className="truncate text-[13px] font-medium text-text-secondary">
                                        {file.fileName}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2">
                                    <span
                                      className={`inline-flex h-6 max-w-full items-center rounded-md px-2 text-xs font-medium ${fileMeta.badgeClassName}`}
                                    >
                                      <span className="truncate">{fileMeta.label}</span>
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                                    {formatFileSize(file.size)}
                                  </td>
                                  <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                                    {formatDateTime(Number.isFinite(updatedAt) ? updatedAt : null)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )
                    ) : loadingTables ? (
                      <LoadingState label={t('cloudData.loadingTables')} />
                    ) : tables.length === 0 ? (
                      <EmptyState label={t('cloudData.noTables')} />
                    ) : (
                      <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
                        <thead className="sticky top-0 z-10">
                          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
                            {batchSelectMode && (
                              <th className="w-[4.5rem] px-4">
                                <input
                                  type="checkbox"
                                  checked={allVisibleTablesSelected}
                                  onChange={toggleAllVisibleTables}
                                  className="h-3.5 w-3.5 accent-accent"
                                  aria-label={t('cloudData.selectAllTables')}
                                  title={t('cloudData.selectAllTables')}
                                />
                              </th>
                            )}
                            <th className="whitespace-nowrap px-2">{t('cloudData.tableName')}</th>
                            <th className="w-[13%] whitespace-nowrap px-2">
                              {t('cloudData.sourceType')}
                            </th>
                            <th className="w-[12%] whitespace-nowrap px-2">
                              {t('cloudData.rows')}
                            </th>
                            <th className="w-[20%] whitespace-nowrap px-2">
                              {t('data.columns.updatedAt')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tables.map((table) => {
                            const isSelected = selectedTableIdSet.has(table.tableId);
                            const sourceType = getCloudTableSourceType(
                              table,
                              t('cloudData.unknownSourceType')
                            );
                            const kindLabel =
                              table.kind === 'base'
                                ? t('cloudData.kindBase')
                                : table.kind === 'analysis'
                                  ? t('cloudData.kindAnalysis')
                                  : null;
                            const updatedAt = table.updatedAt ? Date.parse(table.updatedAt) : NaN;

                            return (
                              <tr
                                key={table.tableId}
                                id={`cloud-table-row-${table.tableId}`}
                                onClick={() => handleTableRowSelect(table.tableId)}
                                className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                                  isSelected
                                    ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
                                    : table.tableId === focusedTableId
                                      ? 'bg-accent-muted/60 ring-1 ring-inset ring-accent/40'
                                      : 'hover:bg-surface-hover/35'
                                }`}
                              >
                                {batchSelectMode && (
                                  <td className="px-4">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => handleTableRowSelect(table.tableId)}
                                      onClick={(event) => event.stopPropagation()}
                                      className="h-3.5 w-3.5 accent-accent"
                                      aria-label={table.tableName}
                                    />
                                  </td>
                                )}
                                <td className="px-2 py-1.5">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
                                      <Table2 className="h-4 w-4" />
                                    </div>
                                    <div className="truncate text-[13px] font-medium text-text-secondary">
                                      {table.tableName}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-2">
                                  <span
                                    className={`inline-flex h-6 max-w-full items-center rounded-md px-2 text-xs font-medium ${
                                      table.kind === 'base'
                                        ? 'bg-surface-active text-text-secondary'
                                        : 'bg-accent-muted text-accent'
                                    }`}
                                  >
                                    <span className="truncate">{kindLabel ?? sourceType}</span>
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                                  {typeof table.rowCount === 'number'
                                    ? table.rowCount.toLocaleString()
                                    : '-'}
                                </td>
                                <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                                  {formatDateTime(Number.isFinite(updatedAt) ? updatedAt : null)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                  {listTab === 'tables' && !showTableLocator && (
                    <div className="flex min-h-14 flex-shrink-0 items-center justify-between gap-2 border-t border-border-muted px-4 py-1 text-xs font-medium text-text-secondary">
                      <span>
                        {t('cloudData.tableCountLoaded', {
                          count: tables.length,
                          total: tablePageInfo.total,
                        })}
                      </span>
                      <div className="flex items-center gap-3">
                        {selectedTables.length > 0 && (
                          <span>
                            {t('cloudData.selectedTableCount', { count: selectedTables.length })}
                          </span>
                        )}
                        {batchSelectMode && (
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={toggleBatchSelectMode}
                            className="text-text-secondary shadow-soft"
                          >
                            <X className="h-3.5 w-3.5" />
                            {t('cloudData.exitBatchSelect')}
                          </Button>
                        )}
                        {tablePageInfo.hasMore && (
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={loadMoreTables}
                            disabled={loadingMoreTables}
                            className="text-text-secondary shadow-soft"
                          >
                            {loadingMoreTables ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            {t('cloudData.loadMoreTables')}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {listTab === 'files' && !showFileLocator && (
                    <div className="flex min-h-14 flex-shrink-0 items-center justify-between gap-2 border-t border-border-muted px-4 py-1 text-xs font-medium text-text-secondary">
                      <span>
                        {t('cloudData.fileCountLoaded', {
                          count: driveFiles.length,
                          total: driveFilePageInfo.total,
                        })}
                      </span>
                      <div className="flex items-center gap-3">
                        {selectedFiles.length > 0 && (
                          <span>
                            {t('cloudData.selectedFileCount', { count: selectedFiles.length })}
                          </span>
                        )}
                        {batchSelectMode && (
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={toggleBatchSelectMode}
                            className="text-text-secondary shadow-soft"
                          >
                            <X className="h-3.5 w-3.5" />
                            {t('cloudData.exitBatchSelect')}
                          </Button>
                        )}
                        {driveFilePageInfo.hasMore && (
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={loadMoreFiles}
                            disabled={loadingMoreDriveFiles}
                            className="text-text-secondary shadow-soft"
                          >
                            {loadingMoreDriveFiles ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            {t('cloudData.loadMoreFiles')}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex h-10 flex-shrink-0 items-stretch border-t border-border-muted">
                    {(['tables', 'files'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setListTab(tab)}
                        className={`relative flex h-full items-center px-4 text-xs font-medium transition-colors ${
                          listTab === tab
                            ? 'bg-accent-muted/60 text-accent'
                            : 'text-text-secondary hover:bg-surface-hover/50 hover:text-text-primary'
                        }`}
                      >
                        {listTab === tab && (
                          <span className="absolute inset-x-0 top-0 h-px bg-accent" />
                        )}
                        {t(tab === 'tables' ? 'cloudData.tablesTab' : 'cloudData.filesTab')}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}

      {preview && !serverUnavailable && (
        <RawTablePreviewDialog
          tableKind="raw"
          title={t('cloudData.previewTitle', { name: preview.name })}
          preview={preview.data}
          isLoading={preview.loading}
          error={preview.error}
          currentPage={previewPage}
          onPageChange={(page) => {
            if (preview.kind === 'table' && preview.table) {
              void previewTable(preview.table, page);
            }
          }}
          onClose={closePreview}
        />
      )}
    </div>
  );
}
