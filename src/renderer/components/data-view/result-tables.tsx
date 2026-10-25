import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Trash2,
  UploadCloud,
  Table2,
  ArrowRight,
  Check,
  ExternalLink,
  Workflow,
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
  TabBarAction,
  tabBarNewCellClass,
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  RawTableSelect,
  RawTableStatusBadge,
  LoadingState,
  TABLE_PAGE_SIZE,
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
import { resultTableDeleteImpact } from '../../features/data/utils/delete-impact';
import {
  getAutomationTableBindings,
  tableBindingKey,
} from '../../../shared/automation/table-bindings';

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
          selected ? 'bg-accent-muted' : 'hover:bg-surface-hover'
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
            <div className="min-w-0 truncate text-[13px] font-medium text-text-primary">
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
            <TabBarAction>
              <button
                onClick={() => setCreateDialogOpen(true)}
                disabled={isCreateDisabled || bulkBusy}
                className={tabBarNewCellClass}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('data.resultTables.add')}
              </button>
            </TabBarAction>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.resultTables.searchPlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedResultTable && (
            <>
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
            </>
          )}
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
                key: 'delete-selected',
                label: t('data.rawTables.actions.delete'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                separatorBefore: true,
                disabled: !selectedResultTable || selectedBusy || bulkBusy,
                onClick: () => {
                  if (selectedResultTable) onDelete(selectedResultTable);
                },
              },
              {
                key: 'delete-all',
                label: t('data.actions.deleteAll'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                disabled: totalResultTables <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>

      <div className="glass-table ui-table-flush flex min-h-0 flex-1 flex-col">
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
              <table className="data-list-table w-full table-fixed border-collapse text-left">
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
      'flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors',
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
      className="ui-dialog-pad max-w-md"
    >
      <DialogHeader>
        <DialogTitle>{t('data.resultTables.create.title')}</DialogTitle>
      </DialogHeader>
      <DialogBody className="ui-group bg-surface">
        <div className="ui-form-row">
          <span className="ui-form-label items-center">{t('data.resultTables.create.name')}</span>
          <div className="ui-form-value">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('data.resultTables.create.namePlaceholder')}
              data-autofocus
              className="h-8 text-[13px]"
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
          </div>
        </div>
        <div className="ui-form-row">
          <span className="ui-form-label items-start">
            <span className="mt-2">{t('data.resultTables.create.purpose')}</span>
          </span>
          <div className="ui-form-value gap-1.5">
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
        </div>
        {purpose === 'copy' && (
          <div className="ui-form-row">
            <span className="ui-form-label items-center">
              {t('data.resultTables.create.source')}
            </span>
            <div className="ui-form-value">
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
          </div>
        )}
      </DialogBody>
      <DialogFooter className="ui-footer-split">
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {busy ? t('common.saving') : t('data.resultTables.create.confirm')}
        </Button>
      </DialogFooter>
    </Dialog>
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
  onDelete,
  onOpenPipeline,
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
  onDelete?: (resultTable: DataResultTable) => void | Promise<void>;
  onOpenPipeline?: (pipeline: DataPipeline) => void;
}) {
  const { t } = useTranslation();
  const [readers, setReaders] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => dataClient.listAutomations())
      .then((result) => {
        if (!active) return;
        const ref = { kind: 'result' as const, tableId: resultTable.id };
        setReaders(
          (result?.automations ?? [])
            .filter((automation) =>
              getAutomationTableBindings(automation).some(
                (binding) => tableBindingKey(binding) === tableBindingKey(ref)
              )
            )
            .map((automation) => automation.name)
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [resultTable.id]);
  const [localName, setLocalName] = useState(resultTable.name);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [sourceRawTableId, setSourceRawTableId] = useState(resultTable.sourceRawTableId ?? '');
  const [activeTab, setActiveTab] = useState<'data' | 'config' | 'automation'>('config');
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
  const listedPipeline = useMemo(() => {
    for (const id of resultTable.relatedPipelineIds ?? []) {
      const found = pipelines.find((pipeline) => pipeline.id === id);
      if (found) return found;
    }
    return (
      pipelines.find((pipeline) => resultTable.relatedPipelineNames.includes(pipeline.name)) ?? null
    );
  }, [pipelines, resultTable.relatedPipelineIds, resultTable.relatedPipelineNames]);
  // Opened from a chat link the dashboard may not have loaded pipelines yet: fetch it directly.
  const [fetchedPipeline, setFetchedPipeline] = useState<DataPipeline | null>(null);
  const firstRelatedPipelineId = resultTable.relatedPipelineIds?.[0] ?? null;
  useEffect(() => {
    setFetchedPipeline(null);
    if (listedPipeline || !firstRelatedPipelineId || !dataClient.has('getPipeline')) return;
    let active = true;
    void Promise.resolve()
      .then(() => dataClient.getPipeline(firstRelatedPipelineId))
      .then((pipeline) => {
        if (active && pipeline) setFetchedPipeline(pipeline);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [listedPipeline, firstRelatedPipelineId]);
  const relatedPipeline = listedPipeline ?? fetchedPipeline;

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
      <div
        className={`flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle`}
      >
        <div className="flex min-w-0 items-stretch">
          <button
            onClick={onBack}
            className="inline-flex w-[104px] flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-r border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.resultTables.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2 border-r border-border-subtle px-3">
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
                className="h-8 min-w-0 max-w-[18rem] truncate border-0 bg-transparent px-0 text-[14px] font-semibold text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={t('data.resultTables.editor.title')}
              />
            ) : (
              <div
                className="flex h-8 min-w-0 max-w-[18rem] items-center truncate text-[14px] font-semibold text-text-primary"
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
        <div className="flex items-stretch">
          {relatedPipeline && (
            <button
              type="button"
              onClick={() => void handleRunRelatedPipeline()}
              disabled={busy || runBusy}
              title={t('data.resultTables.editor.runPipelineTitle', { name: relatedPipeline.name })}
              className="inline-flex h-full w-[92px] items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle text-xs font-medium text-text-secondary transition-colors hover:bg-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
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
            className={`inline-flex h-full w-[92px] items-center justify-center gap-1.5 whitespace-nowrap border-l border-border-subtle text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              activeTab === 'data'
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-accent-muted hover:text-accent'
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
            data-testid="result-editor-save"
            className={`inline-flex h-full w-[92px] items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50 ${
              canSave ? 'text-accent' : 'text-text-secondary hover:text-accent'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
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
        onValueChange={(value) => setActiveTab(value as 'data' | 'config' | 'automation')}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto bg-surface">
          <div className="grid">
            <div className="ui-group grid gap-px bg-border-subtle sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t('data.resultTables.stats.rows')}
                value={resultTable.rowCount.toLocaleString('en-US')}
              />
              <StatCard
                label={t('data.resultTables.stats.columns')}
                value={String(resultTable.columnCount)}
              />
              <StatCard
                label={t('data.resultTables.stats.pipeline')}
                value={relatedPipeline?.name ?? '—'}
                link={Boolean(relatedPipeline)}
              />
              <StatCard
                label={t('data.resultTables.stats.updatedAt')}
                value={formatDateTime(resultTable.updatedAt)}
                plain
              />
            </div>
            <section className="ui-group ui-form-flush bg-surface">
              <div className="ui-group-title">{t('data.resultTables.sections.basic')}</div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  {t('data.resultTables.basic.nameLabel')}
                </div>
                <div className="ui-form-value">
                  <input
                    value={localName}
                    onChange={(event) => setLocalName(event.target.value)}
                    disabled={busy}
                    maxLength={50}
                    aria-label={t('data.resultTables.editor.name')}
                    data-testid="result-basic-name"
                    className="outline-none hover:bg-surface-hover focus:bg-surface-hover disabled:opacity-60"
                  />
                </div>
              </div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  <span className="inline-flex items-center gap-1.5">
                    {t('data.resultTables.editor.rawTable')}
                    <InlineInfoTooltip label={t('data.resultTables.editor.rawTableInfo')} />
                  </span>
                </div>
                <div className="ui-form-value">
                  <RawTableSelect
                    flush
                    value={sourceRawTableId}
                    options={rawTableOptions}
                    disabled={busy || isRawTablesLoading}
                    onChange={setSourceRawTableId}
                  />
                </div>
              </div>
            </section>
            <section className="ui-group ui-form-flush bg-surface">
              <div className="ui-group-title">{t('data.resultTables.lineage.title')}</div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  {t('data.resultTables.lineage.flowLabel')}
                </div>
                <div className="ui-form-value !flex-row">
                  <div className="flex min-h-[35px] min-w-0 flex-1 flex-wrap items-center gap-1.5 px-[10px] py-1 text-[12.5px]">
                    {upstreamRawNames(resultTable, relatedPipeline, rawTables).map((name) => (
                      <LineageChip
                        key={name}
                        kind={t('data.resultTables.lineage.raw')}
                        name={name}
                      />
                    ))}
                    <ArrowRight className="h-3 w-3 text-text-muted" />
                    <LineageChip
                      kind={t('data.resultTables.lineage.pipeline')}
                      name={relatedPipeline?.name ?? '—'}
                    />
                    <ArrowRight className="h-3 w-3 text-text-muted" />
                    <LineageChip
                      kind={t('data.resultTables.lineage.result')}
                      name={resultTable.name}
                      active
                    />
                  </div>
                  {relatedPipeline && onOpenPipeline ? (
                    <button
                      type="button"
                      onClick={() => onOpenPipeline(relatedPipeline)}
                      className="ui-accent-cell w-[120px] flex-shrink-0 border-l border-border-subtle"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('data.resultTables.lineage.openPipeline')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="ui-form-row">
                <div className="ui-form-label items-center">
                  {t('data.resultTables.lineage.downstreamLabel')}
                </div>
                <div className="ui-form-value">
                  <span className="ui-flush-text">
                    {readers.length > 0
                      ? t('data.resultTables.lineage.downstreamText', {
                          count: readers.length,
                          names: readers.join('、'),
                        })
                      : t('data.resultTables.lineage.downstreamNone')}
                  </span>
                </div>
              </div>
            </section>
            {onDelete && (
              <section
                className="ui-group ui-form-flush bg-surface"
                data-testid="result-danger-zone"
              >
                <div className="ui-group-title">{t('data.resultTables.danger.title')}</div>
                <div className="ui-form-row">
                  <div className="ui-form-label items-center">
                    {t('data.resultTables.danger.deleteTitle')}
                  </div>
                  <div className="ui-form-value !flex-row">
                    <span className="flex min-w-0 flex-1 items-center px-[10px] py-2 text-[12.5px] text-text-muted">
                      {t('data.resultTables.danger.deleteHint')}{' '}
                      {resultTableDeleteImpact(resultTable, t)}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onDelete(resultTable)}
                      className="inline-flex w-[140px] flex-shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('data.resultTables.danger.deleteAction')}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
          <GlassDataGridPreview
            preview={preview}
            isLoading={previewLoading}
            error={previewError}
            currentPage={previewPage}
            onPageChange={(page) => void loadPreview(page)}
            onRetry={() => void loadPreview(previewPage)}
            labels={{
              loading: t('data.resultTables.editor.dataLoading'),
              empty: t('data.resultTables.editor.dataEmpty'),
              total: (count) => t('data.workflow.nodeDataTotal', { count }),
              errorTitle: t('data.preview.loadFailed'),
              retry: t('data.preview.retry'),
              pageSize: (count) => t('data.workflow.nodeDataPageSize', { count }),
            }}
            edgeToEdge
            rowHeight={32}
            headerHeight={34}
          />
        </TabsContent>
        <TabsContent value="automation" className="min-h-0 flex-1 overflow-y-auto bg-surface">
          <ResultTableAutomations key={resultTable.id} resultTable={resultTable} embedded grid />
        </TabsContent>
        <div className={`${bottomTabBarClass} justify-between`}>
          <TabsList className={bottomTabListClass}>
            <TabsTrigger value="config" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.config')}
            </TabsTrigger>
            <TabsTrigger value="data" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.data')}
            </TabsTrigger>
            <TabsTrigger value="automation" className={bottomTabTriggerClass}>
              {t('data.resultTables.editor.tabs.automation')}
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

function StatCard({
  label,
  value,
  link,
  plain,
}: {
  label: string;
  value: string;
  link?: boolean;
  plain?: boolean;
}) {
  return (
    <div className="bg-surface">
      <div className="flex h-[30px] items-center border-b border-border-subtle bg-surface-muted px-3 text-xs text-text-secondary">
        {label}
      </div>
      <div
        className={`flex h-10 items-center gap-1.5 truncate px-3 tabular-nums ${
          link
            ? 'text-[12.5px] font-medium text-accent'
            : plain
              ? 'text-[12.5px] text-text-primary'
              : 'text-[15px] font-semibold text-text-primary'
        }`}
        title={value}
      >
        {link ? <Workflow className="h-3.5 w-3.5 flex-shrink-0" /> : null}
        {value}
      </div>
    </div>
  );
}

/** Every raw table the producing pipeline reads (a join over child tables has several). */
export function upstreamRawNames(
  resultTable: { sourceRawTableId: string | null },
  pipeline: { name: string; sourceRawTableId: string | null } | null | undefined,
  rawTables: ReadonlyArray<{ id: string; name: string; relatedPipelineNames?: string[] }>
): string[] {
  const byId = (id: string | null | undefined) =>
    id ? rawTables.find((item) => item.id === id)?.name : undefined;
  const direct = byId(resultTable.sourceRawTableId);
  if (direct) return [direct];
  const read = pipeline
    ? rawTables
        .filter((item) => item.relatedPipelineNames?.includes(pipeline.name))
        .map((item) => item.name)
    : [];
  if (read.length) return read;
  return [byId(pipeline?.sourceRawTableId) ?? '—'];
}

function LineageChip({
  kind,
  name,
  active = false,
}: {
  kind: string;
  name: string;
  active?: boolean;
}) {
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1.5">
      <span
        className={`rounded px-1.5 py-px text-[11px] ${
          active ? 'bg-accent-muted text-accent' : 'bg-surface-muted text-text-secondary'
        }`}
      >
        {kind}
      </span>
      <span className="truncate text-text-primary">{name}</span>
    </span>
  );
}
