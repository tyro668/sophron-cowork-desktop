/**
 * Reusable grouped result-table list (user folders).
 * Used by the 结果表 page (`variant="page"`) and the 云连接 table-picker dialog
 * (`variant="picker"`).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, Folder, UploadCloud } from 'lucide-react';
import type { DataResultTable } from '../../types';
import {
  RawTableStatusBadge,
  TABLE_PAGE_SIZE,
  formatDateTime,
  formatResultTableRelatedPipelineNames,
} from './shared';
import {
  buildGroupSections,
  GroupSectionRows,
  hasNamedSections,
  toggleCollapsed,
  type DataListGroup,
} from './group-ui';
import { cn } from '../ui';
import { PickerCheck, type TableTreeSelectionMode } from './raw-table-tree';
import { TablePickerTree, type TablePickerTreeNode } from './table-picker-tree';

export type ResultTableTreeVariant = 'page' | 'picker';

export interface ResultTableTreeProps {
  resultTables: DataResultTable[];
  groups: DataListGroup[];
  groupCounts?: Record<string, number>;
  groupPages?: Record<string, number>;
  onGroupPageChange?: (groupKey: string, page: number) => void;
  isLoading?: boolean;
  variant?: ResultTableTreeVariant;
  activeId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
  onOpenTable?: (table: DataResultTable) => void;
  onRenameGroup?: (group: DataListGroup) => void;
  onDeleteGroup?: (group: DataListGroup) => void;
  selectionMode?: TableTreeSelectionMode;
  selectedIds?: readonly string[];
  disabledIds?: readonly string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  onSelect?: (table: DataResultTable) => void;
}

export function ResultTableTree({
  resultTables,
  groups,
  groupCounts = {},
  groupPages = {},
  onGroupPageChange,
  isLoading = false,
  variant = 'page',
  activeId = null,
  onActiveIdChange,
  onOpenTable,
  onRenameGroup,
  onDeleteGroup,
  selectionMode = 'none',
  selectedIds = [],
  disabledIds = [],
  onSelectedIdsChange,
  onSelect,
}: ResultTableTreeProps) {
  const { t } = useTranslation();
  const isPicker = variant === 'picker';
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const selected = new Set(selectedIds);
  const disabled = new Set(disabledIds);

  const sections = useMemo(
    () => buildGroupSections(resultTables, groups, (table) => table.groupId),
    [resultTables, groups]
  );
  const grouped = hasNamedSections(sections);
  const colSpan = isPicker ? 2 : 4;
  const pageSize = isPicker ? Number.MAX_SAFE_INTEGER : TABLE_PAGE_SIZE;

  const pickerNodes = useMemo(
    () => (isPicker ? buildResultPickerNodes(resultTables, groups, new Set(disabledIds), t) : []),
    [isPicker, resultTables, groups, disabledIds, t]
  );

  const toggleSelected = (tableId: string) => {
    if (disabled.has(tableId)) return;
    const table = resultTables.find((item) => item.id === tableId);
    if (!table) return;
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

  const renderRow = (resultTable: DataResultTable, indented = false) => {
    if (isPicker) {
      const isDisabled = disabled.has(resultTable.id);
      const isSelected = selected.has(resultTable.id);
      return (
        <tr
          key={resultTable.id}
          data-testid="result-table-tree-row"
          data-table-id={resultTable.id}
          className={cn(
            'h-12 border-b border-border-muted/70 text-[13px] transition-colors',
            isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-hover',
            isSelected && !isDisabled && 'bg-accent-muted'
          )}
          onClick={() => {
            if (!isDisabled) toggleSelected(resultTable.id);
          }}
        >
          <td className={cn('w-11', indented ? 'pl-5 pr-2' : 'pl-4 pr-2')}>
            <PickerCheck
              checked={isSelected}
              disabled={isDisabled}
              label={resultTable.name}
              onChange={() => toggleSelected(resultTable.id)}
            />
          </td>
          <td className="py-1.5 pr-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center bg-surface-muted text-accent">
                <UploadCloud className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 truncate font-medium text-text-primary">
                {resultTable.name}
              </div>
              {isDisabled && (
                <span className="flex-shrink-0 border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                  {t('cloudConnection.ds.pickerReferenced')}
                </span>
              )}
            </div>
          </td>
        </tr>
      );
    }
    const isActive = resultTable.id === activeId;
    return (
      <tr
        key={resultTable.id}
        onClick={() => onActiveIdChange?.(resultTable.id)}
        onDoubleClick={() => onOpenTable?.(resultTable)}
        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
          isActive ? 'bg-accent-muted' : 'hover:bg-surface-hover'
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

  if (isLoading) return null;

  if (isPicker) {
    return (
      <div data-testid="result-table-tree">
        <TablePickerTree
          nodes={pickerNodes}
          selectedIds={selectedIds}
          onSelectedIdsChange={onSelectedIdsChange}
          leafTestId="result-table-tree-row"
          referencedLabel={t('cloudConnection.ds.pickerReferenced')}
        />
      </div>
    );
  }

  return (
    <div className="min-w-full overflow-x-auto" data-testid="result-table-tree">
      <table className="data-list-table w-full table-fixed border-collapse text-left">
        {isPicker ? null : (
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
        )}
        <tbody>
          {sections.map((section) => (
            <GroupSectionRows
              key={section.key}
              colSpan={colSpan}
              section={section}
              grouped={grouped}
              collapsed={collapsedGroups.has(section.key)}
              onToggle={() =>
                setCollapsedGroups((current) => toggleCollapsed(current, section.key))
              }
              onRename={!isPicker && section.group ? onRenameGroup : undefined}
              onDelete={!isPicker && section.group ? onDeleteGroup : undefined}
              count={
                isPicker ? section.rows.length : (groupCounts[section.key] ?? section.rows.length)
              }
              page={isPicker ? 1 : (groupPages[section.key] ?? 1)}
              pageSize={pageSize}
              onPageChange={(page) => onGroupPageChange?.(section.key, page)}
              renderRow={(table, _index, indented) => renderRow(table, indented)}
              headerAppearance={isPicker ? 'picker' : 'default'}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildResultPickerNodes(
  resultTables: DataResultTable[],
  groups: DataListGroup[],
  disabled: Set<string>,
  t: (key: string, options?: Record<string, unknown>) => string
): TablePickerTreeNode[] {
  const sections = buildGroupSections(resultTables, groups, (table) => table.groupId);
  return sections.map((section) => ({
    id: section.key,
    kind: 'group',
    name: section.group?.name ?? t('data.groups.ungrouped'),
    icon: <Folder className="h-4 w-4" />,
    children: section.rows.map((table) => {
      const isDisabled = disabled.has(table.id);
      return {
        id: table.id,
        kind: 'table' as const,
        tableId: table.id,
        name: table.name,
        icon: <UploadCloud className="h-4 w-4 text-accent" />,
        disabled: isDisabled,
        referenced: isDisabled,
      };
    }),
  }));
}
