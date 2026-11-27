import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatIpcError } from '../../utils/ipc-error';
import { useAppStore } from '../../store';
import type {
  CloudTableChatAttachment,
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
import { showToast } from '../../utils/toast';
import { dataClient } from '../../features/data/api/data-client';
import {
  CLOUD_PREVIEW_PAGE_SIZE,
  CLOUD_TABLE_PAGE_SIZE,
  EMPTY_TABLE_PAGE_INFO,
  PROJECT_CACHE_KEYWORD_PROBE,
  isResourceNotFoundError,
  type CloudConnection,
  type CloudFocusTarget,
  type ListTab,
  type NoticeState,
  type PagedCacheEntry,
  type PagedLane,
  type PagedPageInfo,
  type PagedQueryInput,
  type PreviewState,
  type SelectedProject,
  type TableQueryOptions,
} from './cloud-analysis/helpers';
import { CloudUnconnectedState } from './cloud-analysis/CloudUnconnectedState';
import { CloudSpaceSidebar } from './cloud-analysis/CloudSpaceSidebar';
import { CloudContentList } from './cloud-analysis/CloudContentList';

export type { CloudFocusTarget };

export function CloudAnalysisPanel({ focusTarget }: { focusTarget?: CloudFocusTarget | null }) {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const setDesktopAuthStatus = useAppStore((state) => state.setDesktopAuthStatus);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
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
  const [importingTableId, setImportingTableId] = useState<string | null>(null);
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
          : formatIpcError(error, t('cloudData.loginFailed')),
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
      setTableLookupStarted(true);
      setDriveFileLookupStarted(true);
      void loadTables(target, connectionPayload);
      void loadDriveFiles(target, connectionPayload);
    },
    [connectionPayload, loadDriveFiles, loadTables, resetFileResults, resetTableResults]
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

  const resolveTableSource = useCallback(
    (table: PersonalAnalysisTable) => {
      const targetSpaceId = table.spaceId || selectedProject?.spaceId;
      const targetProjectId = table.projectId || selectedProject?.projectId;
      if (!targetSpaceId || !targetProjectId) return null;
      const targetSpaceName =
        spaces.find((space) => space.spaceId === targetSpaceId)?.spaceName ??
        selectedSpace?.spaceName;
      const targetProjectName =
        projectsBySpace[targetSpaceId]?.find((project) => project.projectId === targetProjectId)
          ?.projectName ?? selectedProjectRecord?.projectName;
      return {
        spaceId: targetSpaceId,
        projectId: targetProjectId,
        spaceName: targetSpaceName,
        projectName: targetProjectName,
      };
    },
    [
      selectedProject,
      selectedProjectRecord?.projectName,
      selectedSpace?.spaceName,
      spaces,
      projectsBySpace,
    ]
  );

  const importTable = useCallback(
    async (table: PersonalAnalysisTable) => {
      const source = resolveTableSource(table);
      if (!source || importingTableId) return;
      setImportingTableId(table.tableId);
      try {
        const result = await dataClient.importCloudRawTable({
          ...connectionPayload,
          tableId: table.tableId,
          spaceId: source.spaceId,
          projectId: source.projectId,
          spaceName: source.spaceName,
          projectName: source.projectName,
        });
        setNotice({
          type: 'success',
          message: t('cloudData.importSuccess', { name: result.rawTable.name }),
          rawTableId: result.rawTable.id,
        });
      } catch (error) {
        setNotice({
          type: 'error',
          message: getPersonalAnalysisErrorMessage(error, t),
        });
      } finally {
        setImportingTableId(null);
      }
    },
    [connectionPayload, importingTableId, resolveTableSource, setNotice, t]
  );

  const scheduleTableSync = useCallback(
    (table: PersonalAnalysisTable) => {
      const source = resolveTableSource(table);
      if (!source) return;
      navigateToTableAutomation({
        newRawTableName: table.tableName,
        cloudSource: {
          spaceId: source.spaceId,
          projectId: source.projectId,
          tableId: table.tableId,
          tableKind: table.kind ?? 'analysis',
          tableName: table.tableName,
          spaceName: source.spaceName,
          projectName: source.projectName,
        },
      });
    },
    [navigateToTableAutomation, resolveTableSource]
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
      {serverUnavailable || !isConnected ? (
        <CloudUnconnectedState
          serverUnavailable={serverUnavailable}
          retryingConnection={retryingConnection}
          loadingCatalog={loadingCatalog}
          loginBusy={loginBusy}
          onRetryConnection={() => void retryConnection()}
          onLogin={() => void handleLogin()}
          onOpenSettings={openSettings}
        />
      ) : (
        <div className="glass-table ui-table-flush flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <CloudSpaceSidebar
              usesStoredConnection={usesStoredConnection}
              loadingCatalog={loadingCatalog}
              spaces={spaces}
              projectsBySpace={projectsBySpace}
              expandedSpaceIds={expandedSpaceIds}
              loadingProjectsBySpace={loadingProjectsBySpace}
              selectedProject={selectedProject}
              loadingTables={loadingTables}
              loadingDriveFiles={loadingDriveFiles}
              onRefreshCatalog={() => void loadCatalog({ forceRefresh: true })}
              onToggleSpace={toggleSpace}
              onSelectProject={selectProject}
              onRefreshProject={refreshProjectTables}
            />
            <CloudContentList
              listTab={listTab}
              onListTabChange={setListTab}
              selectedProject={selectedProject}
              selectedProjectRecord={selectedProjectRecord}
              showListLocator={showListLocator}
              showTableLocator={showTableLocator}
              showFileLocator={showFileLocator}
              tables={tables}
              tablePageInfo={tablePageInfo}
              loadingTables={loadingTables}
              loadingMoreTables={loadingMoreTables}
              selectedTables={selectedTables}
              selectedTableIdSet={selectedTableIdSet}
              singleSelectedTable={singleSelectedTable}
              allVisibleTablesSelected={allVisibleTablesSelected}
              focusedTableId={focusedTableId}
              driveFiles={driveFiles}
              driveFilePageInfo={driveFilePageInfo}
              loadingDriveFiles={loadingDriveFiles}
              loadingMoreDriveFiles={loadingMoreDriveFiles}
              selectedFiles={selectedFiles}
              selectedFileIdSet={selectedFileIdSet}
              singleSelectedFile={singleSelectedFile}
              allVisibleFilesSelected={allVisibleFilesSelected}
              batchSelectMode={batchSelectMode}
              importingTableId={importingTableId}
              addingToChat={addingToChat}
              onStartProjectLookup={startProjectLookup}
              onLoadMoreTables={loadMoreTables}
              onLoadMoreFiles={loadMoreFiles}
              onToggleBatchSelectMode={toggleBatchSelectMode}
              onPreviewFile={(file) => void previewFile(file)}
              onPreviewTable={(table) => void previewTable(table, 1)}
              onImportTable={(table) => void importTable(table)}
              onScheduleTableSync={scheduleTableSync}
              onAddSelectedTablesToChat={() => void addSelectedTablesToChat()}
              onToggleAllVisibleFiles={toggleAllVisibleFiles}
              onSelectFileRow={handleFileRowSelect}
              onToggleAllVisibleTables={toggleAllVisibleTables}
              onSelectTableRow={handleTableRowSelect}
            />
          </div>
        </div>
      )}

      {preview && !serverUnavailable && (
        <RawTablePreviewDialog
          tableKind="raw"
          title={preview.name}
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
