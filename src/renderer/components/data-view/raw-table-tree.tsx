/**
 * Reusable grouped raw-table list (user folders + multi-member sources).
 * Used by the 原始表 page (`variant="page"`) and the 云连接 table-picker dialog
 * (`variant="picker"`).
 */
import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  CloudDownload,
  RefreshCw,
  Table2,
} from 'lucide-react';
import type { DataRawTable, DataRawSource } from '../../types';
import { isRawTableUnavailable } from '../../../shared/contracts';
import type { RawTableDraft } from '../../features/data/model/types';
import { ExcelMultiSheetIcon } from './excel-multi-sheet-icon';
import {
  RawTableStatusBadge,
  TABLE_PAGE_SIZE,
  formatDateTime,
  formatRelatedPipelineNames,
  formatCloudMirrorLocation,
  getCloudMirror,
  getCloudMirrorSourceMeta,
  getRawTableSourceMeta,
} from './shared';
import {
  buildGroupSections,
  GroupSectionRows,
  hasNamedSections,
  toggleCollapsed,
  type DataListGroup,
} from './group-ui';
import { cn } from '../ui';
import { TablePickerTree, type TablePickerTreeNode } from './table-picker-tree';
import { PickerCheck } from './picker-check';
import {
  DATA_LIST_HEADER_ROW_CLASS,
  DATA_LIST_PAGE_ROW_CLASS,
  DataListTable,
  DataListTypeIcon,
} from './data-list-table';

export { PickerCheck };

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

export type RawTableSourceRow =
  | { kind: 'rawTable'; id: string; rawTable: DataRawTable; child?: boolean; sourceName?: string }
  | { kind: 'part'; id: string; rawTable: DataRawTable; part: MergePart; child?: boolean }
  | {
      kind: 'source';
      id: string;
      source: DataRawSource;
      members: DataRawTable[];
      rawTable: DataRawTable;
    };

function isFolderRawTable(table: DataRawTable | null | undefined): boolean {
  return table?.sourceKind === 'folder' || table?.inputConfig?.sourceKind === 'folder';
}

/**
 * Layout A: a source with more than one member table becomes a header row followed by its
 * members as flush child rows; single-table sources stay one plain row.
 */
