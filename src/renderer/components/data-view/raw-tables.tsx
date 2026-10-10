import { useAppStore } from '../../store';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  CalendarClock,
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
  DataRawTable,
  DataGroup,
  DataRawTableConfig,
  DataRawTableSourceKind,
} from '../../types';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import type { RawTableDraft } from '../../features/data/model/types';
import { RawTableAutomations } from './table-automations';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  RawTableStatusBadge,
  TABLE_PAGE_SIZE,
  flatToolbarRowClass,
  LoadingState,
  formatDateTime,
  formatDisplayPath,
  formatRelatedPipelineNames,
  formatCloudMirrorLocation,
  getCloudMirror,
  getCloudMirrorSourceMeta,
  getRawTableSourceMeta,
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
import { RawTableEditorWorkbench } from './raw-table-editor-workbench';

export function RawTablesPanel({
  rawTables,
  drafts,
  groups,
  groupCounts,
  groupPages,
  totalRawTables,
  searchQuery,
  isLoading,
  onSearchChange,
  onCreate,
  onRefresh,
  onPreviewRawTable,
  onDelete,
  onDeleteAll,
  onDeleteDraft,
  onEditDraft,
  onEditRawTable,
  onCreatePipelineFromTable,
  onAiGeneratePipelineFromTable,
  onAssignToGroup,
  onRenameGroup,
  onDeleteGroup,
  onGroupPageChange,
  isCreateDisabled,
  actionId,
}: {
  rawTables: DataRawTable[];
  drafts: RawTableDraft[];
  groups: DataGroup[];
  groupCounts: Record<string, number>;
  groupPages: Record<string, number>;
  totalRawTables: number;
  searchQuery: string;
  isLoading: boolean;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onPreviewRawTable: (rawTable: DataRawTable) => void;
  onDelete: (rawTable: DataRawTable) => void;
  onDeleteAll: () => void;
  onDeleteDraft: (id: string) => void;
  onEditDraft: (id: string) => void;
  onEditRawTable: (id: string) => void;
  onCreatePipelineFromTable: (rawTable: DataRawTable) => void;
  onAiGeneratePipelineFromTable?: (rawTable: DataRawTable) => void;
  onAssignToGroup: (ids: string[], target: AssignGroupTarget) => void;
  onRenameGroup: (group: DataListGroup, name: string) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  onGroupPageChange: (groupKey: string, page: number) => void;
  isCreateDisabled: boolean;
  actionId: string | null;
}) {
  const { t } = useTranslation();
  const navigateToAutomation = useAppStore((state) => state.navigateToTableAutomation);
  const [selectedRawTableId, setSelectedRawTableId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const filteredDrafts = useMemo(
    () => drafts.filter((draft) => matchesSearchText(draft.name, searchQuery)),
    [drafts, searchQuery]
  );
  const draftCount = filteredDrafts.length;
  const totalRows = totalRawTables + draftCount;
  const pageDrafts = useMemo(() => (!isLoading ? filteredDrafts : []), [filteredDrafts, isLoading]);
  const visibleRows = useMemo(
    () =>
      isLoading
        ? []
        : [
            ...pageDrafts.map((draft) => ({ kind: 'draft' as const, id: draft.id, draft })),
            ...rawTables.map((rawTable) => ({
              kind: 'rawTable' as const,
              id: rawTable.id,
              rawTable,
            })),
          ],
    [rawTables, isLoading, pageDrafts]
  );
  const pageRows = visibleRows;
  const pageSections = useMemo(
    () =>
      buildGroupSections(pageRows, groups, (row) =>
        row.kind === 'rawTable' ? (row.rawTable?.groupId ?? null) : null
      ),
    [pageRows, groups]
  );
  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = { ...groupCounts };
    counts.ungrouped = (counts.ungrouped ?? 0) + draftCount;
    return counts;
  }, [groupCounts, draftCount]);
  const grouped = hasNamedSections(pageSections);
  const emptyLabel = t('data.rawTables.empty');
  const selectedRow = visibleRows.find((row) => row.id === selectedRawTableId) ?? null;
  const selectedRawTable = selectedRow?.kind === 'rawTable' ? selectedRow.rawTable : null;
  const selectedDraft = selectedRow?.kind === 'draft' ? selectedRow.draft : null;
  const selectedRowBusy = selectedRow ? actionId === selectedRow.id : false;
  const bulkBusy = actionId === 'delete-all-raw-tables';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedRawTableId && !visibleRows.some((row) => row.id === selectedRawTableId)) {
      setSelectedRawTableId(null);
    }
  }, [isLoading, selectedRawTableId, visibleRows]);

  const renderRow = (row: (typeof visibleRows)[number], indented = false) => {
    const rawTable = row.kind === 'rawTable' ? row.rawTable : null;
    const draft = row.kind === 'draft' ? row.draft : null;
    const sourceKind = rawTable ? rawTable.sourceKind : 'draft';
    const cloudMirror = getCloudMirror(rawTable);
    const sourceMeta = cloudMirror ? getCloudMirrorSourceMeta() : getRawTableSourceMeta(sourceKind);
    const selected = row.id === selectedRawTableId;
    const rowName = rawTable?.name ?? draft?.name ?? '';
    const rowUpdatedAt = rawTable?.updatedAt ?? draft?.updatedAt ?? null;
    return (
      <tr
        key={row.id}
        onClick={() => setSelectedRawTableId(row.id)}
        onDoubleClick={() => {
          if (draft) {
            onEditDraft(draft.id);
          } else if (rawTable) {
            onEditRawTable(rawTable.id);
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
            title={cloudMirror ? formatCloudMirrorLocation(cloudMirror) : rawTable?.sourcePath}
          >
            {cloudMirror
              ? formatCloudMirrorLocation(cloudMirror)
              : rawTable
                ? formatDisplayPath(rawTable.sourcePath)
                : t('data.rawTables.notConfigured')}
          </div>
        </td>
        <td className="px-2">
          <div className="truncate text-[13px] font-medium text-text-secondary">
            {rawTable
              ? formatRelatedPipelineNames(rawTable.relatedPipelineNames, t)
              : t('data.rawTables.noRelatedPipelines')}
          </div>
        </td>
        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
          {formatDateTime(rowUpdatedAt)}
        </td>
        <td className="px-2">
          <RawTableStatusBadge
            label={draft ? t('data.rawTables.status.draft') : t('data.rawTables.status.available')}
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
              {t('data.rawTables.add')}
            </button>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.rawTables.searchPlaceholder')}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<CloudDownload className="h-3.5 w-3.5" />}
            label={t('schedule.cloudInput.addFromCloud')}
            disabled={bulkBusy}
            onClick={() => navigateToAutomation({ newRawTableName: '' })}
          />
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('data.rawTables.actions.preview')}
            disabled={!selectedRawTable || bulkBusy}
            onClick={() => {
              if (selectedRawTable) {
                onPreviewRawTable(selectedRawTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.rawTables.actions.edit')}
            disabled={!selectedRow || bulkBusy}
            onClick={() => {
              if (selectedDraft) {
                onEditDraft(selectedDraft.id);
              } else if (selectedRawTable) {
                onEditRawTable(selectedRawTable.id);
              }
            }}
          />
          <DataToolbarButton
            icon={<FolderInput className="h-3.5 w-3.5" />}
            label={t('data.groups.moveToGroup')}
            disabled={!selectedRawTable || selectedRowBusy || bulkBusy}
            onClick={() => {
              if (selectedRawTable) {
                setAssignDialogOpen(true);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.rawTables.actions.delete')}
            disabled={!selectedRow || selectedRowBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedDraft) {
                onDeleteDraft(selectedDraft.id);
              } else if (selectedRawTable) {
                onDelete(selectedRawTable);
              }
            }}
          />
          <DataMoreMenu
            items={[
              {
                key: 'create-pipeline',
                label: t('data.rawTables.actions.createPipelineMenu'),
                icon: <Workflow className="h-3.5 w-3.5" />,
                disabled: !selectedRawTable || bulkBusy || actionId === 'create',
                children: [
                  {
                    key: 'create-pipeline-manual',
                    label: t('data.rawTables.actions.createPipelineManual'),
                    icon: <Workflow className="h-3.5 w-3.5" />,
                    onClick: () => {
                      if (selectedRawTable) {
                        onCreatePipelineFromTable(selectedRawTable);
                      }
                    },
                  },
                  ...(onAiGeneratePipelineFromTable
                    ? [
                        {
                          key: 'create-pipeline-ai',
                          label: t('data.rawTables.actions.createPipelineAi'),
                          icon: <Sparkles className="h-3.5 w-3.5" />,
                          onClick: () => {
                            if (selectedRawTable) {
                              onAiGeneratePipelineFromTable(selectedRawTable);
                            }
                          },
                        },
                      ]
                    : []),
                ],
              },
              {
                key: 'automations',
                label: t('data.resultTables.automation.title'),
                icon: <CalendarClock className="h-3.5 w-3.5" />,
                disabled: !selectedRawTable || bulkBusy,
                onClick: () => setAutomationsOpen(true),
              },
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
            <LoadingState label={t('data.rawTables.loading')} />
          ) : visibleRows.length === 0 ? (
            <EmptyState
              label={emptyLabel}
              description={t(
                searchQuery.trim() ? 'workspaceEmpty.searchHint' : 'workspaceEmpty.rawTablesHint'
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
                      {t('data.rawTables.add')}
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
                      {t('data.columns.rawTableName')}
                    </th>
                    <th className="w-[10%] whitespace-nowrap px-2">
                      {t('data.columns.sourceType')}
                    </th>
                    <th className="w-[23%] whitespace-nowrap px-2">
                      {t('data.columns.sourceLocation')}
                    </th>
                    <th className="w-[17%] whitespace-nowrap px-2">
                      {t('data.columns.relatedPipelines')}
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
        currentGroupId={selectedRawTable?.groupId ?? null}
        busy={actionId === 'assign-group'}
        onSubmit={(target) => {
          if (selectedRawTable) {
            onAssignToGroup([selectedRawTable.id], target);
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
      {selectedRawTable && (
        <Dialog
          open={automationsOpen}
          onOpenChange={setAutomationsOpen}
          ariaLabel={t('data.resultTables.automation.title')}
          className="w-full max-w-2xl p-5"
        >
          <RawTableAutomations rawTable={selectedRawTable} />
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => setAutomationsOpen(false)}>
              {t('common.close')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function RawTableEditor({
  draft,
  rawTable,
  isBusy,
  onBack,
  onRenameDraft,
  onRenameRawTable,
  onChooseDraftSource,
  onChooseRawTableSource,
  onUpdateRawTableConfig,
  onSyncCloudSource,
}: {
  draft?: RawTableDraft;
  rawTable?: DataRawTable;
  isBusy: boolean;
  onBack: () => void;
  onRenameDraft?: (id: string, name: string) => void;
  onRenameRawTable?: (rawTable: DataRawTable, name: string) => void | Promise<void>;
  onChooseDraftSource?: (
    draft: RawTableDraft,
    sourceKind: DataRawTableSourceKind,
    config: DataRawTableConfig,
    name?: string
  ) => void | Promise<void>;
  onChooseRawTableSource?: (
    rawTable: DataRawTable,
    sourceKind: DataRawTableSourceKind,
    config: DataRawTableConfig,
    name?: string
  ) => void | Promise<void>;
  onUpdateRawTableConfig?: (
    rawTable: DataRawTable,
    config: DataRawTableConfig,
    name?: string
  ) => void | Promise<void>;
  onSyncCloudSource?: (rawTable: DataRawTable) => Promise<DataRawTable | undefined>;
}) {
  return (
    <RawTableEditorWorkbench
      draft={draft}
      rawTable={rawTable}
      isBusy={isBusy}
      onBack={onBack}
      onRenameDraft={onRenameDraft}
      onRenameRawTable={onRenameRawTable}
      onChooseDraftSource={onChooseDraftSource}
      onChooseRawTableSource={onChooseRawTableSource}
      onUpdateRawTableConfig={onUpdateRawTableConfig}
      onSyncCloudSource={onSyncCloudSource}
    />
  );
}

export { RawTablePreviewDialog } from './raw-table-preview-dialog';
export { getDefaultRawTableConfig } from './raw-table-normalizer-utils';
