import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, Eye, PencilLine, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { DataDataset, DataInputTableConfig, DataInputTableSourceKind } from '../../types';
import { GlassSelect } from '../GlassSelect';
import type { InputTableDraft, InputTableSourceFilter } from '../../features/data/model/types';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  InputTableStatusBadge,
  LoadingState,
  PaginationFooter,
  TABLE_PAGE_SIZE,
  formatDateTime,
  formatDisplayPath,
  formatRelatedTaskNames,
  getInputTableSourceMeta,
  getTablePageCount,
  matchesSearchText,
} from './shared';
import { InputTableEditorWorkbench } from './input-table-editor-workbench';

const INPUT_TABLE_SOURCE_FILTERS: Array<{
  value: InputTableSourceFilter;
  labelKey: string;
}> = [
  { value: 'all', labelKey: 'data.inputTables.sources.all' },
  { value: 'excel', labelKey: 'data.inputTables.sources.excel' },
  { value: 'csv', labelKey: 'data.inputTables.sources.csv' },
  { value: 'folder', labelKey: 'data.inputTables.sources.folder' },
];

export function InputTablesPanel({
  datasets,
  drafts,
  totalDatasets,
  currentPage,
  searchQuery,
  isLoading,
  sourceFilter,
  onSearchChange,
  onSourceFilterChange,
  onPageChange,
  onCreate,
  onRefresh,
  onPreviewDataset,
  onDelete,
  onDeleteAll,
  onDeleteDraft,
  onEditDraft,
  onEditDataset,
  isCreateDisabled,
  actionId,
}: {
  datasets: DataDataset[];
  drafts: InputTableDraft[];
  totalDatasets: number;
  currentPage: number;
  searchQuery: string;
  isLoading: boolean;
  sourceFilter: InputTableSourceFilter;
  onSearchChange: (value: string) => void;
  onSourceFilterChange: (source: InputTableSourceFilter) => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onPreviewDataset: (dataset: DataDataset) => void;
  onDelete: (dataset: DataDataset) => void;
  onDeleteAll: () => void;
  onDeleteDraft: (id: string) => void;
  onEditDraft: (id: string) => void;
  onEditDataset: (id: string) => void;
  isCreateDisabled: boolean;
  actionId: string | null;
}) {
  const { t } = useTranslation();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const filteredDrafts = useMemo(
    () =>
      sourceFilter === 'all'
        ? drafts.filter((draft) => matchesSearchText(draft.name, searchQuery))
        : [],
    [drafts, searchQuery, sourceFilter]
  );
  const draftCount = filteredDrafts.length;
  const totalRows = totalDatasets + draftCount;
  const pageCount = getTablePageCount(totalRows);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const draftStart = (safeCurrentPage - 1) * TABLE_PAGE_SIZE;
  const pageDrafts = useMemo(
    () =>
      !isLoading && sourceFilter === 'all'
        ? filteredDrafts.slice(draftStart, draftStart + TABLE_PAGE_SIZE)
        : [],
    [draftStart, filteredDrafts, isLoading, sourceFilter]
  );
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
  const emptyLabel =
    sourceFilter === 'all' ? t('data.inputTables.empty') : t('data.inputTables.emptyFiltered');
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
            {t('data.inputTables.add')}
          </button>
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.inputTables.searchPlaceholder')}
          />
          <label className="block w-32">
            <span className="sr-only">{t('data.inputTables.sourceFilter')}</span>
            <GlassSelect
              value={sourceFilter}
              onValueChange={(value) => onSourceFilterChange(value as InputTableSourceFilter)}
              options={INPUT_TABLE_SOURCE_FILTERS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
              disabled={bulkBusy}
              triggerClassName="h-8 w-full justify-between rounded-lg bg-surface pl-3 text-xs font-medium text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:opacity-45"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
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

      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <LoadingState label={t('data.inputTables.loading')} />
          ) : visibleRows.length === 0 ? (
            <EmptyState label={emptyLabel} />
          ) : (
            <div className="min-w-full overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
                    <th className="w-[4%] px-4">
                      <span className="sr-only">{t('data.inputTables.selection')}</span>
                    </th>
                    <th className="w-[22%] whitespace-nowrap px-2">
                      {t('data.columns.inputTableName')}
                    </th>
                    <th className="w-[9%] whitespace-nowrap px-2">
                      {t('data.columns.sourceType')}
                    </th>
                    <th className="w-[22%] whitespace-nowrap px-2">
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
                  {pageRows.map((row, index) => {
                    const dataset = row.kind === 'dataset' ? row.dataset : null;
                    const draft = row.kind === 'draft' ? row.draft : null;
                    const sourceKind = dataset ? dataset.sourceKind : 'draft';
                    const sourceMeta = getInputTableSourceMeta(sourceKind);
                    const SourceIcon = sourceMeta.Icon;
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
                            ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                            : index === 1
                              ? 'bg-accent/5'
                              : 'hover:bg-surface-hover/35'
                        }`}
                      >
                        <td className="px-4">
                          <input
                            type="radio"
                            name="input-table-selection"
                            checked={selected}
                            onChange={() => setSelectedDatasetId(row.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-3.5 w-3.5 accent-accent"
                            aria-label={rowName}
                          />
                        </td>
                        <td className="px-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${sourceMeta.className}`}
                            >
                              <SourceIcon className="h-4 w-4" />
                            </div>
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
                            title={dataset?.sourcePath}
                          >
                            {dataset
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
                              draft
                                ? t('data.inputTables.status.draft')
                                : t('data.inputTables.status.available')
                            }
                            tone={draft ? 'warning' : 'success'}
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
          count={totalRows}
          currentPage={currentPage}
          onPageChange={onPageChange}
          embedded
        />
      </div>
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
    />
  );
}

export { InputTablePreviewDialog } from './input-table-preview-dialog';
export { getDefaultInputTableConfig } from './input-table-normalizer-utils';