export function groupBySource(
  rawTables: DataRawTable[],
  sources: DataRawSource[],
  expandedMerges: ReadonlySet<string> = new Set(),
  collapsedSources: ReadonlySet<string> = new Set()
): RawTableSourceRow[] {
  const pushParts = (rows: RawTableSourceRow[], table: DataRawTable, child: boolean) => {
    if (isFolderRawTable(table) || !expandedMerges.has(table.id)) return;
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
  const rows: RawTableSourceRow[] = [];
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

export type RawTableTreeRow =
  { kind: 'draft'; id: string; draft: RawTableDraft } | RawTableSourceRow;

export type RawTableTreeVariant = 'page' | 'picker';
export type TableTreeSelectionMode = 'single' | 'multi' | 'none';

export interface RawTableTreeProps {
  rawTables: DataRawTable[];
  sources?: DataRawSource[];
  groups: DataListGroup[];
  groupCounts?: Record<string, number>;
  groupPages?: Record<string, number>;
  onGroupPageChange?: (groupKey: string, page: number) => void;
  drafts?: RawTableDraft[];
  isLoading?: boolean;
  variant?: RawTableTreeVariant;
  /** Page: highlight the active row. */
  activeId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
  onOpenTable?: (table: DataRawTable) => void;
  onOpenDraft?: (id: string) => void;
  onOpenSource?: (source: DataRawSource, tableId?: string) => void;
  onRefreshSource?: (source: DataRawSource) => void;
  onRenameGroup?: (group: DataListGroup) => void;
  onDeleteGroup?: (group: DataListGroup) => void;
  actionId?: string | null;
  selectionMode?: TableTreeSelectionMode;
  selectedIds?: readonly string[];
  disabledIds?: readonly string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  onSelect?: (table: DataRawTable) => void;
}

export function RawTableTree({
  rawTables,
  sources = [],
  groups,
  groupCounts = {},
  groupPages = {},
  onGroupPageChange,
  drafts = [],
  isLoading = false,
  variant = 'page',
  activeId = null,
  onActiveIdChange,
  onOpenTable,
  onOpenDraft,
  onOpenSource,
  onRefreshSource,
  onRenameGroup,
  onDeleteGroup,
  actionId = null,
  selectionMode = 'none',
  selectedIds = [],
  disabledIds = [],
  onSelectedIdsChange,
  onSelect,
}: RawTableTreeProps) {
  const { t } = useTranslation();
  const isPicker = variant === 'picker';
  const lastChildBySource = useRef(new Map<string, string>());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedMerges, setExpandedMerges] = useState<Set<string>>(new Set());
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(
    isPicker ? () => new Set() : loadCollapsedSources
  );
  const selected = new Set(selectedIds);
  const disabled = new Set(disabledIds);

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
      if (!isPicker) saveCollapsedSources(next);
      return next;
    });

  const visibleRows = useMemo(() => {
    if (isLoading) return [] as RawTableTreeRow[];
    const sourceRows = groupBySource(
      rawTables,
      sources,
      isPicker ? new Set() : expandedMerges,
      collapsedSources
    );
    if (isPicker) return sourceRows;
    return [
      ...drafts.map((draft) => ({ kind: 'draft' as const, id: draft.id, draft })),
      ...sourceRows,
    ];
  }, [rawTables, isLoading, drafts, sources, expandedMerges, collapsedSources, isPicker]);

  const pageSections = useMemo(
    () =>
      buildGroupSections(visibleRows, groups, (row) =>
        row.kind !== 'draft' ? (row.rawTable?.groupId ?? null) : null
      ),
    [visibleRows, groups]
  );
  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = { ...groupCounts };
    if (!isPicker) counts.ungrouped = (counts.ungrouped ?? 0) + drafts.length;
    return counts;
  }, [groupCounts, drafts.length, isPicker]);
  const grouped = hasNamedSections(pageSections);
  const colSpan = isPicker ? 2 : 5;
  const pageSize = isPicker ? Number.MAX_SAFE_INTEGER : TABLE_PAGE_SIZE;

  const pickerNodes = useMemo(
    () =>
      isPicker ? buildRawPickerNodes(rawTables, sources, groups, new Set(disabledIds), t) : [],
    [isPicker, rawTables, sources, groups, disabledIds, t]
  );

  const toggleSelected = (tableId: string) => {
    if (disabled.has(tableId)) return;
    const table = rawTables.find((item) => item.id === tableId);
    if (!table || isRawTableUnavailable(table)) return;
    if (selectionMode === 'single') {
      onSelectedIdsChange?.([tableId]);
      onSelect?.(table);
      return;
    }
    if (selectionMode !== 'multi') return;
    const next = new Set(selected);
    if (next.has(tableId)) next.delete(tableId);
    else next.add(tableId);
    onSelectedIdsChange?.([...next]);
    onSelect?.(table);
  };

  const renderRow = (row: RawTableTreeRow, indented = false) => {
    if (row.kind === 'source') {
      return renderSourceRow(row.source, row.members, indented, {
        isPicker,
        collapsedSources,
        activeId,
        actionId,
        lastChildBySource,
        toggleSource,
        onActiveIdChange,
        onOpenSource,
        onRefreshSource,
        t,
      });
    }
    if (row.kind === 'part') {
      return renderPartRow(row, indented, t);
    }
    if (isPicker && row.kind === 'rawTable') {
      return renderPickerTableRow(row, indented, {
        selected,
        disabled,
        toggleSelected,
        t,
      });
    }
    return renderPageTableRow(row, indented, {
      activeId,
      expandedMerges,
      lastChildBySource,
      onActiveIdChange,
      onOpenTable,
      onOpenDraft,
      toggleMerge,
      t,
    });
  };

  if (isLoading) return null;

  if (isPicker) {
    return (
      <div data-testid="raw-table-tree">
        <TablePickerTree
          nodes={pickerNodes}
          selectedIds={selectedIds}
          onSelectedIdsChange={onSelectedIdsChange}
          selectionMode={selectionMode === 'single' ? 'single' : 'multi'}
          leafTestId="raw-table-tree-row"
          sourceTestId="raw-source-group-row"
          referencedLabel={t('cloudConnection.ds.pickerReferenced')}
        />
      </div>
    );
  }

  return (
    <DataListTable
      testId="raw-table-tree"
      colSpan={colSpan}
      header={
        <tr className={DATA_LIST_HEADER_ROW_CLASS}>
          <th className="w-[34%] whitespace-nowrap px-2">{t('data.columns.rawTableName')}</th>
          <th className="w-[12%] whitespace-nowrap px-2">{t('data.columns.sourceType')}</th>
          <th className="w-[26%] whitespace-nowrap px-2">{t('data.columns.relatedPipelines')}</th>
          <th className="w-[16%] whitespace-nowrap px-2">
            <span className="inline-flex items-center gap-1">
              {t('data.columns.updatedAt')}
              <ArrowUpDown className="h-3 w-3" />
            </span>
          </th>
          <th className="w-[12%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
        </tr>
      }
    >
      {pageSections.map((section) => (
        <GroupSectionRows
          key={section.key}
          colSpan={colSpan}
          section={section}
          grouped={grouped}
          collapsed={collapsedGroups.has(section.key)}
          onToggle={() => setCollapsedGroups((current) => toggleCollapsed(current, section.key))}
          onRename={!isPicker && section.group ? onRenameGroup : undefined}
          onDelete={!isPicker && section.group ? onDeleteGroup : undefined}
          count={
            isPicker
              ? section.rows.filter((row) => row.kind === 'rawTable').length
              : (sectionCounts[section.key] ?? section.rows.length)
          }
          page={isPicker ? 1 : (groupPages[section.key] ?? 1)}
          pageSize={pageSize}
          onPageChange={(page) => onGroupPageChange?.(section.key, page)}
          renderRow={(row, _index, sectionIndented) => renderRow(row, sectionIndented)}
          headerAppearance={isPicker ? 'picker' : 'default'}
        />
      ))}
    </DataListTable>
  );
}

