import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Clock3, Database, Workflow } from 'lucide-react';
import type {
  DataCleaningTask,
  DataDashboard,
  DataDataset,
  DataInputTableConfig,
  DataInputTablePreview,
  DataInputTableSourceKind,
  DataOutputTable,
  DataRunTaskInput,
} from '../types';
import { useAppStore } from '../store';
import {
  DATA_DELETE_BATCH_SIZE,
  INPUT_TABLE_PREVIEW_PAGE_SIZE,
  OUTPUT_TABLE_INPUT_CHOICES_LIMIT,
  StatCard,
  TABLE_PAGE_SIZE,
  TabButton,
  getTablePageCount,
  matchesSearchText,
  makeLocalId,
  type DataTab,
  type InputTableDraft,
  type InputTableSourceFilter,
} from './data-view/shared';
import { TaskEditor, TasksPanel } from './data-view/data-tasks';
import { CloudAnalysisPanel } from './data-view/cloud-analysis';
import {
  InputTableEditor,
  InputTablePreviewDialog,
  InputTablesPanel,
} from './data-view/input-tables';
import {
  OutputTableEditor,
  OutputTablesPanel,
  UploadOutputTableToCloudDialog,
} from './data-view/output-tables';
import { useConfirmDialog } from './ConfirmDialog';

type StoredPreviewTarget =
  | { kind: 'input'; dataset: DataDataset }
  | { kind: 'output'; outputTable: DataOutputTable };

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
  outputTables: [],
  totalTasks: 0,
  totalDatasets: 0,
  totalOutputTables: 0,
};

