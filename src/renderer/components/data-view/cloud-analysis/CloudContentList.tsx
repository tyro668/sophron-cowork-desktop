import {
  Database,
  Eye,
  ListChecks,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Table2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatByteSize } from '../../../utils/i18n-format';
import type {
  PersonalAnalysisDriveFile,
  PersonalAnalysisProject,
  PersonalAnalysisTable,
} from '../../../types';
import { Button } from '../../ui/button';
import {
  DataMoreMenu,
  DataToolbarButton,
  EmptyState,
  LoadingState,
  fixedTabWidthClass,
  formatDateTime,
} from '../shared';
import {
  getCloudTableSourceType,
  getDriveFileMeta,
  type ListTab,
  type PagedPageInfo,
  type SelectedProject,
} from './helpers';

interface CloudContentListProps {
  listTab: ListTab;
  onListTabChange: (tab: ListTab) => void;
  selectedProject: SelectedProject | null;
  selectedProjectRecord: PersonalAnalysisProject | null;
  showListLocator: boolean;
  showTableLocator: boolean;
  showFileLocator: boolean;
  tables: PersonalAnalysisTable[];
  tablePageInfo: PagedPageInfo;
  loadingTables: boolean;
  loadingMoreTables: boolean;
  selectedTables: PersonalAnalysisTable[];
  selectedTableIdSet: Set<string>;
  singleSelectedTable: PersonalAnalysisTable | null;
  allVisibleTablesSelected: boolean;
  focusedTableId: string | null;
  driveFiles: PersonalAnalysisDriveFile[];
  driveFilePageInfo: PagedPageInfo;
  loadingDriveFiles: boolean;
  loadingMoreDriveFiles: boolean;
  selectedFiles: PersonalAnalysisDriveFile[];
  selectedFileIdSet: Set<string>;
  singleSelectedFile: PersonalAnalysisDriveFile | null;
  allVisibleFilesSelected: boolean;
  batchSelectMode: boolean;
  importingTableId: string | null;
  addingToChat: boolean;
  onStartProjectLookup: () => void;
  onLoadMoreTables: () => void;
  onLoadMoreFiles: () => void;
  onToggleBatchSelectMode: () => void;
  onPreviewFile: (file: PersonalAnalysisDriveFile) => void;
  onPreviewTable: (table: PersonalAnalysisTable) => void;
  onImportTable: (table: PersonalAnalysisTable) => void;
  onScheduleTableSync: (table: PersonalAnalysisTable) => void;
  onAddSelectedTablesToChat: () => void;
  onToggleAllVisibleFiles: () => void;
  onSelectFileRow: (fileId: string) => void;
  onToggleAllVisibleTables: () => void;
  onSelectTableRow: (tableId: string) => void;
}

