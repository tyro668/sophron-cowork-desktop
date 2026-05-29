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
  Eye,
  FileText,
  Filter,
  Folder,
  GitMerge,
  Info,
  MapPin,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Repeat2,
  RefreshCw,
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
  DataInputTableConfig,
  DataInputTableExcelConfig,
  DataInputTableFolderConfig,
  DataInputTablePreview,
  DataInputTableSourceKind,
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

type DataTab = 'tasks' | 'input_tables' | 'output_tables';
type InputTableSourceFilter = 'all' | 'excel' | 'csv' | 'folder';
type InputTableSourceKind = Exclude<InputTableSourceFilter, 'all'> | 'file' | 'draft';

interface InputTableDraft {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

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
const INPUT_TABLE_PREVIEW_PAGE_SIZE = 100;
const WORKFLOW_NODE_WIDTH = 116;
const WORKFLOW_NODE_HEIGHT = 36;
const WORKFLOW_OPERATOR_MIME = 'application/x-sophron-workflow-operator';
const WORKFLOW_ALIGNMENT_THRESHOLD = 6;
const WORKFLOW_ALIGNMENT_GUIDE_PADDING = 32;

const INPUT_TABLE_SOURCE_FILTERS: Array<{
  value: InputTableSourceFilter;
  labelKey: string;
}> = [
  { value: 'all', labelKey: 'data.inputTables.sources.all' },
  { value: 'excel', labelKey: 'data.inputTables.sources.excel' },
  { value: 'csv', labelKey: 'data.inputTables.sources.csv' },
  { value: 'folder', labelKey: 'data.inputTables.sources.folder' },
];

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
  const [inputTableSourceFilter, setInputTableSourceFilter] =
    useState<InputTableSourceFilter>('all');
  const [inputTableDrafts, setInputTableDrafts] = useState<InputTableDraft[]>([]);
  const [editingInputTableDraftId, setEditingInputTableDraftId] = useState<string | null>(null);
  const [editingInputTableDatasetId, setEditingInputTableDatasetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [taskPage, setTaskPage] = useState(1);
  const [datasetPage, setDatasetPage] = useState(1);
  const [loadingTab, setLoadingTab] = useState<DataTab | null>('tasks');
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [storedPreviewOpen, setStoredPreviewOpen] = useState(false);
  const [storedPreviewLoading, setStoredPreviewLoading] = useState(false);
  const [storedPreviewError, setStoredPreviewError] = useState<string | null>(null);
  const [storedPreviewData, setStoredPreviewData] = useState<DataInputTablePreview | null>(null);
  const [storedPreviewPage, setStoredPreviewPage] = useState(1);
  const [storedPreviewDataset, setStoredPreviewDataset] = useState<DataDataset | null>(null);
  const dashboardRequestSeq = useRef(0);
  const hasLoadedDashboardSummary = useRef(false);
  const pendingNavigationTabRef = useRef<DataTab | null>('tasks');

  const isDataApiAvailable = Boolean(window.electronAPI?.data);

  const loadDashboard = useCallback(async (options: { preserveError?: boolean; query?: string; taskPage?: number; datasetPage?: number; tab?: DataTab } = {}) => {
    if (!window.electronAPI?.data) return;
    const requestSeq = dashboardRequestSeq.current + 1;
    dashboardRequestSeq.current = requestSeq;
    const targetTab = options.tab ?? activeTab;
    const requestedTaskPage = Math.max(1, options.taskPage ?? taskPage);
    const requestedDatasetPage = Math.max(1, options.datasetPage ?? datasetPage);
    const shouldLoadTasks = targetTab === 'tasks';
    const shouldLoadDatasets = targetTab === 'input_tables';
    const shouldLoadSummary = shouldLoadTasks || !hasLoadedDashboardSummary.current;
    const visibleDraftCount =
      shouldLoadDatasets && inputTableSourceFilter === 'all' ? inputTableDrafts.length : 0;
    const draftStart = (requestedDatasetPage - 1) * TABLE_PAGE_SIZE;
    const draftsOnRequestedPage = Math.max(
      0,
      Math.min(TABLE_PAGE_SIZE, visibleDraftCount - draftStart)
    );
    const datasetLimit = shouldLoadDatasets
      ? Math.max(0, TABLE_PAGE_SIZE - draftsOnRequestedPage)
      : 0;
    const datasetOffset = Math.max(
      0,
      (requestedDatasetPage - 1) * TABLE_PAGE_SIZE - visibleDraftCount
    );
    setLoadingTab(targetTab);
    if (!options.preserveError) {
      setError(null);
    }
    try {
      const nextDashboard = await window.electronAPI.data.getDashboard({
        query: options.query ?? (shouldLoadTasks ? searchQuery : ''),
        includeSummary: shouldLoadSummary,
        includeTasks: shouldLoadTasks,
        includeDatasets: shouldLoadDatasets,
        taskOffset: (requestedTaskPage - 1) * TABLE_PAGE_SIZE,
        taskLimit: shouldLoadTasks ? TABLE_PAGE_SIZE : 0,
        datasetOffset,
        datasetLimit,
        datasetSourceKind: shouldLoadDatasets ? inputTableSourceFilter : 'all',
      });
      if (requestSeq === dashboardRequestSeq.current) {
        if (shouldLoadSummary) {
          hasLoadedDashboardSummary.current = true;
        }
        setDashboard((current) => ({
          summary: shouldLoadSummary ? nextDashboard.summary : current.summary,
          tasks: shouldLoadTasks ? nextDashboard.tasks : current.tasks,
          datasets: shouldLoadDatasets ? nextDashboard.datasets : current.datasets,
          totalTasks:
            shouldLoadTasks || shouldLoadSummary ? nextDashboard.totalTasks : current.totalTasks,
          totalDatasets: shouldLoadDatasets ? nextDashboard.totalDatasets : current.totalDatasets,
        }));
      }
    } catch (err) {
      if (requestSeq === dashboardRequestSeq.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestSeq === dashboardRequestSeq.current) {
        if (pendingNavigationTabRef.current === targetTab) {
          pendingNavigationTabRef.current = null;
        }
        setLoadingTab((current) => (current === targetTab ? null : current));
      }
    }
  }, [activeTab, datasetPage, inputTableDrafts.length, inputTableSourceFilter, searchQuery, taskPage]);

  useEffect(() => {
    if (!isDataApiAvailable) {
      pendingNavigationTabRef.current = null;
      setLoadingTab(null);
      return;
    }
    dashboardRequestSeq.current += 1;
    if (activeTab === 'output_tables') {
      pendingNavigationTabRef.current = null;
      setLoadingTab(null);
      return;
    }

    const delay = activeTab === 'tasks' && searchQuery ? 180 : 0;
    let timer: number | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          void loadDashboard({ tab: activeTab });
        }, delay);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [activeTab, isDataApiAvailable, loadDashboard, searchQuery]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalTasks);
    if (taskPage > pageCount) {
      setTaskPage(pageCount);
    }
  }, [dashboard.totalTasks, taskPage]);

  useEffect(() => {
    const draftCount = inputTableSourceFilter === 'all' ? inputTableDrafts.length : 0;
    const pageCount = getTablePageCount(dashboard.totalDatasets + draftCount);
    if (datasetPage > pageCount) {
      setDatasetPage(pageCount);
    }
  }, [dashboard.totalDatasets, datasetPage, inputTableDrafts.length, inputTableSourceFilter]);

  const handleSearchChange = useCallback((value: string) => {
    setLoadingTab('tasks');
    setSearchQuery(value);
    setTaskPage(1);
  }, []);

  const handleInputTableSourceFilterChange = useCallback((value: InputTableSourceFilter) => {
    setLoadingTab('input_tables');
    setInputTableSourceFilter(value);
    setDatasetPage(1);
  }, []);

  const handleTabChange = useCallback((tab: DataTab) => {
    if (tab === activeTab) return;
    dashboardRequestSeq.current += 1;
    pendingNavigationTabRef.current = tab === 'output_tables' ? null : tab;
    setLoadingTab(null);
    setActiveTab(tab);
  }, [activeTab]);

  const handleTaskPageChange = useCallback((page: number) => {
    setLoadingTab('tasks');
    setTaskPage(page);
  }, []);

  const handleDatasetPageChange = useCallback((page: number) => {
    setLoadingTab('input_tables');
    setDatasetPage(page);
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
  const editingInputTableDraft = useMemo(
    () => inputTableDrafts.find((draft) => draft.id === editingInputTableDraftId) ?? null,
    [editingInputTableDraftId, inputTableDrafts]
  );
  const editingInputTableDataset = useMemo(
    () => dashboard.datasets.find((dataset) => dataset.id === editingInputTableDatasetId) ?? null,
    [dashboard.datasets, editingInputTableDatasetId]
  );
  const isDetailEditor = Boolean(editingTask || editingInputTableDraft || editingInputTableDataset);
  const isTasksLoading =
    loadingTab === 'tasks' ||
    (activeTab === 'tasks' && pendingNavigationTabRef.current === 'tasks');
  const isInputTablesLoading =
    loadingTab === 'input_tables' ||
    (activeTab === 'input_tables' && pendingNavigationTabRef.current === 'input_tables');
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

  const handleCreateInputTableDraft = useCallback(() => {
    const now = Date.now();
    const draft: InputTableDraft = {
      id: makeLocalId('input_table'),
      name: `${t('data.inputTables.defaultName')} ${dashboard.totalDatasets + inputTableDrafts.length + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    setInputTableDrafts((current) => [draft, ...current]);
    setInputTableSourceFilter('all');
    setActiveTab('input_tables');
    setEditingInputTableDatasetId(null);
    setEditingInputTableDraftId(draft.id);
  }, [dashboard.totalDatasets, inputTableDrafts.length, t]);

  const handleRenameInputTableDraft = useCallback((id: string, name: string) => {
    setInputTableDrafts((current) =>
      current.map((draft) =>
        draft.id === id ? { ...draft, name, updatedAt: Date.now() } : draft
      )
    );
  }, []);

  const handleDeleteInputTableDraft = useCallback((id: string) => {
    setInputTableDrafts((current) => current.filter((draft) => draft.id !== id));
    setEditingInputTableDraftId((current) => (current === id ? null : current));
  }, []);

  const handleImportInputTableSource = useCallback(async (
    draft: InputTableDraft,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig,
    name?: string
  ) => {
    if (!window.electronAPI?.data) return;
    setActionId(draft.id);
    setError(null);
    try {
      const source = window.electronAPI.selectInputTableSource
        ? await window.electronAPI.selectInputTableSource(sourceKind)
        : { path: await selectOneFile(), kind: 'file' as const };
      const sourcePath = source?.path;
      if (!sourcePath) return;
      setActiveTab('input_tables');
      const imported = await window.electronAPI.data.importDataset({
        filePath: sourcePath,
        name: name?.trim() || draft.name,
        sourceKind,
        config,
      });
      setInputTableDrafts((current) => current.filter((item) => item.id !== draft.id));
      setEditingInputTableDraftId(null);
      setEditingInputTableDatasetId(imported.id);
      await loadDashboard({ preserveError: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true });
    } finally {
      setActionId(null);
    }
  }, [loadDashboard, selectOneFile]);

  const handleEditInputTableDataset = useCallback((id: string) => {
    setActiveTab('input_tables');
    setEditingInputTableDraftId(null);
    setEditingInputTableDatasetId(id);
  }, []);

  const handleRenameInputTableDataset = useCallback(
    async (dataset: DataDataset, name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName === dataset.name || !window.electronAPI?.data?.updateDataset) {
        return;
      }
      setActionId(dataset.id);
      setError(null);
      try {
        await window.electronAPI.data.updateDataset({ id: dataset.id, name: trimmedName });
        await loadDashboard({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard]
  );

  const handleUpdateInputTableSource = useCallback(
    async (
      dataset: DataDataset,
      sourceKind: DataInputTableSourceKind,
      config: DataInputTableConfig,
      name?: string
    ) => {
      if (!window.electronAPI?.data?.updateDataset) return;
      setActionId(dataset.id);
      setError(null);
      try {
        const source = window.electronAPI.selectInputTableSource
          ? await window.electronAPI.selectInputTableSource(sourceKind)
          : { path: await selectOneFile(), kind: 'file' as const };
        const sourcePath = source?.path;
        if (!sourcePath) return;
        await window.electronAPI.data.updateDataset({
          id: dataset.id,
          filePath: sourcePath,
          name: name?.trim() || dataset.name,
          sourceKind,
          config,
        });
        await loadDashboard({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard, selectOneFile]
  );

  const handleUpdateInputTableConfig = useCallback(
    async (dataset: DataDataset, config: DataInputTableConfig, name?: string) => {
      if (!window.electronAPI?.data?.updateDataset) return;
      setActionId(dataset.id);
      setError(null);
      try {
        await window.electronAPI.data.updateDataset({
          id: dataset.id,
          name: name?.trim() || dataset.name,
          sourceKind: config.sourceKind,
          config,
        });
        await loadDashboard({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard]
  );

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

  const handleDeleteInputTable = useCallback(
    async (dataset: DataDataset) => {
      if (!window.electronAPI?.data?.deleteDataset) return;
      const confirmed = window.confirm(t('data.inputTables.deleteConfirm', { name: dataset.name }));
      if (!confirmed) return;
      setActionId(dataset.id);
      setError(null);
      try {
        const result = await window.electronAPI.data.deleteDataset(dataset.id);
        if (!result.success) {
          throw new Error(t('data.inputTables.deleteNotFound'));
        }
        await loadDashboard({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard, t]
  );

  const handlePreviewStoredInputTable = useCallback(async (dataset: DataDataset, page = 1) => {
    if (!window.electronAPI?.data?.previewDataset) return;
    setStoredPreviewOpen(true);
    setStoredPreviewDataset(dataset);
    setStoredPreviewLoading(true);
    setStoredPreviewError(null);
    setStoredPreviewPage(page);
    try {
      const preview = await window.electronAPI.data.previewDataset({
        id: dataset.id,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      });
      setStoredPreviewData(preview);
    } catch (err) {
      setStoredPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoredPreviewLoading(false);
    }
  }, []);

  return (
    <div
      className={`flex-1 min-h-0 bg-background ${
        isDetailEditor ? 'overflow-hidden' : 'overflow-y-auto'
      }`}
    >
      <div
        className={`mx-auto w-full max-w-[1120px] px-3 py-3 sm:px-4 ${
          isDetailEditor ? 'flex h-full min-h-0 flex-col' : ''
        }`}
      >
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
        ) : editingInputTableDraft ? (
          <InputTableEditor
            draft={editingInputTableDraft}
            isBusy={actionId === editingInputTableDraft.id}
            onBack={() => setEditingInputTableDraftId(null)}
            onRenameDraft={handleRenameInputTableDraft}
            onChooseDraftSource={handleImportInputTableSource}
          />
        ) : editingInputTableDataset ? (
          <InputTableEditor
            dataset={editingInputTableDataset}
            isBusy={actionId === editingInputTableDataset.id}
            onBack={() => setEditingInputTableDatasetId(null)}
            onRenameDataset={handleRenameInputTableDataset}
            onChooseDatasetSource={handleUpdateInputTableSource}
            onUpdateDatasetConfig={handleUpdateInputTableConfig}
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
                    onClick={() => handleTabChange('tasks')}
                    label={t('data.tabs.tasks')}
                  />
                  <TabButton
                    active={activeTab === 'input_tables'}
                    onClick={() => handleTabChange('input_tables')}
                    label={t('data.tabs.inputTables')}
                  />
                  <TabButton
                    active={activeTab === 'output_tables'}
                    onClick={() => handleTabChange('output_tables')}
                    label={t('data.tabs.outputTables')}
                  />
                </div>
              </div>

              {activeTab === 'tasks' ? (
                <TasksPanel
                  tasks={dashboard.tasks}
                  totalTasks={dashboard.totalTasks}
                  currentPage={taskPage}
                  searchQuery={searchQuery}
                  actionId={actionId}
                  isLoading={isTasksLoading}
                  isCreateDisabled={!isDataApiAvailable || actionId === 'create'}
                  onCreate={handleCreateTask}
                  onSearchChange={handleSearchChange}
                  onPageChange={handleTaskPageChange}
                  onRun={handleRunTask}
                  onEdit={(task) => setEditingTaskId(task.id)}
                  onDelete={handleDeleteTask}
                />
              ) : (
                <div
                  className={
                    activeTab === 'input_tables'
                      ? 'overflow-visible bg-transparent'
                      : 'overflow-hidden rounded-xl border border-border-muted bg-background/90 shadow-card'
                  }
                >
                  {activeTab === 'input_tables' ? (
                      <InputTablesPanel
                        datasets={dashboard.datasets}
                        drafts={inputTableDrafts}
                        totalDatasets={dashboard.totalDatasets}
                        currentPage={datasetPage}
                        isLoading={isInputTablesLoading}
                        sourceFilter={inputTableSourceFilter}
                        onSourceFilterChange={handleInputTableSourceFilterChange}
                        onPageChange={handleDatasetPageChange}
                        onCreate={handleCreateInputTableDraft}
                        onRefresh={() => loadDashboard({ preserveError: true })}
                        onPreviewDataset={handlePreviewStoredInputTable}
                      onDelete={handleDeleteInputTable}
                      onDeleteDraft={handleDeleteInputTableDraft}
                      onEditDraft={setEditingInputTableDraftId}
                      onEditDataset={handleEditInputTableDataset}
                      isCreateDisabled={!isDataApiAvailable}
                      actionId={actionId}
                    />
                  ) : (
                    <BlankDataTableSurface />
                  )}
                </div>
              )}
            </section>
            {storedPreviewOpen && (
              <InputTablePreviewDialog
                preview={storedPreviewData}
                isLoading={storedPreviewLoading}
                error={storedPreviewError}
                currentPage={storedPreviewPage}
                onPageChange={(page) => {
                  if (storedPreviewDataset) {
                    void handlePreviewStoredInputTable(storedPreviewDataset, page);
                  }
                }}
                onClose={() => setStoredPreviewOpen(false)}
              />
            )}
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

function TasksPanel({
  tasks,
  totalTasks,
  currentPage,
  searchQuery,
  actionId,
  isLoading,
  isCreateDisabled,
  onCreate,
  onSearchChange,
  onPageChange,
  onRun,
  onEdit,
  onDelete,
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
  onPageChange: (page: number) => void;
  onRun: (task: DataCleaningTask) => void;
  onEdit: (task: DataCleaningTask) => void;
  onDelete: (task: DataCleaningTask) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="bg-transparent">
      <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <button
          onClick={onCreate}
          disabled={isCreateDisabled}
          className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('data.newCleaningTask')}
        </button>
        <div className="relative w-full sm:w-[20rem]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('data.searchPlaceholder')}
            className="h-8 w-full rounded-lg border border-border-muted bg-background/94 pl-8 pr-3 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border-muted bg-background/90 shadow-card">
        <TasksTable
          tasks={tasks}
          actionId={actionId}
          isLoading={isLoading}
          onRun={onRun}
          onEdit={onEdit}
          onDelete={onDelete}
        />
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
  actionId,
  isLoading,
  onRun,
  onEdit,
  onDelete,
}: {
  tasks: DataCleaningTask[];
  actionId: string | null;
  isLoading: boolean;
  onRun: (task: DataCleaningTask) => void;
  onEdit: (task: DataCleaningTask) => void;
  onDelete: (task: DataCleaningTask) => void;
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

function InputTablesPanel({
  datasets,
  drafts,
  totalDatasets,
  currentPage,
  isLoading,
  sourceFilter,
  onSourceFilterChange,
  onPageChange,
  onCreate,
  onRefresh,
  onPreviewDataset,
  onDelete,
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
  isLoading: boolean;
  sourceFilter: InputTableSourceFilter;
  onSourceFilterChange: (source: InputTableSourceFilter) => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onPreviewDataset: (dataset: DataDataset) => void;
  onDelete: (dataset: DataDataset) => void;
  onDeleteDraft: (id: string) => void;
  onEditDraft: (id: string) => void;
  onEditDataset: (id: string) => void;
  isCreateDisabled: boolean;
  actionId: string | null;
}) {
  const { t } = useTranslation();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const draftCount = sourceFilter === 'all' ? drafts.length : 0;
  const totalRows = totalDatasets + draftCount;
  const pageCount = getTablePageCount(totalRows);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const draftStart = (safeCurrentPage - 1) * TABLE_PAGE_SIZE;
  const pageDrafts = useMemo(
    () =>
      !isLoading && sourceFilter === 'all'
        ? drafts.slice(draftStart, draftStart + TABLE_PAGE_SIZE)
        : [],
    [draftStart, drafts, isLoading, sourceFilter]
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
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);
  const emptyLabel =
    sourceFilter === 'all' ? t('data.inputTables.empty') : t('data.inputTables.emptyFiltered');
  const selectedRow = visibleRows.find((row) => row.id === selectedDatasetId) ?? null;
  const selectedDataset = selectedRow?.kind === 'dataset' ? selectedRow.dataset : null;
  const selectedDraft = selectedRow?.kind === 'draft' ? selectedRow.draft : null;
  const selectedRowBusy = selectedRow ? actionId === selectedRow.id : false;

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (selectedDatasetId && !visibleRows.some((row) => row.id === selectedDatasetId)) {
      setSelectedDatasetId(null);
    }
  }, [isLoading, selectedDatasetId, visibleRows]);

  return (
    <div className="bg-transparent">
      <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onCreate}
              disabled={isCreateDisabled}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('data.inputTables.add')}
            </button>
            <label className="relative block w-32">
              <span className="sr-only">{t('data.inputTables.sourceFilter')}</span>
              <select
                value={sourceFilter}
                onChange={(event) =>
                  onSourceFilterChange(event.target.value as InputTableSourceFilter)
                }
                className="h-8 w-full appearance-none rounded-lg border border-border-muted bg-background/94 pl-3 pr-8 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {INPUT_TABLE_SOURCE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            </label>
          </div>

          <div className="mx-1 hidden h-5 w-px bg-border-muted lg:block" />
          <div className="flex flex-wrap items-center gap-2">
            <InputTableToolbarButton
              icon={<Eye className="h-3.5 w-3.5" />}
              label={t('data.inputTables.actions.preview')}
              disabled={!selectedDataset}
              onClick={() => {
                if (selectedDataset) {
                  onPreviewDataset(selectedDataset);
                }
              }}
            />
            <InputTableToolbarButton
              icon={<PencilLine className="h-3.5 w-3.5" />}
              label={t('data.inputTables.actions.edit')}
              disabled={!selectedRow}
              onClick={() => {
                if (selectedDraft) {
                  onEditDraft(selectedDraft.id);
                } else if (selectedDataset) {
                  onEditDataset(selectedDataset.id);
                }
              }}
            />
            <InputTableToolbarButton
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label={t('data.inputTables.actions.delete')}
              disabled={!selectedRow || selectedRowBusy}
              danger
              onClick={() => {
                if (selectedDraft) {
                  onDeleteDraft(selectedDraft.id);
                } else if (selectedDataset) {
                  onDelete(selectedDataset);
                }
              }}
            />
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('data.actions.refresh')}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border-muted bg-background/94">
        {isLoading ? (
          <LoadingState label={t('data.inputTables.loading')} />
        ) : visibleRows.length === 0 ? (
          <EmptyState label={emptyLabel} />
        ) : (
          <>
            <div className="overflow-hidden">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="h-10 border-b border-border-muted bg-background/80 text-xs font-medium text-text-muted">
                    <th className="w-[4%] px-4">
                      <span className="sr-only">{t('data.inputTables.selection')}</span>
                    </th>
                    <th className="w-[22%] whitespace-nowrap px-2">{t('data.columns.inputTableName')}</th>
                    <th className="w-[9%] whitespace-nowrap px-2">{t('data.columns.sourceType')}</th>
                    <th className="w-[22%] whitespace-nowrap px-2">{t('data.columns.sourceLocation')}</th>
                    <th className="w-[17%] whitespace-nowrap px-2">{t('data.columns.relatedTasks')}</th>
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
                        className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
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
                          <div className="truncate text-[13px] font-medium text-text-secondary" title={dataset?.sourcePath}>
                            {dataset ? formatDisplayPath(dataset.sourcePath) : t('data.inputTables.notConfigured')}
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
          <div className="flex min-h-11 flex-col items-center justify-between gap-2 border-t border-border-muted px-4 py-2.5 text-xs font-medium text-text-secondary sm:flex-row">
            <span>{t('data.totalCount', { count: totalRows })}</span>
            <div className="flex items-center gap-2">
              <button className="inline-flex h-8 min-w-[6.5rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-text-secondary shadow-soft">
                {t('data.rowsPerPage', { count: TABLE_PAGE_SIZE })}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onPageChange(safeCurrentPage - 1)}
                disabled={safeCurrentPage <= 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  onClick={() => onPageChange(pageNumber)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                    pageNumber === safeCurrentPage
                      ? 'bg-accent text-white shadow-soft'
                      : 'border border-border-muted bg-background/94 text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                onClick={() => onPageChange(safeCurrentPage + 1)}
                disabled={safeCurrentPage >= pageCount}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function InputTableEditor({
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
  const { t } = useTranslation();
  const targetId = draft?.id ?? dataset?.id ?? '';
  const initialName = draft?.name ?? dataset?.name ?? '';
  const initialSourceKind = dataset?.sourceKind ?? 'excel';
  const initialConfig = useMemo(
    () => dataset?.inputConfig ?? getDefaultInputTableConfig(initialSourceKind),
    [dataset?.inputConfig, initialSourceKind]
  );
  const [localName, setLocalName] = useState(initialName);
  const [localSourceKind, setLocalSourceKind] =
    useState<DataInputTableSourceKind>(initialSourceKind);
  const [localConfig, setLocalConfig] = useState<DataInputTableConfig>(initialConfig);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DataInputTablePreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const trimmedName = localName.trim();
  const isConfigured = Boolean(dataset);
  const sourceMeta = getInputTableSourceMeta(localSourceKind);
  const SourceIcon = sourceMeta.Icon;
  const excelConfig =
    localConfig.sourceKind === 'excel' ? localConfig : getDefaultExcelInputTableConfig();
  const folderConfig =
    localConfig.sourceKind === 'folder' ? localConfig : getDefaultFolderInputTableConfig();
  const sourceName = dataset ? getFileNameFromPath(dataset.sourcePath) : '';
  const hasNameChanges = Boolean(dataset && trimmedName && trimmedName !== dataset.name);
  const canSaveConfig =
    Boolean(dataset) &&
    localSourceKind === dataset?.sourceKind &&
    !isInputTableConfigEqual(localConfig, dataset?.inputConfig);
  const canSave = Boolean(dataset && trimmedName && !isBusy && (hasNameChanges || canSaveConfig));
  const canPreview = Boolean(
    dataset &&
      localSourceKind === dataset.sourceKind &&
      !isBusy &&
      window.electronAPI?.data?.previewInputTable
  );

  useEffect(() => {
    setLocalName(initialName);
    setLocalSourceKind(initialSourceKind);
    setLocalConfig(initialConfig);
  }, [initialConfig, initialName, initialSourceKind, targetId]);

  const handleNameChange = (value: string) => {
    setLocalName(value);
    if (draft && onRenameDraft) {
      onRenameDraft(draft.id, value);
    }
  };

  const chooseSource = (sourceKind: DataInputTableSourceKind, config = localConfig) => {
    const nextConfig =
      config.sourceKind === sourceKind ? config : getDefaultInputTableConfig(sourceKind);
    if (draft && onChooseDraftSource) {
      void onChooseDraftSource(draft, sourceKind, nextConfig, localName);
    } else if (dataset && onChooseDatasetSource) {
      void onChooseDatasetSource(dataset, sourceKind, nextConfig, localName);
    }
  };

  const handleSourceKindChange = (sourceKind: DataInputTableSourceKind) => {
    const nextConfig = getDefaultInputTableConfig(sourceKind);
    setLocalSourceKind(sourceKind);
    setLocalConfig(nextConfig);
  };

  const updateConfig = (config: DataInputTableConfig) => {
    setLocalConfig(config);
  };

  const saveInputTable = () => {
    if (!dataset || !trimmedName) return;
    if (canSaveConfig && onUpdateDatasetConfig) {
      void onUpdateDatasetConfig(dataset, localConfig, localName);
      return;
    }
    if (hasNameChanges && onRenameDataset) {
      void onRenameDataset(dataset, localName);
    }
  };

  const loadPreviewPage = async (page: number) => {
    if (!dataset || !window.electronAPI?.data?.previewInputTable) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewPage(page);
    try {
      const nextPreview = await window.electronAPI.data.previewInputTable({
        filePath: dataset.sourcePath,
        sourceKind: localSourceKind,
        config: localConfig,
        limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
        offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
      });
      setPreviewData(nextPreview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewInputTable = async () => {
    setPreviewData(null);
    await loadPreviewPage(1);
  };

  return (
    <>
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('data.inputTables.editor.back')}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <input
              value={localName}
              onChange={(event) => handleNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              disabled={isBusy}
              maxLength={50}
              aria-label={t('data.inputTables.editor.name')}
              className="h-8 min-w-0 max-w-[18rem] truncate border-0 bg-transparent px-0 text-[15px] font-medium text-text-secondary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={t('data.inputTables.editor.title')}
            />
            <PencilLine className="h-4 w-4 flex-shrink-0 text-text-muted" />
            <InputTableStatusBadge
              label={
                isConfigured
                  ? t('data.inputTables.status.available')
                  : t('data.inputTables.status.draft')
              }
              tone={isConfigured ? 'success' : 'warning'}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void previewInputTable()}
            disabled={!canPreview || previewLoading}
            className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewLoading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {t('data.inputTables.editor.preview')}
          </button>
          <button
            type="button"
            onClick={saveInputTable}
            disabled={!canSave}
            className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-background/94 px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {isBusy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border-muted bg-background/94 p-4 shadow-card">
        <div className="grid gap-5 lg:grid-cols-[8rem_minmax(0,1fr)] lg:items-center">
          <InputTableFormLabel>{t('data.inputTables.editor.sourceType')}</InputTableFormLabel>
          <label className="relative block">
            <span
              className={`pointer-events-none absolute left-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md ${sourceMeta.className}`}
            >
              <SourceIcon className="h-4 w-4" />
            </span>
            <select
              value={localSourceKind}
              onChange={(event) => handleSourceKindChange(event.target.value as DataInputTableSourceKind)}
              disabled={isBusy}
              className="h-10 w-full appearance-none rounded-lg border border-border-muted bg-background/96 pl-12 pr-9 text-[13px] font-medium text-text-secondary shadow-soft outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="excel">{t('data.inputTables.editor.excel')}</option>
              <option value="csv">{t('data.inputTables.editor.csv')}</option>
              <option value="folder">{t('data.inputTables.editor.folder')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          </label>

          <InputTableFormLabel>
            {localSourceKind === 'folder'
              ? t('data.inputTables.editor.folderPath')
              : t('data.inputTables.editor.file')}
          </InputTableFormLabel>
          <div className="flex min-w-0 items-stretch">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-l-lg border border-border-muted bg-background/86 px-3.5 shadow-soft">
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${sourceMeta.className}`}
              >
                <SourceIcon className="h-4 w-4" />
              </span>
              <div
                className="min-w-0 truncate text-[13px] font-medium text-text-secondary"
                title={dataset?.sourcePath}
              >
                {dataset ? formatDisplayPath(dataset.sourcePath) : t('data.inputTables.editor.noSource')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => chooseSource(localSourceKind)}
              disabled={isBusy || !trimmedName}
              className="inline-flex h-10 flex-shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-border-muted bg-background px-4 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
            >
              {localSourceKind === 'folder'
                ? t('data.inputTables.editor.changeFolder')
                : t('data.inputTables.editor.changeFile')}
            </button>
          </div>

          {localSourceKind === 'excel' && (
            <>
              <InputTableFormLabel>{t('data.inputTables.editor.sheetName')}</InputTableFormLabel>
              <label className="relative block">
                <select
                  value={excelConfig.sheetName ?? ''}
                  onChange={(event) =>
                    updateConfig({
                      ...excelConfig,
                      sheetName: event.target.value,
                    })
                  }
                  disabled={isBusy || !dataset}
                  className="h-10 w-full appearance-none rounded-lg border border-border-muted bg-background/96 px-3 pr-9 text-[13px] font-medium text-text-secondary shadow-soft outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {(excelConfig.sheetNames.length > 0 ? excelConfig.sheetNames : ['Sheet1']).map(
                    (sheetName) => (
                      <option key={sheetName} value={sheetName}>
                        {sheetName}
                      </option>
                    )
                  )}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              </label>

              <InputTableFormLabel>{t('data.inputTables.editor.headerRow')}</InputTableFormLabel>
              <div className="flex flex-wrap items-center gap-5 text-[13px] font-medium text-text-secondary">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={excelConfig.headerMode === 'auto'}
                    onChange={() => updateConfig({ ...excelConfig, headerMode: 'auto' })}
                    disabled={isBusy || !dataset}
                    className="h-4 w-4 accent-accent"
                  />
                  {t('data.inputTables.editor.smartDetect')}
                  <span className="text-accent">{t('data.inputTables.editor.recommended')}</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={excelConfig.headerMode === 'manual'}
                    onChange={() => updateConfig({ ...excelConfig, headerMode: 'manual' })}
                    disabled={isBusy || !dataset}
                    className="h-4 w-4 accent-accent"
                  />
                  {t('data.inputTables.editor.manualSpecify')}
                </label>
                <input
                  type="number"
                  min={1}
                  value={excelConfig.headerRow}
                  onChange={(event) =>
                    updateConfig({
                      ...excelConfig,
                      headerMode: 'manual',
                      headerRow: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                  disabled={isBusy || !dataset}
                  className="h-9 w-24 rounded-lg border border-border-muted bg-background px-3 text-[13px] font-medium text-text-secondary shadow-soft outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span>{t('data.inputTables.editor.rowUnit')}</span>
              </div>

              <InputTableInfo className="lg:col-span-2">
                {t('data.inputTables.editor.excelInfo')}
              </InputTableInfo>
            </>
          )}

          {localSourceKind === 'csv' && (
            <>
              <InputTableFormLabel className="self-start pt-1">
                {t('data.inputTables.editor.autoResult')}
              </InputTableFormLabel>
              <div className="overflow-hidden rounded-lg border border-border-muted bg-background/88">
                {[
                  ['header', 'data.inputTables.editor.csvHeader'],
                  ['dataRegion', 'data.inputTables.editor.csvDataRegion'],
                  ['encoding', 'data.inputTables.editor.csvEncoding'],
                  ['delimiter', 'data.inputTables.editor.csvDelimiter'],
                ].map(([key, labelKey]) => (
                  <div
                    key={key}
                    className="grid min-h-9 grid-cols-[12rem_minmax(0,1fr)] border-b border-border-muted px-3 text-xs font-medium last:border-b-0"
                  >
                    <div className="flex items-center text-text-secondary">{t(labelKey)}</div>
                    <div className="flex items-center text-text-muted">
                      {t('data.inputTables.editor.autoDetected')}
                    </div>
                  </div>
                ))}
              </div>

              <InputTableInfo className="lg:col-span-2">
                {t('data.inputTables.editor.csvInfo')}
              </InputTableInfo>
            </>
          )}

          {localSourceKind === 'folder' && (
            <>
              <InputTableFormLabel className="self-start pt-1">
                {t('data.inputTables.editor.folderMergeStrategy')}
              </InputTableFormLabel>
              <div className="grid gap-3">
                <InputTableFieldRow label={t('data.inputTables.editor.mergeMethod')}>
                  <InputTableSelect
                    value={folderConfig.mergeMode}
                    disabled={isBusy || !dataset}
                    onChange={() => undefined}
                    options={[
                      {
                        value: 'append_same_schema',
                        label: t('data.inputTables.editor.mergeAppend'),
                      },
                    ]}
                  />
                </InputTableFieldRow>
                <InputTableFieldRow label={t('data.inputTables.editor.schemaMismatch')}>
                  <InputTableSelect
                    value={folderConfig.schemaStrategy}
                    disabled={isBusy || !dataset}
                    onChange={() => undefined}
                    options={[
                      {
                        value: 'align_by_name',
                        label: t('data.inputTables.editor.schemaAlignByName'),
                      },
                    ]}
                  />
                </InputTableFieldRow>
                <InputTableFieldRow label={t('data.inputTables.editor.fileSelectionRange')}>
                  <InputTableSelect
                    value={folderConfig.fileRange}
                    disabled={isBusy || !dataset}
                    onChange={(value) =>
                      updateConfig({
                        ...folderConfig,
                        fileRange: value as DataInputTableFolderConfig['fileRange'],
                      })
                    }
                    options={[
                      { value: 'excel_csv', label: t('data.inputTables.editor.includeExcelCsv') },
                      { value: 'excel', label: t('data.inputTables.editor.includeExcel') },
                      { value: 'csv', label: t('data.inputTables.editor.includeCsv') },
                    ]}
                  />
                </InputTableFieldRow>
                <InputTableCheckbox
                  checked={folderConfig.skipEmptyFiles}
                  disabled={isBusy || !dataset}
                  label={t('data.inputTables.editor.skipEmptyFiles')}
                  onChange={(checked) => updateConfig({ ...folderConfig, skipEmptyFiles: checked })}
                />
                <InputTableCheckbox
                  checked={folderConfig.keepSourceFileName}
                  disabled={isBusy || !dataset}
                  label={t('data.inputTables.editor.keepSourceFileName')}
                  onChange={(checked) =>
                    updateConfig({ ...folderConfig, keepSourceFileName: checked })
                  }
                />
              </div>

              <InputTableInfo className="lg:col-span-2">
                {t('data.inputTables.editor.folderInfo')}
              </InputTableInfo>
            </>
          )}

          {dataset && (
            <InputTableSourceSummary
              dataset={dataset}
              sourceMeta={sourceMeta}
              sourceName={sourceName}
              t={t}
            />
          )}
        </div>
      </div>
    </section>
    {previewOpen && (
      <InputTablePreviewDialog
        preview={previewData}
        isLoading={previewLoading}
        error={previewError}
        currentPage={previewPage}
        onPageChange={(page) => void loadPreviewPage(page)}
        onClose={() => setPreviewOpen(false)}
      />
    )}
    </>
  );
}

function InputTablePreviewDialog({
  preview,
  isLoading,
  error,
  currentPage,
  onPageChange,
  onClose,
}: {
  preview: DataInputTablePreview | null;
  isLoading: boolean;
  error: string | null;
  currentPage: number;
  onPageChange: (page: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const columns = preview?.columns ?? [];
  const rows = preview?.rows ?? [];
  const totalRows = preview?.totalRows ?? 0;
  const pageSize = preview?.limit ?? INPUT_TABLE_PREVIEW_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/28 px-4 py-6">
      <div className="flex h-[42rem] max-h-[calc(100vh-3rem)] w-[72rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-muted bg-background shadow-card">
        <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-muted bg-surface-active/70 px-4 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">
              {t('data.inputTables.editor.previewTitle')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background p-3">
          {isLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <LoadingState label={t('data.inputTables.editor.previewLoading')} />
            </div>
          ) : error ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-error/15 bg-error/5 px-4 text-center text-xs font-medium text-error">
              {error}
            </div>
          ) : columns.length === 0 || rows.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border-muted bg-background/70">
              <EmptyState label={t('data.inputTables.editor.previewEmpty')} />
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border-muted">
                <table className="min-w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-background">
                    <tr className="h-9 border-b border-border-muted text-text-muted">
                      {columns.map((column) => (
                        <th
                          key={column}
                          className="max-w-[12rem] whitespace-nowrap px-3 font-medium"
                        >
                          <span className="block truncate" title={column}>
                            {column}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr
                        key={rowIndex}
                        className="h-9 border-b border-border-muted/80 last:border-b-0 hover:bg-surface-hover/35"
                      >
                        {columns.map((column) => (
                          <td
                            key={column}
                            className="max-w-[12rem] whitespace-nowrap px-3 text-text-secondary"
                          >
                            <span className="block truncate" title={formatPreviewCell(row[column])}>
                              {formatPreviewCell(row[column])}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="flex h-12 flex-shrink-0 items-center justify-between gap-3 border-t border-border-muted px-4 text-xs font-medium text-text-secondary">
          <span>
            {preview
              ? t('data.inputTables.editor.previewTotal', { count: totalRows })
              : t('data.inputTables.editor.previewPageSize', {
                  count: INPUT_TABLE_PREVIEW_PAGE_SIZE,
                })}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="mr-2 hidden text-text-muted sm:inline">
              {t('data.inputTables.editor.previewPageSize', {
                count: preview?.limit ?? INPUT_TABLE_PREVIEW_PAGE_SIZE,
              })}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(safeCurrentPage - 1)}
              disabled={isLoading || safeCurrentPage <= 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => onPageChange(pageNumber)}
                disabled={isLoading}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  pageNumber === safeCurrentPage
                    ? 'bg-accent text-white shadow-soft'
                    : 'border border-border-muted bg-background/94 text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
                }`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onPageChange(safeCurrentPage + 1)}
              disabled={isLoading || safeCurrentPage >= pageCount}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InputTableFormLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-[13px] font-medium text-text-secondary ${className}`}>
      {children}
    </div>
  );
}

function InputTableInfo({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-11 items-center gap-2 rounded-lg border border-blue-500/15 bg-blue-500/5 px-3 text-xs font-medium text-text-muted ${className}`}
    >
      <Info className="h-4 w-4 flex-shrink-0 text-blue-500" />
      <span>{children}</span>
    </div>
  );
}

function InputTableSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block">
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full appearance-none rounded-lg border border-border-muted bg-background/96 px-3 pr-9 text-[13px] font-medium text-text-secondary shadow-soft outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
    </label>
  );
}

function InputTableFieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-center">
      <div className="text-xs font-medium text-text-secondary">{label}</div>
      {children}
    </div>
  );
}

function InputTableCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex w-fit items-center gap-2 text-[13px] font-medium text-text-secondary">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border-muted accent-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
      {label}
    </label>
  );
}

function InputTableSourceSummary({
  dataset,
  sourceMeta,
  sourceName,
  t,
}: {
  dataset: DataDataset;
  sourceMeta: ReturnType<typeof getInputTableSourceMeta>;
  sourceName: string;
  t: TranslateFn;
}) {
  const SourceIcon = sourceMeta.Icon;
  const items =
    dataset.sourceKind === 'folder'
      ? [
          {
            label: t('data.columns.sourceType'),
            value: t(sourceMeta.labelKey),
            icon: true,
          },
          {
            label: t('data.inputTables.editor.fileCount'),
            value: formatInteger(dataset.fileCount),
          },
          {
            label: t('data.inputTables.editor.totalRows'),
            value: formatInteger(dataset.rowCount),
          },
          {
            label: t('data.inputTables.editor.estimatedColumns'),
            value: formatInteger(dataset.columnCount),
          },
        ]
      : [
          {
            label: t('data.columns.sourceType'),
            value: t(sourceMeta.labelKey),
            icon: true,
          },
          {
            label: t('data.inputTables.editor.fileName'),
            value: sourceName,
          },
          {
            label: t('data.inputTables.editor.rows'),
            value: formatInteger(dataset.rowCount),
          },
          {
            label: t('data.inputTables.editor.columns'),
            value: formatInteger(dataset.columnCount),
          },
        ];

  return (
    <div className="grid gap-3 rounded-lg border border-border-muted bg-background/80 px-4 py-3 shadow-soft sm:grid-cols-4 lg:col-span-2">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={`min-w-0 ${
            index > 0 ? 'border-t border-border-muted pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0' : ''
          }`}
        >
          <div className="text-xs font-medium text-text-muted">{item.label}</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[13px] font-medium text-text-secondary">
            {item.icon && (
              <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${sourceMeta.className}`}>
                <SourceIcon className="h-4 w-4" />
              </span>
            )}
            <span className="truncate">{item.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function InputTableStatusBadge({
  label,
  tone = 'success',
}: {
  label: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <span
      className={`inline-flex h-6 whitespace-nowrap items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
        tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function InputTableToolbarButton({
  icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-muted bg-background/94 px-2.5 text-xs font-medium text-text-secondary shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? 'hover:border-error/30 hover:bg-error/10 hover:text-error'
          : 'hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
      }`}
      title={label}
    >
      {icon}
      {label}
    </button>
  );
}

function BlankDataTableSurface() {
  return <div className="h-[24rem] bg-background/90" aria-hidden="true" />;
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

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs font-medium text-text-muted">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-background/90 px-3 py-2 shadow-soft">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
        {label}
      </div>
    </div>
  );
}

function PaginationFooter({
  count,
  currentPage,
  onPageChange,
  embedded = false,
}: {
  count: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const pageCount = getTablePageCount(count);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, pageCount);

  return (
    <div
      className={`flex min-h-11 flex-col items-center justify-between gap-2 px-4 text-xs font-medium text-text-secondary sm:flex-row ${
        embedded ? 'border-t border-border-muted py-2.5' : 'mt-3'
      }`}
    >
      <span>{t('data.totalCount', { count })}</span>
      <div className="flex items-center gap-2">
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

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatPreviewCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function formatRelatedTaskNames(
  names: string[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (names.length === 0) return t('data.inputTables.noRelatedTasks');
  return names.join(', ');
}

function formatDisplayPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.replace(/^\/Users\/[^/]+/, '~');
}

function getFileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').filter(Boolean).pop() ?? filePath;
}

function getDefaultInputTableConfig(sourceKind: DataInputTableSourceKind): DataInputTableConfig {
  if (sourceKind === 'excel') {
    return getDefaultExcelInputTableConfig();
  }
  if (sourceKind === 'folder') {
    return getDefaultFolderInputTableConfig();
  }
  return {
    sourceKind: 'csv',
    header: 'auto',
    dataRegion: 'auto',
    encoding: 'auto',
    delimiter: 'auto',
  };
}

function getDefaultExcelInputTableConfig(): DataInputTableExcelConfig {
  return {
    sourceKind: 'excel',
    sheetName: 'Sheet1',
    sheetNames: ['Sheet1'],
    headerMode: 'auto',
    headerRow: 1,
  };
}

function getDefaultFolderInputTableConfig(): DataInputTableFolderConfig {
  return {
    sourceKind: 'folder',
    mergeMode: 'append_same_schema',
    schemaStrategy: 'align_by_name',
    fileRange: 'excel_csv',
    skipEmptyFiles: true,
    keepSourceFileName: true,
  };
}

function isInputTableConfigEqual(
  left: DataInputTableConfig,
  right: DataInputTableConfig | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getInputTableSourceMeta(kind: InputTableSourceKind): {
  Icon: LucideIcon;
  labelKey: string;
  className: string;
  badgeClassName: string;
} {
  switch (kind) {
    case 'draft':
      return {
        Icon: Table2,
        labelKey: 'data.inputTables.sources.notConfigured',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    case 'excel':
      return {
        Icon: Table2,
        labelKey: 'data.inputTables.sources.excel',
        className: 'bg-success/10 text-success',
        badgeClassName: 'bg-success/10 text-success',
      };
    case 'csv':
      return {
        Icon: FileText,
        labelKey: 'data.inputTables.sources.csv',
        className: 'bg-blue-500/10 text-blue-500',
        badgeClassName: 'bg-blue-500/10 text-blue-500',
      };
    case 'folder':
      return {
        Icon: Folder,
        labelKey: 'data.inputTables.sources.folder',
        className: 'bg-warning/10 text-warning',
        badgeClassName: 'bg-warning/10 text-warning',
      };
    default:
      return {
        Icon: FileText,
        labelKey: 'data.inputTables.sources.file',
        className: 'bg-violet-500/10 text-violet-500',
        badgeClassName: 'bg-violet-500/10 text-violet-500',
      };
  }
}
