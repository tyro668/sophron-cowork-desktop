import { useAppStore } from '../../store';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  CloudDownload,
  Eye,
  FolderInput,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Table2,
  Trash2,
  Workflow,
} from 'lucide-react';
import type {
  DataDataset,
  DataGroup,
  DataInputTableConfig,
  DataInputTableSourceKind,
} from '../../types';
import { Button } from '../ui/button';
import type { InputTableDraft } from '../../features/data/model/types';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  InputTableStatusBadge,
  TABLE_PAGE_SIZE,
  flatToolbarRowClass,
  LoadingState,
  formatDateTime,
  formatDisplayPath,
  formatRelatedTaskNames,
  formatCloudMirrorLocation,
  getCloudMirror,
  getCloudMirrorSourceMeta,
  getInputTableSourceMeta,
  matchesSearchText,
} from './shared';
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
import { InputTableEditorWorkbench } from './input-table-editor-workbench';

export function InputTablesPanel({
  datasets,
  drafts,
  groups,
  groupCounts,
  groupPages,
  totalDatasets,
  searchQuery,
  isLoading,
  onSearchChange,
  onCreate,
  onRefresh,
  onPreviewDataset,
  onDelete,
  onDeleteAll,
  onDeleteDraft,
  onEditDraft,
  onEditDataset,
  onCreateTaskFromTable,
  onAiGenerateTaskFromTable,
  onAssignToGroup,
  onRenameGroup,
  onDeleteGroup,
  onGroupPageChange,
  isCreateDisabled,
  actionId,
}: {
  datasets: DataDataset[];
  drafts: InputTableDraft[];
  groups: DataGroup[];
  groupCounts: Record<string, number>;
  groupPages: Record<string, number>;
  totalDatasets: number;
  searchQuery: string;
  isLoading: boolean;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onPreviewDataset: (dataset: DataDataset) => void;
  onDelete: (dataset: DataDataset) => void;
  onDeleteAll: () => void;
  onDeleteDraft: (id: string) => void;
  onEditDraft: (id: string) => void;
  onEditDataset: (id: string) => void;
  onCreateTaskFromTable: (dataset: DataDataset) => void;
  onAiGenerateTaskFromTable?: (dataset: DataDataset) => void;
  onAssignToGroup: (ids: string[], target: AssignGroupTarget) => void;
  onRenameGroup: (group: DataListGroup, name: string) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
  isCreateDisabled: boolean;
  actionId: string | null;
}) {
  const { t } = useTranslation();
  const navigateToAutomation = useAppStore((state) => state.navigateToTableAutomation);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const filteredDrafts = useMemo(
    () => drafts.filter((draft) => matchesSearchText(draft.name, searchQuery)),
    [drafts, searchQuery]
  );
  const draftCount = filteredDrafts.length;
  const totalRows = totalDatasets + draftCount;
  const pageDrafts = useMemo(() => (!isLoading ? filteredDrafts : []), [filteredDrafts, isLoading]);
  const visibleRows = useMemo(
    () =>
      isLoading
        ? []
        : [
            ...pageDrafts.map((draft) => ({ kind: 'draft' as const, id: draft.id, draft })),
            ...datasets.map((dataset) => ({ kind: 'dataset' as const, id: dataset.id, dataset })),
          ],
    [datasets, isLoading, pageDrafts]
  );
  const pageRows = visibleRows;
  const pageSections = useMemo(
    () =>
      buildGroupSections(pageRows, groups, (row) =>
        row.kind === 'dataset' ? (row.dataset?.groupId ?? null) : null
      ),
    [pageRows, groups]
  );
  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = { ...groupCounts };
    counts.ungrouped = (counts.ungrouped ?? 0) + draftCount;
    return counts;
  }, [groupCounts, draftCount]);
  const grouped = hasNamedSections(pageSections);
  const emptyLabel = t('data.inputTables.empty');
  const selectedRow = visibleRows.find((row) => row.id === selectedDatasetId) ?? null;
  const selectedDataset = selectedRow?.kind === 'dataset' ? selectedRow.dataset : null;
  const selectedDraft = selectedRow?.kind === 'draft' ? selectedRow.draft : null;
  const selectedRowBusy = selectedRow ? actionId === selectedRow.id : false;
  const bulkBusy = actionId === 'delete-all-input-tables';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedDatasetId && !visibleRows.some((row) => row.id === selectedDatasetId)) {
      setSelectedDatasetId(null);
    }
  }, [isLoading, selectedDatasetId, visibleRows]);

  const renderRow = (row: (typeof visibleRows)[number], indented = false) => {
    const dataset = row.kind === 'dataset' ? row.dataset : null;
    const draft = row.kind === 'draft' ? row.draft : null;
    const sourceKind = dataset ? dataset.sourceKind : 'draft';
    const cloudMirror = getCloudMirror(dataset);
    const sourceMeta = cloudMirror
      ? getCloudMirrorSourceMeta()
      : getInputTableSourceMeta(sourceKind);
    const selected = row.id === selectedDatasetId;
    const rowName = dataset?.name ?? draft?.name ?? '';
    const rowUpdatedAt = dataset?.updatedAt ?? draft?.updatedAt ?? null;
    return (
      <tr
        key={row.id}
        onClick={() => setSelectedDatasetId(row.id)}
        onDoubleClick={() => {
          if (draft) {
            onEditDraft(draft.id);
          } else if (dataset) {
            onEditDataset(dataset.id);
          }
        }}
        className={`h-[3.25rem] cursor-pointer border-b border-dashed border-border-muted/85 last:border-b-0 transition-colors ${
          selected
            ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
            : 'hover:bg-surface-hover/35'
        }`}
      >
        <td className={indented ? 'pl-9 pr-2' : 'px-2'}>
          <div className="flex min-w-0 items-center gap-3">
            {indented ? (
              <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
            ) : (
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
                <Table2 className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
              {rowName}
            </div>
          </div>
        </td>
        <td className="px-2">
          <span
            className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${sourceMeta.badgeClassName}`}
          >
            {t(sourceMeta.labelKey)}
          </span>
        </td>
        <td className="px-2">
          <div
            className="truncate text-[13px] font-medium text-text-secondary"
            title={cloudMirror ? formatCloudMirrorLocation(cloudMirror) : dataset?.sourcePath}
          >
            {cloudMirror
              ? formatCloudMirrorLocation(cloudMirror)
              : dataset
                ? formatDisplayPath(dataset.sourcePath)
                : t('data.inputTables.notConfigured')}
          </div>
        </td>
        <td className="px-2">
          <div className="truncate text-[13px] font-medium text-text-secondary">
            {dataset
              ? formatRelatedTaskNames(dataset.relatedTaskNames, t)
              : t('data.inputTables.noRelatedTasks')}
          </div>
        </td>
        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
          {formatDateTime(rowUpdatedAt)}
        </td>
        <td className="px-2">
          <InputTableStatusBadge
            label={
              draft ? t('data.inputTables.status.draft') : t('data.inputTables.status.available')
            }
            tone={draft ? 'warning' : 'success'}
          />
        </td>
      </tr>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-2">
          {(isLoading || visibleRows.length > 0 || searchQuery.trim()) && (
            <button
              onClick={onCreate}
              disabled={isCreateDisabled || bulkBusy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('data.inputTables.add')}
            </button>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.inputTables.searchPlaceholder')}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<CloudDownload className="h-3.5 w-3.5" />}
            label={t('schedule.cloudInput.addFromCloud')}
            disabled={bulkBusy}
            onClick={() => navigateToAutomation({ newInputTableName: '' })}
          />
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.preview')}
            disabled={!selectedDataset || bulkBusy}
            onClick={() => {
              if (selectedDataset) {
                onPreviewDataset(selectedDataset);
              }
            }}
          />
          <DataToolbarButton
            icon={<Workflow className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.createTask')}
            disabled={!selectedDataset || bulkBusy || actionId === 'create'}
            onClick={() => {
              if (selectedDataset) {
                onCreateTaskFromTable(selectedDataset);
              }
            }}
          />
          {onAiGenerateTaskFromTable && (
            <DataToolbarButton
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t('data.aiTaskGenerate')}
              disabled={!selectedDataset || bulkBusy || actionId === 'create'}
              onClick={() => {
                if (selectedDataset) onAiGenerateTaskFromTable(selectedDataset);
              }}
            />
          )}
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.edit')}
            disabled={!selectedRow || bulkBusy}
            onClick={() => {
              if (selectedDraft) {
                onEditDraft(selectedDraft.id);
              } else if (selectedDataset) {
                onEditDataset(selectedDataset.id);
              }
            }}
          />
          <DataToolbarButton
            icon={<FolderInput className="h-3.5 w-3.5" />}
            label={t('data.groups.moveToGroup')}
            disabled={!selectedDataset || selectedRowBusy || bulkBusy}
            onClick={() => {
              if (selectedDataset) {
                setAssignDialogOpen(true);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.inputTables.actions.delete')}
            disabled={!selectedRow || selectedRowBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedDraft) {
                onDeleteDraft(selectedDraft.id);
              } else if (selectedDataset) {
                onDelete(selectedDataset);
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
                disabled: totalRows <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>

      <div className="glass-table flex min-h-0 flex-1 flex-col rounded-none border-0">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.inputTables.loading')} />
          ) : visibleRows.length === 0 ? (
            <EmptyState
              label={emptyLabel}
              description={t(
                searchQuery.trim() ? 'workspaceEmpty.searchHint' : 'workspaceEmpty.inputTablesHint'
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
                      {t('data.inputTables.add')}
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
                    <th className="w-[24%] whitespace-nowrap px-2">
                      {t('data.columns.inputTableName')}
                    </th>
                    <th className="w-[10%] whitespace-nowrap px-2">
                      {t('data.columns.sourceType')}
                    </th>
                    <th className="w-[23%] whitespace-nowrap px-2">
                      {t('data.columns.sourceLocation')}
                    </th>
                    <th className="w-[17%] whitespace-nowrap px-2">
                      {t('data.columns.relatedTasks')}
                    </th>
                    <th className="w-[16%] whitespace-nowrap px-2">
                      <span className="inline-flex items-center gap-1">
                        {t('data.columns.updatedAt')}
                        <ArrowUpDown className="h-3 w-3" />
                      </span>
                    </th>
                    <th className="w-[10%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSections.map((section) => (
                    <GroupSectionRows
                      key={section.key}
                      colSpan={6}
                      section={section}
                      grouped={grouped}
                      collapsed={collapsedGroups.has(section.key)}
                      onToggle={() =>
                        setCollapsedGroups((current) => toggleCollapsed(current, section.key))
                      }
                      onRename={section.group ? setRenameTarget : undefined}
                      onDelete={section.group ? onDeleteGroup : undefined}
                      count={sectionCounts[section.key] ?? section.rows.length}
                      page={groupPages[section.key] ?? 1}
                      pageSize={TABLE_PAGE_SIZE}
                      onPageChange={(page) => onGroupPageChange(section.key, page)}
                      renderRow={(row, _index, indented) => renderRow(row, indented)}
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
        currentGroupId={selectedDataset?.groupId ?? null}
        busy={actionId === 'assign-group'}
        onSubmit={(target) => {
          if (selectedDataset) {
            onAssignToGroup([selectedDataset.id], target);
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
    </div>
  );
}

export function InputTableEditor({
  draft,
  dataset,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameDataset,
  onChooseDraftSource,
  onChooseDatasetSource,
  onUpdateDatasetConfig,
  onCreateTask,
  onAiGenerateTask,
  onSyncCloudSource,
}: {
  draft?: InputTableDraft;
  dataset?: DataDataset;
  isBusy: boolean;
  onBack: () => void;
  onRenameDraft?: (id: string, name: string) => void;
  onRenameDataset?: (dataset: DataDataset, name: string) => void | Promise<void>;
  onChooseDraftSource?: (
    draft: InputTableDraft,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onChooseDatasetSource?: (
    dataset: DataDataset,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onUpdateDatasetConfig?: (
    dataset: DataDataset,
    config: DataInputTableConfig,
    name?: string
  ) => void | Promise<void>;
  onCreateTask?: (dataset: DataDataset) => void;
  onAiGenerateTask?: (dataset: DataDataset) => void;
  onSyncCloudSource?: (dataset: DataDataset) => Promise<DataDataset | undefined>;
}) {
  return (
    <InputTableEditorWorkbench
      draft={draft}
      dataset={dataset}
      isBusy={isBusy}
      onBack={onBack}
      onRenameDraft={onRenameDraft}
      onRenameDataset={onRenameDataset}
      onChooseDraftSource={onChooseDraftSource}
      onChooseDatasetSource={onChooseDatasetSource}
      onUpdateDatasetConfig={onUpdateDatasetConfig}
      onCreateTask={onCreateTask}
      onAiGenerateTask={onAiGenerateTask}
      onSyncCloudSource={onSyncCloudSource}
    />
  );
}

export { InputTablePreviewDialog } from './input-table-preview-dialog';
export { getDefaultInputTableConfig } from './input-table-normalizer-utils';
