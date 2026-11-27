import type { ReactNode } from 'react';
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
import { cn } from '../../ui';
import { Button } from '../../ui/button';
import {
  DataMoreMenu,
  EmptyState,
  LoadingState,
  fixedTabWidthClass,
  formatDateTime,
} from '../shared';
import {
  DATA_LIST_HEADER_ROW_CLASS,
  DATA_LIST_PAGE_ROW_CLASS,
  DataListTable,
  DataListTypeIcon,
} from '../data-list-table';
import { titleCellClass } from '../raw-source-wizard';
import {
  getCloudTableSourceType,
  getDriveFileMeta,
  type ListTab,
  type PagedPageInfo,
  type SelectedProject,
} from './helpers';

function HeaderAction({
  children,
  onClick,
  disabled,
  active,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={cn(titleCellClass, active ? 'bg-accent-muted text-accent' : 'text-accent')}
    >
      {children}
    </button>
  );
}

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
    <section className="flex min-w-0 flex-1 flex-col bg-surface">
      <div
        className="flex h-12 flex-shrink-0 items-stretch justify-between border-b border-border-subtle"
        data-testid="cloud-content-header"
      >
        <div className="flex min-w-0 items-center gap-3 px-3">
          {selectedProjectRecord?.projectName && (
            <span className="min-w-0 truncate text-[14px] font-semibold text-text-primary">
              {selectedProjectRecord.projectName}
            </span>
          )}
          {listTab === 'tables' && !showTableLocator && (
            <div className="flex min-w-0 flex-shrink-0 items-center gap-3 text-xs font-medium text-text-muted tabular-nums">
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
                  type="button"
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
            </div>
          )}
          {listTab === 'files' && !showFileLocator && (
            <div className="flex min-w-0 flex-shrink-0 items-center gap-3 text-xs font-medium text-text-muted tabular-nums">
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
                  type="button"
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
            </div>
          )}
        </div>
        {selectedProject && (
          <div className="flex flex-shrink-0 items-stretch">
            <HeaderAction
              testId="cloud-analysis-preview"
              disabled={listTab === 'files' ? !singleSelectedFile : !singleSelectedTable}
              onClick={() => {
                if (listTab === 'files') {
                  if (singleSelectedFile) onPreviewFile(singleSelectedFile);
                } else if (singleSelectedTable) {
                  onPreviewTable(singleSelectedTable);
                }
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              {t('cloudData.preview')}
            </HeaderAction>
            <HeaderAction
              testId="cloud-analysis-batch-select"
              active={batchSelectMode}
              onClick={onToggleBatchSelectMode}
            >
              <ListChecks className="h-3.5 w-3.5" />
              {batchSelectMode ? t('cloudData.exitBatchSelect') : t('cloudData.batchSelect')}
            </HeaderAction>
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
                  disabled:
                    listTab !== 'tables' || !singleSelectedTable || importingTableId !== null,
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
        )}
      </div>

      {showListLocator ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
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
                <Button variant="primary" onClick={onStartProjectLookup}>
                  <ListPlus className="h-4 w-4" />
                  {t('cloudData.loadList')}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto bg-surface">
            {listTab === 'files' ? (
              loadingDriveFiles ? (
                <LoadingState label={t('cloudData.loadingFiles')} />
              ) : driveFiles.length === 0 ? (
                <EmptyState label={t('cloudData.noFiles')} />
              ) : (
                <DataListTable
                  testId="cloud-file-list-table"
                  colSpan={batchSelectMode ? 5 : 4}
                  header={
                    <tr className={DATA_LIST_HEADER_ROW_CLASS}>
                      {batchSelectMode && (
                        <th className="w-11 px-3 text-center">
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
                      <th className="whitespace-nowrap px-3">{t('cloudData.fileName')}</th>
                      <th className="w-[14%] whitespace-nowrap px-3">{t('cloudData.fileType')}</th>
                      <th className="w-[13%] whitespace-nowrap px-3">{t('cloudData.fileSize')}</th>
                      <th className="w-[21%] whitespace-nowrap px-3">
                        {t('data.columns.updatedAt')}
                      </th>
                    </tr>
                  }
                >
                  {driveFiles.map((file) => {
                    const isSelected = selectedFileIdSet.has(file.fileId);
                    const fileMeta = getDriveFileMeta(file);
                    const updatedAt = file.updatedAt ? Date.parse(file.updatedAt) : NaN;

                    return (
                      <tr
                        key={file.fileId}
                        onClick={() => onSelectFileRow(file.fileId)}
                        className={cn(
                          DATA_LIST_PAGE_ROW_CLASS,
                          isSelected ? 'bg-accent-muted' : 'hover:bg-surface-hover'
                        )}
                      >
                        {batchSelectMode && (
                          <td className="px-3 text-center">
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
                        <td className="px-3 py-1.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={cn(
                                'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                                fileMeta.badgeClassName
                              )}
                            >
                              <fileMeta.Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 truncate text-[13px] font-medium text-text-primary">
                              {file.fileName}
                            </span>
                          </div>
                        </td>
                        <td className="px-3">
                          <span
                            className={cn(
                              'inline-flex h-6 max-w-full items-center rounded-md px-2 text-xs font-medium',
                              fileMeta.badgeClassName
                            )}
                          >
                            <span className="truncate">{fileMeta.label}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 text-[13px] font-medium tabular-nums text-text-secondary">
                          {formatByteSize(file.size, '-')}
                        </td>
                        <td className="whitespace-nowrap px-3 text-[13px] font-medium tabular-nums text-text-secondary">
                          {formatDateTime(Number.isFinite(updatedAt) ? updatedAt : null)}
                        </td>
                      </tr>
                    );
                  })}
                </DataListTable>
              )
            ) : loadingTables ? (
              <LoadingState label={t('cloudData.loadingTables')} />
            ) : tables.length === 0 ? (
              <EmptyState label={t('cloudData.noTables')} />
            ) : (
              <DataListTable
                testId="cloud-table-list-table"
                colSpan={batchSelectMode ? 5 : 4}
                header={
                  <tr className={DATA_LIST_HEADER_ROW_CLASS}>
                    {batchSelectMode && (
                      <th className="w-11 px-3 text-center">
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
                    <th className="whitespace-nowrap px-3">{t('cloudData.tableName')}</th>
                    <th className="w-[14%] whitespace-nowrap px-3">{t('cloudData.sourceType')}</th>
                    <th className="w-[13%] whitespace-nowrap px-3">{t('cloudData.rows')}</th>
                    <th className="w-[21%] whitespace-nowrap px-3">
                      {t('data.columns.updatedAt')}
                    </th>
                  </tr>
                }
              >
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
                      className={cn(
                        DATA_LIST_PAGE_ROW_CLASS,
                        isSelected
                          ? 'bg-accent-muted'
                          : table.tableId === focusedTableId
                            ? 'bg-accent-muted/60'
                            : 'hover:bg-surface-hover'
                      )}
                    >
                      {batchSelectMode && (
                        <td className="px-3 text-center">
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
                      <td className="px-3 py-1.5">
                        <div className="flex min-w-0 items-center gap-3">
                          <DataListTypeIcon>
                            <Table2 className="h-4 w-4 text-accent" />
                          </DataListTypeIcon>
                          <span className="min-w-0 truncate text-[13px] font-medium text-text-primary">
                            {table.tableName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3">
                        <span
                          className={cn(
                            'inline-flex h-6 max-w-full items-center rounded-md px-2 text-xs font-medium',
                            table.kind === 'base'
                              ? 'bg-surface-active text-text-secondary'
                              : 'bg-accent-muted text-accent'
                          )}
                        >
                          <span className="truncate">{kindLabel ?? sourceType}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 text-[13px] font-medium tabular-nums text-text-secondary">
                        {typeof table.rowCount === 'number' ? table.rowCount.toLocaleString() : '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 text-[13px] font-medium tabular-nums text-text-secondary">
                        {formatDateTime(Number.isFinite(updatedAt) ? updatedAt : null)}
                      </td>
                    </tr>
                  );
                })}
              </DataListTable>
            )}
          </div>
          <div className="flex h-12 flex-shrink-0 items-stretch border-t border-border-subtle bg-surface">
            {(['tables', 'files'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onListTabChange(tab)}
                title={t(tab === 'tables' ? 'cloudData.tablesTab' : 'cloudData.filesTab')}
                data-fixed-tab
                className={`relative flex h-full items-center border-r border-border-subtle text-xs font-medium transition-colors ${fixedTabWidthClass} ${
                  listTab === tab
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                {listTab === tab && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
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
