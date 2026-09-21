import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  BarChart3,
  Cloud,
  Database,
  Folder,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { DataCleaningTask } from '../../../types';
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

const TASK_ICON_STYLES = [
  { Icon: Database, className: 'bg-accent-muted text-accent' },
  { Icon: BarChart3, className: 'bg-accent-muted text-accent' },
  { Icon: Folder, className: 'bg-warning/10 text-warning' },
  { Icon: UploadCloud, className: 'bg-surface-active text-text-secondary' },
  { Icon: Cloud, className: 'bg-success/10 text-success' },
];

export function TasksPanel({
  tasks,
  totalTasks,
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
}: {
  tasks: DataCleaningTask[];
  totalTasks: number;
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
}) {
  const { t } = useTranslation();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
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
              isLoading={isLoading}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              onEdit={onEdit}
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
    </div>
  );
}

function TasksTable({
  tasks,
  isLoading,
  selectedTaskId,
  onSelectTask,
  onEdit,
}: {
  tasks: DataCleaningTask[];
  isLoading: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onEdit: (task: DataCleaningTask) => void;
}) {
  const { t } = useTranslation();
  const visibleTasks = tasks;

  if (isLoading) {
    return <LoadingState label={t('data.loadingTasks')} />;
  }

  if (visibleTasks.length === 0) {
    return <EmptyState label={t('data.emptyTasks')} />;
  }

  return (
    <div className="min-w-full overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted">
            <th className="w-[4%] px-4">
              <span className="sr-only">{t('data.tasks.selection')}</span>
            </th>
            <th className="w-[42%] whitespace-nowrap px-2">{t('data.columns.taskName')}</th>
            <th className="w-[16%] whitespace-nowrap px-2">{t('data.columns.status')}</th>
            <th className="w-[12%] whitespace-nowrap px-2">{t('data.columns.nodes')}</th>
            <th className="w-[26%] whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {t('data.columns.updatedAt')}
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task, index) => {
            const icon = TASK_ICON_STYLES[index % TASK_ICON_STYLES.length];
            const RowIcon = icon.Icon;
            const selected = task.id === selectedTaskId;
            return (
              <tr
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                onDoubleClick={() => onEdit(task)}
                className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                  selected
                    ? 'bg-accent-muted ring-1 ring-inset ring-accent/20'
                    : 'hover:bg-surface-hover/35'
                }`}
              >
                <td className="px-4">
                  <input
                    type="radio"
                    name="task-selection"
                    checked={selected}
                    onChange={() => onSelectTask(task.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="h-3.5 w-3.5 accent-accent"
                    aria-label={task.name}
                  />
                </td>
                <td className="px-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${icon.className}`}
                    >
                      <RowIcon className="h-4 w-4" />
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
                <td className="px-2 text-[13px] font-medium text-text-secondary">
                  {task.nodeCount}
                </td>
                <td className="whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                  {formatTimestamp(task.updatedAt, t)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
