import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  FolderInput,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Workflow,
} from 'lucide-react';
import type { DataCleaningTask, DataGroup } from '../../../types';
import {
  AssignGroupDialog,
  buildGroupSections,
  GroupHeaderRow,
  GroupNameDialog,
  hasNamedSections,
  toggleCollapsed,
  type AssignGroupTarget,
  type DataListGroup,
} from '../group-ui';
import {
  DataMoreMenu,
  DataTableSearch,
  DataToolbarButton,
  EmptyState,
  flatToolbarRowClass,
  LoadingState,
  PaginationFooter,
  StatusBadge,
  formatTimestamp,
} from '../shared';
import { Button } from '../../ui/button';

export function TasksPanel({
  tasks,
  totalTasks,
  groups,
  currentPage,
  searchQuery,
  actionId,
  isLoading,
  isCreateDisabled,
  onCreate,
  onSearchChange,
  onRefresh,
  onPageChange,
  onRun,
  onEdit,
  onDelete,
  onDeleteAll,
  onAssignToGroup,
  onRenameGroup,
  onDeleteGroup,
}: {
  tasks: DataCleaningTask[];
  totalTasks: number;
  groups: DataGroup[];
  currentPage: number;
  searchQuery: string;
  actionId: string | null;
  isLoading: boolean;
  isCreateDisabled: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onRun: (task: DataCleaningTask) => void;
  onEdit: (task: DataCleaningTask) => void;
  onDelete: (task: DataCleaningTask) => void;
  onDeleteAll: () => void;
  onAssignToGroup: (ids: string[], target: AssignGroupTarget) => void;
  onRenameGroup: (group: DataListGroup, name: string) => void;
  onDeleteGroup: (group: DataListGroup) => void;
}) {
  const { t } = useTranslation();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DataListGroup | null>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedTaskBusy = selectedTask ? actionId === selectedTask.id : false;
  const bulkBusy = actionId === 'delete-all-tasks';

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [isLoading, selectedTaskId, tasks]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={`${flatToolbarRowClass} justify-between`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {(isLoading || tasks.length > 0 || searchQuery.trim()) && (
            <button
              onClick={onCreate}
              disabled={isCreateDisabled || bulkBusy}
              className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('data.newCleaningTask')}
            </button>
          )}
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={t('data.searchPlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Play className="h-3.5 w-3.5" />}
            label={t('data.actions.run')}
            disabled={!selectedTask || selectedTaskBusy || bulkBusy}
            onClick={() => {
              if (selectedTask) {
                onRun(selectedTask);
              }
            }}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={t('data.actions.edit')}
            disabled={!selectedTask || selectedTaskBusy || bulkBusy}
            onClick={() => {
              if (selectedTask) {
                onEdit(selectedTask);
              }
            }}
          />
          <DataToolbarButton
            icon={<FolderInput className="h-3.5 w-3.5" />}
            label={t('data.groups.moveToGroup')}
            disabled={!selectedTask || selectedTaskBusy || bulkBusy}
            onClick={() => {
              if (selectedTask) {
                setAssignDialogOpen(true);
              }
            }}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={t('data.actions.delete')}
            disabled={!selectedTask || selectedTaskBusy || bulkBusy}
            danger
            onClick={() => {
              if (selectedTask) {
                onDelete(selectedTask);
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
                disabled: totalTasks <= 0 || bulkBusy,
                onClick: onDeleteAll,
              },
            ]}
          />
        </div>
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col rounded-none border-0">
        <div className="min-h-0 flex-1 overflow-auto">
          {!isLoading && tasks.length === 0 ? (
            <EmptyState
              label={t('data.emptyTasks')}
              description={t(
                searchQuery.trim() ? 'workspaceEmpty.searchHint' : 'workspaceEmpty.dataHint'
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
                      {t('data.newCleaningTask')}
                    </Button>
                  )
                )
              }
            />
          ) : (
            <TasksTable
              tasks={tasks}
              groups={groups}
              isLoading={isLoading}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              onEdit={onEdit}
              onRenameGroup={setRenameTarget}
              onDeleteGroup={onDeleteGroup}
            />
          )}
        </div>
        <PaginationFooter
          count={totalTasks}
          currentPage={currentPage}
          onPageChange={onPageChange}
          embedded
        />
      </div>
      <AssignGroupDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        groups={groups}
        currentGroupId={selectedTask?.groupId ?? null}
        busy={actionId === 'assign-group'}
        onSubmit={(target) => {
          if (selectedTask) {
            onAssignToGroup([selectedTask.id], target);
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
    </div>
  );
}

function TasksTable({
  tasks,
  groups,
  isLoading,
  selectedTaskId,
  onSelectTask,
  onEdit,
  onRenameGroup,
  onDeleteGroup,
}: {
  tasks: DataCleaningTask[];
  groups: DataGroup[];
  isLoading: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onEdit: (task: DataCleaningTask) => void;
  onRenameGroup: (group: DataListGroup) => void;
  onDeleteGroup: (group: DataListGroup) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sections = buildGroupSections(tasks, groups, (task) => task.groupId);
  const grouped = hasNamedSections(sections);

  if (isLoading) {
    return <LoadingState label={t('data.loadingTasks')} />;
  }

  if (tasks.length === 0) {
    return <EmptyState label={t('data.emptyTasks')} />;
  }

  return (
    <div className="min-w-full overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
            <th className="w-[44%] whitespace-nowrap px-2">{t('data.columns.taskName')}</th>
            <th className="w-[16%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
            <th className="w-[12%] whitespace-nowrap px-2">{t('data.columns.nodes')}</th>
            <th className="w-[28%] whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {t('data.columns.updatedAt')}
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <GroupSectionRows
              key={section.key}
              section={section}
              grouped={grouped}
              collapsed={collapsed.has(section.key)}
              onToggle={() => setCollapsed((current) => toggleCollapsed(current, section.key))}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={onDeleteGroup}
              renderRow={(task) => {
                const selected = task.id === selectedTaskId;
                return (
                  <TaskRow
                    task={task}
                    selected={selected}
                    onSelect={() => onSelectTask(task.id)}
                    onEdit={() => onEdit(task)}
                    t={t}
                    indented={grouped}
                  />
                );
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupSectionRows({
  section,
  grouped,
  collapsed,
  onToggle,
  onRenameGroup,
  onDeleteGroup,
  renderRow,
}: {
  section: ReturnType<typeof buildGroupSections<DataCleaningTask>>[number];
  grouped: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onRenameGroup: (group: DataListGroup) => void;
  onDeleteGroup: (group: DataListGroup) => void;
  renderRow: (task: DataCleaningTask) => ReactNode;
}) {
  return (
    <>
      {grouped && (
        <GroupHeaderRow
          colSpan={4}
          group={section.group}
          count={section.rows.length}
          collapsed={collapsed}
          onToggle={onToggle}
          onRename={section.group ? onRenameGroup : undefined}
          onDelete={section.group ? onDeleteGroup : undefined}
        />
      )}
      {!collapsed && section.rows.map((row) => <Fragment key={row.id}>{renderRow(row)}</Fragment>)}
    </>
  );
}

function TaskRow({
  task,
  selected,
  onSelect,
  onEdit,
  t,
  indented,
}: {
  task: DataCleaningTask;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  t: (key: string) => string;
  indented?: boolean;
}) {
  return (
    <tr
      onClick={onSelect}
      onDoubleClick={onEdit}
      className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
        selected ? 'bg-accent-muted ring-1 ring-inset ring-accent/20' : 'hover:bg-surface-hover/35'
      }`}
    >
      <td className={indented ? 'pl-9 pr-2' : 'px-2'}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
            <Workflow className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 items-center">
            <span className="truncate text-[13px] font-medium text-text-secondary">
              {task.name}
            </span>
          </div>
        </div>
      </td>
      <td className="px-2">
        <StatusBadge status={task.status} />
      </td>
      <td className="px-2 text-[13px] font-medium text-text-secondary">{task.nodeCount}</td>
      <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
        {formatTimestamp(task.updatedAt, t)}
      </td>
    </tr>
  );
}
