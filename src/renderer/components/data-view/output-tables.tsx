import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpDown,
  Cloud,
  Eye,
  LogIn,
  PencilLine,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Settings,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  DataDataset,
  DataOutputTable,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../../types';
import { getPersonalAnalysisErrorMessage } from '../../../shared/personal-analysis';
import { useAppStore } from '../../store';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  InputTableFormLabel,
  InputTableInfo,
  InputTableSelect,
  InputTableStatusBadge,
  LoadingState,
  PaginationFooter,
  formatDateTime,
  formatOutputTableRelatedTaskNames,
} from './shared';

export function OutputTablesPanel({
  outputTables,
  totalOutputTables,
  currentPage,
  searchQuery,
  isLoading,
  actionId,
  isCreateDisabled,
  onCreate,
  onSearchChange,
  onRefresh,
  onPageChange,
  onPreview,
  onUpload,
  onEdit,
  onDelete,
  onDeleteAll,
}: {
  outputTables: DataOutputTable[];
  totalOutputTables: number;
  currentPage: number;
  searchQuery: string;
  isLoading: boolean;
  actionId: string | null;
  isCreateDisabled: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onPreview: (outputTable: DataOutputTable) => void;
  onUpload: (outputTable: DataOutputTable) => void;
  onEdit: (outputTable: DataOutputTable) => void;
  onDelete: (outputTable: DataOutputTable) => void;
  onDeleteAll: () => void;
}) {
  const { t } = useTranslation();
  const [selectedOutputTableId, setSelectedOutputTableId] = useState<string | null>(null);
  const selectedOutputTable =
    outputTables.find((outputTable) => outputTable.id === selectedOutputTableId) ?? null;
  const selectedBusy = selectedOutputTable ? actionId === selectedOutputTable.id : false;
  const bulkBusy = actionId === 'delete-all-output-tables';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (
      selectedOutputTableId &&
      !outputTables.some((outputTable) => outputTable.id === selectedOutputTableId)
    ) {
      setSelectedOutputTableId(null);
    }
  }, [isLoading, outputTables, selectedOutputTableId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            onClick={onCreate}
            disabled={isCreateDisabled || bulkBusy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('data.outputTables.add')}
          </button>
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.outputTables.searchPlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.preview')}
            disabled={!selectedOutputTable || bulkBusy}
            onClick={() => {
              if (selectedOutputTable) {
                onPreview(selectedOutputTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.edit')}
            disabled={!selectedOutputTable || bulkBusy}
            onClick={() => {
              if (selectedOutputTable) {
                onEdit(selectedOutputTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<UploadCloud className="h-3.5 w-3.5" />}
            label={t('data.outputTables.uploadToCloud.action')}
            disabled={!selectedOutputTable || selectedBusy || bulkBusy}
            onClick={() => {
              if (selectedOutputTable) {
                onUpload(selectedOutputTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.delete')}
            disabled={!selectedOutputTable || selectedBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedOutputTable) {
                onDelete(selectedOutputTable);
              }
            }}
          />
          <DataMoreMenu
            items={[
              {
                key: 'refresh',
                label: t('data.actions.refresh'),
                icon: <RefreshCw className="h-3.5 w-3.5" />,
                disabled: bulkBusy,
                onClick: onRefresh,
              },
              {
                key: 'delete-all',
                label: t('data.actions.deleteAll'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                disabled: totalOutputTables <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>

      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.outputTables.loading')} />
          ) : outputTables.length === 0 ? (
            <EmptyState label={t('data.outputTables.empty')} />
          ) : (
            <div className="min-w-full overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
                    <th className="w-[4%] px-4">
                      <span className="sr-only">{t('data.outputTables.selection')}</span>
                    </th>
                    <th className="w-[34%] whitespace-nowrap px-2">
                      {t('data.columns.outputTableName')}
                    </th>
                    <th className="w-[30%] whitespace-nowrap px-2">
                      {t('data.columns.relatedTasks')}
                    </th>
                    <th className="w-[18%] whitespace-nowrap px-2">
                      <span className="inline-flex items-center gap-1">
                        {t('data.columns.updatedAt')}
                        <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </th>
                    <th className="w-[14%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {outputTables.map((outputTable, index) => {
                    const selected = outputTable.id === selectedOutputTableId;
                    return (
                      <tr
                        key={outputTable.id}
                        onClick={() => setSelectedOutputTableId(outputTable.id)}
                        onDoubleClick={() => onEdit(outputTable)}
                        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                          selected
                            ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                            : index === 1
                              ? 'bg-accent/5'
                              : 'hover:bg-surface-hover/35'
                        }`}
                      >
                        <td className="px-4">
                          <input
                            type="radio"
                            name="output-table-selection"
                            checked={selected}
                            onChange={() => setSelectedOutputTableId(outputTable.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-3.5 w-3.5 accent-accent"
                            aria-label={outputTable.name}
                          />
                        </td>
                        <td className="px-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                              <UploadCloud className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
                              {outputTable.name}
                            </div>
                          </div>
                        </td>
                        <td className="px-2">
                          <div className="truncate text-[13px] font-medium text-text-secondary">
                            {formatOutputTableRelatedTaskNames(outputTable, t)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                          {formatDateTime(outputTable.updatedAt)}
                        </td>
                        <td className="px-2">
                          <InputTableStatusBadge
                            label={t('data.outputTables.status.available')}
                            tone="success"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <PaginationFooter
          count={totalOutputTables}
          currentPage={currentPage}
          onPageChange={onPageChange}
          embedded
        />
      </div>
    </div>
  );
}

export function UploadOutputTableToCloudDialog({
  outputTable,
  onClose,
}: {
  outputTable: DataOutputTable;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const setDesktopAuthStatus = useAppStore((state) => state.setDesktopAuthStatus);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projects, setProjects] = useState<PersonalAnalysisProject[]>([]);
  const [cloudTables, setCloudTables] = useState<PersonalAnalysisTable[]>([]);
  const [spaceId, setSpaceId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [targetTableId, setTargetTableId] = useState('');
  const [writeMode, setWriteMode] = useState<'CREATE' | 'REPLACE'>('CREATE');
  const [tableName, setTableName] = useState(outputTable.name);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const spaceRequestSeq = useRef(0);
  const projectRequestSeq = useRef(0);
  const tableRequestSeq = useRef(0);
  const storedConnection = appConfig?.personalAnalysis;
  const hasStoredConnection = Boolean(storedConnection?.apiOrigin && storedConnection?.apiKey);
  const hasDesktopAuthConnection = Boolean(
    desktopAuthStatus.authenticated && desktopAuthStatus.apiOrigin
  );
  const hasCloudConnection = hasStoredConnection || hasDesktopAuthConnection;
  const authDisplayName =
    desktopAuthStatus.user?.displayName?.trim() ||
    desktopAuthStatus.user?.username?.trim() ||
    desktopAuthStatus.user?.userId?.trim() ||
    t('data.outputTables.uploadToCloud.currentAccount');
  const accessModeLabel = hasStoredConnection
    ? desktopAuthStatus.authenticated
      ? t('data.outputTables.uploadToCloud.apiKeyModeWithAccount', { account: authDisplayName })
      : t('data.outputTables.uploadToCloud.apiKeyMode')
    : t('data.outputTables.uploadToCloud.accountMode', { account: authDisplayName });
  const connectionLabel =
    storedConnection?.apiOrigin || desktopAuthStatus.apiOrigin || t('cloudData.notConnected');

  const openApiKeySettings = useCallback(() => {
    setSettingsTab('personal-analysis');
    setShowSettings(true);
    onClose();
  }, [onClose, setSettingsTab, setShowSettings]);

  const handleLoginAndContinue = useCallback(async () => {
    if (!window.electronAPI?.auth || loginBusy) return;

    setLoginBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const status = await window.electronAPI.auth.login();
      setDesktopAuthStatus(status);
      if (!status.authenticated) {
        setError(t('data.outputTables.uploadToCloud.loginNotCompleted'));
      }
    } catch (err) {
      const isCancelled = err instanceof Error && err.message === 'Login cancelled';
      setError(
        isCancelled
          ? t('data.outputTables.uploadToCloud.loginCancelled')
          : err instanceof Error
            ? err.message
            : t('data.outputTables.uploadToCloud.loginFailed')
      );
    } finally {
      setLoginBusy(false);
    }
  }, [loginBusy, setDesktopAuthStatus, t]);

  useEffect(() => {
    const requestId = ++spaceRequestSeq.current;
    const loadSpaces = async () => {
      if (!hasCloudConnection || !window.electronAPI?.data?.listCloudSpaces) {
        setSpaces([]);
        setSpaceId('');
        return;
      }
      setLoadingSpaces(true);
      setError(null);
      try {
        const result = await window.electronAPI.data.listCloudSpaces({});
        if (requestId !== spaceRequestSeq.current) return;
        setSpaces(result.spaces);
        const firstSpace = result.spaces[0];
        setSpaceId(firstSpace?.spaceId ?? '');
      } catch (err) {
        if (requestId === spaceRequestSeq.current) {
          setError(getPersonalAnalysisErrorMessage(err, t));
        }
      } finally {
        if (requestId === spaceRequestSeq.current) {
          setLoadingSpaces(false);
        }
      }
    };

    void loadSpaces();
    return () => {
      if (requestId === spaceRequestSeq.current) {
        spaceRequestSeq.current += 1;
      }
    };
  }, [hasCloudConnection, t]);

  useEffect(() => {
    const requestId = ++projectRequestSeq.current;
    const loadProjects = async () => {
      if (!spaceId || !window.electronAPI?.data?.listCloudProjects) {
        setProjects([]);
        setProjectId('');
        return;
      }
      setLoadingProjects(true);
      setError(null);
      try {
        const result = await window.electronAPI.data.listCloudProjects({ spaceId });
        if (requestId !== projectRequestSeq.current) return;
        setProjects(result.projects);
        setProjectId((current) =>
          result.projects.some((project) => project.projectId === current)
            ? current
            : (result.projects[0]?.projectId ?? '')
        );
      } catch (err) {
        if (requestId === projectRequestSeq.current) {
          setProjects([]);
          setProjectId('');
          setError(getPersonalAnalysisErrorMessage(err, t));
        }
      } finally {
        if (requestId === projectRequestSeq.current) {
          setLoadingProjects(false);
        }
      }
    };

    void loadProjects();
    return () => {
      if (requestId === projectRequestSeq.current) {
        projectRequestSeq.current += 1;
      }
    };
  }, [spaceId, t]);

  useEffect(() => {
    const requestId = ++tableRequestSeq.current;
    const loadTables = async () => {
      if (!spaceId || !projectId || !window.electronAPI?.data?.listCloudTables) {
        setCloudTables([]);
        setTargetTableId('');
        return;
      }
      setLoadingTables(true);
      if (writeMode === 'REPLACE') {
        setError(null);
      }
      try {
        const result = await window.electronAPI.data.listCloudTables({ spaceId, projectId });
        if (requestId !== tableRequestSeq.current) return;
        setCloudTables(result.tables);
        setTargetTableId((current) =>
          result.tables.some((table) => table.tableId === current)
            ? current
            : (result.tables[0]?.tableId ?? '')
        );
      } catch (err) {
        if (requestId === tableRequestSeq.current) {
          setCloudTables([]);
          setTargetTableId('');
          if (writeMode === 'REPLACE') {
            setError(getPersonalAnalysisErrorMessage(err, t));
          }
        }
      } finally {
        if (requestId === tableRequestSeq.current) {
          setLoadingTables(false);
        }
      }
    };

    void loadTables();
    return () => {
      if (requestId === tableRequestSeq.current) {
        tableRequestSeq.current += 1;
      }
    };
  }, [projectId, spaceId, t, writeMode]);

  useEffect(() => {
    setTableName(outputTable.name);
    setTargetTableId('');
    setWriteMode('CREATE');
    setSuccess(null);
    setError(null);
  }, [outputTable.id, outputTable.name]);

  const selectedProject = projects.find((project) => project.projectId === projectId) ?? null;
  const selectedCloudTable = cloudTables.find((table) => table.tableId === targetTableId) ?? null;
  const resolvedTableName =
    writeMode === 'REPLACE'
      ? tableName.trim() || selectedCloudTable?.tableName || outputTable.name
      : tableName.trim();
  const canUpload = Boolean(
    spaceId &&
    projectId &&
    resolvedTableName &&
    !uploading &&
    (writeMode === 'CREATE' || targetTableId)
  );

  const handleUpload = async () => {
    if (!window.electronAPI?.data?.uploadDataTableToCloud || !canUpload) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.electronAPI.data.uploadDataTableToCloud({
        tableKind: 'output',
        id: outputTable.id,
        writeMode,
        spaceId,
        projectId,
        folderId: selectedProject?.folderId,
        tableId: writeMode === 'REPLACE' ? targetTableId : undefined,
        tableName: resolvedTableName,
        waitForDone: true,
      });
      setSuccess(
        t(
          writeMode === 'REPLACE'
            ? 'data.outputTables.uploadToCloud.replaceSuccess'
            : 'data.outputTables.uploadToCloud.success',
          {
            name: resolvedTableName,
            tableId: result.upload.tableId,
          }
        )
      );
    } catch (err) {
      setError(getPersonalAnalysisErrorMessage(err, t));
    } finally {
      setUploading(false);
    }
  };

  if (!hasCloudConnection) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/18 px-5 py-5 backdrop-blur-sm">
        <div className="flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-background shadow-elevated">
          <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-subtle px-4">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-text-primary">
                {t('data.outputTables.uploadToCloud.connectTitle')}
              </div>
              <div className="truncate text-[11px] text-text-muted">
                {t('data.outputTables.uploadToCloud.connectSubtitle', {
                  name: outputTable.name,
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 px-4 py-4">
            <InputTableInfo>{t('data.outputTables.uploadToCloud.connectInfo')}</InputTableInfo>

            <div className="rounded-lg border border-border-subtle bg-surface/35 px-3 py-3">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Cloud className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-text-primary">
                    {t('data.outputTables.uploadToCloud.connectPrimaryTitle')}
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-text-muted">
                    {t('data.outputTables.uploadToCloud.connectPrimaryDescription')}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-[13px] text-error">
                {error}
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 flex-col gap-2 border-t border-border-subtle px-4 py-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={openApiKeySettings}
              disabled={loginBusy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/60 px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Settings className="h-3.5 w-3.5" />
              {t('data.outputTables.uploadToCloud.connectWithApiKey')}
            </button>
            <button
              type="button"
              onClick={() => void handleLoginAndContinue()}
              disabled={loginBusy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginBusy ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogIn className="h-3.5 w-3.5" />
              )}
              {loginBusy
                ? t('data.outputTables.uploadToCloud.loggingIn')
                : t('data.outputTables.uploadToCloud.loginAndContinue')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/18 px-5 py-5 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-background shadow-elevated">
        <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-subtle px-4">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-text-primary">
              {t('data.outputTables.uploadToCloud.title')}
            </div>
            <div className="truncate text-[11px] text-text-muted">
              {t('data.outputTables.uploadToCloud.accessMode', {
                mode: accessModeLabel,
                host: connectionLabel,
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <InputTableInfo>{t('data.outputTables.uploadToCloud.info')}</InputTableInfo>
          <div className="rounded-lg border border-border-subtle bg-surface/35 px-3 py-2 text-[12px] leading-5 text-text-secondary">
            <div className="font-medium text-text-primary">
              {t('data.outputTables.uploadToCloud.accessIdentity')}
            </div>
            <div className="mt-1 text-text-muted">
              {t('data.outputTables.uploadToCloud.accessMode', {
                mode: accessModeLabel,
                host: connectionLabel,
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <InputTableFormLabel>
                {t('data.outputTables.uploadToCloud.space')}
              </InputTableFormLabel>
              <InputTableSelect
                value={spaceId}
                disabled={loadingSpaces || uploading || spaces.length === 0}
                onChange={setSpaceId}
                options={
                  spaces.length
                    ? spaces.map((space) => ({ value: space.spaceId, label: space.spaceName }))
                    : [{ value: '', label: t('data.outputTables.uploadToCloud.noSpaces') }]
                }
              />
            </label>

            <label className="space-y-1.5">
              <InputTableFormLabel>
                {t('data.outputTables.uploadToCloud.project')}
              </InputTableFormLabel>
              <InputTableSelect
                value={projectId}
                disabled={loadingProjects || uploading || projects.length === 0}
                onChange={setProjectId}
                options={
                  projects.length
                    ? projects.map((project) => ({
                        value: project.projectId,
                        label: project.projectName,
                      }))
                    : [{ value: '', label: t('data.outputTables.uploadToCloud.noProjects') }]
                }
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <InputTableFormLabel>
              {t('data.outputTables.uploadToCloud.writeMode')}
            </InputTableFormLabel>
            <div className="inline-flex rounded-lg border border-border-muted/55 bg-background/24 p-0.5">
              {(['CREATE', 'REPLACE'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setWriteMode(mode);
                    setSuccess(null);
                    setError(null);
                  }}
                  disabled={uploading}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    writeMode === mode
                      ? 'bg-background/80 text-accent shadow-soft'
                      : 'text-text-muted hover:bg-background/30 hover:text-text-secondary'
                  }`}
                >
                  {mode === 'CREATE' ? (
                    <Plus className="h-3.5 w-3.5" />
                  ) : (
                    <Repeat2 className="h-3.5 w-3.5" />
                  )}
                  {t(
                    mode === 'CREATE'
                      ? 'data.outputTables.uploadToCloud.writeModeCreateShort'
                      : 'data.outputTables.uploadToCloud.writeModeReplaceShort'
                  )}
                </button>
              ))}
            </div>
          </div>

          {writeMode === 'REPLACE' && (
            <label className="block space-y-1.5">
              <InputTableFormLabel>
                {t('data.outputTables.uploadToCloud.targetTable')}
              </InputTableFormLabel>
              <InputTableSelect
                value={targetTableId}
                disabled={loadingTables || uploading || cloudTables.length === 0}
                onChange={(value) => {
                  setTargetTableId(value);
                  const target = cloudTables.find((table) => table.tableId === value);
                  if (target) {
                    setTableName(target.tableName);
                  }
                }}
                options={
                  cloudTables.length
                    ? cloudTables.map((table) => ({
                        value: table.tableId,
                        label: `${table.tableName} · ${table.tableId}`,
                      }))
                    : [{ value: '', label: t('data.outputTables.uploadToCloud.noTables') }]
                }
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <InputTableFormLabel>
              {t('data.outputTables.uploadToCloud.tableName')}
            </InputTableFormLabel>
            <input
              value={tableName}
              disabled={uploading}
              onChange={(event) => setTableName(event.target.value)}
              className="h-10 w-full rounded-lg border border-border-muted bg-background/50 px-3 text-[13px] font-medium text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
              placeholder={t('data.outputTables.uploadToCloud.tableNamePlaceholder')}
            />
          </label>

          <div className="rounded-lg border border-border-subtle bg-surface/35 px-3 py-2 text-[12px] text-text-secondary">
            <div className="font-medium text-text-primary">
              {t(
                writeMode === 'REPLACE'
                  ? 'data.outputTables.uploadToCloud.writeModeReplace'
                  : 'data.outputTables.uploadToCloud.writeModeCreate'
              )}
            </div>
            <div className="mt-1 text-text-muted">
              {t(
                writeMode === 'REPLACE'
                  ? 'data.outputTables.uploadToCloud.writeModeReplaceHint'
                  : 'data.outputTables.uploadToCloud.writeModeCreateHint'
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-[13px] text-error">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-success/25 bg-accent/10 px-3 py-2 text-[13px] text-success">
              {success}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="inline-flex h-8 items-center rounded-lg border border-border-muted bg-background/60 px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={!canUpload}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadCloud className="h-3.5 w-3.5" />
            )}
            {uploading
              ? t('data.outputTables.uploadToCloud.uploading')
              : t('data.outputTables.uploadToCloud.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OutputTableEditor({
  outputTable,
  inputTables,
  isInputTablesLoading,
  isBusy,
  onBack,
  onSave,
}: {
  outputTable: DataOutputTable;
  inputTables: DataDataset[];
  isInputTablesLoading: boolean;
  isBusy: boolean;
  onBack: () => void;
  onSave: (
    outputTable: DataOutputTable,
    name: string,
    sourceDatasetId: string | null
  ) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [localName, setLocalName] = useState(outputTable.name);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [sourceDatasetId, setSourceDatasetId] = useState(outputTable.sourceDatasetId ?? '');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedName = localName.trim();
  const canSave = Boolean(
    trimmedName &&
    !isBusy &&
    (trimmedName !== outputTable.name || (sourceDatasetId || null) !== outputTable.sourceDatasetId)
  );
  const inputTableOptions = useMemo(() => {
    const options = inputTables.map((dataset) => ({
      value: dataset.id,
      label: dataset.name,
    }));
    if (sourceDatasetId && !options.some((option) => option.value === sourceDatasetId)) {
      options.unshift({ value: sourceDatasetId, label: sourceDatasetId });
    }
    const emptyLabel = isInputTablesLoading
      ? t('data.outputTables.editor.loadingInputTables')
      : t('data.outputTables.editor.noInputTable');
    return [{ value: '', label: emptyLabel }, ...options];
  }, [inputTables, isInputTablesLoading, sourceDatasetId, t]);

  useEffect(() => {
    setLocalName(outputTable.name);
    setIsNameEditing(false);
    setSourceDatasetId(outputTable.sourceDatasetId ?? '');
  }, [outputTable.id, outputTable.name, outputTable.sourceDatasetId]);

  useEffect(() => {
    if (!isNameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isNameEditing]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.outputTables.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <InputTableStatusBadge label={t('data.outputTables.status.available')} tone="success" />
            {isNameEditing ? (
              <input
                ref={nameInputRef}
                value={localName}
                onChange={(event) => setLocalName(event.target.value)}
                onBlur={() => setIsNameEditing(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setLocalName(outputTable.name);
                    setIsNameEditing(false);
                  }
                }}
                disabled={isBusy}
                maxLength={50}
                aria-label={t('data.outputTables.editor.name')}
                className="h-8 min-w-0 max-w-[18rem] truncate border-0 bg-transparent px-0 text-[15px] font-medium text-text-secondary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={t('data.outputTables.editor.title')}
              />
            ) : (
              <div
                className="flex h-8 min-w-0 max-w-[18rem] items-center truncate text-[15px] font-medium text-text-secondary"
                title={localName || t('data.outputTables.editor.title')}
              >
                {localName || t('data.outputTables.editor.title')}
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsNameEditing(true)}
              disabled={isBusy || isNameEditing}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('common.edit')}
              title={t('common.edit')}
            >
              <PencilLine className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onSave(outputTable, localName, sourceDatasetId || null)}
          disabled={!canSave}
          className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {isBusy ? t('common.saving') : t('common.save')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border-muted bg-surface p-4 shadow-card">
        <div className="grid gap-5 lg:grid-cols-[8rem_minmax(0,1fr)] lg:items-center">
          <InputTableFormLabel>{t('data.outputTables.editor.inputTable')}</InputTableFormLabel>
          <InputTableSelect
            value={sourceDatasetId}
            options={inputTableOptions}
            disabled={isBusy || isInputTablesLoading}
            onChange={setSourceDatasetId}
          />

          <div className="lg:col-start-2">
            <InputTableInfo>{t('data.outputTables.editor.inputTableInfo')}</InputTableInfo>
          </div>
        </div>
      </div>
    </section>
  );
}
