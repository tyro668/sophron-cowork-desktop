import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  Eye,
  FolderKanban,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Table2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import type {
  DataInputTablePreview,
  PersonalAnalysisConfig,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../types';
import {
  EMPTY_PERSONAL_ANALYSIS_CONFIG,
  getPersonalAnalysisErrorMessage,
} from '../../shared/personal-analysis';

interface SelectedProject {
  spaceId: string;
  projectId: string;
}

interface NoticeState {
  type: 'success' | 'error' | 'info';
  message: string;
  inputTableId?: string;
}

interface PreviewState {
  table: PersonalAnalysisTable;
  loading: boolean;
  error: string | null;
  data: DataInputTablePreview | null;
}

function formatCount(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat().format(value);
}

function valueText(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function CloudDataView() {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projectsBySpace, setProjectsBySpace] = useState<Record<string, PersonalAnalysisProject[]>>(
    {}
  );
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [importingTableId, setImportingTableId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const catalogRequestSeq = useRef(0);
  const tableRequestSeq = useRef(0);
  const previewRequestSeq = useRef(0);
  const importRequestSeq = useRef(0);
  const selectedProjectRef = useRef<SelectedProject | null>(null);

  const storedConnection = useMemo(
    () => appConfig?.personalAnalysis || EMPTY_PERSONAL_ANALYSIS_CONFIG,
    [appConfig?.personalAnalysis]
  );
  const isConnected = Boolean(storedConnection.apiOrigin && storedConnection.apiKey);
  const connectionLabel = storedConnection.apiOrigin || t('cloudData.notConnected');

  const connectionPayload = useMemo(
    () => ({
      apiOrigin: storedConnection.apiOrigin,
      apiKey: storedConnection.apiKey,
    }),
    [storedConnection.apiKey, storedConnection.apiOrigin]
  );

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  const selectedSpace = spaces.find((space) => space.spaceId === selectedProject?.spaceId) ?? null;
  const selectedProjectRecord =
    selectedProject && projectsBySpace[selectedProject.spaceId]
      ? (projectsBySpace[selectedProject.spaceId].find(
          (project) => project.projectId === selectedProject.projectId
        ) ?? null)
      : null;

  const filteredTables = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tables;
    return tables.filter((table) =>
      [table.tableName, table.tableId, table.sheetId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [searchQuery, tables]);

  const openSettings = useCallback(() => {
    setSettingsTab('personal-analysis');
    setShowSettings(true);
  }, [setSettingsTab, setShowSettings]);

  const loadTables = useCallback(
    async (
      target: SelectedProject,
      connection: Pick<PersonalAnalysisConfig, 'apiOrigin' | 'apiKey'> = connectionPayload
    ) => {
      if (!window.electronAPI?.data) return;
      const requestId = ++tableRequestSeq.current;
      setLoadingTables(true);
      try {
        const result = await window.electronAPI.data.listCloudTables({
          ...connection,
          spaceId: target.spaceId,
          projectId: target.projectId,
        });
        if (requestId !== tableRequestSeq.current) return;
        setTables(result.tables);
      } catch (error) {
        if (requestId !== tableRequestSeq.current) return;
        setTables([]);
        setNotice({
          type: 'error',
          message: getPersonalAnalysisErrorMessage(error, t),
        });
      } finally {
        if (requestId === tableRequestSeq.current) {
          setLoadingTables(false);
        }
      }
    },
    [connectionPayload, t]
  );

  const loadCatalog = useCallback(
    async (
      options: {
        announceSuccess?: boolean;
        connection?: Pick<PersonalAnalysisConfig, 'apiOrigin' | 'apiKey'>;
      } = {}
    ) => {
      const connection = options.connection ?? connectionPayload;
      if (!window.electronAPI?.data || !connection.apiOrigin || !connection.apiKey) return;
      const requestId = ++catalogRequestSeq.current;
      setLoadingCatalog(true);
      setNotice(null);
      try {
        const spaceResult = await window.electronAPI.data.listCloudSpaces(connection);
        const nextSpaces = spaceResult.spaces;
        const projectEntries = await Promise.all(
          nextSpaces.map(async (space) => {
            const result = await window.electronAPI.data.listCloudProjects({
              ...connection,
              spaceId: space.spaceId,
            });
            return [space.spaceId, result.projects] as const;
          })
        );
        if (requestId !== catalogRequestSeq.current) return;
        const nextProjectsBySpace = Object.fromEntries(projectEntries);
        const currentSelectedProject = selectedProjectRef.current;
        const nextSelected =
          currentSelectedProject &&
          nextProjectsBySpace[currentSelectedProject.spaceId]?.some(
            (project) => project.projectId === currentSelectedProject.projectId
          )
            ? currentSelectedProject
            : (nextSpaces.map((space) => nextProjectsBySpace[space.spaceId]?.[0]).find(Boolean) ??
              null);

        setSpaces(nextSpaces);
        setProjectsBySpace(nextProjectsBySpace);
        setSelectedProject(
          nextSelected
            ? {
                spaceId: nextSelected.spaceId,
                projectId: nextSelected.projectId,
              }
            : null
        );

        const projectCount = projectEntries.reduce(
          (count, [, projects]) => count + projects.length,
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
        if (nextSelected) {
          if (requestId !== catalogRequestSeq.current) return;
          await loadTables(
            { spaceId: nextSelected.spaceId, projectId: nextSelected.projectId },
            connection
          );
        } else {
          tableRequestSeq.current += 1;
          setLoadingTables(false);
          setTables([]);
        }
      } catch (error) {
        if (requestId !== catalogRequestSeq.current) return;
        setSpaces([]);
        setProjectsBySpace({});
        setTables([]);
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
    [connectionPayload, loadTables, t]
  );

  useEffect(() => {
    previewRequestSeq.current += 1;
    importRequestSeq.current += 1;
    setPreview(null);
    setImportingTableId(null);

    if (connectionPayload.apiOrigin && connectionPayload.apiKey) {
      setSpaces([]);
      setProjectsBySpace({});
      setSelectedProject(null);
      setTables([]);
      setSearchQuery('');
      void loadCatalog({ connection: connectionPayload });
      return;
    }

    catalogRequestSeq.current += 1;
    tableRequestSeq.current += 1;
    setLoadingCatalog(false);
    setLoadingTables(false);
    setSpaces([]);
    setProjectsBySpace({});
    setSelectedProject(null);
    setTables([]);
  }, [connectionPayload, loadCatalog]);

  const selectProject = useCallback(
    (target: SelectedProject) => {
      setSelectedProject(target);
      setSearchQuery('');
      void loadTables(target);
    },
    [loadTables]
  );

  const previewTable = useCallback(
    async (table: PersonalAnalysisTable) => {
      if (!window.electronAPI?.data) return;
      const requestId = ++previewRequestSeq.current;
      setPreview({ table, loading: true, error: null, data: null });
      try {
        const result = await window.electronAPI.data.previewCloudTable({
          ...connectionPayload,
          tableId: table.tableId,
          limit: 20,
          offset: 0,
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
      if (!window.electronAPI?.data || !selectedProject) return;
      const requestId = ++importRequestSeq.current;
      setImportingTableId(table.tableId);
      try {
        const result = await window.electronAPI.data.importCloudTable({
          ...connectionPayload,
          tableId: table.tableId,
          spaceId: selectedProject.spaceId,
          projectId: selectedProject.projectId,
          name: table.tableName,
          previewRows: 20,
        });
        if (requestId !== importRequestSeq.current) return;
        previewRequestSeq.current += 1;
        setPreview(null);
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

  const closePreview = useCallback(() => {
    previewRequestSeq.current += 1;
    setPreview(null);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div className="flex h-12 flex-shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-background/28 px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          <Cloud className="h-4 w-4 flex-shrink-0 text-accent-text" />
          <h2 className="truncate text-[16px] font-semibold text-text-primary">
            {t('cloudData.title')}
          </h2>
          {isConnected && (
            <span className="truncate text-[12px] font-medium text-text-muted">
              {t('cloudData.connectedTo', { host: connectionLabel })}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {isConnected && (
            <>
              <button
                type="button"
                onClick={() => void loadCatalog()}
                disabled={loadingCatalog}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/60 px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingCatalog ? 'animate-spin' : ''}`} />
                {t('common.refresh')}
              </button>
              <button
                type="button"
                onClick={openSettings}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/60 px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                <Settings className="h-3.5 w-3.5" />
                {t('cloudData.manageConnection')}
              </button>
            </>
          )}
        </div>
      </div>

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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="max-w-[760px] rounded-xl border border-border-subtle bg-background/62 px-5 py-4 shadow-soft">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-text">
                <Cloud className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-semibold text-text-primary">
                  {t('cloudData.connectTitle')}
                </h3>
                <p className="mt-1 max-w-[560px] text-[13px] leading-5 text-text-secondary">
                  {t('cloudData.connectDescription')}
                </p>
                <div className="mt-3 grid gap-1.5 text-[13px] text-text-secondary sm:grid-cols-2">
                  {[
                    t('cloudData.valueBrowseSpaces'),
                    t('cloudData.valuePreviewTables'),
                    t('cloudData.valueImportInput'),
                    t('cloudData.valueUseInTasks'),
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={openSettings}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover"
                >
                  <Settings className="h-4 w-4" />
                  {t('cloudData.startConnect')}
                </button>
              </div>
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
            <div className="h-[calc(100%-2.5rem)] overflow-y-auto p-2">
              {spaces.length === 0 && !loadingCatalog ? (
                <div className="px-2 py-6 text-[13px] text-text-muted">
                  <div>{t('cloudData.noSpaces')}</div>
                  <button
                    type="button"
                    onClick={() => void loadCatalog()}
                    className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent/10"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('cloudData.refreshTables')}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {spaces.map((space) => {
                    const projects = projectsBySpace[space.spaceId] ?? [];
                    const projectCount = projects.length || space.projectCount || 0;

                    return (
                      <section key={space.spaceId} className="space-y-1">
                        <div className="flex items-center gap-2 px-2 py-1.5">
                          <Database className="h-3.5 w-3.5 flex-shrink-0 text-accent-text" />
                          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary">
                            {space.spaceName}
                          </span>
                          <span className="flex-shrink-0 text-[11px] font-medium text-text-muted">
                            {t('cloudData.projectCount', { count: projectCount })}
                          </span>
                        </div>
                        <div className="ml-[15px] space-y-0.5 border-l border-border-subtle pl-2">
                          {projects.length === 0 ? (
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
                  {selectedProjectRecord?.projectName ?? t('cloudData.selectProject')}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
                  <span className="min-w-0 truncate">
                    {selectedSpace?.spaceName ?? t('cloudData.tableList')}
                  </span>
                  {selectedProject && (
                    <span className="flex-shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent-text">
                      {t('cloudData.tableCount', { count: tables.length })}
                    </span>
                  )}
                </div>
              </div>
              <div className="relative w-[240px] flex-shrink-0">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('cloudData.searchTables')}
                  className="h-8 w-full rounded-lg border border-border-muted bg-background/72 pl-8 pr-3 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-[var(--data-grid-header-surface)] text-[12px] font-medium text-text-secondary">
                  <tr className="h-10 border-b border-border-subtle">
                    <th className="w-[42%] px-3">{t('cloudData.tableName')}</th>
                    <th className="w-[14%] px-3">{t('cloudData.rows')}</th>
                    <th className="w-[14%] px-3">{t('cloudData.columns')}</th>
                    <th className="w-[30%] px-3 text-right">{t('cloudData.actions')}</th>
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
                  ) : filteredTables.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="h-28 px-3 text-center text-text-muted">
                        <div>{t('cloudData.noTables')}</div>
                        {selectedProject && (
                          <button
                            type="button"
                            onClick={() => void loadTables(selectedProject)}
                            className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent/10"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            {t('cloudData.refreshTables')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredTables.map((table) => (
                      <tr
                        key={table.tableId}
                        className="h-[52px] transition-colors hover:bg-surface-hover/60"
                      >
                        <td className="px-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Table2 className="h-4 w-4 flex-shrink-0 text-accent-text" />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-text-primary">
                                {table.tableName}
                              </div>
                              <div className="truncate text-[11px] text-text-muted">
                                {table.tableId}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 text-text-secondary">{formatCount(table.rowCount)}</td>
                        <td className="px-3 text-text-secondary">
                          {formatCount(table.columns?.length)}
                        </td>
                        <td className="px-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void previewTable(table)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/60 px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {t('cloudData.preview')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void importTable(table)}
                              disabled={importingTableId === table.tableId}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {preview && (
        <PreviewDialog
          preview={preview}
          importing={importingTableId === preview.table.tableId}
          onClose={closePreview}
          onImport={() => void importTable(preview.table)}
        />
      )}
    </div>
  );
}

function PreviewDialog({
  preview,
  importing,
  onClose,
  onImport,
}: {
  preview: PreviewState;
  importing: boolean;
  onClose: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  const columns = preview.data?.columns ?? preview.table.columns ?? [];
  const sampleRow = preview.data?.rows[0] ?? {};
  const rows = preview.data?.rows ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/18 px-5 py-5 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-[980px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-background shadow-elevated">
        <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-subtle px-4">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-text-primary">
              {t('cloudData.previewTitle', { name: preview.table.tableName })}
            </div>
            <div className="truncate text-[11px] text-text-muted">{preview.table.tableId}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {preview.loading ? (
            <div className="flex h-52 flex-col items-center justify-center text-[13px] text-text-muted">
              <Loader2 className="mb-2 h-5 w-5 animate-spin" />
              {t('cloudData.previewLoading')}
            </div>
          ) : preview.error ? (
            <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-[13px] text-error">
              {preview.error}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                <InfoCell label={t('cloudData.tableId')} value={preview.table.tableId} />
                <InfoCell label={t('cloudData.rows')} value={formatCount(preview.table.rowCount)} />
                <InfoCell label={t('cloudData.columns')} value={formatCount(columns.length)} />
                <InfoCell
                  label={t('cloudData.previewRows')}
                  value={formatCount(preview.data?.rows.length)}
                />
              </div>

              <section>
                <h4 className="mb-2 text-[12px] font-semibold text-text-secondary">
                  {t('cloudData.fields')}
                </h4>
                <div className="overflow-hidden rounded-lg border border-border-subtle">
                  <table className="w-full table-fixed text-left text-[12px]">
                    <thead className="bg-[var(--data-grid-header-surface)] text-text-secondary">
                      <tr className="h-9 border-b border-border-subtle">
                        <th className="w-1/2 px-3">{t('cloudData.fieldName')}</th>
                        <th className="w-1/2 px-3">{t('cloudData.exampleValue')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {columns.map((column) => (
                        <tr key={column} className="h-9">
                          <td className="px-3 font-medium text-text-primary">{column}</td>
                          <td className="truncate px-3 text-text-secondary">
                            {valueText(sampleRow[column])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-[12px] font-semibold text-text-secondary">
                  {t('cloudData.dataPreview')}
                </h4>
                <div className="overflow-auto rounded-lg border border-border-subtle">
                  <table className="w-full min-w-[720px] table-fixed text-left text-[12px]">
                    <thead className="bg-[var(--data-grid-header-surface)] text-text-secondary">
                      <tr className="h-9 border-b border-border-subtle">
                        {columns.map((column) => (
                          <th key={column} className="w-[160px] px-3">
                            <span className="block truncate">{column}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {rows.map((row, index) => (
                        <tr key={index} className="h-9 hover:bg-surface-hover/60">
                          {columns.map((column) => (
                            <td key={column} className="truncate px-3 text-text-secondary">
                              {valueText(row[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="flex h-12 flex-shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border-muted bg-background/60 px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={importing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            {t('cloudData.importAsInput')}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-background/54 px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-1 truncate text-[12px] font-medium text-text-primary">{value}</div>
    </div>
  );
}