export function DataView() {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const pendingDataNavigation = useAppStore((state) => state.pendingDataNavigation);
  const pendingDataTabNavigation = useAppStore((state) => state.pendingDataTabNavigation);
  const clearDataNavigation = useAppStore((state) => state.clearDataNavigation);
  const clearDataTabNavigation = useAppStore((state) => state.clearDataTabNavigation);
  const [dashboard, setDashboard] = useState<DataDashboard>(EMPTY_DASHBOARD);
  const [activeTab, setActiveTab] = useState<DataTab>('tasks');
  const [inputTableSourceFilter, setInputTableSourceFilter] =
    useState<InputTableSourceFilter>('all');
  const [inputTableDrafts, setInputTableDrafts] = useState<InputTableDraft[]>([]);
  const [inputTableDatasets, setInputTableDatasets] = useState<DataDataset[]>([]);
  const [totalInputTableDatasets, setTotalInputTableDatasets] = useState(0);
  const [inputTablesLoading, setInputTablesLoading] = useState(false);
  const [editingInputTableDraftId, setEditingInputTableDraftId] = useState<string | null>(null);
  const [editingInputTableDatasetId, setEditingInputTableDatasetId] = useState<string | null>(null);
  const [editingOutputTableId, setEditingOutputTableId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [taskPage, setTaskPage] = useState(1);
  const [datasetPage, setDatasetPage] = useState(1);
  const [outputPage, setOutputPage] = useState(1);
  const [loadingTab, setLoadingTab] = useState<DataTab | null>('tasks');
  const [pendingNavigationTab, setPendingNavigationTab] = useState<DataTab | null>('tasks');
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [outputEditorInputTables, setOutputEditorInputTables] = useState<DataDataset[]>([]);
  const [outputEditorInputTablesLoading, setOutputEditorInputTablesLoading] = useState(false);
  const [storedPreviewOpen, setStoredPreviewOpen] = useState(false);
  const [storedPreviewLoading, setStoredPreviewLoading] = useState(false);
  const [storedPreviewError, setStoredPreviewError] = useState<string | null>(null);
  const [storedPreviewData, setStoredPreviewData] = useState<DataInputTablePreview | null>(null);
  const [storedPreviewPage, setStoredPreviewPage] = useState(1);
  const [storedPreviewTarget, setStoredPreviewTarget] = useState<StoredPreviewTarget | null>(null);
  const [uploadCloudOutputTable, setUploadCloudOutputTable] = useState<DataOutputTable | null>(
    null
  );
  const [focusedTask, setFocusedTask] = useState<DataCleaningTask | null>(null);
  const [focusedInputTable, setFocusedInputTable] = useState<DataDataset | null>(null);
  const [focusedOutputTable, setFocusedOutputTable] = useState<DataOutputTable | null>(null);
  const dashboardRequestSeq = useRef(0);
  const inputTablesRequestSeq = useRef(0);
  const hasLoadedDashboardSummary = useRef(false);

  const isDataApiAvailable = Boolean(window.electronAPI?.data);

  useEffect(() => {
    if (!pendingDataTabNavigation) return;
    setStoredPreviewOpen(false);
    setEditingTaskId(null);
    setEditingInputTableDraftId(null);
    setEditingInputTableDatasetId(null);
    setEditingOutputTableId(null);
    setUploadCloudOutputTable(null);
    setPendingNavigationTab(pendingDataTabNavigation.tab);
    setLoadingTab(pendingDataTabNavigation.tab);
    setActiveTab(pendingDataTabNavigation.tab);
    setSearchQuery('');
    clearDataTabNavigation(pendingDataTabNavigation.nonce);
  }, [clearDataTabNavigation, pendingDataTabNavigation]);

  useEffect(() => {
    if (!pendingDataNavigation || !isDataApiAvailable || !window.electronAPI?.data) {
      return undefined;
    }

    const target = pendingDataNavigation;
    let cancelled = false;

    const run = async () => {
      setError(null);
      setStoredPreviewOpen(false);
      setEditingTaskId(null);
      setEditingInputTableDraftId(null);
      setEditingInputTableDatasetId(null);
      setEditingOutputTableId(null);
      setUploadCloudOutputTable(null);

      if (target.kind === 'task') {
        setActiveTab('tasks');
        setPendingNavigationTab('tasks');
        setLoadingTab('tasks');
        const task = await window.electronAPI?.data?.getTask(target.id);
        if (cancelled) return;
        if (!task) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedTask(task);
        setDashboard((current) => ({
          ...current,
          tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)],
          totalTasks: Math.max(current.totalTasks, current.tasks.length + 1),
        }));
        setSearchQuery('');
        setTaskPage(1);
        setEditingTaskId(task.id);
        return;
      }

      if (target.kind === 'input_table') {
        setActiveTab('input_tables');
        setPendingNavigationTab('input_tables');
        setLoadingTab('input_tables');
        setInputTablesLoading(true);
        const inputTable = await window.electronAPI?.data?.getInputTable(target.id);
        if (cancelled) return;
        if (!inputTable) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedInputTable(inputTable);
        setInputTableSourceFilter('all');
        setInputTableDatasets((current) => [
          inputTable,
          ...current.filter((item) => item.id !== inputTable.id),
        ]);
        setTotalInputTableDatasets((current) => Math.max(current, 1));
        setDatasetPage(1);
        setEditingInputTableDatasetId(inputTable.id);
        return;
      }

      setActiveTab('output_tables');
      setPendingNavigationTab('output_tables');
      setLoadingTab('output_tables');
      const outputTable = await window.electronAPI?.data?.getOutputTable(target.id);
      if (cancelled) return;
      if (!outputTable) {
        setError(t('data.navigationNotFound'));
        return;
      }
      setFocusedOutputTable(outputTable);
      setDashboard((current) => ({
        ...current,
        outputTables: [
          outputTable,
          ...current.outputTables.filter((item) => item.id !== outputTable.id),
        ],
        totalOutputTables: Math.max(current.totalOutputTables, current.outputTables.length + 1),
      }));
      setOutputPage(1);
      setEditingOutputTableId(outputTable.id);
    };

    void run()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPendingNavigationTab(null);
          setLoadingTab(null);
          setInputTablesLoading(false);
          clearDataNavigation(target.nonce);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearDataNavigation, isDataApiAvailable, pendingDataNavigation, t]);

  const loadDashboard = useCallback(
    async (
      options: {
        preserveError?: boolean;
        query?: string;
        taskPage?: number;
        datasetPage?: number;
        outputPage?: number;
        tab?: DataTab;
      } = {}
    ) => {
      if (!window.electronAPI?.data) return;
      const requestSeq = dashboardRequestSeq.current + 1;
      dashboardRequestSeq.current = requestSeq;
      const targetTab = options.tab ?? activeTab;
      const requestedTaskPage = Math.max(1, options.taskPage ?? taskPage);
      const requestedOutputPage = Math.max(1, options.outputPage ?? outputPage);
      const shouldLoadTasks = targetTab === 'tasks';
      const shouldLoadOutputTables = targetTab === 'output_tables';
      const shouldLoadSummary = shouldLoadTasks || !hasLoadedDashboardSummary.current;
      setLoadingTab(targetTab);
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const nextDashboard = await window.electronAPI.data.getDashboard({
          query: options.query ?? (shouldLoadTasks || shouldLoadOutputTables ? searchQuery : ''),
          includeSummary: shouldLoadSummary,
          includeTasks: shouldLoadTasks,
          includeDatasets: false,
          includeOutputTables: shouldLoadOutputTables,
          taskOffset: (requestedTaskPage - 1) * TABLE_PAGE_SIZE,
          taskLimit: shouldLoadTasks ? TABLE_PAGE_SIZE : 0,
          datasetOffset: 0,
          datasetLimit: 0,
          outputOffset: (requestedOutputPage - 1) * TABLE_PAGE_SIZE,
          outputLimit: shouldLoadOutputTables ? TABLE_PAGE_SIZE : 0,
          datasetSourceKind: 'all',
        });
        if (requestSeq === dashboardRequestSeq.current) {
          if (shouldLoadSummary) {
            hasLoadedDashboardSummary.current = true;
          }
          setDashboard((current) => ({
            summary: shouldLoadSummary ? nextDashboard.summary : current.summary,
            tasks: shouldLoadTasks ? nextDashboard.tasks : current.tasks,
            outputTables: shouldLoadOutputTables
              ? nextDashboard.outputTables
              : current.outputTables,
            datasets: current.datasets,
            totalTasks:
              shouldLoadTasks || shouldLoadSummary ? nextDashboard.totalTasks : current.totalTasks,
            totalDatasets: current.totalDatasets,
            totalOutputTables: shouldLoadOutputTables
              ? nextDashboard.totalOutputTables
              : current.totalOutputTables,
          }));
        }
      } catch (err) {
        if (requestSeq === dashboardRequestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === dashboardRequestSeq.current) {
          setPendingNavigationTab((current) => (current === targetTab ? null : current));
          setLoadingTab((current) => (current === targetTab ? null : current));
        }
      }
    },
    [activeTab, outputPage, searchQuery, taskPage]
  );

  const loadInputTables = useCallback(
    async (
      options: {
        preserveError?: boolean;
        page?: number;
        sourceFilter?: InputTableSourceFilter;
        query?: string;
      } = {}
    ) => {
      if (!window.electronAPI?.data) return;
      const requestSeq = inputTablesRequestSeq.current + 1;
      inputTablesRequestSeq.current = requestSeq;
      const requestedPage = Math.max(1, options.page ?? datasetPage);
      const sourceFilter = options.sourceFilter ?? inputTableSourceFilter;
      setInputTablesLoading(true);
      setLoadingTab('input_tables');
      if (!options.preserveError) {
        setError(null);
      }
      try {
        const nextDashboard = await window.electronAPI.data.getDashboard({
          query: options.query ?? searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: true,
          includeOutputTables: false,
          taskLimit: 0,
          datasetOffset: (requestedPage - 1) * TABLE_PAGE_SIZE,
          datasetLimit: TABLE_PAGE_SIZE,
          datasetSourceKind: sourceFilter,
          outputLimit: 0,
        });
        if (requestSeq === inputTablesRequestSeq.current) {
          setInputTableDatasets(nextDashboard.datasets);
          setTotalInputTableDatasets(nextDashboard.totalDatasets);
        }
      } catch (err) {
        if (requestSeq === inputTablesRequestSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestSeq === inputTablesRequestSeq.current) {
          setPendingNavigationTab((current) => (current === 'input_tables' ? null : current));
          setLoadingTab((current) => (current === 'input_tables' ? null : current));
          setInputTablesLoading(false);
        }
      }
    },
    [datasetPage, inputTableSourceFilter, searchQuery]
  );

  useEffect(() => {
    if (!isDataApiAvailable) {
      setPendingNavigationTab(null);
      setLoadingTab(null);
      return;
    }
    dashboardRequestSeq.current += 1;
    const delay = activeTab === 'tasks' && searchQuery ? 180 : 0;
    let timer: number | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          if (activeTab === 'input_tables') {
            void loadInputTables();
          } else {
            void loadDashboard({ tab: activeTab });
          }
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
  }, [activeTab, isDataApiAvailable, loadDashboard, loadInputTables, searchQuery]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalTasks);
    if (taskPage > pageCount) {
      setTaskPage(pageCount);
    }
  }, [dashboard.totalTasks, taskPage]);

  useEffect(() => {
    const draftCount = inputTableSourceFilter === 'all' ? inputTableDrafts.length : 0;
    const pageCount = getTablePageCount(totalInputTableDatasets + draftCount);
    if (datasetPage > pageCount) {
      setDatasetPage(pageCount);
    }
  }, [datasetPage, inputTableDrafts.length, inputTableSourceFilter, totalInputTableDatasets]);

  useEffect(() => {
    const pageCount = getTablePageCount(dashboard.totalOutputTables);
    if (outputPage > pageCount) {
      setOutputPage(pageCount);
    }
  }, [dashboard.totalOutputTables, outputPage]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setLoadingTab(activeTab);
      if (activeTab === 'input_tables') {
        setInputTablesLoading(true);
        setDatasetPage(1);
      } else if (activeTab === 'output_tables') {
        setOutputPage(1);
      } else {
        setTaskPage(1);
      }
      setSearchQuery(value);
    },
    [activeTab]
  );

  const handleInputTableSourceFilterChange = useCallback((value: InputTableSourceFilter) => {
    setLoadingTab('input_tables');
    setInputTablesLoading(true);
    setInputTableSourceFilter(value);
    setDatasetPage(1);
  }, []);

  const handleTabChange = useCallback(
    (tab: DataTab) => {
      if (tab === activeTab) return;
      dashboardRequestSeq.current += 1;
      setPendingNavigationTab(tab);
      setLoadingTab(tab);
      setActiveTab(tab);
      setSearchQuery('');
    },
    [activeTab]
  );

  const handleTaskPageChange = useCallback((page: number) => {
    setLoadingTab('tasks');
    setTaskPage(page);
  }, []);

  const handleDatasetPageChange = useCallback((page: number) => {
    setLoadingTab('input_tables');
    setInputTablesLoading(true);
    setDatasetPage(page);
  }, []);

  const handleOutputPageChange = useCallback((page: number) => {
    setLoadingTab('output_tables');
    setOutputPage(page);
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
        iconClassName: 'bg-accent/10 text-accent',
      },
      {
        key: 'runningCount',
        label: t('data.summary.running'),
        description: t('data.summary.runningDesc'),
        value: dashboard.summary.runningCount,
        Icon: CheckCircle2,
        iconClassName: 'bg-surface-active/70 text-text-secondary',
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
    () =>
      dashboard.tasks.find((task) => task.id === editingTaskId) ??
      (focusedTask?.id === editingTaskId ? focusedTask : null),
    [dashboard.tasks, editingTaskId, focusedTask]
  );
  const editingInputTableDraft = useMemo(
    () => inputTableDrafts.find((draft) => draft.id === editingInputTableDraftId) ?? null,
    [editingInputTableDraftId, inputTableDrafts]
  );
  const editingInputTableDataset = useMemo(
    () =>
      inputTableDatasets.find((dataset) => dataset.id === editingInputTableDatasetId) ??
      (focusedInputTable?.id === editingInputTableDatasetId ? focusedInputTable : null),
    [editingInputTableDatasetId, focusedInputTable, inputTableDatasets]
  );
  const editingOutputTable = useMemo(
    () =>
      dashboard.outputTables.find((outputTable) => outputTable.id === editingOutputTableId) ??
      (focusedOutputTable?.id === editingOutputTableId ? focusedOutputTable : null),
    [dashboard.outputTables, editingOutputTableId, focusedOutputTable]
  );

  useEffect(() => {
    if (!editingOutputTableId || !window.electronAPI?.data?.getDashboard) {
      setOutputEditorInputTables([]);
      setOutputEditorInputTablesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOutputEditorInputTablesLoading(true);
    void window.electronAPI.data
      .getDashboard({
        includeSummary: false,
        includeTasks: false,
        includeDatasets: true,
        includeOutputTables: false,
        datasetOffset: 0,
        datasetLimit: OUTPUT_TABLE_INPUT_CHOICES_LIMIT,
        datasetSourceKind: 'all',
      })
      .then((nextDashboard) => {
        if (!cancelled) {
          setOutputEditorInputTables(nextDashboard.datasets);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setOutputEditorInputTables([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOutputEditorInputTablesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editingOutputTableId]);

  const isInputTableEditor = Boolean(editingInputTableDraft || editingInputTableDataset);
  const isTasksLoading =
    loadingTab === 'tasks' || (activeTab === 'tasks' && pendingNavigationTab === 'tasks');
  const isInputTablesLoading =
    inputTablesLoading ||
    loadingTab === 'input_tables' ||
    (activeTab === 'input_tables' && pendingNavigationTab === 'input_tables');
  const isOutputTablesLoading =
    loadingTab === 'output_tables' ||
    (activeTab === 'output_tables' && pendingNavigationTab === 'output_tables');
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
    async (task: DataCleaningTask, payload?: DataRunTaskInput) => {
      if (!window.electronAPI?.data) return;
      setActionId(task.id);
      setError(null);
      try {
        const updatedTask = await window.electronAPI.data.runTask(task.id, payload);
        setFocusedTask((current) => (current?.id === updatedTask.id ? updatedTask : current));
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard]
  );

  const handleEditTask = useCallback((task: DataCleaningTask) => {
    setFocusedTask(task);
    setEditingTaskId(task.id);
  }, []);

  const handleCloseTaskEditor = useCallback(() => {
    setEditingTaskId(null);
    setFocusedTask(null);
  }, []);

  const handleCreateInputTableDraft = useCallback(() => {
    const now = Date.now();
    const draft: InputTableDraft = {
      id: makeLocalId('input_table'),
      name: `${t('data.inputTables.defaultName')} ${totalInputTableDatasets + inputTableDrafts.length + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    setInputTableDrafts((current) => [draft, ...current]);
    setInputTableSourceFilter('all');
    setActiveTab('input_tables');
    setSearchQuery('');
    setEditingInputTableDatasetId(null);
    setEditingInputTableDraftId(draft.id);
  }, [inputTableDrafts.length, t, totalInputTableDatasets]);

  const handleRenameInputTableDraft = useCallback((id: string, name: string) => {
    setInputTableDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, name, updatedAt: Date.now() } : draft))
    );
  }, []);

  const handleDeleteInputTableDraft = useCallback((id: string) => {
    setInputTableDrafts((current) => current.filter((draft) => draft.id !== id));
    setEditingInputTableDraftId((current) => (current === id ? null : current));
  }, []);

  const handleImportInputTableSource = useCallback(
    async (
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
        setInputTableDatasets((current) => [
          imported,
          ...current.filter((dataset) => dataset.id !== imported.id),
        ]);
        setTotalInputTableDatasets((current) => current + 1);
        setEditingInputTableDraftId(null);
        setEditingInputTableDatasetId(imported.id);
        setDatasetPage(1);
        await loadInputTables({ preserveError: true, page: 1, sourceFilter: 'all' });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables, selectOneFile]
  );

  const handleEditInputTableDataset = useCallback((id: string) => {
    setActiveTab('input_tables');
    setEditingInputTableDraftId(null);
    setEditingInputTableDatasetId(id);
  }, []);

  const handleRenameInputTableDataset = useCallback(
    async (dataset: DataDataset, name: string) => {
      const trimmedName = name.trim();
      if (
        !trimmedName ||
        trimmedName === dataset.name ||
        !window.electronAPI?.data?.updateDataset
      ) {
        return;
      }
      setActionId(dataset.id);
      setError(null);
      try {
        const updated = await window.electronAPI.data.updateDataset({
          id: dataset.id,
          name: trimmedName,
        });
        setInputTableDatasets((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables]
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
        const updated = await window.electronAPI.data.updateDataset({
          id: dataset.id,
          filePath: sourcePath,
          name: name?.trim() || dataset.name,
          sourceKind,
          config,
        });
        setInputTableDatasets((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables, selectOneFile]
  );

  const handleUpdateInputTableConfig = useCallback(
    async (dataset: DataDataset, config: DataInputTableConfig, name?: string) => {
      if (!window.electronAPI?.data?.updateDataset) return;
      setActionId(dataset.id);
      setError(null);
      try {
        const updated = await window.electronAPI.data.updateDataset({
          id: dataset.id,
          name: name?.trim() || dataset.name,
          sourceKind: config.sourceKind,
          config,
        });
        setInputTableDatasets((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [loadInputTables]
  );

  const handleDeleteTask = useCallback(
    async (task: DataCleaningTask) => {
      if (!window.electronAPI?.data) return;
      const confirmed = await confirmDelete({
        message: t('data.deleteTaskConfirm', { name: task.name }),
      });
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
    [confirmDelete, editingTaskId, loadDashboard, t]
  );

  const handleDeleteAllTasks = useCallback(async () => {
    if (!window.electronAPI?.data) return;
    const count = dashboard.totalTasks;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.deleteAllTasksConfirm', { count }),
    });
    if (!confirmed) return;
    setActionId('delete-all-tasks');
    setError(null);
    try {
      let hasMoreTasks = true;
      while (hasMoreTasks) {
        const page = await window.electronAPI.data.getDashboard({
          query: searchQuery,
          includeSummary: false,
          includeTasks: true,
          includeDatasets: false,
          includeOutputTables: false,
          taskOffset: 0,
          taskLimit: DATA_DELETE_BATCH_SIZE,
          datasetLimit: 0,
          outputLimit: 0,
        });
        hasMoreTasks = page.tasks.length > 0;
        if (!hasMoreTasks) break;
        for (const task of page.tasks) {
          await window.electronAPI.data.deleteTask(task.id);
        }
      }
      setEditingTaskId(null);
      setTaskPage(1);
      await loadDashboard({ preserveError: true, tab: 'tasks', taskPage: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'tasks' });
    } finally {
      setActionId(null);
    }
  }, [confirmDelete, dashboard.totalTasks, loadDashboard, searchQuery, t]);

  const handleDeleteInputTable = useCallback(
    async (dataset: DataDataset) => {
      if (!window.electronAPI?.data?.deleteDataset) return;
      const confirmed = await confirmDelete({
        message: t('data.inputTables.deleteConfirm', { name: dataset.name }),
      });
      if (!confirmed) return;
      setActionId(dataset.id);
      setError(null);
      try {
        const result = await window.electronAPI.data.deleteDataset(dataset.id);
        if (!result.success) {
          throw new Error(t('data.inputTables.deleteNotFound'));
        }
        setInputTableDatasets((current) => current.filter((item) => item.id !== dataset.id));
        setTotalInputTableDatasets((current) => Math.max(0, current - 1));
        await loadInputTables({ preserveError: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        setActionId(null);
      }
    },
    [confirmDelete, loadInputTables, t]
  );

  const handleDeleteAllInputTables = useCallback(async () => {
    if (!window.electronAPI?.data?.deleteDataset) return;
    const draftIds =
      inputTableSourceFilter === 'all'
        ? inputTableDrafts
            .filter((draft) => matchesSearchText(draft.name, searchQuery))
            .map((draft) => draft.id)
        : [];
    const count = totalInputTableDatasets + draftIds.length;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.inputTables.deleteAllConfirm', { count }),
    });
    if (!confirmed) return;
    setActionId('delete-all-input-tables');
    setError(null);
    try {
      if (draftIds.length > 0) {
        setInputTableDrafts((current) => current.filter((draft) => !draftIds.includes(draft.id)));
        setEditingInputTableDraftId((current) =>
          current && draftIds.includes(current) ? null : current
        );
      }
      let hasMoreInputTables = true;
      while (hasMoreInputTables) {
        const page = await window.electronAPI.data.getDashboard({
          query: searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: true,
          includeOutputTables: false,
          taskLimit: 0,
          datasetOffset: 0,
          datasetLimit: DATA_DELETE_BATCH_SIZE,
          datasetSourceKind: inputTableSourceFilter,
          outputLimit: 0,
        });
        hasMoreInputTables = page.datasets.length > 0;
        if (!hasMoreInputTables) break;
        for (const dataset of page.datasets) {
          await window.electronAPI.data.deleteDataset(dataset.id);
        }
      }
      setEditingInputTableDatasetId(null);
      setDatasetPage(1);
      await loadInputTables({ preserveError: true, page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadInputTables({ preserveError: true });
    } finally {
      setActionId(null);
    }
  }, [
    inputTableDrafts,
    inputTableSourceFilter,
    confirmDelete,
    loadInputTables,
    searchQuery,
    t,
    totalInputTableDatasets,
  ]);

  const handlePreviewStoredInputTable = useCallback(async (dataset: DataDataset, page = 1) => {
    if (!window.electronAPI?.data?.previewDataset) return;
    setStoredPreviewOpen(true);
    setStoredPreviewTarget({ kind: 'input', dataset });
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

  const handlePreviewStoredOutputTable = useCallback(
    async (outputTable: DataOutputTable, page = 1) => {
      if (!window.electronAPI?.data?.previewDataset) return;
      setStoredPreviewOpen(true);
      setStoredPreviewTarget({ kind: 'output', outputTable });
      setStoredPreviewLoading(true);
      setStoredPreviewError(null);
      setStoredPreviewPage(page);
      try {
        const preview = await window.electronAPI.data.previewDataset({
          id: outputTable.id,
          limit: INPUT_TABLE_PREVIEW_PAGE_SIZE,
          offset: (page - 1) * INPUT_TABLE_PREVIEW_PAGE_SIZE,
        });
        setStoredPreviewData(preview);
      } catch (err) {
        setStoredPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setStoredPreviewLoading(false);
      }
    },
    []
  );

  const handleCreateOutputTable = useCallback(async () => {
    if (!window.electronAPI?.data?.createOutputTable) return;
    setActionId('create-output');
    setError(null);
    try {
      setActiveTab('output_tables');
      setSearchQuery('');
      setOutputPage(1);
      const outputTable = await window.electronAPI.data.createOutputTable({
        name: `${t('data.outputTables.defaultName')} ${dashboard.totalOutputTables + 1}`,
      });
      setEditingOutputTableId(outputTable.id);
      await loadDashboard({ preserveError: true, tab: 'output_tables', outputPage: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'output_tables' });
    } finally {
      setActionId(null);
    }
  }, [dashboard.totalOutputTables, loadDashboard, t]);

  const handleUpdateOutputTable = useCallback(
    async (outputTable: DataOutputTable, name: string, sourceDatasetId: string | null) => {
      const trimmedName = name.trim();
      const nextSourceDatasetId = sourceDatasetId || null;
      if (
        !trimmedName ||
        (trimmedName === outputTable.name && nextSourceDatasetId === outputTable.sourceDatasetId) ||
        !window.electronAPI?.data?.updateOutputTable
      ) {
        return;
      }
      setActionId(outputTable.id);
      setError(null);
      try {
        await window.electronAPI.data.updateOutputTable({
          id: outputTable.id,
          name: trimmedName,
          sourceDatasetId: nextSourceDatasetId,
        });
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } finally {
        setActionId(null);
      }
    },
    [loadDashboard]
  );

  const handleDeleteOutputTable = useCallback(
    async (outputTable: DataOutputTable) => {
      if (!window.electronAPI?.data?.deleteDataset) return;
      const confirmed = await confirmDelete({
        message: t('data.outputTables.deleteConfirm', { name: outputTable.name }),
      });
      if (!confirmed) return;
      setActionId(outputTable.id);
      setError(null);
      try {
        const result = await window.electronAPI.data.deleteDataset(outputTable.id);
        if (!result.success) {
          throw new Error(t('data.outputTables.deleteNotFound'));
        }
        if (editingOutputTableId === outputTable.id) {
          setEditingOutputTableId(null);
        }
        if (uploadCloudOutputTable?.id === outputTable.id) {
          setUploadCloudOutputTable(null);
        }
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } finally {
        setActionId(null);
      }
    },
    [confirmDelete, editingOutputTableId, loadDashboard, t, uploadCloudOutputTable?.id]
  );

  const handleDeleteAllOutputTables = useCallback(async () => {
    if (!window.electronAPI?.data?.deleteDataset) return;
    const count = dashboard.totalOutputTables;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.outputTables.deleteAllConfirm', { count }),
    });
    if (!confirmed) return;
    setActionId('delete-all-output-tables');
    setError(null);
    try {
      let hasMoreOutputTables = true;
      while (hasMoreOutputTables) {
        const page = await window.electronAPI.data.getDashboard({
          query: searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: false,
          includeOutputTables: true,
          taskLimit: 0,
          datasetLimit: 0,
          outputOffset: 0,
          outputLimit: DATA_DELETE_BATCH_SIZE,
        });
        hasMoreOutputTables = page.outputTables.length > 0;
        if (!hasMoreOutputTables) break;
        for (const outputTable of page.outputTables) {
          await window.electronAPI.data.deleteDataset(outputTable.id);
        }
      }
      setEditingOutputTableId(null);
      setOutputPage(1);
      await loadDashboard({
        preserveError: true,
        tab: 'output_tables',
        outputPage: 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'output_tables' });
    } finally {
      setActionId(null);
    }
  }, [confirmDelete, dashboard.totalOutputTables, loadDashboard, searchQuery, t]);

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-transparent">
      <div
        className={`mx-auto w-full px-3 py-3 sm:px-4 ${
          isInputTableEditor ? 'max-w-[1500px]' : 'max-w-[1120px]'
        } flex h-full min-h-0 flex-col`}
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
            outputTables={dashboard.outputTables}
            actionId={actionId}
            onBack={handleCloseTaskEditor}
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
        ) : editingOutputTable ? (
          <OutputTableEditor
            outputTable={editingOutputTable}
            inputTables={outputEditorInputTables}
            isInputTablesLoading={outputEditorInputTablesLoading}
            isBusy={actionId === editingOutputTable.id}
            onBack={() => setEditingOutputTableId(null)}
            onSave={handleUpdateOutputTable}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="grid flex-shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
              {summaryCards.map(({ key, label, description, value, Icon, iconClassName }) => (
                <StatCard
                  key={key}
                  compact={summaryCards.every((card) => card.value === 0)}
                  label={label}
                  description={description}
                  value={value}
                  Icon={Icon}
                  iconClassName={iconClassName}
                />
              ))}
            </section>

            <section className="mt-3 flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex min-h-10 flex-shrink-0 flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
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
                  <TabButton
                    active={activeTab === 'cloud_analysis'}
                    onClick={() => handleTabChange('cloud_analysis')}
                    label={t('data.tabs.cloudAnalysis')}
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
                  onRefresh={() => loadDashboard({ preserveError: true, tab: 'tasks' })}
                  onPageChange={handleTaskPageChange}
                  onRun={handleRunTask}
                  onEdit={handleEditTask}
                  onDelete={handleDeleteTask}
                  onDeleteAll={handleDeleteAllTasks}
                />
              ) : (
                <div className="min-h-0 flex-1 bg-transparent">
                  {activeTab === 'input_tables' ? (
                    <InputTablesPanel
                      datasets={inputTableDatasets}
                      drafts={inputTableDrafts}
                      totalDatasets={totalInputTableDatasets}
                      currentPage={datasetPage}
                      searchQuery={searchQuery}
                      isLoading={isInputTablesLoading}
                      sourceFilter={inputTableSourceFilter}
                      onSearchChange={handleSearchChange}
                      onSourceFilterChange={handleInputTableSourceFilterChange}
                      onPageChange={handleDatasetPageChange}
                      onCreate={handleCreateInputTableDraft}
                      onRefresh={() => loadInputTables({ preserveError: true })}
                      onPreviewDataset={handlePreviewStoredInputTable}
                      onDelete={handleDeleteInputTable}
                      onDeleteAll={handleDeleteAllInputTables}
                      onDeleteDraft={handleDeleteInputTableDraft}
                      onEditDraft={setEditingInputTableDraftId}
                      onEditDataset={handleEditInputTableDataset}
                      isCreateDisabled={!isDataApiAvailable}
                      actionId={actionId}
                    />
                  ) : activeTab === 'output_tables' ? (
                    <OutputTablesPanel
                      outputTables={dashboard.outputTables}
                      totalOutputTables={dashboard.totalOutputTables}
                      currentPage={outputPage}
                      searchQuery={searchQuery}
                      isLoading={isOutputTablesLoading}
                      actionId={actionId}
                      isCreateDisabled={!isDataApiAvailable || actionId === 'create-output'}
                      onCreate={handleCreateOutputTable}
                      onSearchChange={handleSearchChange}
                      onRefresh={() => loadDashboard({ preserveError: true, tab: 'output_tables' })}
                      onPageChange={handleOutputPageChange}
                      onPreview={handlePreviewStoredOutputTable}
                      onUpload={(outputTable) => setUploadCloudOutputTable(outputTable)}
                      onEdit={(outputTable) => setEditingOutputTableId(outputTable.id)}
                      onDelete={handleDeleteOutputTable}
                      onDeleteAll={handleDeleteAllOutputTables}
                    />
                  ) : (
                    <CloudAnalysisPanel />
                  )}
                </div>
              )}
            </section>
            {storedPreviewOpen && (
              <InputTablePreviewDialog
                tableKind={storedPreviewTarget?.kind ?? 'input'}
                preview={storedPreviewData}
                isLoading={storedPreviewLoading}
                error={storedPreviewError}
                currentPage={storedPreviewPage}
                onPageChange={(page) => {
                  if (storedPreviewTarget?.kind === 'input') {
                    void handlePreviewStoredInputTable(storedPreviewTarget.dataset, page);
                  } else if (storedPreviewTarget?.kind === 'output') {
                    void handlePreviewStoredOutputTable(storedPreviewTarget.outputTable, page);
                  }
                }}
                onClose={() => setStoredPreviewOpen(false)}
              />
            )}
            {uploadCloudOutputTable && (
              <UploadOutputTableToCloudDialog
                outputTable={uploadCloudOutputTable}
                onClose={() => setUploadCloudOutputTable(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