function renderPartRow(
  row: Extract<RawTableTreeRow, { kind: 'part' }>,
  indented: boolean,
  t: (key: string) => string
) {
  return (
    <tr
      key={row.id}
      data-testid="raw-merge-part-row"
      className="h-8 border-b border-border-muted/60 text-[12px]"
    >
      <td
        colSpan={5}
        className={`pr-2 ${
          row.child ? (indented ? 'pl-[5.5rem]' : 'pl-16') : indented ? 'pl-[4.25rem]' : 'pl-12'
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
          <span
            className={row.part.included ? 'text-text-secondary' : 'text-text-muted line-through'}
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

function renderPickerTableRow(
  row: Extract<RawTableSourceRow, { kind: 'rawTable' }>,
  indented: boolean,
  ctx: {
    selected: Set<string>;
    disabled: Set<string>;
    toggleSelected: (id: string) => void;
    t: (key: string, options?: Record<string, unknown>) => string;
  }
) {
  const isChild = Boolean(row.child);
  const table = row.rawTable;
  const isDisabled = ctx.disabled.has(table.id);
  const isSelected = ctx.selected.has(table.id);
  const name = isChild ? childDisplayName(table, row.sourceName) : table.name;
  const sourceKind = table.sourceKind ?? 'excel';
  const typeIcon =
    sourceKind === 'folder' ? (
      <Folder className="h-4 w-4 flex-shrink-0 text-text-secondary" />
    ) : sourceKind === 'excel' ? (
      <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-accent" />
    ) : sourceKind === 'csv' ? (
      <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
    ) : (
      <Table2 className="h-4 w-4 flex-shrink-0 text-accent" />
    );
  return (
    <tr
      key={row.id}
      data-testid="raw-table-tree-row"
      data-table-id={table.id}
      className={cn(
        'h-12 border-b border-border-muted/70 text-[13px] transition-colors',
        isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-hover',
        isSelected && !isDisabled && 'bg-accent-muted'
      )}
      onClick={() => {
        if (!isDisabled) ctx.toggleSelected(table.id);
      }}
    >
      <td className={cn('w-11', indented ? 'pl-5 pr-2' : 'pl-4 pr-2')}>
        {PickerCheck({
          checked: isSelected,
          disabled: isDisabled,
          label: name,
          onChange: () => ctx.toggleSelected(table.id),
        })}
      </td>
      <td className="py-1.5 pr-4">
        <div className={cn('flex min-w-0 items-center gap-3', isChild ? 'pl-8' : 'pl-0')}>
          <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center bg-surface-muted">
            {isChild && (
              <span
                aria-hidden
                className="absolute -left-5 top-[-10px] h-[calc(100%+20px)] w-px bg-border-subtle"
              />
            )}
            {typeIcon}
          </span>
          <div className="min-w-0 flex-1 truncate font-medium text-text-primary">{name}</div>
          {isDisabled && (
            <span className="flex-shrink-0 border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
              {ctx.t('cloudConnection.ds.pickerReferenced')}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function renderPageTableRow(
  row: RawTableTreeRow,
  indented: boolean,
  ctx: {
    activeId: string | null;
    expandedMerges: Set<string>;
    lastChildBySource: MutableRefObject<Map<string, string>>;
    onActiveIdChange?: (id: string | null) => void;
    onOpenTable?: (table: DataRawTable) => void;
    onOpenDraft?: (id: string) => void;
    toggleMerge: (id: string) => void;
    t: (key: string, options?: Record<string, unknown>) => string;
  }
) {
  const isChild = row.kind === 'rawTable' && row.child;
  const rawTable = row.kind === 'rawTable' ? row.rawTable : null;
  const draft = row.kind === 'draft' ? row.draft : null;
  const sourceKind = rawTable ? rawTable.sourceKind : 'draft';
  const cloudMirror = getCloudMirror(rawTable);
  const sourceMeta = cloudMirror ? getCloudMirrorSourceMeta() : getRawTableSourceMeta(sourceKind);
  const isFolderMerge = isFolderRawTable(rawTable);
  const parts = rawTable && !isChild && !isFolderMerge ? mergeParts(rawTable) : null;
  const typeIcon = cloudMirror ? (
    <CloudDownload className="h-4 w-4 flex-shrink-0 text-accent" />
  ) : sourceKind === 'folder' ? (
    <Folder className="h-4 w-4 flex-shrink-0 text-text-secondary" />
  ) : sourceKind === 'excel' ? (
    <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-accent" />
  ) : sourceKind === 'csv' ? (
    <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
  ) : (
    <Table2 className="h-4 w-4 flex-shrink-0 text-accent" />
  );
  const selected = row.id === ctx.activeId;
  const rowName =
    isChild && rawTable
      ? childDisplayName(rawTable, row.sourceName)
      : (rawTable?.name ?? draft?.name ?? '');
  const rowUpdatedAt = rawTable?.updatedAt ?? draft?.updatedAt ?? null;
  return (
    <tr
      key={row.id}
      aria-expanded={parts ? ctx.expandedMerges.has(row.id) : undefined}
      data-merge-row={parts ? 'true' : undefined}
      onClick={() => {
        ctx.onActiveIdChange?.(row.id);
        if (isChild && rawTable?.sourceId)
          ctx.lastChildBySource.current.set(rawTable.sourceId, rawTable.id);
        if (parts && rawTable) ctx.toggleMerge(rawTable.id);
      }}
      onDoubleClick={() => {
        if (draft) ctx.onOpenDraft?.(draft.id);
        else if (rawTable) ctx.onOpenTable?.(rawTable);
      }}
      data-testid={isChild ? 'raw-source-child-row' : undefined}
      className={cn(
        DATA_LIST_PAGE_ROW_CLASS,
        selected
          ? 'bg-accent-muted'
          : parts
            ? 'bg-[var(--data-grid-header-surface)] hover:bg-surface-hover'
            : 'hover:bg-surface-hover'
      )}
    >
      <td
        className={`relative pr-2 ${
          isChild ? (indented ? 'pl-[4.25rem]' : 'pl-12') : indented ? 'pl-9' : 'pl-2'
        } ${isChild && selected ? 'shadow-[inset_2px_0_0_var(--color-accent)]' : ''}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {isChild ? (
            <Table2 className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
          ) : (
            <DataListTypeIcon>{typeIcon}</DataListTypeIcon>
          )}
          <div
            className={`min-w-0 truncate text-[13px] text-text-primary ${
              isChild ? '' : parts ? 'font-semibold' : 'font-medium'
            }`}
            title={
              cloudMirror
                ? formatCloudMirrorLocation(cloudMirror)
                : rawTable
                  ? rawTable.sourcePath
                  : ctx.t('data.rawTables.notConfigured')
            }
          >
            {rowName}
          </div>
          {parts && (
            <span className="flex-shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
              {ctx.t('data.rawSources.list.mergeBadge')}
            </span>
          )}
        </div>
      </td>
      <td className="px-2">
        <span
          className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${sourceMeta.badgeClassName}`}
        >
          {ctx.t(sourceMeta.labelKey)}
        </span>
      </td>
      <td className="px-2">
        <div className="truncate text-[13px] font-medium text-text-secondary">
          {rawTable
            ? formatRelatedPipelineNames(rawTable.relatedPipelineNames, ctx.t)
            : ctx.t('data.rawTables.noRelatedPipelines')}
        </div>
      </td>
      <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
        {formatDateTime(rowUpdatedAt)}
      </td>
      <td className="px-2">
        <RawTableStatusBadge
          label={
            draft
              ? ctx.t('data.rawTables.status.draft')
              : rawTable?.health
                ? ctx.t('data.rawTables.status.abnormal')
                : isRawTableUnavailable(rawTable)
                  ? ctx.t('data.rawTables.status.unavailable')
                  : ctx.t('data.rawTables.status.available')
          }
          title={
            rawTable?.health?.reason ??
            (isRawTableUnavailable(rawTable) ? ctx.t('data.rawSources.missing.inline') : undefined)
          }
          tone={
            rawTable?.health || isRawTableUnavailable(rawTable)
              ? 'error'
              : draft
                ? 'warning'
                : 'success'
          }
        />
      </td>
    </tr>
  );
}

function renderSourceRow(
  source: DataRawSource,
  members: DataRawTable[],
  indented: boolean,
  ctx: {
    isPicker: boolean;
    collapsedSources: Set<string>;
    activeId: string | null;
    actionId: string | null;
    lastChildBySource: MutableRefObject<Map<string, string>>;
    toggleSource: (id: string) => void;
    onActiveIdChange?: (id: string | null) => void;
    onOpenSource?: (source: DataRawSource, tableId?: string) => void;
    onRefreshSource?: (source: DataRawSource) => void;
    t: (key: string, options?: Record<string, unknown>) => string;
  }
) {
  const missing = members.filter((member) => isRawTableUnavailable(member)).length;
  const abnormal = members.filter((member) => member.health);
  const merged = source.buildMode === 'folder_merge' || source.buildMode === 'excel_merge_sheets';
  const updatedAt = Math.max(...members.map((member) => member.updatedAt));
  const pipelines = [...new Set(members.flatMap((member) => member.relatedPipelineNames ?? []))];
  const expanded = !ctx.collapsedSources.has(source.id);
  const selected = ctx.activeId === `source:${source.id}`;
  const icon =
    source.sourceKind === 'cloud' ? (
      <CloudDownload className="h-4 w-4 flex-shrink-0 text-accent" />
    ) : source.sourceKind === 'folder' ? (
      <Folder className="h-4 w-4 flex-shrink-0 text-text-secondary" />
    ) : source.sourceKind === 'csv' ? (
      <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
    ) : source.buildMode === 'excel_per_sheet' ? (
      <ExcelMultiSheetIcon className="h-4 w-4 flex-shrink-0 text-accent" />
    ) : (
      <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-accent" />
    );
  if (ctx.isPicker) {
    return (
      <tr
        key={`source:${source.id}`}
        data-testid="raw-source-group-row"
        aria-expanded={expanded}
        onClick={() => ctx.toggleSource(source.id)}
        className="h-11 cursor-pointer border-b border-border-muted/70 bg-surface-muted/60 hover:bg-surface-hover"
      >
        <td className={cn('w-11', indented ? 'pl-5 pr-2' : 'pl-4 pr-2')} />
        <td className="pr-4">
          <div className="flex min-w-0 items-center gap-2">
            <ChevronRight
              className={cn(
                'h-4 w-4 flex-shrink-0 text-text-muted transition-transform',
                expanded && 'rotate-90'
              )}
            />
            {icon}
            <span className="min-w-0 truncate text-[13px] font-semibold text-text-primary">
              {source.name}
            </span>
            <span
              className={cn(
                'flex-shrink-0 px-1.5 py-0.5 text-[11px] font-medium',
                merged ? 'bg-warning/10 text-warning' : 'bg-accent-muted text-accent'
              )}
            >
              {merged
                ? ctx.t('data.rawSources.list.mergeBadge')
                : ctx.t('data.rawSources.list.tablesBadge', { count: source.memberIds.length })}
            </span>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr
      key={`source:${source.id}`}
      data-testid="raw-source-group-row"
      aria-expanded={expanded}
      aria-selected={selected}
      onClick={() => {
        ctx.onActiveIdChange?.(`source:${source.id}`);
        ctx.toggleSource(source.id);
      }}
      onDoubleClick={() => ctx.onOpenSource?.(source, ctx.lastChildBySource.current.get(source.id))}
      className={cn(
        DATA_LIST_PAGE_ROW_CLASS,
        selected ? 'bg-accent-muted' : 'bg-[var(--data-grid-header-surface)] hover:bg-surface-hover'
      )}
    >
      <td colSpan={2} className={indented ? 'pl-9 pr-2' : 'px-2'}>
        <div className="flex min-w-0 items-center gap-3">
          <DataListTypeIcon>{icon}</DataListTypeIcon>
          <span className="min-w-0 truncate text-[13px] font-semibold text-text-primary">
            {source.name}
          </span>
          <span
            className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
              merged ? 'bg-warning/10 text-warning' : 'bg-accent-muted text-accent'
            }`}
          >
            {merged
              ? ctx.t('data.rawSources.list.mergeBadge')
              : ctx.t('data.rawSources.list.tablesBadge', { count: source.memberIds.length })}
          </span>
        </div>
      </td>
      <td className="px-2">
        <div className="truncate text-[13px] font-medium text-text-secondary">
          {formatRelatedPipelineNames(pipelines, ctx.t)}
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
                ? ctx.t('data.rawTables.status.abnormal')
                : missing > 0
                  ? ctx.t('data.rawSources.list.missingMembers', { count: missing })
                  : ctx.t('data.rawTables.status.available')
            }
            title={
              abnormal.length > 0
                ? abnormal.map((member) => `${member.name}：${member.health?.reason}`).join('\n')
                : missing > 0
                  ? ctx.t('data.rawSources.missing.inline')
                  : undefined
            }
            tone={abnormal.length > 0 || missing > 0 ? 'error' : 'success'}
          />
          <button
            type="button"
            className="ml-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-accent disabled:opacity-50"
            disabled={ctx.actionId === `refresh-source:${source.id}`}
            title={ctx.t('data.rawSources.list.refreshSource')}
            onClick={(event) => {
              event.stopPropagation();
              ctx.onRefreshSource?.(source);
            }}
            data-testid="raw-source-group-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function rawPickerIcon(sourceKind: string | undefined) {
  if (sourceKind === 'folder') return <Folder className="h-4 w-4 text-text-secondary" />;
  if (sourceKind === 'excel') return <FileSpreadsheet className="h-4 w-4 text-accent" />;
  if (sourceKind === 'csv') return <FileText className="h-4 w-4 text-accent" />;
  if (sourceKind === 'cloud') return <CloudDownload className="h-4 w-4 text-accent" />;
  return <Table2 className="h-4 w-4 text-accent" />;
}

