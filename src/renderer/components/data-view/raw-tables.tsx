import { useAppStore } from '../../store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  FileSpreadsheet,
  FileText,
  Folder,
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
import type { DataRawTable, DataGroup, DataRawSource } from '../../types';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import type { RawTableDraft } from '../../features/data/model/types';
import { RawTableAutomations } from './table-automations';
import { ExcelMultiSheetIcon } from './excel-multi-sheet-icon';
import {
  TabBarAction,
  tabBarNewCellClass,
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  RawTableStatusBadge,
  TABLE_PAGE_SIZE,
  flatToolbarRowClass,
  LoadingState,
  formatDateTime,
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
import { RawTableEditorWorkbench, type RawTableEditorProps } from './raw-table-editor-workbench';

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
  sources = [],
  onOpenSource,
  onRefreshSource,
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
  /** Raw-table sources; multi-member sources render as a header row with child rows (layout A). */
  sources?: DataRawSource[];
  /** `tableId`: the child last selected under this source, to preview first. */
  onOpenSource?: (source: DataRawSource, tableId?: string) => void;
  onRefreshSource?: (source: DataRawSource) => void;
}) {
  const { t } = useTranslation();
  const navigateToAutomation = useAppStore((state) => state.navigateToTableAutomation);
  const [selectedRawTableId, setSelectedRawTableId] = useState<string | null>(null);
  const lastChildBySource = useRef(new Map<string, string>());
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedMerges, setExpandedMerges] = useState<Set<string>>(new Set());
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(loadCollapsedSources);
  const toggleMerge = (id: string) =>
    setExpandedMerges((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSource = (id: string) =>
    setCollapsedSources((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsedSources(next);
      return next;
    });
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
            ...groupBySource(rawTables, sources, expandedMerges, collapsedSources),
          ],
    [rawTables, isLoading, pageDrafts, sources, expandedMerges, collapsedSources]
  );
  const pageRows = visibleRows;
  const pageSections = useMemo(
    () =>
      buildGroupSections(pageRows, groups, (row) =>
        row.kind !== 'draft' ? (row.rawTable?.groupId ?? null) : null
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
  const selectedSource = selectedRow?.kind === 'source' ? selectedRow.source : null;
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
    if (row.kind === 'source') {
      return renderSourceRow(row.source, row.members, indented);
    }
    if (row.kind === 'part') {
      return (
        <tr
          key={row.id}
          data-testid="raw-merge-part-row"
          className="h-8 border-b border-dashed border-border-muted/60 text-[12px]"
        >
          <td
            colSpan={6}
            className={`pr-2 ${
              row.child ? (indented ? 'pl-[5.5rem]' : 'pl-16') : indented ? 'pl-[4.25rem]' : 'pl-12'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
              <span
                className={
                  row.part.included ? 'text-text-secondary' : 'text-text-muted line-through'
                }
              >
                {row.part.name}
              </span>
              {!row.part.included && (
                <span className="ml-2 text-warning">
                  {t(
                    row.part.reason === 'type_conflict'
                      ? 'data.rawSources.list.partConflict'
                      : 'data.rawSources.list.partMissingSheet'
                  )}
                </span>
              )}
            </span>
          </td>
        </tr>
      );
    }
    const isChild = row.kind === 'rawTable' && row.child;
    const sectionIndented = indented;
    const rawTable = row.kind === 'rawTable' ? row.rawTable : null;
    const draft = row.kind === 'draft' ? row.draft : null;
    const sourceKind = rawTable ? rawTable.sourceKind : 'draft';
    const cloudMirror = getCloudMirror(rawTable);
    const sourceMeta = cloudMirror ? getCloudMirrorSourceMeta() : getRawTableSourceMeta(sourceKind);
    const parts = rawTable && !isChild ? mergeParts(rawTable) : null;
    const typeIcon = cloudMirror ? (
      <CloudDownload className="h-4 w-4 flex-shrink-0 text-sky-500" />
    ) : parts && sourceKind === 'folder' ? (
      <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />
    ) : sourceKind === 'excel' ? (
      <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-emerald-600" />
    ) : sourceKind === 'csv' ? (
      <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
    ) : (
      <Table2 className="h-4 w-4 flex-shrink-0 text-accent" />
    );
    const selected = row.id === selectedRawTableId;
    const rowName =
      isChild && rawTable
        ? childDisplayName(rawTable, row.sourceName)
        : (rawTable?.name ?? draft?.name ?? '');
    const rowUpdatedAt = rawTable?.updatedAt ?? draft?.updatedAt ?? null;
    return (
      <tr
        key={row.id}
        aria-expanded={parts ? expandedMerges.has(row.id) : undefined}
        data-merge-row={parts ? 'true' : undefined}
        onClick={() => {
          setSelectedRawTableId(row.id);
          if (isChild && rawTable?.sourceId)
            lastChildBySource.current.set(rawTable.sourceId, rawTable.id);
          if (parts && rawTable) toggleMerge(rawTable.id);
        }}
        onDoubleClick={() => {
          if (draft) {
            onEditDraft(draft.id);
          } else if (rawTable) {
            onEditRawTable(rawTable.id);
          }
        }}
        data-testid={isChild ? 'raw-source-child-row' : undefined}
        className={`cursor-pointer border-b border-dashed border-border-muted/85 last:border-b-0 transition-colors ${
          isChild ? 'h-[2.625rem]' : 'h-[2.875rem]'
        } ${
          selected
            ? 'bg-accent-muted'
            : parts
              ? 'bg-[var(--data-grid-header-surface)] hover:bg-surface-hover'
              : 'hover:bg-surface-hover'
        }`}
      >
        <td
          className={`relative pr-2 ${
            isChild
              ? sectionIndented
                ? 'pl-[4.25rem]'
                : 'pl-12'
              : sectionIndented
                ? 'pl-9'
                : 'pl-2'
          } ${isChild && selected ? 'shadow-[inset_2px_0_0_var(--color-accent)]' : ''}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {isChild ? <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" /> : typeIcon}
            <div
              className={`min-w-0 truncate text-[13px] text-text-primary ${
                isChild ? '' : parts ? 'font-semibold' : 'font-medium'
              }`}
              title={
                cloudMirror
                  ? formatCloudMirrorLocation(cloudMirror)
                  : rawTable
                    ? rawTable.sourcePath
                    : t('data.rawTables.notConfigured')
              }
            >
              {rowName}
            </div>
            {parts && (
              <>
                <span className="flex-shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
                  {t('data.rawSources.list.mergeBadge')}
                </span>
              </>
            )}
          </div>
        </td>
        <td className="px-2">
          <span
            className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${sourceMeta.badgeClassName}`}
          >
            {t(sourceMeta.labelKey)}
          </span>
        </td>
        <td className="whitespace-nowrap px-2 pr-6 text-right text-[13px] tabular-nums text-text-secondary">
          {rawTable ? (
            rawTable.rowCount.toLocaleString('en-US')
          ) : (
            <span className="text-text-muted">—</span>
          )}
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
            label={
              draft
                ? t('data.rawTables.status.draft')
                : rawTable?.health
                  ? t('data.rawTables.status.abnormal')
                  : rawTable?.memberStatus === 'missing'
                    ? t('data.rawSources.list.memberMissing')
                    : t('data.rawTables.status.available')
            }
            title={rawTable?.health?.reason}
            tone={
              rawTable?.health
                ? 'error'
                : draft || rawTable?.memberStatus === 'missing'
                  ? 'warning'
                  : 'success'
            }
          />
        </td>
      </tr>
    );
  };

  const renderSourceRow = (source: DataRawSource, members: DataRawTable[], indented: boolean) => {
    const missing = members.filter((member) => member.memberStatus === 'missing').length;
    const abnormal = members.filter((member) => member.health);
    const merged = source.buildMode === 'folder_merge' || source.buildMode === 'excel_merge_sheets';
    const updatedAt = Math.max(...members.map((member) => member.updatedAt));
    const pipelines = [...new Set(members.flatMap((member) => member.relatedPipelineNames ?? []))];
    const expanded = !collapsedSources.has(source.id);
    const selected = selectedRawTableId === `source:${source.id}`;
    const icon =
      source.sourceKind === 'cloud' ? (
        <CloudDownload className="h-4 w-4 flex-shrink-0 text-sky-500" />
      ) : source.sourceKind === 'folder' ? (
        <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />
      ) : source.sourceKind === 'csv' ? (
        <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
      ) : source.buildMode === 'excel_per_sheet' ? (
        <ExcelMultiSheetIcon className="h-4 w-4 flex-shrink-0 text-emerald-600" />
      ) : (
        <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-emerald-600" />
      );
    return (
      <tr
        key={`source:${source.id}`}
        data-testid="raw-source-group-row"
        aria-expanded={expanded}
        aria-selected={selected}
        onClick={() => {
          setSelectedRawTableId(`source:${source.id}`);
          toggleSource(source.id);
        }}
        onDoubleClick={() => onOpenSource?.(source, lastChildBySource.current.get(source.id))}
        className={`h-[2.875rem] cursor-pointer border-b border-dashed border-border-muted/85 ${
          selected
            ? 'bg-accent-muted'
            : 'bg-[var(--data-grid-header-surface)] hover:bg-surface-hover'
        }`}
      >
        <td colSpan={2} className={indented ? 'pl-9 pr-2' : 'px-2'}>
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="min-w-0 truncate text-[13px] font-semibold text-text-primary">
              {source.name}
            </span>
            <span
              className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                merged ? 'bg-warning/10 text-warning' : 'bg-accent-muted text-accent'
              }`}
            >
              {merged
                ? t('data.rawSources.list.mergeBadge')
                : t('data.rawSources.list.tablesBadge', { count: source.memberIds.length })}
            </span>
          </div>
        </td>
        <td />
        <td className="px-2">
          <div className="truncate text-[13px] font-medium text-text-secondary">
            {formatRelatedPipelineNames(pipelines, t)}
          </div>
        </td>
        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
          {formatDateTime(Number.isFinite(updatedAt) ? updatedAt : null)}
        </td>
        <td className="px-2">
          <div className="flex items-center gap-1">
            <RawTableStatusBadge
              label={
                abnormal.length > 0
                  ? t('data.rawTables.status.abnormal')
                  : missing > 0
                    ? t('data.rawSources.list.missingMembers', { count: missing })
                    : t('data.rawTables.status.available')
              }
              title={abnormal
                .map((member) => `${member.name}：${member.health?.reason}`)
                .join('\n')}
              tone={abnormal.length > 0 ? 'error' : missing > 0 ? 'warning' : 'success'}
            />
            <button
              type="button"
              className="ml-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-accent disabled:opacity-50"
              disabled={actionId === `refresh-source:${source.id}`}
              title={t('data.rawSources.list.refreshSource')}
              onClick={(event) => {
                event.stopPropagation();
                onRefreshSource?.(source);
              }}
              data-testid="raw-source-group-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-2">
          {(isLoading || visibleRows.length > 0 || searchQuery.trim()) && (
            <TabBarAction>
              <button
                onClick={onCreate}
                disabled={isCreateDisabled || bulkBusy}
                className={tabBarNewCellClass}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('data.rawTables.add')}
              </button>
            </TabBarAction>
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
          {selectedRow && (
            <>
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
                  } else if (selectedSource) {
                    onOpenSource?.(
                      selectedSource,
                      lastChildBySource.current.get(selectedSource.id)
                    );
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
            </>
          )}
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
                key: 'delete-selected',
                label: t('data.rawTables.actions.delete'),
                icon: <Trash2 className="h-3.5 w-3.5" />,
                danger: true,
                disabled: !selectedRow || !!selectedSource || selectedRowBusy || bulkBusy,
                onClick: () => {
                  if (selectedDraft) {
                    onDeleteDraft(selectedDraft.id);
                  } else if (selectedRawTable) {
                    onDelete(selectedRawTable);
                  }
                },
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

      <div className="glass-table ui-table-flush flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.rawTables.loading')} />
          ) : visibleRows.length === 0 ? (
            <EmptyState
              label={emptyLabel}
              icon={<Table2 className="h-6 w-6" />}
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
              <table className="data-list-table w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
                    <th className="w-[30%] whitespace-nowrap px-2">
                      {t('data.columns.rawTableName')}
                    </th>
                    <th className="w-[10%] whitespace-nowrap px-2">
                      {t('data.columns.sourceType')}
                    </th>
                    <th className="w-[12%] whitespace-nowrap px-2 pr-6 text-right">
                      {t('data.columns.rowCount')}
                    </th>
                    <th className="w-[22%] whitespace-nowrap px-2">
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
          <RawTableAutomations
            rawTable={selectedRawTable}
            onNavigateAway={() => setAutomationsOpen(false)}
          />
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

export type MergePart = {
  name: string;
  included: boolean;
  reason?: 'missing_sheet' | 'type_conflict';
};

/** Files / sheets a merged table is built from (null when the table is not a merge). */
export function mergeParts(table: DataRawTable): MergePart[] | null {
  const config = table.inputConfig as {
    sourceKind?: string;
    mergeSheets?: string[];
    /** Sheets that were gone at the last refresh. */
    missingMergeSheets?: string[];
    mergeReport?: {
      includedFiles?: string[];
      missingSheetFiles?: string[];
      typeConflictFiles?: Array<{ file: string }>;
    };
  };
  if (config.sourceKind === 'excel' && (config.mergeSheets?.length ?? 0) > 1) {
    const missing = new Set(config.missingMergeSheets ?? []);
    return config.mergeSheets!.map((name) =>
      missing.has(name)
        ? { name, included: false, reason: 'missing_sheet' as const }
        : { name, included: true }
    );
  }
  if (config.sourceKind === 'folder' && config.mergeReport) {
    const report = config.mergeReport;
    return [
      ...(report.includedFiles ?? []).map((name) => ({ name, included: true })),
      ...(report.missingSheetFiles ?? []).map((name) => ({
        name,
        included: false,
        reason: 'missing_sheet' as const,
      })),
      ...(report.typeConflictFiles ?? []).map((item) => ({
        name: item.file,
        included: false,
        reason: 'type_conflict' as const,
      })),
    ];
  }
  return null;
}

type PanelRow =
  | { kind: 'rawTable'; id: string; rawTable: DataRawTable; child?: boolean; sourceName?: string }
  | { kind: 'part'; id: string; rawTable: DataRawTable; part: MergePart; child?: boolean }
  | {
      kind: 'source';
      id: string;
      source: DataRawSource;
      members: DataRawTable[];
      rawTable: DataRawTable;
    };

/**
 * Layout A: a source with more than one member table becomes a header row followed by its
 * members as flush child rows; single-table sources stay one plain row.
 */
export function groupBySource(
  rawTables: DataRawTable[],
  sources: DataRawSource[],
  expandedMerges: ReadonlySet<string> = new Set(),
  collapsedSources: ReadonlySet<string> = new Set()
): PanelRow[] {
  const pushParts = (rows: PanelRow[], table: DataRawTable, child: boolean) => {
    if (!expandedMerges.has(table.id)) return;
    (mergeParts(table) ?? []).forEach((part, index) =>
      rows.push({ kind: 'part', id: `part:${table.id}:${index}`, rawTable: table, part, child })
    );
  };
  const byId = new Map(sources.map((source) => [source.id, source]));
  const membersBySource = new Map<string, DataRawTable[]>();
  for (const table of rawTables) {
    const source = table.sourceId ? byId.get(table.sourceId) : undefined;
    if (!source || source.memberIds.length <= 1) continue;
    const list = membersBySource.get(source.id) ?? [];
    list.push(table);
    membersBySource.set(source.id, list);
  }
  const rows: PanelRow[] = [];
  const emitted = new Set<string>();
  for (const table of rawTables) {
    const members = table.sourceId ? membersBySource.get(table.sourceId) : undefined;
    if (!members) {
      rows.push({ kind: 'rawTable', id: table.id, rawTable: table });
      pushParts(rows, table, false);
      continue;
    }
    if (emitted.has(table.sourceId!)) continue;
    emitted.add(table.sourceId!);
    const source = byId.get(table.sourceId!)!;
    const ordered = [...members].sort(
      (a, b) => source.memberIds.indexOf(a.id) - source.memberIds.indexOf(b.id)
    );
    rows.push({
      kind: 'source',
      id: `source:${source.id}`,
      source,
      members: ordered,
      rawTable: table,
    });
    if (collapsedSources.has(source.id)) continue;
    for (const member of ordered) {
      rows.push({
        kind: 'rawTable',
        id: member.id,
        rawTable: member,
        child: true,
        sourceName: source.name,
      });
      pushParts(rows, member, true);
    }
  }
  return rows;
}

const COLLAPSED_SOURCES_KEY = 'sophron.rawSources.collapsed';

function loadCollapsedSources(): Set<string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(COLLAPSED_SOURCES_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedSources(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_SOURCES_KEY, JSON.stringify([...ids]));
  } catch {
    // storage unavailable: the state just isn't remembered
  }
}

/** Child rows show only the sheet / file part ("经营 / 目标" → "目标"). */
export function childDisplayName(table: DataRawTable, sourceName?: string): string {
  const stem = (sourceName ?? '').replace(/\.[^./\\]+$/, '');
  if (stem && table.name.startsWith(`${stem} / `)) return table.name.slice(stem.length + 3);
  return table.name;
}

export function RawTableEditor(props: RawTableEditorProps) {
  return <RawTableEditorWorkbench {...props} />;
}

export { RawTablePreviewDialog } from './raw-table-preview-dialog';
export { getDefaultRawTableConfig } from './raw-table-normalizer-utils';