export function CloudContentList({
  listTab,
  onListTabChange,
  selectedProject,
  selectedProjectRecord,
  showListLocator,
  showTableLocator,
  showFileLocator,
  tables,
  tablePageInfo,
  loadingTables,
  loadingMoreTables,
  selectedTables,
  selectedTableIdSet,
  singleSelectedTable,
  allVisibleTablesSelected,
  focusedTableId,
  driveFiles,
  driveFilePageInfo,
  loadingDriveFiles,
  loadingMoreDriveFiles,
  selectedFiles,
  selectedFileIdSet,
  singleSelectedFile,
  allVisibleFilesSelected,
  batchSelectMode,
  importingTableId,
  addingToChat,
  onStartProjectLookup,
  onLoadMoreTables,
  onLoadMoreFiles,
  onToggleBatchSelectMode,
  onPreviewFile,
  onPreviewTable,
  onImportTable,
  onScheduleTableSync,
  onAddSelectedTablesToChat,
  onToggleAllVisibleFiles,
  onSelectFileRow,
  onToggleAllVisibleTables,
  onSelectTableRow,
}: CloudContentListProps) {
  const { t } = useTranslation();

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-10 flex-shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <div className="flex min-w-0 items-center gap-3 text-xs font-medium text-text-muted">
          {listTab === 'tables' && !showTableLocator && (
            <>
              <span className="truncate">
                {t('cloudData.tableCountLoaded', {
                  count: tables.length,
                  total: tablePageInfo.total,
                })}
              </span>
              {selectedTables.length > 0 && (
                <span className="text-text-secondary">
                  {t('cloudData.selectedTableCount', { count: selectedTables.length })}
                </span>
              )}
              {tablePageInfo.hasMore && (
                <button
                  onClick={onLoadMoreTables}
                  disabled={loadingMoreTables}
                  className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMoreTables ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {t('cloudData.loadMoreTables')}
                </button>
              )}
            </>
          )}
          {listTab === 'files' && !showFileLocator && (
            <>
              <span className="truncate">
                {t('cloudData.fileCountLoaded', {
                  count: driveFiles.length,
                  total: driveFilePageInfo.total,
                })}
              </span>
              {selectedFiles.length > 0 && (
                <span className="text-text-secondary">
                  {t('cloudData.selectedFileCount', { count: selectedFiles.length })}
                </span>
              )}
              {driveFilePageInfo.hasMore && (
                <button
                  onClick={onLoadMoreFiles}
                  disabled={loadingMoreDriveFiles}
                  className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMoreDriveFiles ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {t('cloudData.loadMoreFiles')}
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DataToolbarButton
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('cloudData.preview')}
            disabled={listTab === 'files' ? !singleSelectedFile : !singleSelectedTable}
            onClick={() => {
              if (listTab === 'files') {
                if (singleSelectedFile) onPreviewFile(singleSelectedFile);
              } else if (singleSelectedTable) {
                onPreviewTable(singleSelectedTable);
              }
            }}
          />
          <DataToolbarButton
            icon={<ListChecks className="h-3.5 w-3.5" />}
            label={batchSelectMode ? t('cloudData.exitBatchSelect') : t('cloudData.batchSelect')}
            active={batchSelectMode}
            onClick={onToggleBatchSelectMode}
          />
          <DataMoreMenu
            items={[
              {
                key: 'import-raw-table',
                label:
                  singleSelectedTable && importingTableId === singleSelectedTable.tableId
                    ? t('cloudData.importing')
                    : t('cloudData.importNow'),
                icon:
                  singleSelectedTable && importingTableId === singleSelectedTable.tableId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Database className="h-3.5 w-3.5" />
                  ),
                disabled: listTab !== 'tables' || !singleSelectedTable || importingTableId !== null,
                onClick: () => {
                  if (singleSelectedTable) {
                    onImportTable(singleSelectedTable);
                  }
                },
              },
              {
                key: 'schedule-sync',
                label: t('cloudData.scheduleSync'),
                icon: <RefreshCw className="h-3.5 w-3.5" />,
                disabled: listTab !== 'tables' || !singleSelectedTable,
                onClick: () => {
                  if (singleSelectedTable) {
                    onScheduleTableSync(singleSelectedTable);
                  }
                },
              },
              {
                key: 'add-to-chat',
                label:
                  selectedTables.length > 0
                    ? `${t('cloudData.addToChat')} (${selectedTables.length})`
                    : t('cloudData.addToChat'),
                icon: <MessageSquarePlus className="h-3.5 w-3.5" />,
                disabled: listTab !== 'tables' || selectedTables.length === 0 || addingToChat,
                onClick: onAddSelectedTablesToChat,
              },
            ]}
          />
        </div>
      </div>

      {showListLocator ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-auto">
          <EmptyState
            label={selectedProject ? t('cloudData.listNotLoaded') : t('cloudData.locateTitle')}
            description={
              selectedProject
                ? t('cloudData.locateTablesInProjectDesc', {
                    project: selectedProjectRecord?.projectName ?? '',
                  })
                : t('cloudData.locateTablesDesc')
            }
            action={
              selectedProject ? (
                <Button variant="primary" className="shadow-soft" onClick={onStartProjectLookup}>
                  <ListPlus className="h-4 w-4" />
                  {t('cloudData.loadList')}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            {listTab === 'files' ? (
              loadingDriveFiles ? (
                <LoadingState label={t('cloudData.loadingFiles')} />
              ) : driveFiles.length === 0 ? (
                <EmptyState label={t('cloudData.noFiles')} />
              ) : (
                <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
                  <thead className="sticky top-0 z-10">
                    <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
                      {batchSelectMode && (
                        <th className="w-[4.5rem] px-4">
                          <input
                            type="checkbox"
                            checked={allVisibleFilesSelected}
                            onChange={onToggleAllVisibleFiles}
                            className="h-3.5 w-3.5 accent-accent"
                            aria-label={t('cloudData.selectAllTables')}
                            title={t('cloudData.selectAllTables')}
                          />
                        </th>
                      )}
                      <th className="whitespace-nowrap px-2">{t('cloudData.fileName')}</th>
                      <th className="w-[13%] whitespace-nowrap px-2">{t('cloudData.fileType')}</th>
                      <th className="w-[12%] whitespace-nowrap px-2">{t('cloudData.fileSize')}</th>
                      <th className="w-[20%] whitespace-nowrap px-2">
                        {t('data.columns.updatedAt')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {driveFiles.map((file) => {
                      const isSelected = selectedFileIdSet.has(file.fileId);
                      const fileMeta = getDriveFileMeta(file);
                      const updatedAt = file.updatedAt ? Date.parse(file.updatedAt) : NaN;

                      return (
                        <tr
                          key={file.fileId}
                          onClick={() => onSelectFileRow(file.fileId)}
                          className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                            isSelected
                              ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
                              : 'hover:bg-surface-hover/35'
                          }`}
                        >
                          {batchSelectMode && (
                            <td className="px-4">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => onSelectFileRow(file.fileId)}
                                onClick={(event) => event.stopPropagation()}
                                className="h-3.5 w-3.5 accent-accent"
                                aria-label={file.fileName}
                              />
                            </td>
                          )}
                          <td className="px-2 py-1.5">
                            <div className="flex min-w-0 items-center gap-3">
                              <div
                                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${fileMeta.badgeClassName}`}
                              >
                                <fileMeta.Icon className="h-4 w-4" />
                              </div>
                              <div className="truncate text-[13px] font-medium text-text-secondary">
                                {file.fileName}
                              </div>
                            </div>
                          </td>
                          <td className="px-2">
                            <span
                              className={`inline-flex h-6 max-w-full items-center rounded-md px-2 text-xs font-medium ${fileMeta.badgeClassName}`}
                            >
                              <span className="truncate">{fileMeta.label}</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                            {formatByteSize(file.size, '-')}
                          </td>
                          <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                            {formatDateTime(Number.isFinite(updatedAt) ? updatedAt : null)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : loadingTables ? (
              <LoadingState label={t('cloudData.loadingTables')} />
            ) : tables.length === 0 ? (
              <EmptyState label={t('cloudData.noTables')} />
            ) : (
              <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
                    {batchSelectMode && (
                      <th className="w-[4.5rem] px-4">
                        <input
                          type="checkbox"
                          checked={allVisibleTablesSelected}
                          onChange={onToggleAllVisibleTables}
                          className="h-3.5 w-3.5 accent-accent"
                          aria-label={t('cloudData.selectAllTables')}
                          title={t('cloudData.selectAllTables')}
                        />
                      </th>
                    )}
                    <th className="whitespace-nowrap px-2">{t('cloudData.tableName')}</th>
                    <th className="w-[13%] whitespace-nowrap px-2">{t('cloudData.sourceType')}</th>
                    <th className="w-[12%] whitespace-nowrap px-2">{t('cloudData.rows')}</th>
                    <th className="w-[20%] whitespace-nowrap px-2">
                      {t('data.columns.updatedAt')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((table) => {
                    const isSelected = selectedTableIdSet.has(table.tableId);
                    const sourceType = getCloudTableSourceType(
                      table,
                      t('cloudData.unknownSourceType')
                    );
                    const kindLabel =
                      table.kind === 'base'
                        ? t('cloudData.kindBase')
                        : table.kind === 'analysis'
                          ? t('cloudData.kindAnalysis')
                          : null;
                    const updatedAt = table.updatedAt ? Date.parse(table.updatedAt) : NaN;

                    return (
                      <tr
                        key={table.tableId}
                        id={`cloud-table-row-${table.tableId}`}
                        onClick={() => onSelectTableRow(table.tableId)}
                        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                          isSelected
                            ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
                            : table.tableId === focusedTableId
                              ? 'bg-accent-muted/60 ring-1 ring-inset ring-accent/40'
                              : 'hover:bg-surface-hover/35'
                        }`}
                      >
                        {batchSelectMode && (
                          <td className="px-4">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => onSelectTableRow(table.tableId)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-3.5 w-3.5 accent-accent"
                              aria-label={table.tableName}
                            />
                          </td>
                        )}
                        <td className="px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
                              <Table2 className="h-4 w-4" />
                            </div>
                            <div className="truncate text-[13px] font-medium text-text-secondary">
                              {table.tableName}
                            </div>
                          </div>
                        </td>
                        <td className="px-2">
                          <span
                            className={`inline-flex h-6 max-w-full items-center rounded-md px-2 text-xs font-medium ${
                              table.kind === 'base'
                                ? 'bg-surface-active text-text-secondary'
                                : 'bg-accent-muted text-accent'
                            }`}
                          >
                            <span className="truncate">{kindLabel ?? sourceType}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                          {typeof table.rowCount === 'number'
                            ? table.rowCount.toLocaleString()
                            : '-'}
                        </td>
                        <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                          {formatDateTime(Number.isFinite(updatedAt) ? updatedAt : null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex h-12 flex-shrink-0 items-stretch border-t border-border-muted">
            {(['tables', 'files'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onListTabChange(tab)}
                title={t(tab === 'tables' ? 'cloudData.tablesTab' : 'cloudData.filesTab')}
                data-fixed-tab
                className={`relative flex h-full items-center border-r border-border-subtle text-xs font-medium transition-colors ${fixedTabWidthClass} ${
                  listTab === tab
                    ? 'bg-accent-muted/60 text-accent'
                    : 'text-text-secondary hover:bg-surface-hover/50 hover:text-text-primary'
                }`}
              >
                {listTab === tab && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
                <span className="truncate">
                  {t(tab === 'tables' ? 'cloudData.tablesTab' : 'cloudData.filesTab')}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
