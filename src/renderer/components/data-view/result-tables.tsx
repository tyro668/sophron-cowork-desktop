import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpDown,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderInput,
  Info,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UploadCloud,
  Table2,
} from 'lucide-react';
import type {
  DataPipeline,
  DataRawTable,
  DataGroup,
  DataRawTablePreview,
  DataResultTable,
  DataTableExportFormat,
} from '../../types';
import { dataClient } from '../../features/data/api/data-client';
import { showToast } from '../../utils/toast';
import { GlassDataGridPreview } from '../GlassDataGridPreview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  AssignGroupDialog,
  buildGroupSections,
  GroupNameDialog,
  GroupSectionRows,
  hasNamedSections,
  toggleCollapsed,
  type AssignGroupTarget,
  type DataListGroup,
} from './group-ui';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  RawTableFormLabel,
  RawTableSelect,
  RawTableStatusBadge,
  LoadingState,
  TABLE_PAGE_SIZE,
  editorHeaderRowClass,
  flatToolbarRowClass,
  formatDateTime,
  formatResultTableRelatedPipelineNames,
  RAW_TABLE_PREVIEW_PAGE_SIZE,
  RESULT_TABLE_INPUT_CHOICES_LIMIT,
  bottomTabBarClass,
  bottomTabListClass,
  bottomTabTriggerClass,
} from './shared';
import {
  Button,
  cn,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '../ui';
import { ResultTableAutomations } from './table-automations';

/** Shared export flow for result tables (save dialog, success toast, silent cancel). */
function useResultTableExport() {
  const { t } = useTranslation();
  const [exportBusy, setExportBusy] = useState<DataTableExportFormat | null>(null);
  const exportResultTable = async (id: string, format: DataTableExportFormat) => {
    if (exportBusy) return;
    setExportBusy(format);
    try {
      const result = await dataClient.exportTable({
        tableKind: 'result',
        id,
        format,
      });
      if (result.success) {
        showToast('success', t('data.resultTables.editor.exportDone', { path: result.path }));
      } else if (result.error && result.error !== 'cancelled') {
        showToast('error', result.error);
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(null);
    }
  };
  return { exportBusy, exportResultTable, canExport: dataClient.has('exportTable') };
}

export function ResultTablesPanel({
  resultTables,
  totalResultTables,
  groups,
  groupCounts,
  groupPages,
  searchQuery,
  isLoading,
  actionId,
  isCreateDisabled,
  onCreate,
  onSearchChange,
  onRefresh,
  onGroupPageChange,
  onPreview,
  onEdit,
  onDelete,
  onDeleteAll,
  onAssignToGroup,
  onRenameGroup,
  onDeleteGroup,
}: {
  resultTables: DataResultTable[];
  totalResultTables: number;
  groups: DataGroup[];
  groupCounts: Record<string, number>;
  groupPages: Record<string, number>;
  searchQuery: string;
  isLoading: boolean;
  actionId: string | null;
  isCreateDisabled: boolean;
  onCreate: (input: { name: string; sourceRawTableId: string | null }) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
  onPreview: (resultTable: DataResultTable) => void;
  onEdit: (resultTable: DataResultTable) => void;
  onDelete: (resultTable: DataResultTable) => void;
  onDeleteAll: () => void;
  onAssignToGroup: (ids: string[], target: AssignGroupTarget) => void;
  onRenameGroup: (group: DataListGroup, name: string) => void;
  onDeleteGroup: (group: DataListGroup) => void;
}) {
  const { t } = useTranslation();
  const { exportBusy, exportResultTable, canExport } = useResultTableExport();
  const [selectedResultTableId, setSelectedResultTableId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const selectedResultTable =
    resultTables.find((resultTable) => resultTable.id === selectedResultTableId) ?? null;
  const selectedBusy = selectedResultTable ? actionId === selectedResultTable.id : false;
  const bulkBusy = actionId === 'delete-all-result-tables';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (
      selectedResultTableId &&
      !resultTables.some((resultTable) => resultTable.id === selectedResultTableId)
    ) {
      setSelectedResultTableId(null);
    }
  }, [isLoading, resultTables, selectedResultTableId]);

  const sections = useMemo(
    () => buildGroupSections(resultTables, groups, (resultTable) => resultTable.groupId),
    [resultTables, groups]
  );
  const grouped = hasNamedSections(sections);

  const renderRow = (resultTable: DataResultTable, indented = false) => {
    const selected = resultTable.id === selectedResultTableId;
    return (
      <tr
        key={resultTable.id}
        onClick={() => setSelectedResultTableId(resultTable.id)}
        onDoubleClick={() => onEdit(resultTable)}
        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
          selected
            ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
            : 'hover:bg-surface-hover/35'
        }`}
      >
        <td className={indented ? 'pl-9 pr-2' : 'px-2'}>
          <div className="flex min-w-0 items-center gap-3">
            {indented ? (
              <UploadCloud className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
            ) : (
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
                <UploadCloud className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
              {resultTable.name}
            </div>
          </div>
        </td>
        <td className="px-2">
          <div className="truncate text-[13px] font-medium text-text-secondary">
            {formatResultTableRelatedPipelineNames(resultTable, t)}
          </div>
        </td>
        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
          {formatDateTime(resultTable.updatedAt)}
        </td>
        <td className="px-2">
          <RawTableStatusBadge label={t('data.resultTables.status.available')} tone="success" />
        </td>
      </tr>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {(isLoading || resultTables.length > 0 || searchQuery.trim()) && (
            <button
              onClick={() => setCreateDialogOpen(true)}
              disabled={isCreateDisabled || bulkBusy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('data.resultTables.add')}
            </button>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.resultTables.searchPlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('data.rawTables.actions.preview')}
            disabled={!selectedResultTable || bulkBusy}
            onClick={() => {
              if (selectedResultTable) {
                onPreview(selectedResultTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.rawTables.actions.edit')}
            disabled={!selectedResultTable || bulkBusy}
            onClick={() => {
              if (selectedResultTable) {
                onEdit(selectedResultTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<FolderInput className="h-3.5 w-3.5" />}
            label={t('data.groups.moveToGroup')}
            disabled={!selectedResultTable || selectedBusy || bulkBusy}
            onClick={() => {
              if (selectedResultTable) {
                setAssignDialogOpen(true);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.rawTables.actions.delete')}
            disabled={!selectedResultTable || selectedBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedResultTable) {
                onDelete(selectedResultTable);
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
              ...(canExport
                ? [
                    selectedResultTable && !selectedBusy && !bulkBusy && exportBusy === null
                      ? {
                          key: 'export',
                          label: t('data.resultTables.editor.export'),
                          icon: <Download className="h-3.5 w-3.5" />,
                          children: [
                            {
                              key: 'export-csv',
                              label: t('data.resultTables.editor.exportCsv'),
                              icon: <FileText className="h-3.5 w-3.5" />,
                              onClick: () => void exportResultTable(selectedResultTable.id, 'csv'),
                            },
                            {
                              key: 'export-xlsx',
                              label: t('data.resultTables.editor.exportExcel'),
                              icon: <Download className="h-3.5 w-3.5" />,
                              onClick: () => void exportResultTable(selectedResultTable.id, 'xlsx'),
                            },
                          ],
                        }
                      : {
                          key: 'export',
                          label: t('data.resultTables.editor.export'),
                          icon: <Download className="h-3.5 w-3.5" />,
                          disabled: true,
                          description: selectedResultTable
                            ? undefined
                            : t('data.resultTables.exportSelectHint'),
                        },
                  ]
                : []),
              {
                key: 'delete-all',
                label: t('data.actions.deleteAll'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                separatorBefore: true,
                disabled: totalResultTables <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>

      <div className="glass-table flex min-h-0 flex-1 flex-col rounded-none border-0">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.resultTables.loading')} />
          ) : resultTables.length === 0 ? (
            <EmptyState
              label={t('data.resultTables.empty')}
              icon={<Table2 className="h-6 w-6" />}
              description={t(
                searchQuery.trim() ? 'workspaceEmpty.searchHint' : 'workspaceEmpty.resultTablesHint'
              )}
              action={
                searchQuery.trim() ? (
                  <Button variant="secondary" onClick={() => onSearchChange('')}>
                    {t('workspaceEmpty.clearSearch')}
                  </Button>
                ) : (
                  !isCreateDisabled && (
                    <Button
                      variant="primary"
                      onClick={() => setCreateDialogOpen(true)}
                      className="shadow-soft"
                    >
                      <Plus className="h-4 w-4" />
                      {t('data.resultTables.add')}
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
                    <th className="w-[36%] whitespace-nowrap px-2">
                      {t('data.columns.resultTableName')}
                    </th>
                    <th className="w-[32%] whitespace-nowrap px-2">
                      {t('data.columns.relatedPipelines')}
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
                  {sections.map((section) => (
                    <GroupSectionRows
                      key={section.key}
                      colSpan={4}
                      section={section}
                      grouped={grouped}
                      collapsed={collapsedGroups.has(section.key)}
                      onToggle={() =>
                        setCollapsedGroups((current) => toggleCollapsed(current, section.key))
                      }
                      onRename={section.group ? setRenameTarget : undefined}
                      onDelete={section.group ? onDeleteGroup : undefined}
                      count={groupCounts[section.key] ?? section.rows.length}
                      page={groupPages[section.key] ?? 1}
                      pageSize={TABLE_PAGE_SIZE}
                      onPageChange={(page) => onGroupPageChange(section.key, page)}
                      renderRow={(resultTable, _index, indented) =>
                        renderRow(resultTable, indented)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <AssignGroupDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        groups={groups}
        currentGroupId={selectedResultTable?.groupId ?? null}
        busy={actionId === 'assign-group'}
        onSubmit={(target) => {
          if (selectedResultTable) {
            onAssignToGroup([selectedResultTable.id], target);
          }
          setAssignDialogOpen(false);
        }}
      />
      <GroupNameDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        initialName={renameTarget?.name ?? ''}
        onSubmit={(name) => {
          if (renameTarget) {
            onRenameGroup(renameTarget, name);
          }
          setRenameTarget(null);
        }}
      />
      <ResultTableCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        busy={actionId === 'create-output'}
        suggestedName={`${t('data.resultTables.defaultName')} ${totalResultTables + 1}`}
        onSubmit={(input) => {
          onCreate(input);
          setCreateDialogOpen(false);
        }}
      />
    </div>
  );
}

function ResultTableCreateDialog({
  open,
  onOpenChange,
  busy,
  suggestedName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  suggestedName: string;
  onSubmit: (input: { name: string; sourceRawTableId: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(suggestedName);
  const [purpose, setPurpose] = useState<'pipeline' | 'copy'>('pipeline');
  const [sourceRawTableId, setSourceRawTableId] = useState('');
  const [rawTables, setRawTables] = useState<DataRawTable[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(suggestedName);
    setPurpose('pipeline');
    setSourceRawTableId('');
    if (!dataClient.has('getDashboard')) return;
    let cancelled = false;
    setSourcesLoading(true);
    void dataClient
      .getDashboard({
        includeSummary: false,
        includePipelines: false,
        includeRawTables: true,
        includeResultTables: false,
        rawTableOffset: 0,
        rawTableLimit: RESULT_TABLE_INPUT_CHOICES_LIMIT,
        rawTableSourceKind: 'all',
      })
      .then((dashboard) => {
        if (!cancelled) setRawTables(dashboard.rawTables);
      })
      .catch(() => {
        if (!cancelled) setRawTables([]);
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, suggestedName]);

  const trimmedName = name.trim();
  const canSubmit =
    Boolean(trimmedName) && !busy && (purpose === 'pipeline' || Boolean(sourceRawTableId));
  const submit = () => {
    if (canSubmit) {
      onSubmit({
        name: trimmedName,
        sourceRawTableId: purpose === 'copy' ? sourceRawTableId : null,
      });
    }
  };

  const purposeOptionClass = (value: 'pipeline' | 'copy') =>
    cn(
      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors',
      purpose === value
        ? 'border-accent/40 bg-accent-muted text-text-primary'
        : 'border-border-subtle text-text-secondary hover:bg-surface-hover/40'
    );

  const sourceOptions = rawTables.map((rawTable) => ({
    value: rawTable.id,
    label: rawTable.name,
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      ariaLabel={t('data.resultTables.create.title')}
      className="max-w-md"
    >
      <DialogHeader>
        <DialogTitle>{t('data.resultTables.create.title')}</DialogTitle>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <div className="grid gap-1">
          <span className="text-xs font-medium text-text-secondary">
            {t('data.resultTables.create.name')}
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('data.resultTables.create.namePlaceholder')}
            data-autofocus
            className="text-[13px]"
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-text-secondary">
            {t('data.resultTables.create.purpose')}
          </span>
          <label className={purposeOptionClass('pipeline')}>
            <input
              type="radio"
              name="result-table-purpose"
              checked={purpose === 'pipeline'}
              onChange={() => setPurpose('pipeline')}
              className="mt-0.5 h-3.5 w-3.5 accent-accent"
            />
            <span className="grid gap-0.5">
              <span className="font-medium">{t('data.resultTables.create.purposePipeline')}</span>
              <span className="text-xs text-text-muted">
                {t('data.resultTables.create.purposePipelineDesc')}
              </span>
            </span>
          </label>
          <label className={purposeOptionClass('copy')}>
            <input
              type="radio"
              name="result-table-purpose"
              checked={purpose === 'copy'}
              onChange={() => setPurpose('copy')}
              className="mt-0.5 h-3.5 w-3.5 accent-accent"
            />
            <span className="grid gap-0.5">
              <span className="font-medium">{t('data.resultTables.create.purposeCopy')}</span>
              <span className="text-xs text-text-muted">
                {t('data.resultTables.create.purposeCopyDesc')}
              </span>
            </span>
          </label>
        </div>
        {purpose === 'copy' && (
          <div className="grid gap-1">
            <span className="text-xs font-medium text-text-secondary">
              {t('data.resultTables.create.source')}
            </span>
            <RawTableSelect
              value={sourceRawTableId}
              options={[
                {
                  value: '',
                  label: sourcesLoading
                    ? t('data.resultTables.editor.loadingRawTables')
                    : t('data.resultTables.create.selectSource'),
                },
                ...sourceOptions,
              ]}
              disabled={busy || sourcesLoading}
              onChange={setSourceRawTableId}
            />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {busy ? t('common.saving') : t('data.resultTables.create.confirm')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AutomationConfigGridRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <>
      <RawTableFormLabel className="lg:self-start lg:pt-1.5">{label}</RawTableFormLabel>
      <div className="min-w-0">{children}</div>
    </>
  );
}

export function ResultTableEditor({
  resultTable,
  rawTables,
  isRawTablesLoading,
  isBusy,
  pipelines,
  onBack,
  onSave,
  onRunPipeline,
}: {
  resultTable: DataResultTable;
  rawTables: DataRawTable[];
  isRawTablesLoading: boolean;
  isBusy: boolean;
  pipelines: DataPipeline[];
  onBack: () => void;
  onSave: (
    resultTable: DataResultTable,
    name: string,
    sourceRawTableId: string | null
  ) => void | Promise<void>;
  onRunPipeline: (pipeline: DataPipeline) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [localName, setLocalName] = useState(resultTable.name);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [sourceRawTableId, setSourceRawTableId] = useState(resultTable.sourceRawTableId ?? '');
  const [activeTab, setActiveTab] = useState<'data' | 'config'>('config');
  const [preview, setPreview] = useState<DataRawTablePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [runBusy, setRunBusy] = useState(false);
  const { exportBusy, exportResultTable, canExport } = useResultTableExport();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const busy = isBusy;
  const trimmedName = localName.trim();
  const canSave = Boolean(
    trimmedName &&
    !busy &&
    (trimmedName !== resultTable.name ||
      (sourceRawTableId || null) !== resultTable.sourceRawTableId)
  );

  const rawTableOptions = useMemo(() => {
    const options = rawTables.map((rawTable) => ({
      value: rawTable.id,
      label: rawTable.name,
    }));
    if (sourceRawTableId && !options.some((option) => option.value === sourceRawTableId)) {
      options.unshift({ value: sourceRawTableId, label: sourceRawTableId });
    }
    const emptyLabel = isRawTablesLoading
      ? t('data.resultTables.editor.loadingRawTables')
      : t('data.resultTables.editor.noRawTable');
    return [{ value: '', label: emptyLabel }, ...options];
  }, [rawTables, isRawTablesLoading, sourceRawTableId, t]);

  // The pipeline that produced this table — matched by id (name fallback for
  // dashboards loaded before relatedPipelineIds existed).
  const relatedPipeline = useMemo(() => {
    for (const id of resultTable.relatedPipelineIds ?? []) {
      const found = pipelines.find((pipeline) => pipeline.id === id);
      if (found) return found;
    }
    return (
      pipelines.find((pipeline) => resultTable.relatedPipelineNames.includes(pipeline.name)) ?? null
    );
  }, [pipelines, resultTable.relatedPipelineIds, resultTable.relatedPipelineNames]);

  const loadPreview = useCallback(
    async (page: number) => {
      if (!dataClient.has('previewRawTable')) return;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await dataClient.previewRawTable({
          id: resultTable.id,
          limit: RAW_TABLE_PREVIEW_PAGE_SIZE,
          offset: (page - 1) * RAW_TABLE_PREVIEW_PAGE_SIZE,
        });
        setPreview(result);
        setPreviewPage(page);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewLoading(false);
      }
    },
    [resultTable.id]
  );

  const handleSave = async () => {
    if (!canSave) return;
    await onSave(resultTable, localName, sourceRawTableId || null);
    await loadPreview(previewPage);
  };

  // Header preview toggle: enter preview (data tab + reload) or exit back to
  // the config tab.
  const handlePreviewToggle = async () => {
    if (activeTab === 'data') {
      setActiveTab('config');
      return;
    }
    setActiveTab('data');
    await loadPreview(1);
  };

  useEffect(() => {
    setPreview(null);
    setPreviewPage(1);
    setActiveTab('config');
    void loadPreview(1);
  }, [loadPreview]);

  useEffect(() => {
    setLocalName(resultTable.name);
    setIsNameEditing(false);
    setSourceRawTableId(resultTable.sourceRawTableId ?? '');
  }, [resultTable.id, resultTable.name, resultTable.sourceRawTableId]);

  useEffect(() => {
    if (!isNameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [isNameEditing]);

  const handleRunRelatedPipeline = async () => {
    if (!relatedPipeline || runBusy) return;
    setRunBusy(true);
    try {
      await onRunPipeline(relatedPipeline);
      await loadPreview(previewPage);
    } finally {
      setRunBusy(false);
    }
  };

  const handleExport = (format: DataTableExportFormat) => exportResultTable(resultTable.id, format);

  const exportDisabled = busy || exportBusy !== null || !canExport;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className={`${editorHeaderRowClass} justify-between`}>
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.resultTables.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <RawTableStatusBadge label={t('data.resultTables.status.available')} tone="success" />
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
                    setLocalName(resultTable.name);
                    setIsNameEditing(false);
                  }
                }}
                disabled={busy}
                maxLength={50}
                aria-label={t('data.resultTables.editor.name')}
                className="h-8 min-w-0 max-w-[18rem] truncate border-0 bg-transparent px-0 text-[15px] font-medium text-text-secondary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={t('data.resultTables.editor.title')}
              />
            ) : (
              <div
                className="flex h-8 min-w-0 max-w-[18rem] items-center truncate text-[15px] font-medium text-text-secondary"
                title={localName || t('data.resultTables.editor.title')}
              >
                {localName || t('data.resultTables.editor.title')}
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {relatedPipeline && (
            <button
              type="button"
              onClick={() => void handleRunRelatedPipeline()}
              disabled={busy || runBusy}
              title={t('data.resultTables.editor.runPipelineTitle', { name: relatedPipeline.name })}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              {runBusy
                ? t('data.resultTables.editor.running')
                : t('data.resultTables.editor.runPipeline')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handlePreviewToggle()}
            disabled={busy && activeTab !== 'data'}
            aria-pressed={activeTab === 'data'}
            className={`inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activeTab === 'data'
                ? 'border border-accent/40 bg-accent-muted text-accent'
                : 'border border-border-muted bg-surface text-text-secondary hover:border-accent/30 hover:bg-accent-muted hover:text-accent'
            }`}
          >
            {activeTab === 'data' ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {activeTab === 'data'
              ? t('data.rawTables.actions.exitPreview')
              : t('data.rawTables.actions.preview')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {busy ? t('common.saving') : t('common.save')}
          </button>
          <DataMoreMenu
            items={[
              {
                key: 'export',
                label: t('data.resultTables.editor.export'),
                icon: <Download className="h-3.5 w-3.5" />,
                disabled: exportDisabled,
                children: [
                  {
                    key: 'export-csv',
                    label: t('data.resultTables.editor.exportCsv'),
                    icon: <FileText className="h-3.5 w-3.5" />,
                    disabled: exportDisabled,
                    onClick: () => void handleExport('csv'),
                  },
                  {
                    key: 'export-xlsx',
                    label: t('data.resultTables.editor.exportExcel'),
                    icon: <Download className="h-3.5 w-3.5" />,
                    disabled: exportDisabled,
                    onClick: () => void handleExport('xlsx'),
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'data' | 'config')}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 py-3">
          <div className="grid gap-3 lg:grid-cols-[8rem_minmax(0,1fr)] lg:items-center">
            <RawTableFormLabel>
              <span className="inline-flex items-center gap-1.5">
                {t('data.resultTables.editor.rawTable')}
                <InlineInfoTooltip label={t('data.resultTables.editor.rawTableInfo')} />
              </span>
            </RawTableFormLabel>
            <RawTableSelect
              value={sourceRawTableId}
              options={rawTableOptions}
              disabled={busy || isRawTablesLoading}
              onChange={setSourceRawTableId}
            />

            <div className="col-span-full border-t border-border-subtle" />

            <ResultTableAutomations
              key={resultTable.id}
              resultTable={resultTable}
              embedded
              Row={AutomationConfigGridRow}
            />
          </div>
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
          <GlassDataGridPreview
            preview={preview}
            isLoading={previewLoading}
            error={previewError}
            currentPage={previewPage}
            onPageChange={(page) => void loadPreview(page)}
            labels={{
              loading: t('data.resultTables.editor.dataLoading'),
              empty: t('data.resultTables.editor.dataEmpty'),
              total: (count) => t('data.workflow.nodeDataTotal', { count }),
              pageSize: (count) => t('data.workflow.nodeDataPageSize', { count }),
            }}
            edgeToEdge
            rowHeight={32}
            headerHeight={34}
          />
        </TabsContent>
        <div className={`${bottomTabBarClass} justify-between`}>
          <TabsList className={bottomTabListClass}>
            <TabsTrigger value="config" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.config')}
            </TabsTrigger>
            <TabsTrigger value="data" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.data')}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 px-4 text-xs text-text-muted">
            {activeTab === 'data' && preview && (
              <span>
                {t('data.resultTables.editor.dataMeta', {
                  rows: preview.totalRows,
                  time: formatDateTime(resultTable.updatedAt),
                })}
              </span>
            )}
            {activeTab === 'data' && (
              <button
                type="button"
                onClick={() => void loadPreview(previewPage)}
                disabled={previewLoading}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={t('data.actions.refresh')}
                title={t('data.actions.refresh')}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>
      </Tabs>
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
