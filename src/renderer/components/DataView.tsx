import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type HandleType,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectStartParams,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Code2,
  Columns3,
  Copy,
  Database,
  Droplet,
  FileText,
  Filter,
  Folder,
  GitMerge,
  MapPin,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Repeat2,
  Save,
  Search,
  Sigma,
  Table2,
  Trash2,
  Upload,
  UploadCloud,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  DataCleaningTask,
  DataDashboard,
  DataDataset,
  DataTaskStatus,
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowNode,
  DataWorkflowOperatorType,
} from '../types';
import { PrepDslEditor } from './PrepDslEditor';
import {
  compilePrepWorkflowToFlow,
  exportPrepOperatorDsl,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../shared/prep-dsl';

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
const WORKFLOW_NODE_WIDTH = 116;
const WORKFLOW_NODE_HEIGHT = 36;
const WORKFLOW_OPERATOR_MIME = 'application/x-sophron-workflow-operator';
const WORKFLOW_ALIGNMENT_THRESHOLD = 6;
const WORKFLOW_ALIGNMENT_GUIDE_PADDING = 32;

type WorkflowFlowNode = Node<{ workflowNode: DataWorkflowNode }, 'operator'>;
type WorkflowFlowEdge = Edge<Record<string, never>>;
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;
type WorkflowAlignmentLine =
  | { id: string; orientation: 'horizontal'; x1: number; x2: number; y: number }
  | { id: string; orientation: 'vertical'; x: number; y1: number; y2: number };

interface WorkflowAlignmentGuides {
  horizontal: WorkflowAlignmentLine | null;
  vertical: WorkflowAlignmentLine | null;
}

const EMPTY_WORKFLOW_ALIGNMENT_GUIDES: WorkflowAlignmentGuides = {
  horizontal: null,
  vertical: null,
};

const OPERATOR_CATALOG: Array<{
  type: DataWorkflowOperatorType;
  labelKey: string;
  Icon: LucideIcon;
  colorClassName: string;
  nodeClassName: string;
}> = [
  {
    type: 'input_source',
    labelKey: 'data.workflow.operators.input_source',
    Icon: Database,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'filter',
    labelKey: 'data.workflow.operators.filter',
    Icon: Filter,
    colorClassName: 'text-blue-500 bg-blue-500/10',
    nodeClassName: 'border-blue-500/35 bg-blue-500/5 text-blue-500',
  },
  {
    type: 'field_select',
    labelKey: 'data.workflow.operators.field_select',
    Icon: Columns3,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'deduplicate',
    labelKey: 'data.workflow.operators.deduplicate',
    Icon: Copy,
    colorClassName: 'text-violet-500 bg-violet-500/10',
    nodeClassName: 'border-violet-500/35 bg-violet-500/5 text-violet-500',
  },
  {
    type: 'missing_value',
    labelKey: 'data.workflow.operators.missing_value',
    Icon: Droplet,
    colorClassName: 'text-warning bg-warning/10',
    nodeClassName: 'border-warning/40 bg-warning/5 text-warning',
  },
  {
    type: 'type_convert',
    labelKey: 'data.workflow.operators.type_convert',
    Icon: Repeat2,
    colorClassName: 'text-blue-500 bg-blue-500/10',
    nodeClassName: 'border-blue-500/35 bg-blue-500/5 text-blue-500',
  },
  {
    type: 'sort',
    labelKey: 'data.workflow.operators.sort',
    Icon: ArrowUpDown,
    colorClassName: 'text-success bg-success/10',
    nodeClassName: 'border-success/35 bg-success/5 text-success',
  },
  {
    type: 'join',
    labelKey: 'data.workflow.operators.join',
    Icon: GitMerge,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'aggregate',
    labelKey: 'data.workflow.operators.aggregate',
    Icon: Sigma,
    colorClassName: 'text-violet-500 bg-violet-500/10',
    nodeClassName: 'border-violet-500/35 bg-violet-500/5 text-violet-500',
  },
  {
    type: 'calculate_field',
    labelKey: 'data.workflow.operators.calculate_field',
    Icon: Calculator,
    colorClassName: 'text-violet-500 bg-violet-500/10',
    nodeClassName: 'border-violet-500/35 bg-violet-500/5 text-violet-500',
  },
  {
    type: 'field_mapping',
    labelKey: 'data.workflow.operators.field_mapping',
    Icon: Table2,
    colorClassName: 'text-teal-500 bg-teal-500/10',
    nodeClassName: 'border-teal-500/35 bg-teal-500/5 text-teal-500',
  },
  {
    type: 'output',
    labelKey: 'data.workflow.operators.output',
    Icon: UploadCloud,
    colorClassName: 'text-blue-500 bg-blue-500/10',
    nodeClassName: 'border-blue-500/35 bg-blue-500/5 text-blue-500',
  },
];

const WORKFLOW_NODE_TYPES = {
  operator: WorkflowOperatorNode,
};

export function DataView() {
  const { t } = useTranslation();
  const [dashboard, setDashboard] = useState<DataDashboard>(EMPTY_DASHBOARD);
  const [activeTab, setActiveTab] = useState<DataTab>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [taskPage, setTaskPage] = useState(1);
  const [datasetPage, setDatasetPage] = useState(1);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const isDataApiAvailable = Boolean(window.electronAPI?.data);

  const loadDashboard = useCallback(async (options: { preserveError?: boolean; query?: string; taskPage?: number; datasetPage?: number } = {}) => {
    if (!window.electronAPI?.data) return;
    const requestedTaskPage = Math.max(1, options.taskPage ?? taskPage);
    const requestedDatasetPage = Math.max(1, options.datasetPage ?? datasetPage);
    setLoading(true);
    if (!options.preserveError) {
      setError(null);
    }
    try {
      const nextDashboard = await window.electronAPI.data.getDashboard({
        query: options.query ?? searchQuery,
        taskOffset: (requestedTaskPage - 1) * TABLE_PAGE_SIZE,
        taskLimit: TABLE_PAGE_SIZE,
        datasetOffset: (requestedDatasetPage - 1) * TABLE_PAGE_SIZE,
        datasetLimit: TABLE_PAGE_SIZE,
      });
      setDashboard(nextDashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [datasetPage, searchQuery, taskPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard();
    }, searchQuery ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard, searchQuery]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalTasks);
    if (taskPage > pageCount) {
      setTaskPage(pageCount);
    }
  }, [dashboard.totalTasks, taskPage]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalDatasets);
    if (datasetPage > pageCount) {
      setDatasetPage(pageCount);
    }
  }, [dashboard.totalDatasets, datasetPage]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setTaskPage(1);
    setDatasetPage(1);
  }, []);

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
      setTaskPage(1);
      await window.electronAPI.data.createTask({
        name: `${t('data.defaultTaskName')} ${dashboard.summary.taskCount + 1}`,
      });
      await loadDashboard({ query: '', taskPage: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, query: '' });
    } finally {
      setActionId(null);
    }
  }, [dashboard.summary.taskCount, loadDashboard, t]);

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
    <div
      className={`flex-1 min-h-0 bg-background ${
        editingTask ? 'overflow-hidden' : 'overflow-y-auto'
      }`}
    >
      <div
        className={`mx-auto w-full max-w-[1120px] px-3 py-3 sm:px-4 ${
          editingTask ? 'flex h-full min-h-0 flex-col' : ''
        }`}
      >
        {!editingTask && (
          <header className="mb-3 flex min-h-9 flex-col gap-3 lg:flex-row lg:items-start lg:justify-end">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-[20rem] xl:w-[22rem]">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  value={searchQuery}
                  onChange={(event) => handleSearchChange(event.target.value)}
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
          <div className="mb-4 flex shrink-0 items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5 text-[13px] text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {editingTask ? (
          <TaskEditor
            task={editingTask}
            actionId={actionId}
            onBack={() => setEditingTaskId(null)}
            onRun={handleRunTask}
            onWorkflowSaved={() => loadDashboard({ preserveError: true })}
          />
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

            <section className="mt-3">
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
                currentPage={activeTab === 'tasks' ? taskPage : datasetPage}
                onPageChange={activeTab === 'tasks' ? setTaskPage : setDatasetPage}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function TaskEditor({
  task,
  actionId,
  onBack,
  onRun,
  onWorkflowSaved,
}: {
  task: DataCleaningTask;
  actionId: string | null;
  onBack: () => void;
  onRun: (task: DataCleaningTask) => void | Promise<void>;
  onWorkflowSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [workflow, setWorkflow] = useState<DataTaskWorkflow | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<'config' | 'logs'>('config');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dslMode, setDslMode] = useState<'import' | 'export' | null>(null);
  const [dslText, setDslText] = useState('');

  const loadWorkflow = useCallback(async () => {
    if (!window.electronAPI?.data) return;
    setLocalError(null);
    try {
      const nextWorkflow = await window.electronAPI.data.getTaskWorkflow(task.id);
      setWorkflow(nextWorkflow);
      setSelectedNodeId((current) => current ?? nextWorkflow.nodes[0]?.id ?? null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [task.id]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  const nodes = useMemo(() => workflow?.nodes ?? [], [workflow?.nodes]);
  const edges = useMemo(() => workflow?.edges ?? [], [workflow?.edges]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId]
  );
  const isBusy = saving || actionId === task.id;

  const updateSelectedNode = useCallback(
    (updater: (node: DataWorkflowNode) => DataWorkflowNode) => {
      if (!selectedNodeId) return;
      setWorkflow((current) => {
        if (!current) return current;
        return {
          ...current,
          nodes: current.nodes.map((node) => (node.id === selectedNodeId ? updater(node) : node)),
        };
      });
    },
    [selectedNodeId]
  );

  const addOperator = useCallback(
    (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => {
      const catalog = getOperatorCatalog(type);
      const createdAt = Date.now();
      const id = makeLocalId('node');
      setSelectedNodeId(id);
      setWorkflow((current) => {
        if (!current) return current;
        const fallbackPosition = getNextWorkflowNodePosition(current.nodes.length);
        const x = Math.max(0, Math.round(position?.x ?? fallbackPosition.x));
        const y = Math.max(0, Math.round(position?.y ?? fallbackPosition.y));
        const nextNode: DataWorkflowNode = {
          id,
          taskId: task.id,
          type,
          label: t(catalog.labelKey),
          x,
          y,
          config: {},
          createdAt,
          updatedAt: createdAt,
        };
        return {
          ...current,
          nodes: [...current.nodes, nextNode],
        };
      });
    },
    [t, task.id]
  );

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    setWorkflow((current) => {
      if (!current) return current;
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                x,
                y,
                updatedAt: Date.now(),
              }
            : node
        ),
      };
    });
  }, []);

  const connectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string, sourceHandle = 'output', targetHandle = 'input') => {
      if (sourceNodeId === targetNodeId) return;
      setWorkflow((current) => {
        if (!current) return current;
        const exists = current.edges.some(
          (edge) =>
            edge.sourceNodeId === sourceNodeId &&
            edge.targetNodeId === targetNodeId &&
            edge.sourceHandle === sourceHandle &&
            edge.targetHandle === targetHandle
        );
        if (exists) return current;
        return {
          ...current,
          edges: [
            ...current.edges,
            {
              id: makeLocalId('edge'),
              taskId: task.id,
              sourceNodeId,
              targetNodeId,
              sourceHandle,
              targetHandle,
              createdAt: Date.now(),
            },
          ],
        };
      });
    },
    [task.id]
  );
  const reconnectWorkflowEdge = useCallback((edgeId: string, connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setWorkflow((current) => {
      if (!current) return current;
      const duplicate = current.edges.some(
        (edge) =>
          edge.id !== edgeId &&
          edge.sourceNodeId === connection.source &&
          edge.targetNodeId === connection.target &&
          edge.sourceHandle === (connection.sourceHandle ?? 'output') &&
          edge.targetHandle === (connection.targetHandle ?? 'input')
      );
      if (duplicate) {
        return {
          ...current,
          edges: current.edges.filter((edge) => edge.id !== edgeId),
        };
      }
      return {
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                sourceNodeId: connection.source,
                targetNodeId: connection.target,
                sourceHandle: connection.sourceHandle ?? 'output',
                targetHandle: connection.targetHandle ?? 'input',
              }
            : edge
        ),
      };
    });
  }, []);
  const removeWorkflowEdge = useCallback((edgeId: string) => {
    setWorkflow((current) =>
      current
        ? {
            ...current,
            edges: current.edges.filter((edge) => edge.id !== edgeId),
          }
        : current
    );
  }, []);

  const saveWorkflow = useCallback(async (): Promise<DataTaskWorkflow | null> => {
    if (!workflow || !window.electronAPI?.data) return null;
    setSaving(true);
    setLocalError(null);
    try {
      const saved = await window.electronAPI.data.saveTaskWorkflow(task.id, {
        nodes: workflow.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          label: node.label,
          x: node.x,
          y: node.y,
          config: node.config,
        })),
        edges: workflow.edges.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
      });
      setWorkflow(saved);
      setSelectedNodeId((current) => current ?? saved.nodes[0]?.id ?? null);
      await onWorkflowSaved();
      return saved;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, [onWorkflowSaved, task.id, workflow]);

  const handleRun = useCallback(async () => {
    const saved = await saveWorkflow();
    await onRun(saved?.task ?? task);
    await loadWorkflow();
  }, [loadWorkflow, onRun, saveWorkflow, task]);

  const openImportDsl = useCallback(() => {
    setLocalError(null);
    setDslText('');
    setDslMode('import');
  }, []);

  const openExportDsl = useCallback(() => {
    if (!workflow) return;
    setLocalError(null);
    setDslText(exportPrepWorkflowDsl(workflow.nodes, workflow.edges));
    setDslMode('export');
  }, [workflow]);

  const applyDslImport = useCallback(() => {
    if (!workflow) return;
    const parsed = parsePrepDsl(dslText);
    const diagnostics = [...parsed.diagnostics];
    if (parsed.ast) {
      const compiled = compilePrepWorkflowToFlow(parsed.ast);
      diagnostics.push(...compiled.diagnostics);
      const errors = diagnostics.filter((item) => item.severity === 'error');
      if (errors.length > 0) {
        setLocalError(errors.map((item) => formatPrepDiagnosticForUi(item, t)).join('\n'));
        return;
      }
      const now = Date.now();
      const nextNodes: DataWorkflowNode[] = compiled.nodes
        .filter((node) => isWorkflowOperatorType(node.type))
        .map((node) => ({
          id: node.id,
          taskId: task.id,
          type: node.type as DataWorkflowOperatorType,
          label: t(getOperatorCatalog(node.type as DataWorkflowOperatorType).labelKey),
          x: node.x,
          y: node.y,
          config: node.config ?? {},
          createdAt: now,
          updatedAt: now,
        }));
      const nextEdges: DataWorkflowEdge[] = compiled.edges.map((edge) => ({
        id: edge.id,
        taskId: task.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        createdAt: now,
      }));
      setWorkflow({
        ...workflow,
        nodes: nextNodes,
        edges: nextEdges,
      });
      setSelectedNodeId(nextNodes[0]?.id ?? null);
      setDslMode(null);
      setDslText('');
      setLocalError(null);
      return;
    }
    setLocalError(
      diagnostics.map((item) => formatPrepDiagnosticForUi(item, t)).join('\n') ||
        t('data.workflow.dslInvalid')
    );
  }, [dslText, t, task.id, workflow]);

  return (
    <section className="flex flex-1 min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[15px] font-medium text-text-secondary">{task.name}</h1>
            <button
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
              title={t('common.edit')}
            >
              <PencilLine className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openImportDsl}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Upload className="h-3.5 w-3.5" />
            {t('data.workflow.importDsl')}
          </button>
          <button
            onClick={openExportDsl}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Workflow className="h-3.5 w-3.5" />
            {t('data.workflow.exportDsl')}
          </button>
          <button
            onClick={() => void saveWorkflow()}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? t('common.saving') : t('common.save')}
          </button>
          <button
            onClick={() => void handleRun()}
            disabled={isBusy || !workflow}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Play className="h-3.5 w-3.5" />
            {t('data.editor.runTask')}
          </button>
          <button className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-secondary shadow-soft">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {localError && (
        <div className="mb-3 flex shrink-0 items-start gap-2 whitespace-pre-line rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5 text-[13px] text-error">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{localError}</span>
        </div>
      )}

      {dslMode && (
        <div className="mb-3 shrink-0 rounded-lg border border-border-muted bg-background/94 p-2.5 shadow-card">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-secondary">
              {dslMode === 'import' ? t('data.workflow.importDsl') : t('data.workflow.exportDsl')}
            </span>
            <button
              onClick={() => setDslMode(null)}
              className="inline-flex h-7 items-center rounded-lg px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-active hover:text-text-secondary"
            >
              {t('common.close')}
            </button>
          </div>
          <textarea
            value={dslText}
            onChange={(event) => setDslText(event.target.value)}
            readOnly={dslMode === 'export'}
            spellCheck={false}
            className="h-32 w-full resize-none rounded-lg border border-border-muted bg-background px-2.5 py-2 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            placeholder={t('data.workflow.dslPlaceholder')}
          />
          {dslMode === 'import' && (
            <div className="mt-2 flex justify-end">
              <button
                onClick={applyDslImport}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white shadow-soft transition-colors hover:bg-accent-hover"
              >
                <Workflow className="h-3.5 w-3.5" />
                {t('data.workflow.applyDsl')}
              </button>
            </div>
          )}
        </div>
      )}

      {!workflow ? (
        <div className="flex flex-1 min-h-0 items-center justify-center rounded-xl border border-border-muted bg-background/90 text-xs text-text-muted shadow-card">
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 grid-cols-[13rem_minmax(0,1fr)] items-stretch gap-3">
          <WorkflowOperatorPalette
            operators={OPERATOR_CATALOG}
            onAddOperator={addOperator}
          />
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_20rem] gap-3">
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={setSelectedNodeId}
              onAddNode={addOperator}
              onMoveNode={moveNode}
              onConnectNodes={connectNodes}
              onReconnectEdge={reconnectWorkflowEdge}
              onRemoveEdge={removeWorkflowEdge}
            />
            <WorkflowInspector
              node={selectedNode}
              activeTab={activeInspectorTab}
              onActiveTabChange={setActiveInspectorTab}
              onNodeChange={updateSelectedNode}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function WorkflowOperatorPalette({
  operators,
  onAddOperator,
}: {
  operators: typeof OPERATOR_CATALOG;
  onAddOperator: (type: DataWorkflowOperatorType) => void;
}) {
  const { t } = useTranslation();
  const handleDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, type: DataWorkflowOperatorType) => {
      event.dataTransfer.setData(WORKFLOW_OPERATOR_MIME, type);
      event.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-muted bg-background/90 p-2 shadow-card">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {operators.map(({ type, labelKey, Icon, colorClassName }) => (
          <button
            key={type}
            draggable
            onDragStart={(event) => handleDragStart(event, type)}
            onClick={() => onAddOperator(type)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-border-muted bg-background/94 px-2.5 text-left text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            <span
              className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${colorClassName}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{t(labelKey)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function WorkflowCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onAddNode: (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string
  ) => void;
  onReconnectEdge: (edgeId: string, connection: Connection) => void;
  onRemoveEdge: (edgeId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasContent
        nodes={nodes}
        edges={edges}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        onAddNode={onAddNode}
        onMoveNode={onMoveNode}
        onConnectNodes={onConnectNodes}
        onReconnectEdge={onReconnectEdge}
        onRemoveEdge={onRemoveEdge}
      />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasContent({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onAddNode,
  onMoveNode,
  onConnectNodes,
  onReconnectEdge,
  onRemoveEdge,
}: {
  nodes: DataWorkflowNode[];
  edges: DataWorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onAddNode: (type: DataWorkflowOperatorType, position?: { x: number; y: number }) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnectNodes: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string
  ) => void;
  onReconnectEdge: (edgeId: string, connection: Connection) => void;
  onRemoveEdge: (edgeId: string) => void;
}) {
  const { t } = useTranslation();
  const { screenToFlowPosition } = useReactFlow();
  const [connectionStart, setConnectionStart] = useState<OnConnectStartParams | null>(null);
  const mappedFlowNodes = useMemo<WorkflowFlowNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'operator',
        position: { x: node.x, y: node.y },
        width: WORKFLOW_NODE_WIDTH,
        height: WORKFLOW_NODE_HEIGHT,
        initialWidth: WORKFLOW_NODE_WIDTH,
        initialHeight: WORKFLOW_NODE_HEIGHT,
        dragHandle: '.workflow-node-drag-handle',
        draggable: true,
        selectable: true,
        selected: node.id === selectedNodeId,
        data: { workflowNode: node },
      })),
    [nodes, selectedNodeId]
  );
  const mappedFlowEdges = useMemo<WorkflowFlowEdge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        type: 'smoothstep',
        reconnectable: true,
        interactionWidth: 18,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: 'rgba(100, 116, 139, 0.82)',
        },
        style: {
          stroke: 'rgba(100, 116, 139, 0.68)',
          strokeWidth: 1.8,
        },
      })),
    [edges]
  );
  const [flowNodes, setFlowNodes] = useState<WorkflowFlowNode[]>(mappedFlowNodes);
  const [flowEdges, setFlowEdges] = useState<WorkflowFlowEdge[]>(mappedFlowEdges);
  const [alignmentGuides, setAlignmentGuides] = useState<WorkflowAlignmentGuides>(
    EMPTY_WORKFLOW_ALIGNMENT_GUIDES
  );
  const flowNodesRef = useRef<WorkflowFlowNode[]>(mappedFlowNodes);
  const connectSucceededRef = useRef(false);
  const reconnectSucceededRef = useRef(false);

  useEffect(() => {
    flowNodesRef.current = mappedFlowNodes;
    setFlowNodes(mappedFlowNodes);
  }, [mappedFlowNodes]);

  useEffect(() => {
    setFlowEdges(mappedFlowEdges);
  }, [mappedFlowEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      let nextGuides = EMPTY_WORKFLOW_ALIGNMENT_GUIDES;
      const snappedChanges = changes.map((change) => {
        if (change.type !== 'position' || !change.dragging || !change.position) {
          return change;
        }
        const snap = getWorkflowAlignmentSnap(
          change.id,
          change.position,
          flowNodesRef.current
        );
        nextGuides = snap.guides;
        return {
          ...change,
          position: snap.position,
          positionAbsolute: snap.position,
        };
      });
      setAlignmentGuides(nextGuides);
      setFlowNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(snappedChanges, currentNodes);
        flowNodesRef.current = nextNodes;
        for (const change of snappedChanges) {
          if (change.type === 'select' && change.selected) {
            onSelectNode(change.id);
          }
        }
        return nextNodes;
      });
    },
    [onSelectNode]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<WorkflowFlowEdge>[]) => {
      setFlowEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
    },
    []
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      connectSucceededRef.current = true;
      onConnectNodes(
        connection.source,
        connection.target,
        connection.sourceHandle ?? 'output',
        connection.targetHandle ?? 'input'
      );
      onSelectNode(connection.target);
    },
    [onConnectNodes, onSelectNode]
  );
  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      connectSucceededRef.current = false;
      setConnectionStart(params);
    },
    []
  );
  const isValidWorkflowConnection = useCallback(
    (connection: Edge | Connection) =>
      Boolean(connection.source && connection.target && connection.source !== connection.target),
    []
  );
  const handleReconnectStart = useCallback(
    (_event: ReactMouseEvent, _edge: WorkflowFlowEdge, _handleType: HandleType) => {
      reconnectSucceededRef.current = false;
    },
    []
  );
  const handleReconnect = useCallback(
    (oldEdge: WorkflowFlowEdge, newConnection: Connection) => {
      reconnectSucceededRef.current = true;
      setFlowEdges((currentEdges) =>
        reconnectEdge(oldEdge, newConnection, currentEdges, { shouldReplaceId: false })
      );
      onReconnectEdge(oldEdge.id, newConnection);
    },
    [onReconnectEdge]
  );
  const handleReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: WorkflowFlowEdge,
      _handleType: HandleType,
      connectionState: FinalConnectionState
    ) => {
      if (!reconnectSucceededRef.current && connectionState.isValid !== true) {
        setFlowEdges((currentEdges) => currentEdges.filter((item) => item.id !== edge.id));
        onRemoveEdge(edge.id);
      }
      reconnectSucceededRef.current = false;
    },
    [onRemoveEdge]
  );
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectSucceededRef.current) {
        connectSucceededRef.current = false;
        setConnectionStart(null);
        return;
      }
      const sourceNodeId = connectionStart?.nodeId ?? connectionState.fromNode?.id ?? null;
      if (!sourceNodeId) {
        setConnectionStart(null);
        return;
      }
      const dropTarget = getWorkflowConnectionDropTarget(event, connectionState);
      if (dropTarget && dropTarget.nodeId !== sourceNodeId) {
        onConnectNodes(
          sourceNodeId,
          dropTarget.nodeId,
          connectionStart?.handleId ?? 'output',
          dropTarget.handleId
        );
        onSelectNode(dropTarget.nodeId);
      }
      setConnectionStart(null);
    },
    [connectionStart, onConnectNodes, onSelectNode]
  );
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(WORKFLOW_OPERATOR_MIME);
      if (!isWorkflowOperatorType(type)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onAddNode(type, {
        x: position.x - WORKFLOW_NODE_WIDTH / 2,
        y: position.y - WORKFLOW_NODE_HEIGHT / 2,
      });
    },
    [onAddNode, screenToFlowPosition]
  );
  const handleNodeDragStop = useCallback(
    (_event: ReactMouseEvent, node: WorkflowFlowNode) => {
      const currentNode = flowNodesRef.current.find((item) => item.id === node.id);
      const position = currentNode?.position ?? node.position;
      const snap = getWorkflowAlignmentSnap(node.id, position, flowNodesRef.current);
      setAlignmentGuides(EMPTY_WORKFLOW_ALIGNMENT_GUIDES);
      setFlowNodes((currentNodes) => {
        const nextNodes = currentNodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                position: snap.position,
              }
            : item
        );
        flowNodesRef.current = nextNodes;
        return nextNodes;
      });
      onMoveNode(node.id, snap.position.x, snap.position.y);
    },
    [onMoveNode]
  );

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-muted bg-background/90 shadow-card">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-muted px-3">
        <h2 className="text-[13px] font-medium text-text-secondary">
          {t('data.workflow.canvasTitle')}
        </h2>
      </div>
      <div className="relative min-h-0 flex-1" onDragOver={handleDragOver} onDrop={handleDrop}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onReconnectStart={handleReconnectStart}
          onReconnect={handleReconnect}
          onReconnectEnd={handleReconnectEnd}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          nodesDraggable
          edgesReconnectable
          proOptions={{ hideAttribution: true }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={48}
          reconnectRadius={12}
          isValidConnection={isValidWorkflowConnection}
          defaultEdgeOptions={{
            type: 'smoothstep',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: 'rgba(100, 116, 139, 0.82)',
            },
            style: {
              stroke: 'rgba(100, 116, 139, 0.68)',
              strokeWidth: 1.8,
            },
          }}
          className="workflow-react-flow bg-background/90"
        >
          <Background color="rgba(148, 163, 184, 0.35)" gap={18} size={1.3} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            style={{ width: 100, height: 75 }}
            nodeColor={() => 'rgba(25, 169, 154, 0.36)'}
            maskColor="rgba(251, 254, 253, 0.72)"
          />
          <ViewportPortal>
            <WorkflowAlignmentGuidesOverlay guides={alignmentGuides} />
          </ViewportPortal>
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-text-muted">
            {t('data.workflow.emptyCanvas')}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkflowOperatorNode({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const node = data.workflowNode;
  const catalog = getOperatorCatalog(node.type);
  const Icon = catalog.Icon;
  return (
    <div
      data-node-id={node.id}
      style={{ width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT }}
      className={`workflow-node-drag-handle relative flex items-center gap-2 rounded-lg border bg-background/92 px-2.5 text-left shadow-soft transition-colors ${
        selected ? 'border-accent text-accent ring-2 ring-accent/15' : catalog.nodeClassName
      }`}
    >
      {node.type === 'join' ? (
        <>
          <Handle
            id="left"
            type="target"
            position={Position.Left}
            style={{ top: '35%' }}
            className="workflow-node-handle !left-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
          />
          <Handle
            id="right"
            type="target"
            position={Position.Left}
            style={{ top: '65%' }}
            className="workflow-node-handle !left-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
          />
        </>
      ) : (
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          className="workflow-node-handle !left-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
        />
      )}
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="workflow-node-handle !right-[-6px] !h-3 !w-3 !rounded-full !border-2 !border-current !bg-background !opacity-100"
      />
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0 truncate text-xs font-medium text-text-secondary">{node.label}</span>
    </div>
  );
}

function WorkflowAlignmentGuidesOverlay({ guides }: { guides: WorkflowAlignmentGuides }) {
  const lines = [guides.horizontal, guides.vertical].filter(
    (line): line is WorkflowAlignmentLine => Boolean(line)
  );
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute left-0 top-0">
      {lines.map((line) =>
        line.orientation === 'vertical' ? (
          <div
            key={line.id}
            className="workflow-alignment-guide absolute border-l border-dashed border-accent/75 shadow-[0_0_0_1px_rgba(25,169,154,0.16)]"
            style={{
              left: line.x,
              top: line.y1,
              height: Math.max(1, line.y2 - line.y1),
            }}
          />
        ) : (
          <div
            key={line.id}
            className="workflow-alignment-guide absolute border-t border-dashed border-accent/75 shadow-[0_0_0_1px_rgba(25,169,154,0.16)]"
            style={{
              left: line.x1,
              top: line.y,
              width: Math.max(1, line.x2 - line.x1),
            }}
          />
        )
      )}
    </div>
  );
}

