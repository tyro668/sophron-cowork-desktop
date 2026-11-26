import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import {
  Download,
  Eye,
  FileText,
  FolderInput,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
  Table2,
} from 'lucide-react';
import type { DataGroup, DataResultTable } from '../../types';
import {
  AssignGroupDialog,
  GroupNameDialog,
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
  LoadingState,
  flatToolbarRowClass,
} from './shared';
import { ResultTableTree } from './result-table-tree';
import { ResultTableCreateDialog } from './result-tables/ResultTableCreateDialog';
import { ResultTableEditor } from './result-tables/ResultTableEditor';
import { upstreamRawNames, useResultTableExport } from './result-tables/ResultTablePrimitives';

export { ResultTableEditor, upstreamRawNames };

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
            <ResultTableTree
              variant="page"
              resultTables={resultTables}
              groups={groups}
              groupCounts={groupCounts}
              groupPages={groupPages}
              onGroupPageChange={onGroupPageChange}
              isLoading={isLoading}
              activeId={selectedResultTableId}
              onActiveIdChange={setSelectedResultTableId}
              onOpenTable={onEdit}
              onRenameGroup={setRenameTarget}
              onDeleteGroup={onDeleteGroup}
            />
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
