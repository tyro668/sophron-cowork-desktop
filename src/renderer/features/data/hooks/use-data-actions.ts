/**
 * Command layer for the data workspace: every user action that talks to the
 * backend lives here, expressed against the domain hooks' state + actions.
 * IPC goes through `dataClient` — no `window.electronAPI` in this file.
 */
import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type {
  DataCleaningTask,
  DataDataset,
  DataInputTableConfig,
  DataInputTableSourceKind,
  DataOutputTable,
  DataRunTaskInput,
} from '../../../types';
import type { ConfirmDialogOptions } from '../../../components/ConfirmDialog';
import { DATA_DELETE_BATCH_SIZE, matchesSearchText } from '../../../components/data-view/shared';
import { dataClient } from '../api/data-client';
import type { InputTableDraft } from '../model/types';
import type { DataViewUi } from './use-data-view-ui';
import type { DataDashboardState } from './use-data-dashboard';
import type { InputTablesState } from './use-input-tables';
import type { InputTableDraftsState } from './use-input-table-drafts';
import type { DataViewEditors } from './use-data-view-editors';

export interface DataActionsDeps {
  ui: DataViewUi;
  dashboard: DataDashboardState;
  inputTables: InputTablesState;
  drafts: InputTableDraftsState;
  editors: DataViewEditors;
  t: TFunction;
  confirmDelete: (options: ConfirmDialogOptions) => Promise<boolean>;
}

