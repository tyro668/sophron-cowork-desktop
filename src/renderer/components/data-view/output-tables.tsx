import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpDown,
  Eye,
  Info,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { DataDataset, DataOutputTable } from '../../types';
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
  flatToolbarRowClass,
  formatDateTime,
  formatOutputTableRelatedTaskNames,
} from './shared';
import { Button } from '../ui/button';
import { OutputTableAutomations } from './table-automations';

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
      <div className={`${flatToolbarRowClass} justify-between`}>
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

      <div className="glass-table flex min-h-0 flex-1 flex-col rounded-none border-0">
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
  const busy = isBusy;
  const trimmedName = localName.trim();
  const canSave = Boolean(
    trimmedName &&
    !busy &&
    (trimmedName !== outputTable.name || (sourceDatasetId || null) !== outputTable.sourceDatasetId)
  );
  const handleSave = async () => {
    if (canSave) await onSave(outputTable, localName, sourceDatasetId || null);
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
      <div className={`${flatToolbarRowClass} justify-between`}>
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

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-4">
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

          <div className="col-span-full">
            <OutputTableAutomations key={outputTable.id} outputTable={outputTable} />
          </div>
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
