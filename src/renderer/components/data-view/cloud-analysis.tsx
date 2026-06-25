import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  CheckCircle2,
  Cloud,
  Database,
  Eye,
  FolderKanban,
  KeyRound,
  LogIn,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Table2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import appLogoSrc from '../../assets/logo.png';
import type {
  CloudTableChatAttachment,
  DataInputTablePreview,
  PersonalAnalysisConfig,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../../types';
import {
  EMPTY_PERSONAL_ANALYSIS_CONFIG,
  getPersonalAnalysisErrorMessage,
} from '../../../shared/personal-analysis';
import { InputTablePreviewDialog } from './input-tables';

interface SelectedProject {
  spaceId: string;
  projectId: string;
}

type CloudConnection = Pick<PersonalAnalysisConfig, 'apiOrigin'> & {
  apiKey?: string;
};

type TableSearchScope = 'global' | 'project';

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
  inputTableId?: string;
}

const CLOUD_TABLE_PAGE_SIZE = 10;
const CLOUD_PREVIEW_PAGE_SIZE = 20;

interface PreviewState {
  table: PersonalAnalysisTable;
  loading: boolean;
  error: string | null;
  data: DataInputTablePreview | null;
}

interface TableCacheEntry {
  tables: PersonalAnalysisTable[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

type TableCacheScope =
  | { type: 'global' }
  | {
      type: 'project';
      target: SelectedProject;
    };

interface TableQueryOptions {
  forceRefresh?: boolean;
  keyword?: string;
  page?: number;
  append?: boolean;
}

interface TableQueryInput {
  cacheKey: string;
  options?: TableQueryOptions;
  requireKeyword?: boolean;
  fetchTables: (input: { keyword: string; page: number }) => Promise<TableCacheEntry>;
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

const EMPTY_TABLE_PAGE_INFO = {
  page: 1,
  pageSize: CLOUD_TABLE_PAGE_SIZE,
  total: 0,
  hasMore: false,
};

function CloudDataPermissionItem({
  icon,
  title,
  description,
}: {
  icon: JSX.Element;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-background/72 text-text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-text-primary">{title}</div>
        <div className="mt-1 text-[12px] leading-5 text-text-muted">{description}</div>
      </div>
    </div>
  );
}

function CloudConnectionOptionCard({
  icon,
  title,
  badge,
  description,
  points,
  actionLabel,
  primary = false,
  loading = false,
  disabled = false,
  onClick,
}: {
  icon: JSX.Element;
  title: string;
  badge?: string;
  description: string;
  points: string[];
  actionLabel: string;
  primary?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex h-full min-w-0 flex-col rounded-xl border px-4 py-4 text-left shadow-soft transition-colors ${
        primary
          ? 'border-accent/30 bg-accent/5 ring-1 ring-accent/10'
          : 'border-border-subtle bg-surface/55'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
            primary ? 'bg-accent/12 text-accent-text' : 'bg-background/72 text-text-primary'
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-[14px] font-semibold text-text-primary">{title}</div>
            {badge && (
              <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-medium text-accent-text">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-text-muted">{description}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-[12px] leading-5 text-text-secondary">
        {points.map((point) => (
          <div key={point} className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
            <span className="min-w-0">{point}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`mt-5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${
          primary
            ? 'bg-accent text-white shadow-soft hover:bg-accent-hover'
            : 'border border-border-subtle bg-background/70 text-text-primary hover:border-accent/35 hover:text-accent-text'
        }`}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {actionLabel}
      </button>
    </div>
  );
}

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

export function CloudAnalysisPanel() {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const setDesktopAuthStatus = useAppStore((state) => state.setDesktopAuthStatus);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const navigateToCloudAutomationTemplate = useAppStore(
    (state) => state.navigateToCloudAutomationTemplate
  );
  const setAppConfig = useAppStore((state) => state.setAppConfig);
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
  const addCloudTablesToChat = useAppStore((state) => state.addCloudTablesToChat);
  const addCloudTablesToWelcomeChat = useAppStore((state) => state.addCloudTablesToWelcomeChat);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projectsBySpace, setProjectsBySpace] = useState<Record<string, PersonalAnalysisProject[]>>(
    {}
  );
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [tableSearchScope, setTableSearchScope] = useState<TableSearchScope>('project');
  const [globalSearchDisabled, setGlobalSearchDisabled] = useState(false);
  const [projectFilterQuery, setProjectFilterQuery] = useState('');
  const [tableLookupStarted, setTableLookupStarted] = useState(false);
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<string[]>([]);
  const [loadingProjectsBySpace, setLoadingProjectsBySpace] = useState<Record<string, boolean>>({});
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingMoreTables, setLoadingMoreTables] = useState(false);
  const [tablePageInfo, setTablePageInfo] = useState(EMPTY_TABLE_PAGE_INFO);
  const [loginBusy, setLoginBusy] = useState(false);
  const [switchingToAccount, setSwitchingToAccount] = useState(false);
  const [importingTableId, setImportingTableId] = useState<string | null>(null);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [addingToChat, setAddingToChat] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const catalogRequestSeq = useRef(0);
  const projectRequestSeq = useRef<Record<string, number>>({});
  const tableRequestSeq = useRef(0);
  const previewRequestSeq = useRef(0);
  const importRequestSeq = useRef(0);
  const selectedProjectRef = useRef<SelectedProject | null>(null);
  const expandedSpaceIdsRef = useRef<string[]>([]);
  const searchQueryRef = useRef('');
  const tableSearchScopeRef = useRef<TableSearchScope>('project');
  const tableLookupStartedRef = useRef(false);
  const tablesRef = useRef<PersonalAnalysisTable[]>([]);
  const tableCacheRef = useRef<Map<string, TableCacheEntry>>(new Map());

  const storedConnection = useMemo(
    () => appConfig?.personalAnalysis || EMPTY_PERSONAL_ANALYSIS_CONFIG,
    [appConfig?.personalAnalysis]
  );
  const hasStoredConnection = Boolean(storedConnection.apiOrigin && storedConnection.apiKey);
  const hasDesktopAuthConnection = Boolean(
    desktopAuthStatus.authenticated && desktopAuthStatus.apiOrigin
  );
  const usesDesktopAuthConnection = hasDesktopAuthConnection;
  const usesStoredConnection = !usesDesktopAuthConnection && hasStoredConnection;
  const isConnected = usesStoredConnection || usesDesktopAuthConnection;
  const authDisplayName =
    desktopAuthStatus.user?.displayName?.trim() ||
    desktopAuthStatus.user?.username?.trim() ||
    desktopAuthStatus.user?.userId?.trim() ||
    t('cloudData.currentAccount');
  const accessModeLabel = usesStoredConnection
    ? t('cloudData.apiKeyMode')
    : t('cloudData.accountMode', { account: authDisplayName });
  const connectionLabel =
    (usesDesktopAuthConnection ? desktopAuthStatus.apiOrigin : storedConnection.apiOrigin) ||
    t('cloudData.notConnected');

  const connectionPayload = useMemo(
    () => ({
      apiOrigin:
        (usesDesktopAuthConnection ? desktopAuthStatus.apiOrigin : storedConnection.apiOrigin) ||
        '',
      ...(usesStoredConnection && storedConnection.apiKey
        ? { apiKey: storedConnection.apiKey }
        : {}),
    }),
    [
      desktopAuthStatus.apiOrigin,
      storedConnection.apiKey,
      storedConnection.apiOrigin,
      usesDesktopAuthConnection,
      usesStoredConnection,
    ]
  );

  useEffect(() => {
    if (
      hasStoredConnection ||
      notice?.type !== 'error' ||
      (notice.message !== t('cloudData.errorAuth') &&
        notice.message !== t('cloudData.errorPermission'))
    ) {
      return;
    }

    setNotice(null);
  }, [hasStoredConnection, notice, t]);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    expandedSpaceIdsRef.current = expandedSpaceIds;
  }, [expandedSpaceIds]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    tableSearchScopeRef.current = tableSearchScope;
  }, [tableSearchScope]);

  useEffect(() => {
    tableLookupStartedRef.current = tableLookupStarted;
  }, [tableLookupStarted]);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  const selectedSpace = spaces.find((space) => space.spaceId === selectedProject?.spaceId) ?? null;
  const selectedProjectRecord =
    selectedProject && projectsBySpace[selectedProject.spaceId]
      ? (projectsBySpace[selectedProject.spaceId].find(
          (project) => project.projectId === selectedProject.projectId
        ) ?? null)
      : null;

  const filteredSpaces = useMemo(() => {
    const query = projectFilterQuery.trim().toLowerCase();
    if (!query) {
      return spaces.map((space) => ({
        space,
        projects: projectsBySpace[space.spaceId] ?? [],
      }));
    }

    return spaces
      .map((space) => {
        const projects = projectsBySpace[space.spaceId] ?? [];
        const spaceMatches =
          space.spaceName.toLowerCase().includes(query) ||
          space.spaceId.toLowerCase().includes(query);
        const nextProjects = spaceMatches
          ? projects
          : projects.filter(
              (project) =>
                project.projectName.toLowerCase().includes(query) ||
                project.projectId.toLowerCase().includes(query)
            );
        return {
          space,
          projects: nextProjects,
        };
      })
      .filter(({ space, projects }) => {
        const spaceMatches =
          space.spaceName.toLowerCase().includes(query) ||
          space.spaceId.toLowerCase().includes(query);
        return spaceMatches || projects.length > 0;
      });
  }, [projectFilterQuery, projectsBySpace, spaces]);
  const selectedTableIdSet = useMemo(() => new Set(selectedTableIds), [selectedTableIds]);
  const selectedTables = useMemo(
    () => tables.filter((table) => selectedTableIdSet.has(table.tableId)),
    [selectedTableIdSet, tables]
  );

  const openSettings = useCallback(() => {
    setSettingsTab('personal-analysis');
    setShowSettings(true);
  }, [setSettingsTab, setShowSettings]);

  const handleLogin = useCallback(async () => {
    if (!window.electronAPI?.auth || loginBusy) return;

    setLoginBusy(true);
    setNotice(null);
    try {
      const status = await window.electronAPI.auth.login();
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
  }, [loginBusy, setDesktopAuthStatus, t]);

  const handleSwitchToAccountAccess = useCallback(async () => {
    if (!window.electronAPI?.config || switchingToAccount) return;

    setSwitchingToAccount(true);
    setNotice(null);
    try {
      const result = await window.electronAPI.config.save({
        personalAnalysis: EMPTY_PERSONAL_ANALYSIS_CONFIG,
      });
      setAppConfig(result.config);
      setNotice({
        type: 'success',
        message: t('cloudData.switchedToAccountMode'),
      });
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : t('cloudData.switchToAccountFailed'),
      });
    } finally {
      setSwitchingToAccount(false);
    }
  }, [setAppConfig, switchingToAccount, t]);

  const clearTableResults = useCallback(() => {
    tablesRef.current = [];
    setTables([]);
    setTablePageInfo(EMPTY_TABLE_PAGE_INFO);
  }, []);

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

  const getTableCacheKey = useCallback(
    (scope: TableCacheScope, connection: CloudConnection = connectionPayload, keyword = '') =>
      [
        usesDesktopAuthConnection ? 'account' : 'api-key',
        connection.apiOrigin || '',
        storedConnection.updatedAt ?? '',
        scope.type === 'global' ? 'global' : scope.target.spaceId,
        scope.type === 'global' ? '' : scope.target.projectId,
        keyword.trim().toLowerCase(),
        CLOUD_TABLE_PAGE_SIZE,
      ].join(':'),
    [connectionPayload, storedConnection.updatedAt, usesDesktopAuthConnection]
  );

  const runTableQuery = useCallback(
    async ({
      cacheKey,
      options = {},
      requireKeyword = false,
      fetchTables,
      onResourceNotFound,
    }: TableQueryInput) => {
      const keyword = options.keyword?.trim() ?? '';
      if (!window.electronAPI?.data || (requireKeyword && !keyword)) return;

      const requestId = ++tableRequestSeq.current;
      const page = options.page ?? 1;
      const cached = tableCacheRef.current.get(cacheKey);
      if (!options.forceRefresh && !options.append && cached) {
        tablesRef.current = cached.tables;
        setTables(cached.tables);
        setTablePageInfo({
          page: cached.page,
          pageSize: cached.pageSize,
          total: cached.total,
          hasMore: cached.hasMore,
        });
        setLoadingTables(false);
        return;
      }

      if (options.append) {
        setLoadingMoreTables(true);
      } else {
        setLoadingTables(true);
      }

      try {
        const result = await fetchTables({ keyword, page });
        if (requestId !== tableRequestSeq.current) return;
        const nextTables = options.append
          ? [...tablesRef.current, ...result.tables]
          : result.tables;
        const nextEntry: TableCacheEntry = {
          ...result,
          tables: nextTables,
        };
        tableCacheRef.current.set(cacheKey, nextEntry);
        tablesRef.current = nextTables;
        setTables(nextTables);
        setTablePageInfo({
          page: nextEntry.page,
          pageSize: nextEntry.pageSize,
          total: nextEntry.total,
          hasMore: nextEntry.hasMore,
        });
      } catch (error) {
        if (requestId !== tableRequestSeq.current) return;
        if (!options.append) {
          clearTableResults();
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
        if (requestId === tableRequestSeq.current) {
          setLoadingTables(false);
          setLoadingMoreTables(false);
        }
      }
    },
    [clearTableResults, t]
  );

  const searchGlobalTables = useCallback(
    async (connection: CloudConnection = connectionPayload, options: TableQueryOptions = {}) => {
      const keyword = options.keyword?.trim() ?? '';
      const cacheKey = getTableCacheKey({ type: 'global' }, connection, keyword);
      await runTableQuery({
        cacheKey,
        options,
        requireKeyword: true,
        fetchTables: async ({ keyword: queryKeyword, page }) =>
          window.electronAPI.data.searchCloudTables({
            ...connection,
            keyword: queryKeyword,
            page,
            pageSize: CLOUD_TABLE_PAGE_SIZE,
            matchField: 'all',
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          }),
        onResourceNotFound: () => {
          setGlobalSearchDisabled(true);
          setTableSearchScope('project');
          setTableLookupStarted(false);
          setNotice({
            type: 'info',
            message: t('cloudData.globalSearchUnavailable'),
          });
        },
      });
    },
    [connectionPayload, getTableCacheKey, runTableQuery, t]
  );

  const loadTables = useCallback(
    async (
      target: SelectedProject,
      connection: CloudConnection = connectionPayload,
      options: TableQueryOptions = {}
    ) => {
      const keyword = options.keyword?.trim() ?? '';
      const cacheKey = getTableCacheKey({ type: 'project', target }, connection, keyword);
      await runTableQuery({
        cacheKey,
        options,
        fetchTables: async ({ keyword: queryKeyword, page }) =>
          window.electronAPI.data.listCloudTables({
            ...connection,
            spaceId: target.spaceId,
            projectId: target.projectId,
            keyword: queryKeyword,
            page,
            pageSize: CLOUD_TABLE_PAGE_SIZE,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          }),
      });
    },
    [connectionPayload, getTableCacheKey, runTableQuery]
  );

  const loadProjectsForSpace = useCallback(
    async (
      spaceId: string,
      connection: CloudConnection = connectionPayload,
      options: { forceRefresh?: boolean } = {}
    ) => {
      if (!window.electronAPI?.data || !connection.apiOrigin) return;
      if (!options.forceRefresh && projectsBySpace[spaceId]) return;

      const requestId = (projectRequestSeq.current[spaceId] ?? 0) + 1;
      projectRequestSeq.current = {
        ...projectRequestSeq.current,
        [spaceId]: requestId,
      };
      setLoadingProjectsBySpace((current) => ({ ...current, [spaceId]: true }));
      try {
        const result = await window.electronAPI.data.listCloudProjects({
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
    [connectionPayload, projectsBySpace, t]
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
      if (!window.electronAPI?.data || !connection.apiOrigin) return;
      const preserveView = Boolean(options.forceRefresh);
      const viewSnapshot = preserveView
        ? {
            expandedSpaceIds: expandedSpaceIdsRef.current,
            selectedProject: selectedProjectRef.current,
            searchQuery: searchQueryRef.current,
            tableSearchScope: tableSearchScopeRef.current,
            tableLookupStarted: tableLookupStartedRef.current,
          }
        : null;
      if (options.forceRefresh) {
        tableCacheRef.current.clear();
        projectRequestSeq.current = {};
      }
      const requestId = ++catalogRequestSeq.current;
      setLoadingCatalog(true);
      setNotice(null);
      try {
        const spaceResult = await window.electronAPI.data.listCloudSpaces(connection);
        const nextSpaces = spaceResult.spaces;
        if (requestId !== catalogRequestSeq.current) return;
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
            void window.electronAPI.data
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

          const shouldRefreshTables =
            viewSnapshot.tableLookupStarted || Boolean(viewSnapshot.searchQuery.trim());
          if (shouldRefreshTables && viewSnapshot.tableSearchScope === 'global') {
            void searchGlobalTables(connection, {
              forceRefresh: true,
              keyword: viewSnapshot.searchQuery,
            });
          } else if (shouldRefreshTables && preservedSelectedProject) {
            void loadTables(preservedSelectedProject, connection, {
              forceRefresh: true,
              keyword: viewSnapshot.searchQuery,
            });
          }
        } else {
          resetTableResults({ cancelRequests: true });
          setTableLookupStarted(false);
        }
      } catch (error) {
        if (requestId !== catalogRequestSeq.current) return;
        setSpaces([]);
        setProjectsBySpace({});
        resetTableResults();
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
    [connectionPayload, loadTables, resetTableResults, searchGlobalTables, t]
  );

  const resetConnectionState = useCallback(() => {
    setSpaces([]);
    setProjectsBySpace({});
    setExpandedSpaceIds([]);
    setLoadingProjectsBySpace({});
    projectRequestSeq.current = {};
    setSelectedProject(null);
    setSearchQuery('');
    setTableSearchScope('project');
    setGlobalSearchDisabled(false);
    setProjectFilterQuery('');
    setTableLookupStarted(false);
    resetTableResults({ cancelRequests: true });
  }, [resetTableResults]);

  useEffect(() => {
    previewRequestSeq.current += 1;
    importRequestSeq.current += 1;
    setPreview(null);
    setPreviewPage(1);
    setImportingTableId(null);
    setSelectedTableIds([]);
    tableCacheRef.current.clear();

    if (connectionPayload.apiOrigin) {
      resetConnectionState();
      void loadCatalog({ connection: connectionPayload });
      return;
    }

    catalogRequestSeq.current += 1;
    setLoadingCatalog(false);
    resetConnectionState();
  }, [connectionPayload, loadCatalog, resetConnectionState]);

  const selectProject = useCallback(
    (target: SelectedProject) => {
      setSelectedProject(target);
      setTableSearchScope('project');
      setSearchQuery('');
      setSelectedTableIds([]);
      setTableLookupStarted(false);
      resetTableResults({ cancelRequests: true });
    },
    [resetTableResults]
  );

  useEffect(() => {
    if (!tableLookupStarted && !searchQuery.trim()) return;
    if (!connectionPayload.apiOrigin) return;

    const timeout = window.setTimeout(() => {
      if (tableSearchScope === 'global') {
        void searchGlobalTables(connectionPayload, { keyword: searchQuery });
        return;
      }

      if (selectedProject) {
        void loadTables(selectedProject, connectionPayload, { keyword: searchQuery });
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [
    connectionPayload,
    loadTables,
    searchGlobalTables,
    searchQuery,
    selectedProject,
    tableLookupStarted,
    tableSearchScope,
  ]);

  const loadMoreTables = useCallback(() => {
    if (loadingTables || loadingMoreTables || !tablePageInfo.hasMore) return;
    if (tableSearchScope === 'global') {
      if (!searchQuery.trim()) return;
      void searchGlobalTables(connectionPayload, {
        append: true,
        keyword: searchQuery,
        page: tablePageInfo.page + 1,
      });
      return;
    }

    if (!selectedProject) return;
    void loadTables(selectedProject, connectionPayload, {
      append: true,
      keyword: searchQuery,
      page: tablePageInfo.page + 1,
    });
  }, [
    connectionPayload,
    loadTables,
    loadingMoreTables,
    loadingTables,
    searchQuery,
    searchGlobalTables,
    selectedProject,
    tablePageInfo.hasMore,
    tablePageInfo.page,
    tableSearchScope,
  ]);

  const previewTable = useCallback(
    async (table: PersonalAnalysisTable, page = 1) => {
      if (!window.electronAPI?.data) return;
      const requestId = ++previewRequestSeq.current;
      setPreviewPage(page);
      setPreview({ table, loading: true, error: null, data: null });
      try {
        const result = await window.electronAPI.data.previewCloudTable({
          ...connectionPayload,
          tableId: table.tableId,
          limit: CLOUD_PREVIEW_PAGE_SIZE,
          offset: (page - 1) * CLOUD_PREVIEW_PAGE_SIZE,
        });
        if (requestId !== previewRequestSeq.current) return;
        setPreview({ table, loading: false, error: null, data: result.preview });
      } catch (error) {
        if (requestId !== previewRequestSeq.current) return;
        setPreview({
          table,
          loading: false,
          error: getPersonalAnalysisErrorMessage(error, t),
          data: null,
        });
      }
    },
    [connectionPayload, t]
  );

  const importTable = useCallback(
    async (table: PersonalAnalysisTable) => {
      if (!window.electronAPI?.data) return;
      const targetSpaceId = table.spaceId || selectedProject?.spaceId;
      const targetProjectId = table.projectId || selectedProject?.projectId;
      if (!targetProjectId) return;
      const requestId = ++importRequestSeq.current;
      setImportingTableId(table.tableId);
      try {
        const result = await window.electronAPI.data.importCloudTable({
          ...connectionPayload,
          tableId: table.tableId,
          spaceId: targetSpaceId,
          projectId: targetProjectId,
          name: table.tableName,
          previewRows: 20,
        });
        if (requestId !== importRequestSeq.current) return;
        previewRequestSeq.current += 1;
        setPreview(null);
        setPreviewPage(1);
        setNotice({
          type: 'success',
          message: t('cloudData.importSuccess', { name: result.inputTable.name }),
          inputTableId: result.inputTable.id,
        });
      } catch (error) {
        if (requestId !== importRequestSeq.current) return;
        setNotice({
          type: 'error',
          message: getPersonalAnalysisErrorMessage(error, t),
        });
      } finally {
        if (requestId === importRequestSeq.current) {
          setImportingTableId(null);
        }
      }
    },
    [connectionPayload, selectedProject, t]
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

  const toggleTableSelection = useCallback((tableId: string) => {
    setSelectedTableIds((current) =>
      current.includes(tableId) ? current.filter((id) => id !== tableId) : [...current, tableId]
    );
  }, []);

  const addSelectedTablesToChat = useCallback(async () => {
    if (!window.electronAPI?.data || selectedTables.length === 0) return;

    setAddingToChat(true);
    setNotice(null);
    try {
      const attachments = await Promise.all(
        selectedTables.map(async (table): Promise<CloudTableChatAttachment> => {
          let sampleRows: Array<Record<string, unknown>> = [];
          let columns = table.columns ?? [];
          try {
            const result = await window.electronAPI.data.previewCloudTable({
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
    t,
  ]);

  const closePreview = useCallback(() => {
    previewRequestSeq.current += 1;
    setPreview(null);
    setPreviewPage(1);
  }, []);

  const switchTableSearchScope = useCallback(
    (scope: TableSearchScope) => {
      if (scope === 'global' && globalSearchDisabled) return;
      setTableSearchScope(scope);
      setSelectedTableIds([]);
      resetTableResults({ cancelRequests: true });
      setTableLookupStarted(
        Boolean(searchQuery.trim()) && (scope === 'global' || Boolean(selectedProject))
      );
    },
    [globalSearchDisabled, resetTableResults, searchQuery, selectedProject]
  );

  const showTableLocator =
    tableSearchScope === 'project'
      ? !selectedProject || (!tableLookupStarted && !searchQuery.trim())
      : !tableLookupStarted && !searchQuery.trim();

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent">
      {isConnected && (
        <div className="flex h-10 w-full flex-shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-background/18 px-5 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2">
            <Cloud className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
            <span className="truncate text-[12px] font-medium text-text-muted">
              {t('cloudData.connectedWithMode', { mode: accessModeLabel, host: connectionLabel })}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {usesStoredConnection && desktopAuthStatus.authenticated && (
              <button
                type="button"
                onClick={() => void handleSwitchToAccountAccess()}
                disabled={switchingToAccount}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted bg-background/60 px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
              >
                {switchingToAccount && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('cloudData.switchToAccountMode')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadCatalog({ forceRefresh: true })}
              disabled={loadingCatalog}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted bg-background/60 px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingCatalog ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </button>
            <button
              type="button"
              onClick={openSettings}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-muted bg-background/60 px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <Settings className="h-3.5 w-3.5" />
              {t('cloudData.manageConnection')}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="mx-5 mt-3 flex flex-shrink-0 items-center justify-between gap-3 rounded-lg border border-border-muted bg-background/72 px-3 py-2 text-[13px] shadow-soft">
          <div
            className={`flex min-w-0 items-center gap-2 ${
              notice.type === 'error'
                ? 'text-error'
                : notice.type === 'success'
                  ? 'text-success'
                  : 'text-text-secondary'
            }`}
          >
            {notice.type === 'error' ? (
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            )}
            <span className="min-w-0 truncate">{notice.message}</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {notice.inputTableId && (
              <button
                type="button"
                onClick={() =>
                  navigateToDataElement({ kind: 'input_table', id: notice.inputTableId! })
                }
                className="rounded-md px-2 py-1 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent/10"
              >
                {t('cloudData.viewInputTable')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {!isConnected ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-5">
          <div className="flex w-full max-w-[680px] flex-col items-center text-center">
            <div className="flex items-center justify-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent-text shadow-soft ring-1 ring-accent/10">
                <img src={appLogoSrc} alt="" className="h-9 w-9 object-contain" />
              </div>
              <div className="flex items-center gap-1 text-accent/45">
                <ArrowRight className="h-3.5 w-3.5" />
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent-text shadow-soft ring-1 ring-accent/10">
                <Cloud className="h-8 w-8" />
              </div>
            </div>

            <h3 className="mt-6 text-[21px] font-semibold leading-tight text-text-primary">
              {t('cloudData.connectTitle')}
            </h3>
            <p className="mt-2 max-w-[560px] text-[13px] leading-6 text-text-secondary">
              {t('cloudData.connectDescription')}
            </p>

            <div className="mt-6 w-full max-w-[560px] rounded-xl bg-surface/55 px-5 py-4 text-left shadow-soft ring-1 ring-border-subtle">
              <div className="text-[13px] font-medium text-text-secondary">
                {t('cloudData.availableAfterConnect')}
              </div>
              <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                <CloudDataPermissionItem
                  icon={<LogIn className="h-4 w-4" />}
                  title={t('cloudData.permissionReadTables')}
                  description={t('cloudData.permissionReadTablesDesc')}
                />
                <CloudDataPermissionItem
                  icon={<Database className="h-4 w-4" />}
                  title={t('cloudData.permissionPreviewData')}
                  description={t('cloudData.permissionPreviewDataDesc')}
                />
                <CloudDataPermissionItem
                  icon={<FolderKanban className="h-4 w-4" />}
                  title={t('cloudData.permissionImportData')}
                  description={t('cloudData.permissionImportDataDesc')}
                />
                <CloudDataPermissionItem
                  icon={<UploadCloud className="h-4 w-4" />}
                  title={t('cloudData.permissionUploadData')}
                  description={t('cloudData.permissionUploadDataDesc')}
                />
              </div>
            </div>

            <div className="mt-6 grid w-full max-w-[680px] gap-4 sm:grid-cols-2">
              <CloudConnectionOptionCard
                icon={<LogIn className="h-4 w-4" />}
                title={t('cloudData.accountConnectTitle')}
                badge={t('cloudData.recommended')}
                description={t('cloudData.accountConnectDescription')}
                points={[
                  t('cloudData.accountConnectPointIdentity'),
                  t('cloudData.accountConnectPointPermission'),
                  t('cloudData.accountConnectPointDaily'),
                ]}
                actionLabel={t('cloudData.startConnect')}
                primary
                loading={loginBusy}
                disabled={loginBusy}
                onClick={() => void handleLogin()}
              />
              <CloudConnectionOptionCard
                icon={<KeyRound className="h-4 w-4" />}
                title={t('cloudData.apiKeyConnectTitle')}
                description={t('cloudData.apiKeyConnectDescription')}
                points={[
                  t('cloudData.apiKeyConnectPointConfig'),
                  t('cloudData.apiKeyConnectPointAutomation'),
                  t('cloudData.apiKeyConnectPointFallback'),
                ]}
                actionLabel={t('cloudData.configureApiKey')}
                onClick={openSettings}
              />
            </div>

            <div className="mt-4 flex max-w-[560px] items-center justify-center gap-2 text-[12px] text-text-muted">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
              <span>{t('cloudData.privacyHint')}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-0 overflow-hidden px-5 py-4">
          <aside className="w-[260px] flex-shrink-0 overflow-hidden rounded-l-xl border border-border-subtle bg-background/54">
            <div className="flex h-10 items-center justify-between border-b border-border-subtle px-3">
              <span className="text-[12px] font-semibold text-text-secondary">
                {t('cloudData.spaceProject')}
              </span>
              {loadingCatalog && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />}
            </div>
            <div className="border-b border-border-subtle px-2 py-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <input
                  value={projectFilterQuery}
                  onChange={(event) => setProjectFilterQuery(event.target.value)}
                  placeholder={t('cloudData.filterProjects')}
                  className="h-8 w-full rounded-lg border border-border-muted bg-background/72 pl-8 pr-3 text-[12px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
              {projectFilterQuery.trim() && (
                <div className="mt-1 px-1 text-[11px] leading-4 text-text-muted">
                  {t('cloudData.projectFilterLoadedOnly')}
                </div>
              )}
            </div>
            <div className="h-[calc(100%-5.5rem)] overflow-y-auto p-2">
              {spaces.length === 0 && !loadingCatalog ? (
                <div className="px-2 py-6 text-[13px] text-text-muted">
                  <div>{t('cloudData.noSpaces')}</div>
                  <button
                    type="button"
                    onClick={() => void loadCatalog({ forceRefresh: true })}
                    className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent/10"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('cloudData.refreshTables')}
                  </button>
                </div>
              ) : filteredSpaces.length === 0 && !loadingCatalog ? (
                <div className="px-2 py-6 text-[13px] text-text-muted">
                  {t('cloudData.noProjectMatches')}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredSpaces.map(({ space, projects }) => {
                    const expanded = expandedSpaceIds.includes(space.spaceId);
                    const projectsLoaded = Object.prototype.hasOwnProperty.call(
                      projectsBySpace,
                      space.spaceId
                    );
                    const projectCount = projectsLoaded ? projects.length : space.projectCount || 0;
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
                                return (
                                  <button
                                    key={project.projectId}
                                    type="button"
                                    onClick={() =>
                                      selectProject({
                                        spaceId: space.spaceId,
                                        projectId: project.projectId,
                                      })
                                    }
                                    className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium transition-colors ${
                                      active
                                        ? 'bg-accent/10 text-accent-text ring-1 ring-inset ring-accent/15'
                                        : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                                    }`}
                                  >
                                    <FolderKanban className="h-3.5 w-3.5 flex-shrink-0" />
                                    <span className="min-w-0 flex-1 truncate">
                                      {project.projectName}
                                    </span>
                                  </button>
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

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-r-xl border-y border-r border-border-subtle bg-background/48">
            <div className="flex h-12 flex-shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text-primary">
                  {tableSearchScope === 'global'
                    ? t('cloudData.globalTableSearch')
                    : (selectedProjectRecord?.projectName ?? t('cloudData.selectProject'))}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
                  <span className="min-w-0 truncate">
                    {tableSearchScope === 'global'
                      ? t('cloudData.allAccessibleSpaces')
                      : (selectedSpace?.spaceName ?? t('cloudData.tableList'))}
                  </span>
                  {tableLookupStarted && (
                    <span className="flex-shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent-text">
                      {t('cloudData.tableCountLoaded', {
                        count: tables.length,
                        total: tablePageInfo.total,
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <div className="flex h-8 rounded-lg border border-border-muted bg-background/70 p-0.5">
                  <button
                    type="button"
                    onClick={() => switchTableSearchScope('global')}
                    disabled={globalSearchDisabled}
                    className={`rounded-md px-2.5 text-[12px] font-medium transition-colors ${
                      tableSearchScope === 'global'
                        ? 'bg-accent/10 text-accent-text'
                        : 'text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50'
                    }`}
                  >
                    {t('cloudData.searchScopeGlobal')}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchTableSearchScope('project')}
                    disabled={!selectedProject}
                    className={`rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      tableSearchScope === 'project'
                        ? 'bg-accent/10 text-accent-text'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {t('cloudData.searchScopeProject')}
                  </button>
                </div>
                <div className="relative w-[260px]">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    value={searchQuery}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setSearchQuery(nextValue);
                      setSelectedTableIds([]);
                      if (nextValue.trim() && (tableSearchScope === 'global' || selectedProject)) {
                        setTableLookupStarted(true);
                      }
                    }}
                    disabled={tableSearchScope === 'project' && !selectedProject}
                    placeholder={
                      tableSearchScope === 'global'
                        ? t('cloudData.searchAllTables')
                        : t('cloudData.searchTables')
                    }
                    className="h-8 w-full rounded-lg border border-border-muted bg-background/72 pl-8 pr-3 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              <div className="h-full overflow-auto pb-24">
                {showTableLocator ? (
                  <div className="flex min-h-full items-center justify-center px-6 py-10">
                    <div className="w-full max-w-[560px] text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent-text">
                        <Search className="h-6 w-6" />
                      </div>
                      <h3 className="mt-4 text-[16px] font-semibold text-text-primary">
                        {tableSearchScope === 'global'
                          ? t('cloudData.globalTableSearchTitle')
                          : selectedProject
                            ? t('cloudData.locateTablesInProjectTitle')
                            : t('cloudData.locateTablesTitle')}
                      </h3>
                      <p className="mt-2 text-[13px] leading-6 text-text-muted">
                        {tableSearchScope === 'global'
                          ? t('cloudData.globalTableSearchDesc')
                          : selectedProject
                            ? t('cloudData.locateTablesInProjectDesc', {
                                project: selectedProjectRecord?.projectName ?? '',
                              })
                            : t('cloudData.locateTablesDesc')}
                      </p>
                      <div className="mt-5 grid gap-3 text-left sm:grid-cols-2">
                        <div className="rounded-xl border border-border-subtle bg-surface/55 px-4 py-3">
                          <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                            <Search className="h-4 w-4 text-accent-text" />
                            {tableSearchScope === 'global'
                              ? t('cloudData.globalKeywordSearch')
                              : t('cloudData.projectScopedSearch')}
                          </div>
                          <p className="mt-1 text-[12px] leading-5 text-text-muted">
                            {tableSearchScope === 'global'
                              ? t('cloudData.globalKeywordSearchDesc')
                              : t('cloudData.projectScopedSearchDesc')}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border-subtle bg-surface/55 px-4 py-3">
                          <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                            <FolderKanban className="h-4 w-4 text-accent-text" />
                            {t('cloudData.projectTreeFilter')}
                          </div>
                          <p className="mt-1 text-[12px] leading-5 text-text-muted">
                            {t('cloudData.projectTreeFilterDesc')}
                          </p>
                        </div>
                      </div>
                      {selectedProject && (
                        <button
                          type="button"
                          onClick={() => setTableLookupStarted(true)}
                          className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-border-muted bg-background/70 px-4 text-[13px] font-semibold text-text-secondary shadow-soft transition-colors hover:bg-surface-hover hover:text-text-primary"
                        >
                          <Table2 className="h-4 w-4" />
                          {t('cloudData.browseCurrentProject')}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <table className="w-full min-w-[860px] table-fixed border-collapse text-left">
                      <thead className="sticky top-0 z-10 bg-[var(--data-grid-header-surface)] text-[12px] font-medium text-text-secondary">
                        <tr className="h-10 border-b border-border-subtle">
                          <th className="w-[6%] px-3" aria-hidden="true" />
                          <th className="w-[44%] px-3">{t('cloudData.tableName')}</th>
                          <th className="w-[14%] px-3">{t('cloudData.sourceType')}</th>
                          <th className="w-[36%] px-3 text-right">{t('cloudData.actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle text-[13px]">
                        {loadingTables ? (
                          <tr>
                            <td colSpan={4} className="h-28 px-3 text-center text-text-muted">
                              <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                              {t('cloudData.loadingTables')}
                            </td>
                          </tr>
                        ) : tables.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="h-28 px-3 text-center text-text-muted">
                              <div>{t('cloudData.noTables')}</div>
                              {(tableSearchScope === 'global'
                                ? Boolean(searchQuery.trim())
                                : Boolean(selectedProject)) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (tableSearchScope === 'global') {
                                      void searchGlobalTables(connectionPayload, {
                                        forceRefresh: true,
                                        keyword: searchQuery,
                                      });
                                      return;
                                    }
                                    if (selectedProject) {
                                      void loadTables(selectedProject, connectionPayload, {
                                        forceRefresh: true,
                                        keyword: searchQuery,
                                      });
                                    }
                                  }}
                                  className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent/10"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  {t('cloudData.refreshTables')}
                                </button>
                              )}
                            </td>
                          </tr>
                        ) : (
                          tables.map((table) => {
                            const isSelected = selectedTableIdSet.has(table.tableId);
                            const sourceType = getCloudTableSourceType(
                              table,
                              t('cloudData.unknownSourceType')
                            );

                            return (
                              <tr
                                key={table.tableId}
                                onClick={() => toggleTableSelection(table.tableId)}
                                className={`group h-[50px] cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-accent/10 ring-1 ring-inset ring-accent/15'
                                    : 'hover:bg-surface-hover/60'
                                }`}
                              >
                                <td className="px-3">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleTableSelection(table.tableId)}
                                    onClick={(event) => event.stopPropagation()}
                                    className={`h-3.5 w-3.5 rounded border-border-muted accent-accent transition-opacity ${
                                      isSelected
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover:opacity-100'
                                    }`}
                                    aria-label={table.tableName}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Table2 className="h-4 w-4 flex-shrink-0 text-accent-text" />
                                    <div className="min-w-0">
                                      <div className="truncate font-medium text-text-primary">
                                        {table.tableName}
                                      </div>
                                      <div className="truncate text-[11px] text-text-muted">
                                        {tableSearchScope === 'global' &&
                                        (table.spaceId || table.projectId)
                                          ? t('cloudData.tableSearchLocation', {
                                              space: table.spaceId || '-',
                                              project: table.projectId || '-',
                                              tableId: table.tableId,
                                            })
                                          : table.tableId}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3">
                                  <span className="inline-flex h-6 max-w-full items-center rounded-md bg-accent/10 px-2 text-[11px] font-semibold text-accent-text">
                                    <span className="truncate">{sourceType}</span>
                                  </span>
                                </td>
                                <td className="px-3">
                                  <div className="flex flex-nowrap justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void previewTable(table, 1);
                                      }}
                                      className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-muted bg-background/60 px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      {t('cloudData.preview')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void importTable(table);
                                      }}
                                      disabled={importingTableId === table.tableId}
                                      className={`inline-flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                        importingTableId === table.tableId
                                          ? 'border-accent bg-accent text-white shadow-soft'
                                          : 'border-accent/25 bg-accent/10 text-accent-text hover:bg-accent hover:text-white'
                                      }`}
                                    >
                                      {importingTableId === table.tableId ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Database className="h-3.5 w-3.5" />
                                      )}
                                      {t('cloudData.importAsInput')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        startCloudTableAutomation(table);
                                      }}
                                      className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-success/30 bg-success/10 px-2.5 text-[12px] font-medium text-success transition-colors hover:bg-success hover:text-white"
                                    >
                                      <CalendarClock className="h-3.5 w-3.5" />
                                      {t('cloudData.autoProcess')}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>

                    {!loadingTables && tablePageInfo.hasMore && (
                      <div className="flex justify-center px-4 py-4">
                        <button
                          type="button"
                          onClick={loadMoreTables}
                          disabled={loadingMoreTables}
                          className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-muted bg-background/70 px-3 text-[12px] font-medium text-text-secondary shadow-soft transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
                        >
                          {loadingMoreTables ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          {t('cloudData.loadMoreTables')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {selectedTables.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
                  <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border-subtle bg-background/95 px-4 py-3 shadow-elevated backdrop-blur-xl">
                    <span className="whitespace-nowrap text-[13px] font-medium text-text-secondary">
                      {t('cloudData.selectedTableCount', { count: selectedTables.length })}
                    </span>
                    <button
                      type="button"
                      onClick={() => void addSelectedTablesToChat()}
                      disabled={addingToChat}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
                    >
                      {addingToChat ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MessageSquarePlus className="h-4 w-4" />
                      )}
                      {t('cloudData.addToChat')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {preview && (
        <InputTablePreviewDialog
          tableKind="input"
          title={t('cloudData.previewTitle', { name: preview.table.tableName })}
          subtitle={preview.table.tableId}
          preview={preview.data}
          isLoading={preview.loading}
          error={preview.error}
          currentPage={previewPage}
          onPageChange={(page) => void previewTable(preview.table, page)}
          onClose={closePreview}
          footer={
            <>
              <button
                type="button"
                onClick={closePreview}
                className="inline-flex h-8 items-center rounded-lg border border-border-muted bg-background/60 px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void importTable(preview.table)}
                disabled={importingTableId === preview.table.tableId}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importingTableId === preview.table.tableId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Database className="h-3.5 w-3.5" />
                )}
                {t('cloudData.importAsInput')}
              </button>
              <button
                type="button"
                onClick={() => {
                  startCloudTableAutomation(preview.table);
                  closePreview();
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 text-[12px] font-medium text-success shadow-soft transition-colors hover:bg-success hover:text-white"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {t('cloudData.autoProcess')}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}