export function useDataActions(deps: DataActionsDeps) {
  const { ui, dashboard, inputTables, drafts, editors, t, confirmDelete } = deps;
  const { loadDashboard } = dashboard;
  const { loadInputTables } = inputTables;

  const handleCreateTask = useCallback(async () => {
    if (!dataClient.isAvailable()) return;
    ui.setActionId('create');
    ui.setError(null);
    try {
      ui.setActiveTab('tasks');
      ui.setSearchQuery('');
      dashboard.setTaskPage(1);
      await dataClient.createTask({
        name: `${t('data.defaultTaskName')} ${dashboard.dashboard.summary.taskCount + 1}`,
      });
      await loadDashboard({ query: '', taskPage: 1 });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, query: '' });
    } finally {
      ui.setActionId(null);
    }
  }, [dashboard, loadDashboard, t, ui]);

  const handleRunTask = useCallback(
    async (task: DataCleaningTask, payload?: DataRunTaskInput) => {
      if (!dataClient.isAvailable()) return;
      ui.setActionId(task.id);
      ui.setError(null);
      try {
        const result = await dataClient.runTaskWithDiagnostics(task.id, payload);
        editors.setFocusedTask((current) =>
          current?.id === result.task.id ? result.task : current
        );
        dashboard.setRunNodeStats(result.nodeStats ?? []);
        await loadDashboard();
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [dashboard, editors, loadDashboard, ui]
  );

  const handleEditTask = useCallback(
    (task: DataCleaningTask) => {
      editors.setFocusedTask(task);
      editors.setEditingTaskId(task.id);
    },
    [editors]
  );

  const handleCloseTaskEditor = useCallback(() => {
    editors.setEditingTaskId(null);
    editors.setFocusedTask(null);
  }, [editors]);

  const handleCreateInputTableDraft = useCallback(() => {
    const draft = drafts.createDraft(
      `${t('data.inputTables.defaultName')} ${inputTables.totalInputTableDatasets + drafts.drafts.length + 1}`
    );
    ui.setInputTableSourceFilter('all');
    ui.setActiveTab('input_tables');
    ui.setSearchQuery('');
    editors.setEditingInputTableDatasetId(null);
    editors.setEditingInputTableDraftId(draft.id);
  }, [drafts, editors, inputTables.totalInputTableDatasets, t, ui]);

  const handleRenameInputTableDraft = useCallback(
    (id: string, name: string) => {
      drafts.renameDraft(id, name);
    },
    [drafts]
  );

  const handleDeleteInputTableDraft = useCallback(
    (id: string) => {
      drafts.removeDraft(id);
      editors.setEditingInputTableDraftId((current) => (current === id ? null : current));
    },
    [drafts, editors]
  );

  const handleImportInputTableSource = useCallback(
    async (
      draft: InputTableDraft,
      sourceKind: DataInputTableSourceKind,
      config: DataInputTableConfig,
      name?: string
    ) => {
      if (!dataClient.isAvailable()) return;
      ui.setActionId(draft.id);
      ui.setError(null);
      try {
        const sourcePath = await dataClient.pickInputTableSourcePath(sourceKind);
        if (!sourcePath) return;
        ui.setActiveTab('input_tables');
        const imported = await dataClient.importDataset({
          filePath: sourcePath,
          name: name?.trim() || draft.name,
          sourceKind,
          config,
        });
        drafts.removeDraft(draft.id);
        inputTables.upsertDataset(imported, true);
        editors.setEditingInputTableDraftId(null);
        editors.setEditingInputTableDatasetId(imported.id);
        inputTables.setDatasetPage(1);
        await loadInputTables({ preserveError: true, page: 1, sourceFilter: 'all' });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [drafts, editors, inputTables, loadInputTables, ui]
  );

  const handleEditInputTableDataset = useCallback(
    (id: string) => {
      ui.setActiveTab('input_tables');
      editors.setEditingInputTableDraftId(null);
      editors.setEditingInputTableDatasetId(id);
    },
    [editors, ui]
  );

  const handleRenameInputTableDataset = useCallback(
    async (dataset: DataDataset, name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName === dataset.name || !dataClient.has('updateDataset')) {
        return;
      }
      ui.setActionId(dataset.id);
      ui.setError(null);
      try {
        const updated = await dataClient.updateDataset({
          id: dataset.id,
          name: trimmedName,
        });
        inputTables.updateDatasetRow(updated);
        await loadInputTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [inputTables, loadInputTables, ui]
  );

  const handleUpdateInputTableSource = useCallback(
    async (
      dataset: DataDataset,
      sourceKind: DataInputTableSourceKind,
      config: DataInputTableConfig,
      name?: string
    ) => {
      if (!dataClient.has('updateDataset')) return;
      ui.setActionId(dataset.id);
      ui.setError(null);
      try {
        const sourcePath = await dataClient.pickInputTableSourcePath(sourceKind);
        if (!sourcePath) return;
        const updated = await dataClient.updateDataset({
          id: dataset.id,
          filePath: sourcePath,
          name: name?.trim() || dataset.name,
          sourceKind,
          config,
        });
        inputTables.updateDatasetRow(updated);
        await loadInputTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [inputTables, loadInputTables, ui]
  );

  const handleUpdateInputTableConfig = useCallback(
    async (dataset: DataDataset, config: DataInputTableConfig, name?: string) => {
      if (!dataClient.has('updateDataset')) return;
      ui.setActionId(dataset.id);
      ui.setError(null);
      try {
        const updated = await dataClient.updateDataset({
          id: dataset.id,
          name: name?.trim() || dataset.name,
          sourceKind: config.sourceKind,
          config,
        });
        inputTables.updateDatasetRow(updated);
        await loadInputTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [inputTables, loadInputTables, ui]
  );

  const handleDeleteTask = useCallback(
    async (task: DataCleaningTask) => {
      if (!dataClient.isAvailable()) return;
      const confirmed = await confirmDelete({
        message: t('data.deleteTaskConfirm', { name: task.name }),
      });
      if (!confirmed) return;
      ui.setActionId(task.id);
      ui.setError(null);
      try {
        const result = await dataClient.deleteTask(task.id);
        if (!result.success) {
          throw new Error(t('data.deleteTaskNotFound'));
        }
        if (editors.editingTaskId === task.id) {
          editors.setEditingTaskId(null);
        }
        await loadDashboard();
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, editors, loadDashboard, t, ui]
  );

  const handleDeleteAllTasks = useCallback(async () => {
    if (!dataClient.isAvailable()) return;
    const count = dashboard.dashboard.totalTasks;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.deleteAllTasksConfirm', { count }),
    });
    if (!confirmed) return;
    ui.setActionId('delete-all-tasks');
    ui.setError(null);
    try {
      let hasMoreTasks = true;
      while (hasMoreTasks) {
        const page = await dataClient.getDashboard({
          query: ui.searchQuery,
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
          await dataClient.deleteTask(task.id);
        }
      }
      editors.setEditingTaskId(null);
      dashboard.setTaskPage(1);
      await loadDashboard({ preserveError: true, tab: 'tasks', taskPage: 1 });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'tasks' });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, dashboard, editors, loadDashboard, t, ui]);

  const handleDeleteInputTable = useCallback(
    async (dataset: DataDataset) => {
      if (!dataClient.has('deleteDataset')) return;
      const confirmed = await confirmDelete({
        message: t('data.inputTables.deleteConfirm', { name: dataset.name }),
      });
      if (!confirmed) return;
      ui.setActionId(dataset.id);
      ui.setError(null);
      try {
        const result = await dataClient.deleteDataset(dataset.id);
        if (!result.success) {
          throw new Error(t('data.inputTables.deleteNotFound'));
        }
        inputTables.removeDataset(dataset.id);
        await loadInputTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadInputTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, inputTables, loadInputTables, t, ui]
  );

  const handleDeleteAllInputTables = useCallback(async () => {
    if (!dataClient.has('deleteDataset')) return;
    const draftIds =
      ui.inputTableSourceFilter === 'all'
        ? drafts.drafts
            .filter((draft) => matchesSearchText(draft.name, ui.searchQuery))
            .map((draft) => draft.id)
        : [];
    const count = inputTables.totalInputTableDatasets + draftIds.length;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.inputTables.deleteAllConfirm', { count }),
    });
    if (!confirmed) return;
    ui.setActionId('delete-all-input-tables');
    ui.setError(null);
    try {
      if (draftIds.length > 0) {
        drafts.removeDrafts(draftIds);
        editors.setEditingInputTableDraftId((current) =>
          current && draftIds.includes(current) ? null : current
        );
      }
      let hasMoreInputTables = true;
      while (hasMoreInputTables) {
        const page = await dataClient.getDashboard({
          query: ui.searchQuery,
          includeSummary: false,
          includeTasks: false,
          includeDatasets: true,
          includeOutputTables: false,
          taskLimit: 0,
          datasetOffset: 0,
          datasetLimit: DATA_DELETE_BATCH_SIZE,
          datasetSourceKind: ui.inputTableSourceFilter,
          outputLimit: 0,
        });
        hasMoreInputTables = page.datasets.length > 0;
        if (!hasMoreInputTables) break;
        for (const dataset of page.datasets) {
          await dataClient.deleteDataset(dataset.id);
        }
      }
      editors.setEditingInputTableDatasetId(null);
      inputTables.setDatasetPage(1);
      await loadInputTables({ preserveError: true, page: 1 });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadInputTables({ preserveError: true });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, drafts, editors, inputTables, loadInputTables, t, ui]);

  const handleCreateOutputTable = useCallback(async () => {
    if (!dataClient.has('createOutputTable')) return;
    ui.setActionId('create-output');
    ui.setError(null);
    try {
      ui.setActiveTab('output_tables');
      ui.setSearchQuery('');
      dashboard.setOutputPage(1);
      const outputTable = await dataClient.createOutputTable({
        name: `${t('data.outputTables.defaultName')} ${dashboard.dashboard.totalOutputTables + 1}`,
      });
      editors.setEditingOutputTableId(outputTable.id);
      await loadDashboard({ preserveError: true, tab: 'output_tables', outputPage: 1 });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'output_tables' });
    } finally {
      ui.setActionId(null);
    }
  }, [dashboard, editors, loadDashboard, t, ui]);

  const handleUpdateOutputTable = useCallback(
    async (outputTable: DataOutputTable, name: string, sourceDatasetId: string | null) => {
      const trimmedName = name.trim();
      const nextSourceDatasetId = sourceDatasetId || null;
      if (
        !trimmedName ||
        (trimmedName === outputTable.name && nextSourceDatasetId === outputTable.sourceDatasetId) ||
        !dataClient.has('updateOutputTable')
      ) {
        return;
      }
      ui.setActionId(outputTable.id);
      ui.setError(null);
      try {
        await dataClient.updateOutputTable({
          id: outputTable.id,
          name: trimmedName,
          sourceDatasetId: nextSourceDatasetId,
        });
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } finally {
        ui.setActionId(null);
      }
    },
    [loadDashboard, ui]
  );

  const handleDeleteOutputTable = useCallback(
    async (outputTable: DataOutputTable) => {
      if (!dataClient.has('deleteDataset')) return;
      const confirmed = await confirmDelete({
        message: t('data.outputTables.deleteConfirm', { name: outputTable.name }),
      });
      if (!confirmed) return;
      ui.setActionId(outputTable.id);
      ui.setError(null);
      try {
        const result = await dataClient.deleteDataset(outputTable.id);
        if (!result.success) {
          throw new Error(t('data.outputTables.deleteNotFound'));
        }
        if (editors.editingOutputTableId === outputTable.id) {
          editors.setEditingOutputTableId(null);
        }
        if (editors.uploadCloudOutputTable?.id === outputTable.id) {
          editors.setUploadCloudOutputTable(null);
        }
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'output_tables' });
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, editors, loadDashboard, t, ui]
  );

  const handleDeleteAllOutputTables = useCallback(async () => {
    if (!dataClient.has('deleteDataset')) return;
    const count = dashboard.dashboard.totalOutputTables;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.outputTables.deleteAllConfirm', { count }),
    });
    if (!confirmed) return;
    ui.setActionId('delete-all-output-tables');
    ui.setError(null);
    try {
      let hasMoreOutputTables = true;
      while (hasMoreOutputTables) {
        const page = await dataClient.getDashboard({
          query: ui.searchQuery,
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
          await dataClient.deleteDataset(outputTable.id);
        }
      }
      editors.setEditingOutputTableId(null);
      dashboard.setOutputPage(1);
      await loadDashboard({
        preserveError: true,
        tab: 'output_tables',
        outputPage: 1,
      });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'output_tables' });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, dashboard, editors, loadDashboard, t, ui]);

  return {
    handleCreateTask,
    handleRunTask,
    handleEditTask,
    handleCloseTaskEditor,
    handleCreateInputTableDraft,
    handleRenameInputTableDraft,
    handleDeleteInputTableDraft,
    handleImportInputTableSource,
    handleEditInputTableDataset,
    handleRenameInputTableDataset,
    handleUpdateInputTableSource,
    handleUpdateInputTableConfig,
    handleDeleteTask,
    handleDeleteAllTasks,
    handleDeleteInputTable,
    handleDeleteAllInputTables,
    handleCreateOutputTable,
    handleUpdateOutputTable,
    handleDeleteOutputTable,
    handleDeleteAllOutputTables,
  };
}

export type DataActions = ReturnType<typeof useDataActions>;
