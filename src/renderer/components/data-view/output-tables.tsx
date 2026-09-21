import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpDown,
  Eye,
  FolderSync,
  Info,
  LogIn,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Settings,
  Trash2,
  Unlink,
  UploadCloud,
} from 'lucide-react';
import type {
  CloudOutputAction,
  CloudOutputActionSpec,
  CloudOutputActionTrigger,
  CloudOutputActionType,
  DataDataset,
  DataOutputTable,
  PersonalAnalysisDriveFile,
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
  InputTableSelect,
  InputTableStatusBadge,
  LoadingState,
  PaginationFooter,
  formatDateTime,
  formatOutputTableRelatedTaskNames,
} from './shared';
import { dataClient } from '../../features/data/api/data-client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { GlassSelect } from '../GlassSelect';

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
          {(isLoading || outputTables.length > 0 || searchQuery.trim()) && (
            <button
              onClick={onCreate}
              disabled={isCreateDisabled || bulkBusy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('data.outputTables.add')}
            </button>
          )}
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
            <EmptyState
              label={t('data.outputTables.empty')}
              description={t(
                searchQuery.trim() ? 'workspaceEmpty.searchHint' : 'workspaceEmpty.outputTablesHint'
              )}
              action={
                searchQuery.trim() ? (
                  <Button variant="secondary" onClick={() => onSearchChange('')}>
                    {t('workspaceEmpty.clearSearch')}
                  </Button>
                ) : (
                  !isCreateDisabled && (
                    <Button variant="primary" onClick={onCreate} className="shadow-soft">
                      <Plus className="h-4 w-4" />
                      {t('data.outputTables.add')}
                    </Button>
                  )
                )
              }
            />
          ) : (
            <div className="min-w-full overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
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
                  {outputTables.map((outputTable) => {
                    const selected = outputTable.id === selectedOutputTableId;
                    return (
                      <tr
                        key={outputTable.id}
                        onClick={() => setSelectedOutputTableId(outputTable.id)}
                        onDoubleClick={() => onEdit(outputTable)}
                        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                          selected
                            ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
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
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
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

const CLOUD_ACTION_INTERVALS = [1, 15, 30, 60, 360, 1440];

function CloudActionOptionGroup<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="flex min-w-0 flex-1 divide-x divide-border-muted overflow-hidden rounded-lg border border-border-muted bg-surface-muted"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            className={`inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 px-3 text-[12px] font-medium transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function useOutputCloudActionForm(outputTable: DataOutputTable, onPersisted?: () => void) {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const setDesktopAuthStatus = useAppStore((state) => state.setDesktopAuthStatus);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const [boundAction, setBoundAction] = useState<CloudOutputAction | null>(
    outputTable.cloudAction ?? null
  );
  const hasCloudConnection = Boolean(
    (appConfig?.personalAnalysis?.apiOrigin && appConfig?.personalAnalysis?.apiKey) ||
    (desktopAuthStatus.authenticated && desktopAuthStatus.apiOrigin)
  );

  const [actionType, setActionType] = useState<CloudOutputActionType>(
    boundAction?.type ?? 'cloud_table'
  );
  const [trigger, setTrigger] = useState<CloudOutputActionTrigger>(
    boundAction?.trigger ?? 'on_change'
  );
  const [intervalMinutes, setIntervalMinutes] = useState(boundAction?.intervalMinutes ?? 60);
  const [spaceId, setSpaceId] = useState(boundAction?.spaceId ?? '');
  const [projectId, setProjectId] = useState(boundAction?.projectId ?? '');
  const [targetFileId, setTargetFileId] = useState(
    boundAction?.type === 'drive_file' ? (boundAction.fileId ?? '') : ''
  );
  const [fileName, setFileName] = useState(boundAction?.fileName ?? `${outputTable.name}.csv`);
  const [writeMode, setWriteMode] = useState<'CREATE' | 'REPLACE'>(
    boundAction?.type === 'cloud_table' && boundAction.tableId ? 'REPLACE' : 'CREATE'
  );
  const [targetTableId, setTargetTableId] = useState(
    boundAction?.type === 'cloud_table' ? (boundAction.tableId ?? '') : ''
  );
  const [tableName, setTableName] = useState(
    boundAction?.type === 'cloud_table' && boundAction.tableName
      ? boundAction.tableName
      : outputTable.name
  );
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projects, setProjects] = useState<PersonalAnalysisProject[]>([]);
  const [driveFiles, setDriveFiles] = useState<PersonalAnalysisDriveFile[]>([]);
  const [cloudTables, setCloudTables] = useState<PersonalAnalysisTable[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const spaceSeq = useRef(0);
  const projectSeq = useRef(0);
  const targetSeq = useRef(0);

  useEffect(() => {
    const action = outputTable.cloudAction ?? null;
    setBoundAction(action);
    setActionType(action?.type ?? 'cloud_table');
    setTrigger(action?.trigger ?? 'on_change');
    setIntervalMinutes(action?.intervalMinutes ?? 60);
    setSpaceId(action?.spaceId ?? '');
    setProjectId(action?.projectId ?? '');
    setTargetFileId(action?.type === 'drive_file' ? (action.fileId ?? '') : '');
    setFileName(action?.fileName ?? `${outputTable.name}.csv`);
    setWriteMode(action?.type === 'cloud_table' && action.tableId ? 'REPLACE' : 'CREATE');
    setTargetTableId(action?.type === 'cloud_table' ? (action.tableId ?? '') : '');
    setTableName(
      action?.type === 'cloud_table' && action.tableName ? action.tableName : outputTable.name
    );
    setError(null);
    setNotice(null);
  }, [outputTable.id, outputTable.cloudAction, outputTable.name]);

  useEffect(() => {
    const requestId = ++spaceSeq.current;
    if (!hasCloudConnection || !dataClient.has('listCloudSpaces')) {
      setSpaces([]);
      return;
    }
    setLoadingSpaces(true);
    dataClient
      .listCloudSpaces({})
      .then((result) => {
        if (requestId !== spaceSeq.current) return;
        setSpaces(result.spaces);
        setSpaceId((current) =>
          result.spaces.some((space) => space.spaceId === current) ? current : ''
        );
      })
      .catch((err) => {
        if (requestId === spaceSeq.current) setError(getPersonalAnalysisErrorMessage(err, t));
      })
      .finally(() => {
        if (requestId === spaceSeq.current) setLoadingSpaces(false);
      });
  }, [hasCloudConnection, t]);

  useEffect(() => {
    const requestId = ++projectSeq.current;
    if (!spaceId || !dataClient.has('listCloudProjects')) {
      setProjects([]);
      return;
    }
    setLoadingProjects(true);
    dataClient
      .listCloudProjects({ spaceId })
      .then((result) => {
        if (requestId !== projectSeq.current) return;
        setProjects(result.projects);
        setProjectId((current) =>
          result.projects.some((project) => project.projectId === current) ? current : ''
        );
      })
      .catch((err) => {
        if (requestId === projectSeq.current) {
          setProjects([]);
          setError(getPersonalAnalysisErrorMessage(err, t));
        }
      })
      .finally(() => {
        if (requestId === projectSeq.current) setLoadingProjects(false);
      });
  }, [spaceId, t]);

  useEffect(() => {
    const requestId = ++targetSeq.current;
    if (!spaceId || !projectId) {
      setDriveFiles([]);
      setCloudTables([]);
      return;
    }
    setLoadingTargets(true);
    const load =
      actionType === 'drive_file'
        ? dataClient
            .listCloudDriveFiles({ spaceId, projectId, fileType: 'csv', page: 1, pageSize: 50 })
            .then((result) => {
              setDriveFiles(result.files.filter((file) => file.fileType === 'csv'));
            })
        : dataClient
            .listCloudTables({ spaceId, projectId, page: 1, pageSize: 50 })
            .then((result) => {
              setCloudTables(result.tables);
            });
    load
      .catch((err) => {
        if (requestId === targetSeq.current) setError(getPersonalAnalysisErrorMessage(err, t));
      })
      .finally(() => {
        if (requestId === targetSeq.current) setLoadingTargets(false);
      });
  }, [actionType, spaceId, projectId, t]);

  const normalizedFileName = useMemo(() => {
    const name = fileName.trim();
    if (!name) return '';
    return name.toLowerCase().endsWith('.csv') ? name : `${name}.csv`;
  }, [fileName]);

  const resolvedTableName =
    writeMode === 'REPLACE'
      ? tableName.trim() ||
        cloudTables.find((table) => table.tableId === targetTableId)?.tableName ||
        outputTable.name
      : tableName.trim();

  const spec = useMemo<CloudOutputActionSpec | null>(() => {
    if (!spaceId || !projectId) return null;
    const base = {
      trigger,
      intervalMinutes: trigger === 'schedule' ? intervalMinutes : undefined,
      spaceId,
      projectId,
    };
    if (actionType === 'drive_file') {
      return {
        ...base,
        type: 'drive_file',
        ...(targetFileId ? { fileId: targetFileId } : {}),
        ...(!targetFileId && normalizedFileName ? { fileName: normalizedFileName } : {}),
      };
    }
    return {
      ...base,
      type: 'cloud_table',
      writeMode,
      ...(writeMode === 'REPLACE' && targetTableId ? { tableId: targetTableId } : {}),
      ...(resolvedTableName ? { tableName: resolvedTableName } : {}),
    };
  }, [
    actionType,
    intervalMinutes,
    normalizedFileName,
    projectId,
    resolvedTableName,
    spaceId,
    targetFileId,
    targetTableId,
    trigger,
    writeMode,
  ]);

  const actionChanged = useMemo(() => {
    if (!spec) return Boolean(boundAction);
    if (!boundAction) return true;
    return (
      boundAction.type !== spec.type ||
      boundAction.trigger !== spec.trigger ||
      (boundAction.intervalMinutes ?? 0) !== (spec.intervalMinutes ?? 0) ||
      boundAction.spaceId !== spec.spaceId ||
      boundAction.projectId !== spec.projectId ||
      (boundAction.fileId ?? '') !== (spec.fileId ?? '') ||
      (!spec.fileId && (boundAction.fileName ?? '') !== (spec.fileName ?? '')) ||
      (boundAction.tableId ?? '') !== (spec.tableId ?? '') ||
      (boundAction.tableName ?? '') !== (spec.tableName ?? '')
    );
  }, [boundAction, spec]);

  const specValid = Boolean(
    spec &&
    (actionType === 'drive_file'
      ? targetFileId || normalizedFileName
      : resolvedTableName && (writeMode === 'CREATE' || targetTableId))
  );

  const applySavedAction = (action: CloudOutputAction | null) => {
    setBoundAction(action);
    if (action?.type === 'drive_file') {
      setTargetFileId(action.fileId ?? '');
      if (action.fileName) setFileName(action.fileName);
    }
    if (action?.type === 'cloud_table') {
      setTargetTableId(action.tableId ?? '');
      if (action.tableName) setTableName(action.tableName);
      if (action.tableId) setWriteMode('REPLACE');
    }
  };

  const saveAction = useCallback(async (): Promise<boolean> => {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const result = await dataClient.setOutputTableCloudAction({
        outputTableId: outputTable.id,
        action: spec,
      });
      applySavedAction(result.outputTable?.cloudAction ?? null);
      onPersisted?.();
      return true;
    } catch (err) {
      setError(getPersonalAnalysisErrorMessage(err, t));
      return false;
    } finally {
      setBusy(null);
    }
  }, [outputTable.id, spec, t, onPersisted]);

  const handleRemove = useCallback(async () => {
    if (busy) return;
    setBusy('remove');
    setError(null);
    setNotice(null);
    try {
      await dataClient.setOutputTableCloudAction({ outputTableId: outputTable.id, action: null });
      setBoundAction(null);
      setSpaceId('');
      setProjectId('');
      setTargetFileId('');
      setTargetTableId('');
      setNotice(t('data.outputTables.cloudAction.removeSuccess'));
      onPersisted?.();
    } catch (err) {
      setError(getPersonalAnalysisErrorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }, [busy, outputTable.id, t, onPersisted]);

  const handleRun = useCallback(async () => {
    if (busy) return;
    setBusy('run');
    setError(null);
    setNotice(null);
    try {
      const result = await dataClient.runOutputTableCloudAction({ outputTableId: outputTable.id });
      applySavedAction(result.outputTable.cloudAction ?? null);
      setNotice(
        t('data.outputTables.cloudAction.runSuccess', { time: formatDateTime(result.ranAt) })
      );
      onPersisted?.();
    } catch (err) {
      setError(getPersonalAnalysisErrorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }, [busy, outputTable.id, t, onPersisted]);

  const handleLogin = useCallback(async () => {
    if (!dataClient.hasAuth() || loginBusy) return;
    setLoginBusy(true);
    setError(null);
    try {
      const status = await dataClient.authLogin();
      setDesktopAuthStatus(status);
      if (!status.authenticated) {
        setError(t('data.outputTables.cloudAction.loginNotCompleted'));
      }
    } catch (err) {
      const isCancelled = err instanceof Error && err.message === 'Login cancelled';
      setError(
        isCancelled
          ? t('data.outputTables.cloudAction.loginCancelled')
          : err instanceof Error
            ? err.message
            : t('data.outputTables.cloudAction.loginFailed')
      );
    } finally {
      setLoginBusy(false);
    }
  }, [loginBusy, setDesktopAuthStatus, t]);

  const openApiKeySettings = useCallback(() => {
    setSettingsTab('personal-analysis');
    setShowSettings(true);
  }, [setSettingsTab, setShowSettings]);

  const statusLabel = boundAction
    ? [
        t(
          boundAction.type === 'drive_file'
            ? 'data.outputTables.cloudAction.typeDriveFile'
            : 'data.outputTables.cloudAction.typeCloudTable'
        ),
        boundAction.type === 'drive_file'
          ? boundAction.fileName || boundAction.fileId || boundAction.projectId
          : boundAction.tableName || boundAction.tableId || boundAction.projectId,
        boundAction.lastRunAt
          ? t('data.outputTables.cloudAction.lastRun', {
              time: formatDateTime(boundAction.lastRunAt),
            })
          : t('data.outputTables.cloudAction.neverRun'),
      ].join(' · ')
    : t('data.outputTables.cloudAction.notConfigured');

  return {
    hasCloudConnection,
    boundAction,
    statusLabel,
    actionType,
    setActionType,
    trigger,
    setTrigger,
    intervalMinutes,
    setIntervalMinutes,
    spaceId,
    setSpaceId,
    projectId,
    setProjectId,
    targetFileId,
    setTargetFileId,
    fileName,
    setFileName,
    writeMode,
    setWriteMode,
    targetTableId,
    setTargetTableId,
    tableName,
    setTableName,
    spaces,
    projects,
    driveFiles,
    cloudTables,
    loadingSpaces,
    loadingProjects,
    loadingTargets,
    busy,
    error,
    notice,
    loginBusy,
    handleLogin,
    openApiKeySettings,
    actionChanged,
    spec,
    specValid,
    saveAction,
    handleRemove,
    handleRun,
  };
}

export function OutputTableEditor({
  outputTable,
  inputTables,
  isInputTablesLoading,
  isBusy,
  onBack,
  onSave,
  onCloudActionChanged,
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
  onCloudActionChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [localName, setLocalName] = useState(outputTable.name);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [sourceDatasetId, setSourceDatasetId] = useState(outputTable.sourceDatasetId ?? '');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const cloud = useOutputCloudActionForm(outputTable, onCloudActionChanged);
  const busy = isBusy || Boolean(cloud.busy);
  const trimmedName = localName.trim();
  const actionSavable = !cloud.actionChanged || !cloud.spec || cloud.specValid;
  const canSave = Boolean(
    trimmedName &&
    !busy &&
    actionSavable &&
    (trimmedName !== outputTable.name ||
      (sourceDatasetId || null) !== outputTable.sourceDatasetId ||
      cloud.actionChanged)
  );

  const handleSave = async () => {
    if (!canSave) return;
    if (cloud.actionChanged) {
      const saved = await cloud.saveAction();
      if (!saved) return;
    }
    await onSave(outputTable, localName, sourceDatasetId || null);
  };

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
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
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
                disabled={busy}
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
              disabled={busy || isNameEditing}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('common.edit')}
              title={t('common.edit')}
            >
              <PencilLine className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border-muted bg-surface p-4 shadow-card">
        <div className="grid gap-5 lg:grid-cols-[8rem_minmax(0,1fr)] lg:items-center">
          <InputTableFormLabel>
            <span className="inline-flex items-center gap-1.5">
              {t('data.outputTables.editor.inputTable')}
              <InlineInfoTooltip label={t('data.outputTables.editor.inputTableInfo')} />
            </span>
          </InputTableFormLabel>
          <InputTableSelect
            value={sourceDatasetId}
            options={inputTableOptions}
            disabled={busy || isInputTablesLoading}
            onChange={setSourceDatasetId}
          />

          <div className="col-span-full border-t border-border-subtle" />

          <InputTableFormLabel>{t('data.outputTables.cloudAction.title')}</InputTableFormLabel>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-[12px] text-text-secondary">{cloud.statusLabel}</span>
            {cloud.boundAction && (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void cloud.handleRun()}
                  disabled={busy}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-accent transition-colors hover:bg-accent-muted disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  {t('data.outputTables.cloudAction.runNow')}
                </button>
                <button
                  type="button"
                  onClick={() => void cloud.handleRemove()}
                  disabled={busy}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {t('data.outputTables.cloudAction.remove')}
                </button>
              </span>
            )}
          </div>

          {!cloud.hasCloudConnection ? (
            <>
              <span />
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted">
                  {t('data.outputTables.cloudAction.connectPrompt')}
                </span>
                <button
                  type="button"
                  onClick={() => void cloud.handleLogin()}
                  disabled={cloud.loginBusy}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-accent-muted px-2.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  {cloud.loginBusy
                    ? t('data.outputTables.cloudAction.loggingIn')
                    : t('data.outputTables.cloudAction.loginAndContinue')}
                </button>
                <button
                  type="button"
                  onClick={cloud.openApiKeySettings}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary"
                >
                  <Settings className="h-3.5 w-3.5" />
                  {t('data.outputTables.cloudAction.connectWithApiKey')}
                </button>
              </div>
            </>
          ) : (
            <>
              <InputTableFormLabel>{t('data.outputTables.cloudAction.space')}</InputTableFormLabel>
              <InputTableSelect
                value={cloud.spaceId}
                disabled={cloud.loadingSpaces || busy}
                onChange={cloud.setSpaceId}
                options={[
                  { value: '', label: t('data.outputTables.cloudAction.none') },
                  ...cloud.spaces.map((space) => ({
                    value: space.spaceId,
                    label: space.spaceName,
                  })),
                ]}
              />

              {cloud.spaceId && (
                <>
                  <InputTableFormLabel>
                    {t('data.outputTables.cloudAction.project')}
                  </InputTableFormLabel>
                  <InputTableSelect
                    value={cloud.projectId}
                    disabled={cloud.loadingProjects || busy}
                    onChange={cloud.setProjectId}
                    options={[
                      { value: '', label: t('data.outputTables.cloudAction.selectProject') },
                      ...cloud.projects.map((project) => ({
                        value: project.projectId,
                        label: project.projectName,
                      })),
                    ]}
                  />
                </>
              )}

              {cloud.spaceId && cloud.projectId && (
                <>
                  <InputTableFormLabel>
                    {t('data.outputTables.cloudAction.typeLabel')}
                  </InputTableFormLabel>
                  <CloudActionOptionGroup
                    value={cloud.actionType}
                    disabled={busy}
                    onChange={cloud.setActionType}
                    options={[
                      {
                        value: 'cloud_table',
                        label: t('data.outputTables.cloudAction.typeCloudTable'),
                        icon: <UploadCloud className="h-3.5 w-3.5" />,
                      },
                      {
                        value: 'drive_file',
                        label: t('data.outputTables.cloudAction.typeDriveFile'),
                        icon: <FolderSync className="h-3.5 w-3.5" />,
                      },
                    ]}
                  />

                  {cloud.actionType === 'drive_file' ? (
                    <>
                      <InputTableFormLabel>
                        {t('data.outputTables.cloudAction.targetFile')}
                      </InputTableFormLabel>
                      <InputTableSelect
                        value={cloud.targetFileId}
                        disabled={cloud.loadingTargets || busy}
                        onChange={cloud.setTargetFileId}
                        options={[
                          {
                            value: '',
                            label: t('data.outputTables.cloudAction.createNewFile'),
                          },
                          ...cloud.driveFiles.map((file) => ({
                            value: file.fileId,
                            label: `${file.fileName} · ${file.fileId}`,
                          })),
                        ]}
                      />
                      {!cloud.targetFileId && (
                        <>
                          <InputTableFormLabel>
                            {t('data.outputTables.cloudAction.fileName')}
                          </InputTableFormLabel>
                          <Input
                            value={cloud.fileName}
                            disabled={busy}
                            onChange={(event) => cloud.setFileName(event.target.value)}
                            className="h-9 px-3"
                            placeholder={`${outputTable.name}.csv`}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <InputTableFormLabel>
                        {t('data.outputTables.cloudAction.writeMode')}
                      </InputTableFormLabel>
                      <CloudActionOptionGroup
                        value={cloud.writeMode}
                        disabled={busy}
                        onChange={cloud.setWriteMode}
                        options={[
                          {
                            value: 'CREATE',
                            label: t('data.outputTables.cloudAction.writeModeCreate'),
                            icon: <Plus className="h-3.5 w-3.5" />,
                          },
                          {
                            value: 'REPLACE',
                            label: t('data.outputTables.cloudAction.writeModeReplace'),
                            icon: <Repeat2 className="h-3.5 w-3.5" />,
                          },
                        ]}
                      />
                      {cloud.writeMode === 'REPLACE' && (
                        <>
                          <InputTableFormLabel>
                            {t('data.outputTables.cloudAction.targetTable')}
                          </InputTableFormLabel>
                          <InputTableSelect
                            value={cloud.targetTableId}
                            disabled={
                              cloud.loadingTargets || busy || cloud.cloudTables.length === 0
                            }
                            onChange={(value) => {
                              cloud.setTargetTableId(value);
                              const target = cloud.cloudTables.find(
                                (table) => table.tableId === value
                              );
                              if (target) cloud.setTableName(target.tableName);
                            }}
                            options={
                              cloud.cloudTables.length
                                ? cloud.cloudTables.map((table) => ({
                                    value: table.tableId,
                                    label: `${table.tableName} · ${table.tableId}`,
                                  }))
                                : [
                                    {
                                      value: '',
                                      label: t('data.outputTables.cloudAction.noTables'),
                                    },
                                  ]
                            }
                          />
                        </>
                      )}
                      <InputTableFormLabel>
                        {t('data.outputTables.cloudAction.tableName')}
                      </InputTableFormLabel>
                      <Input
                        value={cloud.tableName}
                        disabled={busy}
                        onChange={(event) => cloud.setTableName(event.target.value)}
                        className="h-9 px-3"
                        placeholder={outputTable.name}
                      />
                    </>
                  )}

                  <InputTableFormLabel>
                    {t('data.outputTables.cloudAction.triggerLabel')}
                  </InputTableFormLabel>
                  <div className="flex items-center gap-2">
                    <CloudActionOptionGroup
                      value={cloud.trigger}
                      disabled={busy}
                      onChange={cloud.setTrigger}
                      options={[
                        {
                          value: 'on_change',
                          label: t('data.outputTables.cloudAction.triggerOnChange'),
                        },
                        {
                          value: 'schedule',
                          label: t('data.outputTables.cloudAction.triggerSchedule'),
                        },
                      ]}
                    />
                    {cloud.trigger === 'schedule' && (
                      <GlassSelect
                        value={String(cloud.intervalMinutes)}
                        disabled={busy}
                        onValueChange={(value) => cloud.setIntervalMinutes(Number(value))}
                        triggerClassName="!h-7 w-28 rounded-lg bg-surface px-2.5 text-[12px] font-medium text-text-secondary"
                        options={CLOUD_ACTION_INTERVALS.map((minutes) => ({
                          value: String(minutes),
                          label: t(`data.outputTables.cloudAction.interval${minutes}`),
                        }))}
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {(cloud.error || cloud.notice || cloud.boundAction?.lastError) && (
            <>
              <span />
              <div className="min-w-0">
                {(cloud.error || cloud.boundAction?.lastError) && (
                  <div className="rounded-md border border-error/25 bg-error/10 px-3 py-1.5 text-[12px] text-error">
                    {cloud.error ?? cloud.boundAction?.lastError}
                  </div>
                )}
                {cloud.notice && !(cloud.error || cloud.boundAction?.lastError) && (
                  <div className="rounded-md border border-success/25 bg-accent-muted px-3 py-1.5 text-[12px] text-success">
                    {cloud.notice}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function InlineInfoTooltip({ label }: { label: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-muted hover:text-accent focus:bg-accent-muted focus:text-accent focus:outline-none"
        aria-label={label}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[12px] font-medium leading-5 text-text-secondary shadow-elevated group-hover:block group-focus-within:block">
        {label}
      </span>
    </span>
  );
}
