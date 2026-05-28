import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Database,
  Folder,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Search,
  Table2,
  Trash2,
  UploadCloud,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { DataCleaningTask, DataDashboard, DataDataset, DataTaskStatus } from '../types';

type DataTab = 'tasks' | 'datasets';

const EMPTY_DASHBOARD: DataDashboard = {
  summary: {
    taskCount: 0,
    workflowNodeCount: 0,
    runningCount: 0,
    todayScheduleCount: 0,
    statusCounts: {
      running: 0,
      completed: 0,
      stopped: 0,
      draft: 0,
      pending: 0,
      failed: 0,
    },
  },
  tasks: [],
  datasets: [],
  totalTasks: 0,
  totalDatasets: 0,
};

const TASK_ICON_STYLES = [
  { Icon: Database, className: 'bg-accent/10 text-accent' },
  { Icon: BarChart3, className: 'bg-blue-500/10 text-blue-500' },
  { Icon: Folder, className: 'bg-warning/10 text-warning' },
  { Icon: UploadCloud, className: 'bg-violet-500/10 text-violet-500' },
  { Icon: Cloud, className: 'bg-cyan-500/10 text-cyan-500' },
];

const TABLE_PAGE_SIZE = 10;

export function DataView() {
  const { t } = useTranslation();
  const [dashboard, setDashboard] = useState<DataDashboard>(EMPTY_DASHBOARD);
  const [activeTab, setActiveTab] = useState<DataTab>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const isDataApiAvailable = Boolean(window.electronAPI?.data);

  const loadDashboard = useCallback(async (options: { preserveError?: boolean; query?: string } = {}) => {
    if (!window.electronAPI?.data) return;
    setLoading(true);
    if (!options.preserveError) {
      setError(null);
    }
    try {
      const nextDashboard = await window.electronAPI.data.getDashboard({
        query: options.query ?? searchQuery,
      });
      setDashboard(nextDashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard();
    }, searchQuery ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard, searchQuery]);

  const summaryCards = useMemo(
    () => [
      {
        key: 'taskCount',
        label: t('data.summary.tasks'),
        description: t('data.summary.tasksDesc'),
        value: dashboard.summary.taskCount,
        Icon: Database,
        iconClassName: 'bg-accent/10 text-accent',
      },
      {
        key: 'workflowNodeCount',
        label: t('data.summary.workflowNodes'),
        description: t('data.summary.workflowNodesDesc'),
        value: dashboard.summary.workflowNodeCount,
        Icon: Workflow,
        iconClassName: 'bg-blue-500/10 text-blue-500',
      },
      {
        key: 'runningCount',
        label: t('data.summary.running'),
        description: t('data.summary.runningDesc'),
        value: dashboard.summary.runningCount,
        Icon: CheckCircle2,
        iconClassName: 'bg-violet-500/10 text-violet-500',
      },
      {
        key: 'todayScheduleCount',
        label: t('data.summary.todaySchedule'),
        description: t('data.summary.todayScheduleDesc'),
        value: dashboard.summary.todayScheduleCount,
        Icon: Clock3,
        iconClassName: 'bg-warning/10 text-warning',
      },
    ],
    [dashboard.summary, t]
  );
  const editingTask = useMemo(
    () => dashboard.tasks.find((task) => task.id === editingTaskId) ?? null,
    [dashboard.tasks, editingTaskId]
  );

  const selectOneFile = useCallback(async (): Promise<string | null> => {
    if (!window.electronAPI?.selectFiles) return null;
    const files = await window.electronAPI.selectFiles();
    return files[0] ?? null;
  }, []);

  const handleCreateTask = useCallback(async () => {
    if (!window.electronAPI?.data) return;
    setActionId('create');
    setError(null);
    try {
      setActiveTab('tasks');
      setSearchQuery('');
      await window.electronAPI.data.createTask({
        name: `${t('data.defaultTaskName')} ${dashboard.totalTasks + 1}`,
      });
      await loadDashboard({ query: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, query: '' });
    } finally {
      setActionId(null);
    }
  }, [dashboard.totalTasks, loadDashboard, t]);

  const handleRunTask = useCallback(
    async (task: DataCleaningTask) => {
      if (!window.electronAPI?.data) return;
      setActionId(task.id);
      setError(null);
      try {
        const sourcePath = task.sourcePath ? null : await selectOneFile();
        if (!task.sourcePath && !sourcePath) return;
        await window.electronAPI.data.runTask(task.id, { sourcePath });
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard, selectOneFile]
  );

  const handleImportDataset = useCallback(async () => {
    if (!window.electronAPI?.data) return;
    setActionId('import-dataset');
    setError(null);
    try {
      const sourcePath = await selectOneFile();
      if (!sourcePath) return;
      await window.electronAPI.data.importDataset({ filePath: sourcePath });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true });
    } finally {
      setActionId(null);
    }
  }, [loadDashboard, selectOneFile]);

  const handleDeleteTask = useCallback(
    async (task: DataCleaningTask) => {
      if (!window.electronAPI?.data) return;
      const confirmed = window.confirm(t('data.deleteTaskConfirm', { name: task.name }));
      if (!confirmed) return;
      setActionId(task.id);
      setError(null);
      try {
        const result = await window.electronAPI.data.deleteTask(task.id);
        if (!result.success) {
          throw new Error(t('data.deleteTaskNotFound'));
        }
        if (editingTaskId === task.id) {
          setEditingTaskId(null);
        }
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [editingTaskId, loadDashboard, t]
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[1080px] px-7 py-6 lg:px-8">
        {!editingTask && (
          <header className="mb-5 flex min-h-9 flex-col gap-3 lg:flex-row lg:items-start lg:justify-end">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-[20rem] xl:w-[22rem]">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('data.searchPlaceholder')}
                  className="h-9 w-full rounded-lg border border-border-muted bg-background/94 pl-9 pr-3 text-[13px] font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <button
                onClick={handleCreateTask}
                disabled={!isDataApiAvailable || actionId === 'create'}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {t('data.newCleaningTask')}
              </button>
            </div>
          </header>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5 text-[13px] text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {editingTask ? (
          <TaskEditor onBack={() => setEditingTaskId(null)} />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map(({ key, label, description, value, Icon, iconClassName }) => (
                <StatCard
                  key={key}
                  label={label}
                  description={description}
                  value={value}
                  Icon={Icon}
                  iconClassName={iconClassName}
                />
              ))}
            </section>

            <section className="mt-5">
              <div className="mb-2 flex min-h-10 flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-end gap-5">
                  <TabButton
                    active={activeTab === 'tasks'}
                    onClick={() => setActiveTab('tasks')}
                    label={t('data.tabs.etl')}
                  />
                  <TabButton
                    active={activeTab === 'datasets'}
                    onClick={() => setActiveTab('datasets')}
                    label={t('data.tabs.datasets')}
                  />
                </div>
                <div className="flex items-center gap-3">
                  {activeTab === 'datasets' && (
                    <button
                      onClick={handleImportDataset}
                      disabled={actionId === 'import-dataset'}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                      {t('data.importDataset')}
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border-muted bg-background/90 shadow-card">
                {activeTab === 'tasks' ? (
                  <TasksTable
                    tasks={dashboard.tasks}
                    actionId={actionId}
                    onRun={handleRunTask}
                    onEdit={(task) => setEditingTaskId(task.id)}
                    onDelete={handleDeleteTask}
                  />
                ) : (
                  <DatasetsTable datasets={dashboard.datasets} />
                )}
              </div>

              <PaginationFooter
                count={activeTab === 'tasks' ? dashboard.totalTasks : dashboard.totalDatasets}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function TaskEditor({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();

  return (
    <section className="min-h-[28rem]">
      <button
        onClick={onBack}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('data.editor.back')}
      </button>
    </section>
  );
}

function StatCard({
  label,
  description,
  value,
  Icon,
  iconClassName,
}: {
  label: string;
  description: string;
  value: number;
  Icon: LucideIcon;
  iconClassName: string;
}) {
  return (
    <article className="flex h-[5.75rem] items-center gap-3 rounded-xl border border-border-muted bg-background/88 px-4 shadow-card">
      <div
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-[1.25rem] font-medium leading-none text-text-secondary">{value}</div>
        <div className="mt-1.5 whitespace-nowrap text-[13px] font-medium leading-4 text-text-secondary">
          {label}
        </div>
        <div className="mt-1 truncate text-[11px] leading-4 text-text-secondary">
          {description}
        </div>
      </div>
    </article>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative h-9 px-2.5 text-left text-[13px] font-medium transition-colors ${
        active ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
      {active && (
        <span className="absolute bottom-0 left-0 h-px w-full rounded-full bg-accent" />
      )}
    </button>
  );
}

function TasksTable({
  tasks,
  actionId,
  onRun,
  onEdit,
  onDelete,
}: {
  tasks: DataCleaningTask[];
  actionId: string | null;
  onRun: (task: DataCleaningTask) => void;
  onEdit: (task: DataCleaningTask) => void;
  onDelete: (task: DataCleaningTask) => void;
}) {
  const { t } = useTranslation();
  const visibleTasks = tasks.slice(0, TABLE_PAGE_SIZE);

  if (visibleTasks.length === 0) {
    return <EmptyState label={t('data.emptyTasks')} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-background/80 text-xs font-medium text-text-muted">
            <th className="w-[34%] px-5">{t('data.columns.taskName')}</th>
            <th className="w-[15%] px-4">{t('data.columns.status')}</th>
            <th className="w-[10%] px-5">{t('data.columns.nodes')}</th>
            <th className="w-[17%] px-5">{t('data.columns.updatedAt')}</th>
            <th className="w-[24%] px-5 text-center">{t('data.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task, index) => {
            const icon = TASK_ICON_STYLES[index % TASK_ICON_STYLES.length];
            const RowIcon = icon.Icon;
            const isBusy = actionId === task.id;
            return (
              <tr
                key={task.id}
                className={`h-[3.25rem] border-b border-border-muted/85 last:border-b-0 transition-colors ${
                  index === 0 ? 'bg-accent/5' : 'hover:bg-surface-hover/35'
                }`}
              >
                <td className="px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${icon.className}`}
                    >
                      <RowIcon className="h-4 w-4" />
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-text-secondary">
                        {task.name}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                    </div>
                  </div>
                </td>
                <td className="px-4">
                  <StatusBadge status={task.status} />
                </td>
                <td className="px-5 text-[13px] font-medium text-text-secondary">
                  {task.nodeCount}
                </td>
                <td className="px-5 text-[13px] font-medium text-text-secondary">
                  {formatTimestamp(task.updatedAt, t)}
                </td>
                <td className="px-5">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => onEdit(task)}
                      disabled={isBusy}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('data.actions.edit')}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      <span className="sr-only">{t('data.actions.edit')}</span>
                    </button>
                    <button
                      onClick={() => onRun(task)}
                      disabled={isBusy}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('data.actions.run')}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onDelete(task)}
                      disabled={isBusy}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-secondary shadow-soft transition-colors hover:border-error/30 hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('data.actions.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DatasetsTable({ datasets }: { datasets: DataDataset[] }) {
  const { t } = useTranslation();
  const visibleDatasets = datasets.slice(0, TABLE_PAGE_SIZE);

  if (visibleDatasets.length === 0) {
    return <EmptyState label={t('data.emptyDatasets')} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-background/80 text-xs font-medium text-text-muted">
            <th className="w-[38%] px-5">{t('data.columns.datasetName')}</th>
            <th className="w-[15%] px-5">{t('data.columns.rows')}</th>
            <th className="w-[15%] px-5">{t('data.columns.columns')}</th>
            <th className="w-[20%] px-5">{t('data.columns.updatedAt')}</th>
            <th className="w-[12%] px-5 text-center">{t('data.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {visibleDatasets.map((dataset, index) => (
            <tr
              key={dataset.id}
              className={`h-[3.25rem] border-b border-border-muted/85 last:border-b-0 transition-colors ${
                index === 0 ? 'bg-accent/5' : 'hover:bg-surface-hover/35'
              }`}
            >
              <td className="px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Table2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-text-secondary">
                      {dataset.name}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-text-muted">
                      {basenameFromPath(dataset.sourcePath)}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-5 text-[13px] font-medium text-text-secondary">
                {formatNumber(dataset.rowCount)}
              </td>
              <td className="px-5 text-[13px] font-medium text-text-secondary">
                {dataset.columnCount}
              </td>
              <td className="px-5 text-[13px] font-medium text-text-secondary">
                {formatTimestamp(dataset.updatedAt, t)}
              </td>
              <td className="px-5 text-right">
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                  title={t('data.actions.more')}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: DataTaskStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex h-6 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${statusBadgeClass(
        status
      )}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(`data.status.${status}`)}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-5 py-12 text-center text-xs text-text-muted">
      {label}
    </div>
  );
}

function PaginationFooter({ count }: { count: number }) {
  const { t } = useTranslation();
  const pageCount = Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
  const pageNumbers = Array.from({ length: Math.min(pageCount, 3) }, (_, index) => index + 1);

  return (
    <div className="mt-5 flex flex-col items-center justify-end gap-2 text-xs font-medium text-text-secondary sm:flex-row">
      <span>{t('data.totalCount', { count })}</span>
      <button className="inline-flex h-8 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-text-secondary shadow-soft">
        {t('data.rowsPerPage', { count: TABLE_PAGE_SIZE })}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2">
        {pageCount > 1 && (
          <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-muted shadow-soft">
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium shadow-soft ${
              pageNumber === 1
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-muted bg-background/94 text-text-secondary'
            }`}
          >
            {pageNumber}
          </button>
        ))}
        {pageCount > 1 && (
          <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-secondary shadow-soft">
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function statusBadgeClass(status: DataTaskStatus): string {
  switch (status) {
    case 'running':
      return 'bg-success/10 text-success';
    case 'completed':
      return 'bg-blue-500/10 text-blue-500';
    case 'stopped':
      return 'bg-text-muted/10 text-text-muted';
    case 'pending':
      return 'bg-warning/10 text-warning';
    case 'failed':
      return 'bg-error/10 text-error';
    case 'draft':
    default:
      return 'bg-surface-active text-text-secondary';
  }
}

function formatTimestamp(timestamp: number | null, t: (key: string) => string): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (timestamp >= startToday) {
    return `${t('data.relative.today')} ${time}`;
  }
  if (timestamp >= startYesterday) {
    return `${t('data.relative.yesterday')} ${time}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function basenameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? filePath;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