function rawPickerTableNode(
  table: DataRawTable,
  disabled: Set<string>,
  t: (key: string, options?: Record<string, unknown>) => string,
  sourceName?: string
): TablePickerTreeNode {
  const kind = table.sourceKind ?? 'excel';
  const name = sourceName ? childDisplayName(table, sourceName) : table.name;
  const isReferenced = disabled.has(table.id);
  const isUnavailable = isRawTableUnavailable(table);
  return {
    id: table.id,
    kind: 'table',
    tableId: table.id,
    name,
    icon: rawPickerIcon(kind),
    disabled: isReferenced || isUnavailable,
    referenced: isReferenced || isUnavailable,
    referencedLabel:
      isUnavailable && !isReferenced ? t('data.rawTables.status.unavailable') : undefined,
  };
}

function buildRawPickerNodes(
  rawTables: DataRawTable[],
  sources: DataRawSource[],
  groups: DataListGroup[],
  disabled: Set<string>,
  t: (key: string, options?: Record<string, unknown>) => string
): TablePickerTreeNode[] {
  const sections = buildGroupSections(rawTables, groups, (table) => table.groupId ?? null);
  return sections.map((section) => {
    const rows = groupBySource(section.rows, sources, new Set(), new Set());
    const children: TablePickerTreeNode[] = [];
    for (const row of rows) {
      if (row.kind === 'source') {
        const sourceKind = row.source.sourceKind;
        children.push({
          id: row.id,
          kind: 'source',
          name: row.source.name,
          icon: rawPickerIcon(sourceKind),
          children: row.members.map((table) =>
            rawPickerTableNode(table, disabled, t, row.source.name)
          ),
        });
      } else if (row.kind === 'rawTable' && !row.child) {
        children.push(rawPickerTableNode(row.rawTable, disabled, t));
      }
    }
    return {
      id: section.key,
      kind: 'group',
      name: section.group?.name ?? t('data.groups.ungrouped'),
      icon: <Folder className="h-4 w-4" />,
      children,
    };
  });
}