function WorkflowInspector({
  node,
  activeTab,
  onActiveTabChange,
  onNodeChange,
}: {
  node: DataWorkflowNode | null;
  activeTab: 'config' | 'logs';
  onActiveTabChange: (tab: 'config' | 'logs') => void;
  onNodeChange: (updater: (node: DataWorkflowNode) => DataWorkflowNode) => void;
}) {
  const { t } = useTranslation();
  const [operatorDsl, setOperatorDsl] = useState('');
  const [operatorDslDiagnostics, setOperatorDslDiagnostics] = useState<PrepDiagnostic[]>([]);
  const [operatorDslStatus, setOperatorDslStatus] = useState<string | null>(null);
  const [operatorDslDiagnosticsOpen, setOperatorDslDiagnosticsOpen] = useState(true);
  const operatorDslNodeKeyRef = useRef('');
  const usesOperatorDsl = Boolean(node && node.type !== 'input_source' && node.type !== 'output');
  const editorCompletionLabels = useMemo(
    () => ({
      keywords: t('data.workflow.completionGroups.keywords'),
      snippets: t('data.workflow.completionGroups.snippets'),
      types: t('data.workflow.completionGroups.types'),
    }),
    [t]
  );
  const formatEditorDiagnostic = useCallback(
    (diagnostic: PrepDiagnostic) => formatPrepDiagnosticForUi(diagnostic, t),
    [t]
  );

  useEffect(() => {
    const nextNodeKey = node && usesOperatorDsl ? `${node.id}:${node.type}` : '';
    if (operatorDslNodeKeyRef.current === nextNodeKey) return;
    operatorDslNodeKeyRef.current = nextNodeKey;
    if (!node || !usesOperatorDsl) {
      setOperatorDsl('');
      setOperatorDslDiagnostics([]);
      setOperatorDslStatus(null);
      setOperatorDslDiagnosticsOpen(true);
      return;
    }
    setOperatorDsl(exportPrepOperatorDsl(node));
    setOperatorDslDiagnostics([]);
    setOperatorDslStatus(null);
    setOperatorDslDiagnosticsOpen(true);
  }, [node, node?.id, node?.type, usesOperatorDsl]);

  useEffect(() => {
    if (!operatorDslStatus) return undefined;
    const timeoutId = window.setTimeout(() => setOperatorDslStatus(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [operatorDslStatus]);

  const handleOperatorDslChange = useCallback((value: string) => {
    setOperatorDsl(value);
    setOperatorDslStatus(null);
    setOperatorDslDiagnosticsOpen(true);
  }, []);

  const handleFormatOperatorDsl = useCallback(() => {
    if (!node || !usesOperatorDsl) return;
    const result = parsePrepOperatorDsl(operatorDsl, node.type);
    setOperatorDslDiagnostics(result.diagnostics);
    setOperatorDslDiagnosticsOpen(true);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (!result.operator || errors.length > 0) {
      setOperatorDslStatus(null);
      return;
    }
    setOperatorDsl(exportPrepOperatorDsl({ id: node.id, type: node.type, config: result.operator.config }));
    setOperatorDslStatus(null);
  }, [node, operatorDsl, usesOperatorDsl]);

  const handleApplyOperatorDsl = useCallback(() => {
    if (!node || !usesOperatorDsl) return;
    const result = parsePrepOperatorDsl(operatorDsl, node.type);
    setOperatorDslDiagnostics(result.diagnostics);
    setOperatorDslDiagnosticsOpen(true);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (!result.operator || errors.length > 0) {
      setOperatorDslStatus(null);
      return;
    }
    onNodeChange((current) => ({
      ...current,
      config: result.operator?.config ?? current.config,
      updatedAt: Date.now(),
    }));
    setOperatorDsl(result.operator.config.dsl as string);
    setOperatorDslStatus(t('data.workflow.operatorDslApplied'));
    setOperatorDslDiagnostics([]);
    setOperatorDslDiagnosticsOpen(true);
  }, [node, onNodeChange, operatorDsl, t, usesOperatorDsl]);

  if (!node) {
    return (
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-border-muted bg-background/90 p-3 text-xs text-text-muted shadow-card">
        {t('data.workflow.noNodeSelected')}
      </aside>
    );
  }

  const catalog = getOperatorCatalog(node.type);
  const Icon = catalog.Icon;
  const summary = getWorkflowConfigSummary(node, t);
  const ruleSummaryItems = getRuleSummaryItems(node, t, Icon);
  const operatorDslHasErrors = operatorDslDiagnostics.some(
    (diagnostic) => diagnostic.severity === 'error'
  );

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-muted bg-background/90 shadow-card">
      <div
        className={`flex shrink-0 items-center justify-between border-b border-border-muted px-3 ${
          usesOperatorDsl ? 'h-12' : 'h-10'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex flex-shrink-0 items-center justify-center rounded-lg ${
              usesOperatorDsl ? 'h-8 w-8' : 'h-7 w-7'
            } ${catalog.colorClassName}`}
          >
            <Icon className={usesOperatorDsl ? 'h-[18px] w-[18px]' : 'h-4 w-4'} />
          </span>
          <div className="min-w-0">
            <div
              className={`truncate font-medium text-text-secondary ${
                usesOperatorDsl ? 'text-[15px]' : 'text-xs'
              }`}
            >
              {node.label}
            </div>
            {!usesOperatorDsl && (
              <div className="text-[11px] text-text-muted">
                {t('data.workflow.nodeId', { id: node.id.slice(0, 8) })}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface-active p-0.5 text-xs font-medium">
            <button
              onClick={() => onActiveTabChange('config')}
              className={`h-7 rounded-md px-3 ${
                activeTab === 'config'
                  ? 'bg-background text-accent shadow-soft'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('data.workflow.config')}
            </button>
            <button
              onClick={() => onActiveTabChange('logs')}
              className={`h-7 rounded-md px-3 ${
                activeTab === 'logs'
                  ? 'bg-background text-accent shadow-soft'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('data.workflow.logs')}
            </button>
          </div>
          <X className="h-4 w-4 text-text-muted" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2.5">

        {activeTab === 'logs' ? (
          <div className="h-full min-h-0 rounded-lg border border-border-muted bg-background/70 p-2.5 text-xs text-text-muted">
            {t('data.workflow.noLogs')}
          </div>
        ) : usesOperatorDsl ? (
          <div className="grid h-full min-h-0 gap-2.5 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
            <div className="grid min-h-0 min-w-0 grid-rows-[repeat(3,minmax(0,1fr))] gap-2 overflow-hidden">
              <WorkflowRuleFieldRow
                icon={FileText}
                title={t('data.workflow.ruleName')}
                value={node.label}
                suffix={`${node.label.length}/50`}
                onChange={(value) =>
                  onNodeChange((current) => ({
                    ...current,
                    label: value.slice(0, 50),
                    updatedAt: Date.now(),
                  }))
                }
              />
              <WorkflowRuleSelectRow
                icon={Database}
                title={t('data.workflow.inputData')}
                value={t('data.workflow.previousOutput')}
              />
              <WorkflowRuleSelectRow
                icon={Filter}
                title={t('data.workflow.outputResult')}
                value={t('data.workflow.operatorResult', { operator: t(catalog.labelKey) })}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border-muted bg-background/95 p-2 shadow-card">
              <div className="mb-2 grid min-h-8 grid-cols-[1fr_auto_auto] items-center gap-2">
                <div className="min-w-0 truncate text-[13px] font-medium text-text-secondary">
                  {t('data.workflow.dslEditor')}
                </div>
                {operatorDslStatus && (
                  <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-success/20 bg-success/5 px-2 text-[11px] text-success">
                    <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{operatorDslStatus}</span>
                  </div>
                )}
                <button
                  onClick={handleFormatOperatorDsl}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted/70 bg-background/90 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  {t('data.workflow.formatDsl')}
                </button>
                <button
                  onClick={handleApplyOperatorDsl}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white shadow-soft transition-colors hover:bg-accent-hover"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('data.workflow.applyOperatorDsl')}
                </button>
              </div>
              <PrepDslEditor
                value={operatorDsl}
                operatorType={node.type}
                placeholderText={t('data.workflow.operatorDslPlaceholder')}
                completionLabels={editorCompletionLabels}
                formatDiagnostic={formatEditorDiagnostic}
                onChange={handleOperatorDslChange}
                onDiagnosticsChange={setOperatorDslDiagnostics}
                height={182}
              />
            </div>
            <WorkflowRuleSummaryCard
              title={t('data.workflow.ruleSummary')}
              items={ruleSummaryItems}
              syntaxOk={!operatorDslHasErrors}
              syntaxOkText={t('data.workflow.syntaxOk')}
              syntaxErrorText={t('data.workflow.syntaxInvalid')}
              diagnostics={operatorDslDiagnostics}
              diagnosticsOpen={operatorDslDiagnosticsOpen}
              onCloseDiagnostics={() => setOperatorDslDiagnosticsOpen(false)}
              formatDiagnostic={formatEditorDiagnostic}
              emptyText={t('data.workflow.noConfig')}
            />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
            <div className="grid content-start gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <LabeledInput
                  label={t('data.workflow.nodeName')}
                  value={node.label}
                  suffix={`${node.label.length}/50`}
                  onChange={(value) =>
                    onNodeChange((current) => ({
                      ...current,
                      label: value.slice(0, 50),
                      updatedAt: Date.now(),
                    }))
                  }
                />
              </div>
              <SelectLike label={t('data.workflow.input')} value={t('data.workflow.previousOutput')} />
              <SelectLike label={t('data.workflow.output')} value={t(catalog.labelKey)} />
            </div>
            <WorkflowSummaryPanel
              title={t('data.workflow.summary')}
              rows={summary.primary}
              emptyText={t('data.workflow.noConfig')}
            />
            <WorkflowSummaryPanel
              title={t('data.workflow.details')}
              rows={summary.details}
              emptyText={t('data.workflow.noConfig')}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function LabeledInput({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
      <span className="flex h-8 items-center rounded-lg border border-border-muted bg-background/94 px-2 shadow-soft focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-text-secondary outline-none"
        />
        <span className="ml-2 text-[11px] text-text-muted">{suffix}</span>
      </span>
    </label>
  );
}

function SelectLike({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</span>
      <button className="flex h-8 w-full items-center justify-between rounded-lg border border-border-muted bg-background/94 px-2 text-left text-xs font-medium text-text-secondary shadow-soft">
        <span className="truncate">{value}</span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </span>
      </button>
    </label>
  );
}

function WorkflowRuleRowShell({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col justify-center rounded-xl border border-border-muted bg-background/95 p-2 shadow-card">
      <div className="mb-1.5 flex h-5 min-w-0 items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 truncate text-[13px] font-medium text-text-secondary">{title}</span>
      </div>
      {children}
    </section>
  );
}

function WorkflowRuleFieldRow({
  icon,
  title,
  value,
  suffix,
  onChange,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  suffix: string;
  onChange: (value: string) => void;
}) {
  return (
    <WorkflowRuleRowShell icon={icon} title={title}>
      <span className="flex h-8 w-full min-w-0 items-center rounded-lg border border-border-muted bg-background/94 px-2.5 shadow-soft transition-shadow focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/15">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-text-secondary outline-none"
        />
        <span className="ml-2 text-xs text-text-muted">{suffix}</span>
      </span>
    </WorkflowRuleRowShell>
  );
}

function WorkflowRuleSelectRow({
  icon,
  title,
  value,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
}) {
  return (
    <WorkflowRuleRowShell icon={icon} title={title}>
      <button className="flex h-8 w-full min-w-0 items-center justify-between rounded-lg border border-border-muted bg-background/94 px-2.5 text-left text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-background/95">
        <span className="truncate">{value}</span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </span>
      </button>
    </WorkflowRuleRowShell>
  );
}

interface WorkflowSummaryRow {
  label: string;
  value: string;
  mono?: boolean;
}

interface WorkflowRuleSummaryItem {
  id: string;
  label: string;
  operator?: string;
  value: string;
  Icon: LucideIcon;
}

function WorkflowRuleSummaryCard({
  title,
  items,
  syntaxOk,
  syntaxOkText,
  syntaxErrorText,
  diagnostics,
  diagnosticsOpen,
  onCloseDiagnostics,
  formatDiagnostic,
  emptyText,
}: {
  title: string;
  items: WorkflowRuleSummaryItem[];
  syntaxOk: boolean;
  syntaxOkText: string;
  syntaxErrorText: string;
  diagnostics: PrepDiagnostic[];
  diagnosticsOpen: boolean;
  onCloseDiagnostics: () => void;
  formatDiagnostic: (diagnostic: PrepDiagnostic) => string;
  emptyText: string;
}) {
  const visibleDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border-muted bg-background/95 p-3 shadow-card">
      <h3 className="mb-2 flex h-8 items-center text-[13px] font-medium text-text-secondary">
        {title}
      </h3>
      <div className="min-h-0 space-y-1.5 overflow-hidden">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              key={item.id}
              className="flex min-h-8 items-center gap-2 rounded-lg bg-surface-active/45 px-2.5 py-1.5 text-[13px] text-text-secondary"
            >
              <item.Icon className="h-4 w-4 flex-shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              {item.operator && (
                <span className="px-1.5 font-mono text-xs font-medium text-accent">
                  {item.operator}
                </span>
              )}
              <span className="max-w-[7rem] truncate rounded-md bg-accent/10 px-2 py-1 font-medium text-accent">
                {item.value}
              </span>
            </div>
          ))
        ) : (
          <div className="rounded-lg bg-surface-active/45 px-2.5 py-2 text-xs text-text-muted">
            {emptyText}
          </div>
        )}
      </div>
      <div className="mt-auto border-t border-dashed border-border-muted pt-2">
        <div
          className={`flex h-8 items-center gap-2 text-[13px] font-medium ${
            syntaxOk ? 'text-accent' : 'text-error'
          }`}
        >
          {syntaxOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{syntaxOk ? syntaxOkText : syntaxErrorText}</span>
        </div>
        {visibleDiagnostics.length > 0 && diagnosticsOpen && (
          <div className="mt-2 max-h-20 overflow-y-auto rounded-lg border border-error/15 bg-error/5 p-1.5">
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <span className="text-[11px] font-medium text-error">
                {visibleDiagnostics.length}
              </span>
              <button
                onClick={onCloseDiagnostics}
                className="inline-flex h-5 w-5 items-center justify-center rounded-md text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                title={formatDiagnostic({
                  severity: 'warning',
                  code: 'dismissDiagnostics',
                  message: 'Dismiss diagnostics',
                })}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-1">
              {visibleDiagnostics.map((diagnostic, index) => (
                <div
                  key={`${diagnostic.code ?? diagnostic.message}-${index}`}
                  className="rounded-md bg-background/72 px-2 py-1 text-[11px] leading-4 text-error"
                >
                  {formatDiagnostic(diagnostic)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function WorkflowSummaryPanel({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: WorkflowSummaryRow[];
  emptyText: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-medium text-text-secondary">{title}</div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border-muted text-[11px]">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)] border-b border-border-muted last:border-b-0"
            >
              <div className="bg-background/72 px-2 py-1.5 text-text-muted">{row.label}</div>
              <div
                className={`min-w-0 break-words px-2 py-1.5 text-text-secondary ${
                  row.mono ? 'font-mono text-[10.5px]' : ''
                }`}
              >
                {row.value}
              </div>
            </div>
          ))
        ) : (
          <div className="px-2 py-2 text-text-muted">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function getOperatorCatalog(type: DataWorkflowOperatorType) {
  return OPERATOR_CATALOG.find((operator) => operator.type === type) ?? OPERATOR_CATALOG[0];
}

function isWorkflowOperatorType(value: string): value is DataWorkflowOperatorType {
  return OPERATOR_CATALOG.some((operator) => operator.type === value);
}

function formatPrepDiagnosticForUi(
  diagnostic: PrepDiagnostic,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!diagnostic.code) {
    return diagnostic.message;
  }
  return t(`data.workflow.dslDiagnostics.${diagnostic.code}`, {
    defaultValue: diagnostic.message,
    ...(diagnostic.params ?? {}),
  });
}

function getNextWorkflowNodePosition(index: number): { x: number; y: number } {
  return {
    x: 64 + (index % 4) * 150,
    y: 72 + Math.floor(index / 4) * 64,
  };
}

function getWorkflowAlignmentSnap(
  nodeId: string,
  position: { x: number; y: number },
  nodes: WorkflowFlowNode[]
): { position: { x: number; y: number }; guides: WorkflowAlignmentGuides } {
  const otherNodes = nodes.filter((node) => node.id !== nodeId);
  if (otherNodes.length === 0) {
    return { position, guides: EMPTY_WORKFLOW_ALIGNMENT_GUIDES };
  }

  let verticalMatch: { distance: number; x: number; snappedX: number; node: WorkflowFlowNode } | null =
    null;
  let horizontalMatch:
    | { distance: number; y: number; snappedY: number; node: WorkflowFlowNode }
    | null = null;
  const activeLeft = position.x;
  const activeRight = position.x + WORKFLOW_NODE_WIDTH;
  const activeCenterY = position.y + WORKFLOW_NODE_HEIGHT / 2;

  for (const node of otherNodes) {
    const otherLeft = node.position.x;
    const otherRight = node.position.x + WORKFLOW_NODE_WIDTH;
    const otherCenterY = node.position.y + WORKFLOW_NODE_HEIGHT / 2;
    const leftDistance = Math.abs(activeLeft - otherLeft);
    const rightDistance = Math.abs(activeRight - otherRight);
    const centerYDistance = Math.abs(activeCenterY - otherCenterY);

    if (
      leftDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!verticalMatch || leftDistance < verticalMatch.distance)
    ) {
      verticalMatch = {
        distance: leftDistance,
        x: otherLeft,
        snappedX: otherLeft,
        node,
      };
    }
    if (
      rightDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!verticalMatch || rightDistance < verticalMatch.distance)
    ) {
      verticalMatch = {
        distance: rightDistance,
        x: otherRight,
        snappedX: otherRight - WORKFLOW_NODE_WIDTH,
        node,
      };
    }
    if (
      centerYDistance <= WORKFLOW_ALIGNMENT_THRESHOLD &&
      (!horizontalMatch || centerYDistance < horizontalMatch.distance)
    ) {
      horizontalMatch = {
        distance: centerYDistance,
        y: otherCenterY,
        snappedY: otherCenterY - WORKFLOW_NODE_HEIGHT / 2,
        node,
      };
    }
  }

  const snappedPosition = {
    x: verticalMatch ? verticalMatch.snappedX : position.x,
    y: horizontalMatch ? horizontalMatch.snappedY : position.y,
  };
  const guides: WorkflowAlignmentGuides = {
    horizontal: horizontalMatch
      ? {
          id: `horizontal-${horizontalMatch.node.id}`,
          orientation: 'horizontal',
          x1:
            Math.min(snappedPosition.x, horizontalMatch.node.position.x) -
            WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          x2:
            Math.max(
              snappedPosition.x + WORKFLOW_NODE_WIDTH,
              horizontalMatch.node.position.x + WORKFLOW_NODE_WIDTH
            ) + WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          y: horizontalMatch.y,
        }
      : null,
    vertical: verticalMatch
      ? {
          id: `vertical-${verticalMatch.node.id}`,
          orientation: 'vertical',
          x: verticalMatch.x,
          y1:
            Math.min(snappedPosition.y, verticalMatch.node.position.y) -
            WORKFLOW_ALIGNMENT_GUIDE_PADDING,
          y2:
            Math.max(
              snappedPosition.y + WORKFLOW_NODE_HEIGHT,
              verticalMatch.node.position.y + WORKFLOW_NODE_HEIGHT
            ) + WORKFLOW_ALIGNMENT_GUIDE_PADDING,
        }
      : null,
  };

  return { position: snappedPosition, guides };
}

function makeLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getElementFromConnectEndEvent(event: MouseEvent | TouchEvent): Element | null {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return document.elementFromPoint(touch.clientX, touch.clientY);
  }
  return event.target instanceof Element ? event.target : null;
}

function getWorkflowConnectionDropTarget(
  event: MouseEvent | TouchEvent,
  connectionState: FinalConnectionState
): { nodeId: string; handleId: string } | null {
  if (connectionState.toNode?.id && connectionState.toHandle?.id) {
    return {
      nodeId: connectionState.toNode.id,
      handleId: connectionState.toHandle.id,
    };
  }
  const targetElement = getElementFromConnectEndEvent(event);
  const handleElement = targetElement?.closest<HTMLElement>('[data-handleid]');
  const nodeElement = handleElement?.closest<HTMLElement>('[data-node-id]');
  const nodeId = nodeElement?.dataset.nodeId;
  const handleId = handleElement?.dataset.handleid;
  if (!nodeId || !handleId) {
    return null;
  }
  return { nodeId, handleId };
}

function getRuleSummaryItems(
  node: DataWorkflowNode,
  t: TranslateFn,
  fallbackIcon: LucideIcon
): WorkflowRuleSummaryItem[] {
  if (node.type === 'filter') {
    const condition = stringValue(node.config.condition);
    const parsedConditions = parseFilterSummaryItems(condition);
    if (parsedConditions.length > 0) {
      return parsedConditions.map((item, index) => ({
        id: `condition-${index}`,
        label: item.label,
        operator: item.operator,
        value: item.value,
        Icon: item.label.toLowerCase().includes('region') ? MapPin : BarChart3,
      }));
    }
  }

  const summary = getWorkflowConfigSummary(node, t);
  const dslLabel = t('data.workflow.summaryLabels.dsl');
  const notSet = t('data.workflow.values.notSet');
  return [...summary.primary, ...summary.details]
    .filter((row) => row.label !== dslLabel && row.value && row.value !== notSet)
    .slice(0, 3)
    .map((row, index) => ({
      id: `${row.label}-${index}`,
      label: row.label,
      value: row.value,
      Icon: fallbackIcon,
    }));
}

function parseFilterSummaryItems(
  condition: string
): Array<{ label: string; operator: string; value: string }> {
  const normalized = condition.replace(/^filter\s+/i, '').trim();
  if (!normalized) return [];
  return normalized.split(/\s+and\s+/i).flatMap((part) => {
    const match = /^\s*(.+?)\s*(>=|<=|!=|=|>|<)\s*(.+?)\s*$/.exec(part);
    if (!match) return [];
    return [
      {
        label: stripSummaryFieldRef(match[1]),
        operator: match[2],
        value: stripSummaryLiteral(match[3]),
      },
    ];
  });
}

function stripSummaryFieldRef(value: string): string {
  const pieces = value
    .trim()
    .split('.')
    .map((part) => part.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/^`|`$/g, ''));
  return pieces[pieces.length - 1] || value.trim();
}

function stripSummaryLiteral(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

interface WorkflowConfigSummary {
  primary: WorkflowSummaryRow[];
  details: WorkflowSummaryRow[];
}

function getWorkflowConfigSummary(
  node: DataWorkflowNode,
  t: TranslateFn
): WorkflowConfigSummary {
  const config = node.config;
  let summary: WorkflowConfigSummary;

  switch (node.type) {
    case 'input_source':
      summary = {
        primary: [
          summaryRow(t, 'source', translateWorkflowValue(t, 'sources', stringValue(config.source, 'task'))),
          summaryRow(t, 'alias', stringValue(config.alias)),
          summaryRow(t, 'format', stringValue(config.format, 'auto')),
        ],
        details: [
          summaryRow(t, 'dataset', stringValue(config.datasetId)),
          summaryRow(t, 'file', stringValue(config.filePath), true),
          summaryRow(t, 'sheet', stringValue(config.sheet)),
          summaryRow(t, 'encoding', stringValue(config.encoding)),
        ],
      };
      break;
    case 'field_select':
      summary = {
        primary: [
          summaryRow(t, 'mode', translateWorkflowValue(t, 'selectModes', stringValue(config.mode, 'include'))),
          summaryRow(t, 'columns', formatCount(stringArray(config.columns).length)),
        ],
        details: [summaryRow(t, 'fields', formatList(stringArray(config.columns), t), true)],
      };
      break;
    case 'field_mapping':
      summary = {
        primary: [
          summaryRow(t, 'mappings', formatCount(recordArray(config.mappings).length)),
          summaryRow(t, 'mode', translateWorkflowValue(t, 'mappingModes', getMappingMode(config))),
        ],
        details: [summaryRow(t, 'fields', formatMappings(config.mappings, t), true)],
      };
      break;
    case 'filter':
      summary = {
        primary: [summaryRow(t, 'condition', stringValue(config.condition), true)],
        details: [],
      };
      break;
    case 'deduplicate':
      summary = {
        primary: [
          summaryRow(
            t,
            'strategy',
            translateWorkflowValue(t, 'deduplicateStrategies', stringValue(config.strategy, 'all_columns'))
          ),
          summaryRow(t, 'keep', translateWorkflowValue(t, 'keepRules', stringValue(config.keep, 'first'))),
        ],
        details: [
          summaryRow(t, 'columns', formatList(stringArray(config.columns), t), true),
          summaryRow(t, 'orderBy', formatSortKeys(config.orderBy, t), true),
        ],
      };
      break;
    case 'missing_value':
      summary = {
        primary: [
          summaryRow(
            t,
            'strategy',
            translateWorkflowValue(t, 'missingStrategies', stringValue(config.strategy, 'by_column'))
          ),
          summaryRow(t, 'rules', formatCount(recordArray(config.rules).length)),
        ],
        details: [
          summaryRow(t, 'condition', stringValue(config.condition)),
          summaryRow(t, 'rules', formatMissingRules(config.rules, t), true),
        ],
      };
      break;
    case 'type_convert':
      summary = {
        primary: [summaryRow(t, 'conversions', formatCount(recordArray(config.conversions).length))],
        details: [summaryRow(t, 'fields', formatConversions(config.conversions, t), true)],
      };
      break;
    case 'sort':
      summary = {
        primary: [summaryRow(t, 'sortKeys', formatCount(recordArray(config.keys).length))],
        details: [summaryRow(t, 'orderBy', formatSortKeys(config.keys, t), true)],
      };
      break;
    case 'calculate_field':
      summary = {
        primary: [summaryRow(t, 'calculations', formatCount(recordArray(config.calculations).length))],
        details: [summaryRow(t, 'expression', formatCalculations(config.calculations, t), true)],
      };
      break;
    case 'aggregate':
      summary = {
        primary: [
          summaryRow(t, 'groupBy', formatList(stringArray(config.groupBy), t), true),
          summaryRow(t, 'metrics', formatCount(recordArray(config.metrics).length)),
        ],
        details: [summaryRow(t, 'metrics', formatMetrics(config.metrics, t), true)],
      };
      break;
    case 'join':
      summary = getJoinConfigSummary(config, t);
      break;
    case 'output':
      summary = {
        primary: [
          summaryRow(
            t,
            'destination',
            translateWorkflowValue(t, 'destinations', stringValue(config.destination, 'duckdb_table'))
          ),
          summaryRow(t, 'mode', translateWorkflowValue(t, 'outputModes', stringValue(config.mode, 'replace'))),
        ],
        details: [
          summaryRow(t, 'table', stringValue(config.table)),
          summaryRow(t, 'dataset', stringValue(config.dataset)),
          summaryRow(t, 'file', stringValue(config.filePath), true),
          summaryRow(t, 'format', stringValue(config.format)),
        ],
      };
      break;
    default:
      summary = { primary: [], details: [] };
  }

  const dsl = stringValue(config.dsl);
  return dsl
    ? {
        ...summary,
        details: [...summary.details, summaryRow(t, 'dsl', dsl, true)],
      }
    : summary;
}

function getJoinConfigSummary(
  config: Record<string, unknown>,
  t: TranslateFn
): WorkflowConfigSummary {
  const joinType = stringValue(config.joinType, 'left');
  const asof = recordValue(config.asof);
  const primary = [
    summaryRow(t, 'joinType', translateWorkflowValue(t, 'joinTypes', joinType)),
    summaryRow(t, 'rightInput', stringValue(config.rightInput)),
    summaryRow(t, 'cardinality', stringValue(config.cardinality)),
  ];
  const details = [
    summaryRow(t, 'conditions', joinType === 'asof' ? formatAsof(asof, t) : formatConditions(config.conditions, t), true),
    summaryRow(t, 'by', formatConditions(asof?.by, t), true),
    summaryRow(t, 'direction', stringValue(asof?.direction)),
    summaryRow(t, 'tolerance', stringValue(asof?.tolerance)),
    summaryRow(t, 'keep', formatJoinKeep(config.keep, t), true),
    summaryRow(t, 'conflict', formatConflict(config.conflict, t)),
  ];
  return { primary, details };
}

function summaryRow(
  t: TranslateFn,
  label: string,
  value: string,
  mono = false
): WorkflowSummaryRow {
  return {
    label: t(`data.workflow.summaryLabels.${label}`),
    value: value || t('data.workflow.values.notSet'),
    mono,
  };
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}

function formatCount(value: number): string {
  return String(value);
}

function formatList(values: string[], t: TranslateFn, limit = 6): string {
  if (values.length === 0) return t('data.workflow.values.notSet');
  const head = values.slice(0, limit).join(', ');
  const remaining = values.length - limit;
  return remaining > 0 ? `${head}, ${t('data.workflow.values.more', { count: remaining })}` : head;
}

function translateWorkflowValue(
  t: TranslateFn,
  group: string,
  value: string,
  fallback?: string
): string {
  if (!value) return t('data.workflow.values.notSet');
  return t(`data.workflow.values.${group}.${value}`, { defaultValue: fallback ?? value });
}

function getMappingMode(config: Record<string, unknown>): string {
  const dsl = stringValue(config.dsl);
  return dsl.startsWith('rename ') ? 'rename' : 'map';
}

function formatMappings(value: unknown, t: TranslateFn): string {
  const mappings = recordArray(value).map(
    (item) => `${stringValue(item.source, '?')} -> ${stringValue(item.target, '?')}`
  );
  return formatList(mappings, t);
}

function formatMissingRules(value: unknown, t: TranslateFn): string {
  const rules = recordArray(value).map((rule) => {
    const method = stringValue(rule.method, 'skip');
    const methodLabel = t(`data.workflow.ruleMethods.${method}`, { defaultValue: method });
    const values = Array.isArray(rule.values)
      ? ` (${rule.values.map((item) => String(item)).join(', ')})`
      : '';
    const fillValue = rule.value === undefined ? '' : ` = ${String(rule.value)}`;
    return `${stringValue(rule.column, '?')}: ${methodLabel}${values}${fillValue}`;
  });
  return formatList(rules, t);
}

function formatConversions(value: unknown, t: TranslateFn): string {
  const conversions = recordArray(value).map((item) => {
    const onError = stringValue(item.onError);
    const suffix = onError ? ` (${onError})` : '';
    return `${stringValue(item.column, '?')} -> ${stringValue(item.type, '?')}${suffix}`;
  });
  return formatList(conversions, t);
}

function formatSortKeys(value: unknown, t: TranslateFn): string {
  const keys = recordArray(value).map((item) => {
    const nulls = stringValue(item.nulls);
    return `${stringValue(item.field, '?')} ${stringValue(item.direction, 'asc')}${
      nulls ? ` nulls ${nulls}` : ''
    }`;
  });
  return formatList(keys, t);
}

function formatCalculations(value: unknown, t: TranslateFn): string {
  const calculations = recordArray(value).map(
    (item) => `${stringValue(item.field, '?')} = ${stringValue(item.expression, '?')}`
  );
  return formatList(calculations, t, 4);
}

function formatMetrics(value: unknown, t: TranslateFn): string {
  const metrics = recordArray(value).map(
    (item) =>
      `${stringValue(item.function, 'count')}(${stringValue(item.expression, '*')}) as ${stringValue(
        item.alias,
        '?'
      )}`
  );
  return formatList(metrics, t, 4);
}

function formatConditions(value: unknown, t: TranslateFn): string {
  const conditions = recordArray(value).map(
    (item) =>
      `${stringValue(item.left, '?')} ${stringValue(item.operator, '=')} ${stringValue(item.right, '?')}`
  );
  return formatList(conditions, t, 4);
}

function formatAsof(asof: Record<string, unknown> | null, t: TranslateFn): string {
  if (!asof) return t('data.workflow.values.notSet');
  return `${stringValue(asof.leftTime, '?')} ${stringValue(asof.operator, '>=')} ${stringValue(
    asof.rightTime,
    '?'
  )}`;
}

function formatJoinKeep(value: unknown, t: TranslateFn): string {
  const keep = recordArray(value).map((item) => {
    if (item.wildcard) {
      return `${stringValue(item.side, '?')} *`;
    }
    const alias = stringValue(item.alias);
    return `${stringValue(item.source, '?')}${alias ? ` as ${alias}` : ''}`;
  });
  return formatList(keep, t, 4);
}

function formatConflict(value: unknown, t: TranslateFn): string {
  const conflict = recordValue(value);
  if (!conflict) return t('data.workflow.values.notSet');
  const strategy = stringValue(conflict.strategy, 'right_prefix');
  if (strategy === 'right_prefix') {
    return `${strategy}: ${stringValue(conflict.rightPrefix, '')}`;
  }
  if (strategy === 'suffix') {
    return `${strategy}: ${stringValue(conflict.leftSuffix, '_left')} / ${stringValue(
      conflict.rightSuffix,
      '_right'
    )}`;
  }
  return strategy;
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
    <article className="flex h-[5.75rem] items-center gap-3 rounded-xl border border-border-muted bg-background/88 px-3 shadow-card">
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
  const visibleTasks = tasks;

  if (visibleTasks.length === 0) {
    return <EmptyState label={t('data.emptyTasks')} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-background/80 text-xs font-medium text-text-muted">
            <th className="w-[34%] px-4">{t('data.columns.taskName')}</th>
            <th className="w-[15%] px-4">{t('data.columns.status')}</th>
            <th className="w-[10%] px-4">{t('data.columns.nodes')}</th>
            <th className="w-[17%] px-4">{t('data.columns.updatedAt')}</th>
            <th className="w-[24%] px-4 text-center">{t('data.columns.actions')}</th>
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
                <td className="px-4">
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
                <td className="px-4 text-[13px] font-medium text-text-secondary">
                  {task.nodeCount}
                </td>
                <td className="px-4 text-[13px] font-medium text-text-secondary">
                  {formatTimestamp(task.updatedAt, t)}
                </td>
                <td className="px-4">
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
  const visibleDatasets = datasets;

  if (visibleDatasets.length === 0) {
    return <EmptyState label={t('data.emptyDatasets')} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-background/80 text-xs font-medium text-text-muted">
            <th className="w-[38%] px-4">{t('data.columns.datasetName')}</th>
            <th className="w-[15%] px-4">{t('data.columns.rows')}</th>
            <th className="w-[15%] px-4">{t('data.columns.columns')}</th>
            <th className="w-[20%] px-4">{t('data.columns.updatedAt')}</th>
            <th className="w-[12%] px-4 text-center">{t('data.columns.actions')}</th>
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
              <td className="px-4">
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
              <td className="px-4 text-[13px] font-medium text-text-secondary">
                {formatNumber(dataset.rowCount)}
              </td>
              <td className="px-4 text-[13px] font-medium text-text-secondary">
                {dataset.columnCount}
              </td>
              <td className="px-4 text-[13px] font-medium text-text-secondary">
                {formatTimestamp(dataset.updatedAt, t)}
              </td>
              <td className="px-4 text-right">
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
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs text-text-muted">
      {label}
    </div>
  );
}

function PaginationFooter({
  count,
  currentPage,
  onPageChange,
}: {
  count: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pageCount = getTablePageCount(count);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);

  return (
    <div className="mt-3 flex flex-col items-center justify-end gap-2 text-xs font-medium text-text-secondary sm:flex-row">
      <span>{t('data.totalCount', { count })}</span>
      <button className="inline-flex h-8 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-text-secondary shadow-soft">
        {t('data.rowsPerPage', { count: TABLE_PAGE_SIZE })}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2">
        {pageCount > 1 && (
          <button
            onClick={() => onPageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-muted shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            onClick={() => onPageChange(pageNumber)}
            aria-current={pageNumber === safeCurrentPage ? 'page' : undefined}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium shadow-soft ${
              pageNumber === safeCurrentPage
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-muted bg-background/94 text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
            }`}
          >
            {pageNumber}
          </button>
        ))}
        {pageCount > 1 && (
          <button
            onClick={() => onPageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage >= pageCount}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-background/94 text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function getTablePageCount(count: number): number {
  return Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE));
}

function getVisiblePageNumbers(currentPage: number, pageCount: number): number[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const start = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
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
