import { useAppStore } from '../../store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarClock,
  CloudDownload,
  Eye,
  FileCode2,
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
import {
  TabBarAction,
  tabBarNewCellClass,
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  flatToolbarRowClass,
  LoadingState,
  matchesSearchText,
} from './shared';
import { NormalizerManagerDialog } from './normalizer-manager-dialog';
import {
  AssignGroupDialog,
  GroupNameDialog,
  type AssignGroupTarget,
  type DataListGroup,
} from './group-ui';
import { RawTableEditorWorkbench, type RawTableEditorProps } from './raw-table-editor-workbench';
import { RawTableTree } from './raw-table-tree';
export { childDisplayName, groupBySource, mergeParts, type MergePart } from './raw-table-tree';

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
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [normalizersOpen, setNormalizersOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  const filteredDrafts = useMemo(
    () => drafts.filter((draft) => matchesSearchText(draft.name, searchQuery)),
    [drafts, searchQuery]
  );
  const draftCount = filteredDrafts.length;
  const totalRows = totalRawTables + draftCount;
  const emptyLabel = t('data.rawTables.empty');
  const selectedRawTable = rawTables.find((table) => table.id === selectedRawTableId) ?? null;
  const selectedDraft = drafts.find((draft) => draft.id === selectedRawTableId) ?? null;
  const selectedSource = selectedRawTableId?.startsWith('source:')
    ? (sources.find((source) => `source:${source.id}` === selectedRawTableId) ?? null)
    : null;
  const selectedRowBusy = selectedRawTableId ? actionId === selectedRawTableId : false;
  const bulkBusy = actionId === 'delete-all-raw-tables';
  const hasRows = rawTables.length > 0 || draftCount > 0;
  const hasSelection = Boolean(selectedRawTable || selectedDraft || selectedSource);
  const lastChildBySource = useRef(new Map<string, string>());

  useEffect(() => {
    if (isLoading || !selectedRawTableId) return;
    const inTables = rawTables.some((table) => table.id === selectedRawTableId);
    const inDrafts = drafts.some((draft) => draft.id === selectedRawTableId);
    const inSources =
      selectedRawTableId.startsWith('source:') &&
      sources.some((source) => `source:${source.id}` === selectedRawTableId);
    if (!inTables && !inDrafts && !inSources) setSelectedRawTableId(null);
  }, [isLoading, selectedRawTableId, rawTables, drafts, sources]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-2">
          {(isLoading || hasRows || searchQuery.trim()) && (
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
          {hasSelection && (
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
                disabled={!hasSelection || bulkBusy}
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
                key: 'normalizers',
                label: t('data.rawTables.normalizers.menu'),
                icon: <FileCode2 className="h-3.5 w-3.5" />,
                disabled: bulkBusy,
                onClick: () => setNormalizersOpen(true),
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
                disabled: !hasSelection || !!selectedSource || selectedRowBusy || bulkBusy,
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
          ) : !hasRows ? (
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
            <RawTableTree
              variant="page"
              rawTables={rawTables}
              sources={sources}
              groups={groups}
              groupCounts={groupCounts}
              groupPages={groupPages}
              onGroupPageChange={onGroupPageChange}
              drafts={isLoading ? [] : filteredDrafts}
              isLoading={isLoading}
              activeId={selectedRawTableId}
              onActiveIdChange={(id) => {
                setSelectedRawTableId(id);
                const table = rawTables.find((item) => item.id === id);
                if (table?.sourceId) lastChildBySource.current.set(table.sourceId, table.id);
              }}
              onOpenTable={(table) => onEditRawTable(table.id)}
              onOpenDraft={onEditDraft}
              onOpenSource={onOpenSource}
              onRefreshSource={onRefreshSource}
              onRenameGroup={setRenameTarget}
              onDeleteGroup={onDeleteGroup}
              actionId={actionId}
            />
          )}
        </div>
      </div>
      <NormalizerManagerDialog open={normalizersOpen} onClose={() => setNormalizersOpen(false)} />
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

export function RawTableEditor(props: RawTableEditorProps) {
  return <RawTableEditorWorkbench {...props} />;
}

export { RawTablePreviewDialog } from './raw-table-preview-dialog';
export { getDefaultRawTableConfig } from './raw-table-normalizer-utils';
