/**
 * Command layer for the data workspace: every user action that talks to the
 * backend lives here, expressed against the domain hooks' state + actions.
 * IPC goes through `dataClient` — no `window.electronAPI` in this file.
 */
import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type {
  DataPipeline,
  DataRawTable,
  DataGroupScope,
  DataGeneratePipelineFromRequirementResult,
  DataRawTableConfig,
  DataRawTableSourceKind,
  DataResultTable,
  DataRunPipelineInput,
} from '../../../types';
import type { ConfirmDialogOptions } from '../../../components/ConfirmDialog';
import type { AssignGroupTarget, DataListGroup } from '../../../components/data-view/group-ui';
import { DATA_DELETE_BATCH_SIZE, matchesSearchText } from '../../../components/data-view/shared';
import { getOperatorCatalog } from '../../../components/data-view/data-pipelines/workflow/operator-catalog';
import { buildWorkflowStarterGraph } from '../../../components/data-view/data-pipelines/workflow/workflow-starter';
import { dataClient } from '../api/data-client';
import { showToast } from '../../../utils/toast';
import { uniquePipelineName } from '../model/pipeline-names';
import type { RawTableDraft } from '../model/types';
import type { DataViewUi } from './use-data-view-ui';
import type { DataDashboardState } from './use-data-dashboard';
import type { RawTablesState } from './use-raw-tables';
import type { RawTableDraftsState } from './use-raw-table-drafts';
import type { DataViewEditors } from './use-data-view-editors';

export interface DataActionsDeps {
  ui: DataViewUi;
  dashboard: DataDashboardState;
  rawTables: RawTablesState;
  drafts: RawTableDraftsState;
  editors: DataViewEditors;
  t: TFunction;
  confirmDelete: (options: ConfirmDialogOptions) => Promise<boolean>;
}

/** Every stored pipeline name — the unique-name check must scan all pages, not
 *  just the currently loaded page. */
async function collectPipelineNames(): Promise<Set<string>> {
  const names = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await dataClient.getDashboard({
      includeSummary: false,
      includePipelines: true,
      includeRawTables: false,
      includeResultTables: false,
      pipelineOffset: offset,
      pipelineLimit: DATA_DELETE_BATCH_SIZE,
      rawTableLimit: 0,
      outputLimit: 0,
    });
    for (const pipeline of page.pipelines) names.add(pipeline.name);
    if (page.pipelines.length < DATA_DELETE_BATCH_SIZE) break;
    offset += page.pipelines.length;
  }
  return names;
}

export function useDataActions(deps: DataActionsDeps) {
  const { ui, dashboard, rawTables, drafts, editors, t, confirmDelete } = deps;
  const { loadDashboard } = dashboard;
  const { loadRawTables } = rawTables;

  /**
   * Creates a pipeline with a guaranteed-unique name and opens the editor in
   * rename mode. With `sourceRawTable`, the pipeline is persisted with a bound
   * `input_source` node — the "create pipeline from this table" flow lands on a
   * canvas that is already wired to the selected input table.
   */
  const createPipelineAndEdit = useCallback(
    async (sourceRawTable?: DataRawTable) => {
      if (!dataClient.isAvailable()) return;
      ui.setActionId('create');
      ui.setError(null);
      try {
        ui.setActiveTab('pipelines');
        ui.setSearchQuery('');
        dashboard.setPipelinePage(1);
        const existingNames = await collectPipelineNames();
        const name = sourceRawTable
          ? uniquePipelineName(
              t('data.pipelineNameFromTable', { name: sourceRawTable.name }),
              existingNames
            )
          : uniquePipelineName(t('data.defaultPipelineName'), existingNames, {
              alwaysNumber: true,
            });
        const pipeline = await dataClient.createPipeline({
          name,
          sourceRawTableId: sourceRawTable?.id ?? null,
        });
        let focused = pipeline;
        if (sourceRawTable) {
          try {
            // Seed the same input → filter → output starter graph the empty
            // canvas offers — bound to the table this pipeline was created from.
            const starter = buildWorkflowStarterGraph({
              pipelineId: pipeline.id,
              sourceRawTableId: sourceRawTable.id,
              sourceName: sourceRawTable.name,
              labels: {
                input_source: t(getOperatorCatalog('input_source').labelKey),
                filter: t(getOperatorCatalog('filter').labelKey),
                output: t(getOperatorCatalog('output').labelKey),
              },
            });
            const seeded = await dataClient.savePipelineWorkflow(pipeline.id, {
              nodes: starter.nodes,
              edges: starter.edges,
            });
            focused = seeded.pipeline;
          } catch (err) {
            // Pipeline exists and the editor still opens — binding can be redone
            // in the input node's config if the seed save failed.
            ui.setError(err instanceof Error ? err.message : String(err));
          }
        }
        editors.setFocusedPipeline(focused);
        editors.setEditingPipelineId(focused.id);
        editors.setPipelineNameEditRequested(true);
        await loadDashboard({ query: '', pipelinePage: 1 });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, query: '' });
      } finally {
        ui.setActionId(null);
      }
    },
    [dashboard, editors, loadDashboard, t, ui]
  );

  const handleCreatePipeline = useCallback(() => createPipelineAndEdit(), [createPipelineAndEdit]);

  const handleCreatePipelineFromTable = useCallback(
    (rawTable: DataRawTable) => createPipelineAndEdit(rawTable),
    [createPipelineAndEdit]
  );

  const handleRunPipeline = useCallback(
    async (pipeline: DataPipeline, payload?: DataRunPipelineInput) => {
      if (!dataClient.isAvailable()) return;
      ui.setActionId(pipeline.id);
      ui.setError(null);
      try {
        const result = await dataClient.runPipelineWithDiagnostics(pipeline.id, payload);
        if (result.failure) {
          // Temporary runs return failures as a structured result (stats and
          // violating samples travel with the run — nothing was persisted).
          dashboard.setLastRunFailure({
            message: result.failure.message,
            at: Date.now(),
            temporary: payload?.outputMode === 'temporary',
          });
          dashboard.setRunNodeStats(result.nodeStats ?? []);
          const isExpectFailure = /Expect failed at node [^:]+:/.test(result.failure.message);
          if (editors.editingPipelineId !== pipeline.id || !isExpectFailure) {
            ui.setError(result.failure.message);
          }
          await loadDashboard({ preserveError: true });
          return;
        }
        editors.setFocusedPipeline((current) =>
          current?.id === result.pipeline.id ? result.pipeline : current
        );
        dashboard.setRunNodeStats(result.nodeStats ?? []);
        dashboard.setLastRunFailure(null);
        await loadDashboard();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dashboard.setLastRunFailure({
          message,
          at: Date.now(),
          temporary: payload?.outputMode === 'temporary',
        });
        // Pull the failed run's persisted stats so the canvas and the editor's
        // structured failure card can show where the stream broke (expect
        // failures persist rejectedRows + violating samples). Temporary runs
        // never persist stats — fetching would return the previous run's.
        if (payload?.outputMode !== 'temporary') {
          try {
            dashboard.setRunNodeStats(await dataClient.getPipelineNodeStats(pipeline.id));
          } catch {
            // Node stats are best-effort — the failure message still stands.
          }
        }
        // Inside the editor the structured card replaces the page-level banner
        // for assertion failures; other failures still surface as a banner.
        const isExpectFailure = /Expect failed at node [^:]+:/.test(message);
        if (editors.editingPipelineId !== pipeline.id || !isExpectFailure) {
          ui.setError(message);
        }
        await loadDashboard({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [dashboard, editors, loadDashboard, ui]
  );

  const handleRefreshCloudRawTable = useCallback(
    async (rawTable: DataRawTable) => {
      if (!dataClient.has('refreshCloudRawTable')) return;
      ui.setActionId(`cloud-sync:${rawTable.id}`);
      ui.setError(null);
      try {
        const result = await dataClient.refreshCloudRawTable({ rawTableId: rawTable.id });
        await Promise.all([
          loadRawTables({ preserveError: true }),
          loadDashboard({ preserveError: true }),
        ]);
        return result.rawTable;
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [loadDashboard, loadRawTables, ui]
  );

  const handleEditPipeline = useCallback(
    (pipeline: DataPipeline) => {
      editors.setPipelineNameEditRequested(false);
      editors.setFocusedPipeline(pipeline);
      editors.setEditingPipelineId(pipeline.id);
    },
    [editors]
  );

  const handleGeneratedPipeline = useCallback(
    async (result: DataGeneratePipelineFromRequirementResult) => {
      ui.setActiveTab('pipelines');
      ui.setSearchQuery('');
      dashboard.setPipelinePage(1);
      editors.setEditingRawTableId(null);
      editors.setPipelineNameEditRequested(false);
      try {
        const pipeline = await dataClient.getPipeline(result.pipelineId);
        if (pipeline) {
          editors.setFocusedPipeline(pipeline);
          editors.setEditingPipelineId(pipeline.id);
        }
        await loadDashboard({ query: '', pipelinePage: 1 });
      } catch (err) {
        // Generation already persisted the pipeline. Do not leave a retry button that
        // would create it again just because refreshing the workspace failed.
        ui.setError(err instanceof Error ? err.message : String(err));
      }
    },
    [ui, editors, dashboard, loadDashboard]
  );

  const handleClosePipelineEditor = useCallback(() => {
    editors.setPipelineNameEditRequested(false);
    editors.setEditingPipelineId(null);
    editors.setFocusedPipeline(null);
  }, [editors]);

  const handleCreateRawTableDraft = useCallback(() => {
    const draft = drafts.createDraft(
      `${t('data.rawTables.defaultName')} ${rawTables.totalRawTables + drafts.drafts.length + 1}`
    );
    ui.setActiveTab('raw_tables');
    ui.setSearchQuery('');
    editors.setEditingRawTableId(null);
    editors.setEditingRawTableDraftId(draft.id);
  }, [drafts, editors, rawTables.totalRawTables, t, ui]);

  const handleRenameRawTableDraft = useCallback(
    (id: string, name: string) => {
      drafts.renameDraft(id, name);
    },
    [drafts]
  );

  const handleDeleteRawTableDraft = useCallback(
    (id: string) => {
      drafts.removeDraft(id);
      editors.setEditingRawTableDraftId((current) => (current === id ? null : current));
    },
    [drafts, editors]
  );

  const handleImportRawTableSource = useCallback(
    async (
      draft: RawTableDraft,
      sourceKind: DataRawTableSourceKind,
      config: DataRawTableConfig,
      name?: string
    ) => {
      if (!dataClient.isAvailable()) return;
      ui.setActionId(draft.id);
      ui.setError(null);
      try {
        const sourcePath =
          sourceKind === 'cloud' ? undefined : await dataClient.pickRawTableSourcePath(sourceKind);
        if (sourceKind !== 'cloud' && !sourcePath) return;
        ui.setActiveTab('raw_tables');
        const imported =
          config.sourceKind === 'cloud'
            ? (
                await dataClient.importCloudRawTable({
                  ...config.cloudMirror,
                  name: name?.trim() || draft.name,
                })
              ).rawTable
            : await dataClient.importRawTable({
                filePath: sourcePath!,
                name: name?.trim() || draft.name,
                sourceKind,
                config,
              });
        drafts.removeDraft(draft.id);
        rawTables.upsertRawTable(imported, true);
        editors.setEditingRawTableDraftId(null);
        editors.setEditingRawTableId(imported.id);
        rawTables.setRawTablePage(1);
        await loadRawTables({ preserveError: true, page: 1 });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadRawTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [drafts, editors, rawTables, loadRawTables, ui]
  );

  const handleEditRawTable = useCallback(
    (id: string) => {
      ui.setActiveTab('raw_tables');
      editors.setEditingRawTableDraftId(null);
      editors.setEditingRawTableId(id);
    },
    [editors, ui]
  );

  const handleRenameRawTable = useCallback(
    async (rawTable: DataRawTable, name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName === rawTable.name || !dataClient.has('updateRawTable')) {
        return;
      }
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const updated = await dataClient.updateRawTable({
          id: rawTable.id,
          name: trimmedName,
        });
        rawTables.updateRawTableRow(updated);
        await loadRawTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadRawTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [rawTables, loadRawTables, ui]
  );

  const handleUpdateRawTableSource = useCallback(
    async (
      rawTable: DataRawTable,
      sourceKind: DataRawTableSourceKind,
      config: DataRawTableConfig,
      name?: string
    ) => {
      if (!dataClient.has('updateRawTable')) return;
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const sourcePath =
          sourceKind === 'cloud' ? undefined : await dataClient.pickRawTableSourcePath(sourceKind);
        if (sourceKind !== 'cloud' && !sourcePath) return;
        const updated =
          config.sourceKind === 'cloud'
            ? (
                await dataClient.importCloudRawTable({
                  ...config.cloudMirror,
                  rawTableId: rawTable.id,
                  name: name?.trim() || rawTable.name,
                })
              ).rawTable
            : await dataClient.updateRawTable({
                id: rawTable.id,
                filePath: sourcePath!,
                name: name?.trim() || rawTable.name,
                sourceKind,
                config,
              });
        rawTables.updateRawTableRow(updated);
        await loadRawTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadRawTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [rawTables, loadRawTables, ui]
  );

  const handleUpdateRawTableConfig = useCallback(
    async (rawTable: DataRawTable, config: DataRawTableConfig, name?: string) => {
      if (!dataClient.has('updateRawTable')) return;
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const updated = await dataClient.updateRawTable({
          id: rawTable.id,
          name: name?.trim() || rawTable.name,
          sourceKind: config.sourceKind,
          config,
        });
        rawTables.updateRawTableRow(updated);
        await loadRawTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadRawTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [rawTables, loadRawTables, ui]
  );

  const handleDeletePipeline = useCallback(
    async (pipeline: DataPipeline) => {
      if (!dataClient.isAvailable()) return;
      const confirmed = await confirmDelete({
        message: t('data.deletePipelineConfirm', { name: pipeline.name }),
      });
      if (!confirmed) return;
      ui.setActionId(pipeline.id);
      ui.setError(null);
      try {
        const result = await dataClient.deletePipeline(pipeline.id);
        if (!result.success) {
          throw new Error(t('data.deletePipelineNotFound'));
        }
        if (editors.editingPipelineId === pipeline.id) {
          editors.setEditingPipelineId(null);
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

  const handleDeleteAllPipelines = useCallback(async () => {
    if (!dataClient.isAvailable()) return;
    const count = dashboard.dashboard.totalPipelines;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.deleteAllPipelinesConfirm', { count }),
    });
    if (!confirmed) return;
    ui.setActionId('delete-all-pipelines');
    ui.setError(null);
    try {
      let hasMorePipelines = true;
      while (hasMorePipelines) {
        const page = await dataClient.getDashboard({
          query: ui.searchQuery,
          includeSummary: false,
          includePipelines: true,
          includeRawTables: false,
          includeResultTables: false,
          pipelineOffset: 0,
          pipelineLimit: DATA_DELETE_BATCH_SIZE,
          rawTableLimit: 0,
          outputLimit: 0,
        });
        hasMorePipelines = page.pipelines.length > 0;
        if (!hasMorePipelines) break;
        for (const pipeline of page.pipelines) {
          await dataClient.deletePipeline(pipeline.id);
        }
      }
      editors.setEditingPipelineId(null);
      dashboard.setPipelinePage(1);
      await loadDashboard({ preserveError: true, tab: 'pipelines', pipelinePage: 1 });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'pipelines' });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, dashboard, editors, loadDashboard, t, ui]);

  const handleDeleteRawTable = useCallback(
    async (rawTable: DataRawTable) => {
      if (!dataClient.has('deleteRawTable')) return;
      const confirmed = await confirmDelete({
        message: t('data.rawTables.deleteConfirm', { name: rawTable.name }),
      });
      if (!confirmed) return;
      ui.setActionId(rawTable.id);
      ui.setError(null);
      try {
        const result = await dataClient.deleteRawTable(rawTable.id);
        if (!result.success) {
          throw new Error(t('data.rawTables.deleteNotFound'));
        }
        rawTables.removeRawTable(rawTable.id);
        await loadRawTables({ preserveError: true });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadRawTables({ preserveError: true });
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, rawTables, loadRawTables, t, ui]
  );

  const handleDeleteAllRawTables = useCallback(async () => {
    if (!dataClient.has('deleteRawTable')) return;
    const draftIds = drafts.drafts
      .filter((draft) => matchesSearchText(draft.name, ui.searchQuery))
      .map((draft) => draft.id);
    const count = rawTables.totalRawTables + draftIds.length;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.rawTables.deleteAllConfirm', { count }),
    });
    if (!confirmed) return;
    ui.setActionId('delete-all-raw-tables');
    ui.setError(null);
    try {
      if (draftIds.length > 0) {
        drafts.removeDrafts(draftIds);
        editors.setEditingRawTableDraftId((current) =>
          current && draftIds.includes(current) ? null : current
        );
      }
      let hasMoreRawTables = true;
      while (hasMoreRawTables) {
        const page = await dataClient.getDashboard({
          query: ui.searchQuery,
          includeSummary: false,
          includePipelines: false,
          includeRawTables: true,
          includeResultTables: false,
          pipelineLimit: 0,
          rawTableOffset: 0,
          rawTableLimit: DATA_DELETE_BATCH_SIZE,
          rawTableSourceKind: 'all',
          outputLimit: 0,
        });
        hasMoreRawTables = page.rawTables.length > 0;
        if (!hasMoreRawTables) break;
        for (const rawTable of page.rawTables) {
          await dataClient.deleteRawTable(rawTable.id);
        }
      }
      editors.setEditingRawTableId(null);
      rawTables.setRawTablePage(1);
      await loadRawTables({ preserveError: true, page: 1 });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadRawTables({ preserveError: true });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, drafts, editors, rawTables, loadRawTables, t, ui]);

  const handleCreateResultTable = useCallback(
    async (input: { name: string; sourceRawTableId: string | null }) => {
      if (!dataClient.has('createResultTable')) return;
      ui.setActionId('create-output');
      ui.setError(null);
      try {
        ui.setActiveTab('result_tables');
        ui.setSearchQuery('');
        dashboard.setOutputPage(1);
        const resultTable = await dataClient.createResultTable({
          name: input.name.trim(),
        });
        let opened = resultTable;
        if (input.sourceRawTableId && dataClient.has('updateResultTable')) {
          opened = await dataClient.updateResultTable({
            id: resultTable.id,
            sourceRawTableId: input.sourceRawTableId,
          });
          showToast('success', t('data.resultTables.copiedRows', { count: opened.rowCount }));
        }
        editors.setEditingResultTableId(opened.id);
        await loadDashboard({ preserveError: true, tab: 'result_tables', outputPage: 1 });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'result_tables' });
      } finally {
        ui.setActionId(null);
      }
    },
    [dashboard, editors, loadDashboard, t, ui]
  );

  const handleUpdateResultTable = useCallback(
    async (resultTable: DataResultTable, name: string, sourceRawTableId: string | null) => {
      const trimmedName = name.trim();
      const nextSourceRawTableId = sourceRawTableId || null;
      if (
        !trimmedName ||
        (trimmedName === resultTable.name &&
          nextSourceRawTableId === resultTable.sourceRawTableId) ||
        !dataClient.has('updateResultTable')
      ) {
        return;
      }
      ui.setActionId(resultTable.id);
      ui.setError(null);
      try {
        const updated = await dataClient.updateResultTable({
          id: resultTable.id,
          name: trimmedName,
          sourceRawTableId: nextSourceRawTableId,
        });
        if (nextSourceRawTableId && nextSourceRawTableId !== resultTable.sourceRawTableId) {
          showToast('success', t('data.resultTables.copiedRows', { count: updated.rowCount }));
        }
        await loadDashboard({ preserveError: true, tab: 'result_tables' });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'result_tables' });
      } finally {
        ui.setActionId(null);
      }
    },
    [loadDashboard, t, ui]
  );

  const handleDeleteResultTable = useCallback(
    async (resultTable: DataResultTable) => {
      if (!dataClient.has('deleteRawTable')) return;
      const confirmed = await confirmDelete({
        message: t('data.resultTables.deleteConfirm', { name: resultTable.name }),
      });
      if (!confirmed) return;
      ui.setActionId(resultTable.id);
      ui.setError(null);
      try {
        const result = await dataClient.deleteRawTable(resultTable.id);
        if (!result.success) {
          throw new Error(t('data.resultTables.deleteNotFound'));
        }
        if (editors.editingResultTableId === resultTable.id) {
          editors.setEditingResultTableId(null);
        }
        await loadDashboard({ preserveError: true, tab: 'result_tables' });
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await loadDashboard({ preserveError: true, tab: 'result_tables' });
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, editors, loadDashboard, t, ui]
  );

  const handleDeleteAllResultTables = useCallback(async () => {
    if (!dataClient.has('deleteRawTable')) return;
    const count = dashboard.dashboard.totalResultTables;
    if (count <= 0) return;
    const confirmed = await confirmDelete({
      message: t('data.resultTables.deleteAllConfirm', { count }),
    });
    if (!confirmed) return;
    ui.setActionId('delete-all-result-tables');
    ui.setError(null);
    try {
      let hasMoreResultTables = true;
      while (hasMoreResultTables) {
        const page = await dataClient.getDashboard({
          query: ui.searchQuery,
          includeSummary: false,
          includePipelines: false,
          includeRawTables: false,
          includeResultTables: true,
          pipelineLimit: 0,
          rawTableLimit: 0,
          outputOffset: 0,
          outputLimit: DATA_DELETE_BATCH_SIZE,
        });
        hasMoreResultTables = page.resultTables.length > 0;
        if (!hasMoreResultTables) break;
        for (const resultTable of page.resultTables) {
          await dataClient.deleteRawTable(resultTable.id);
        }
      }
      editors.setEditingResultTableId(null);
      dashboard.setOutputPage(1);
      await loadDashboard({
        preserveError: true,
        tab: 'result_tables',
        outputPage: 1,
      });
    } catch (err) {
      ui.setError(err instanceof Error ? err.message : String(err));
      await loadDashboard({ preserveError: true, tab: 'result_tables' });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, dashboard, editors, loadDashboard, t, ui]);

  const reloadScope = useCallback(
    async (scope: DataGroupScope) => {
      if (scope === 'raw') {
        await loadRawTables({ preserveError: true });
      } else {
        await loadDashboard({
          preserveError: true,
          tab: scope === 'pipeline' ? 'pipelines' : 'result_tables',
        });
      }
    },
    [loadDashboard, loadRawTables]
  );

  const handleAssignToGroup = useCallback(
    async (scope: DataGroupScope, ids: string[], target: AssignGroupTarget) => {
      if (ids.length === 0 || !dataClient.has('assignGroup')) return;
      ui.setActionId('assign-group');
      ui.setError(null);
      try {
        let groupId = target.groupId;
        if (target.newGroupName) {
          const group = await dataClient.createGroup({ scope, name: target.newGroupName });
          groupId = group.id;
        }
        await dataClient.assignGroup({ scope, ids, groupId });
        await reloadScope(scope);
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await reloadScope(scope);
      } finally {
        ui.setActionId(null);
      }
    },
    [reloadScope, ui]
  );

  const handleRenameGroup = useCallback(
    async (scope: DataGroupScope, group: DataListGroup, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === group.name || !dataClient.has('renameGroup')) return;
      ui.setActionId(`rename-group-${group.id}`);
      ui.setError(null);
      try {
        await dataClient.renameGroup({ id: group.id, name: trimmed });
        await reloadScope(scope);
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await reloadScope(scope);
      } finally {
        ui.setActionId(null);
      }
    },
    [reloadScope, ui]
  );

  const handleDeleteGroup = useCallback(
    async (scope: DataGroupScope, group: DataListGroup) => {
      if (!dataClient.has('deleteGroup')) return;
      const confirmed = await confirmDelete({
        message: t('data.groups.deleteConfirm', { name: group.name }),
      });
      if (!confirmed) return;
      ui.setActionId(`delete-group-${group.id}`);
      ui.setError(null);
      try {
        await dataClient.deleteGroup(group.id);
        await reloadScope(scope);
      } catch (err) {
        ui.setError(err instanceof Error ? err.message : String(err));
        await reloadScope(scope);
      } finally {
        ui.setActionId(null);
      }
    },
    [confirmDelete, reloadScope, t, ui]
  );

  return {
    handleCreatePipeline,
    handleCreatePipelineFromTable,
    handleRefreshCloudRawTable,
    handleRunPipeline,
    handleEditPipeline,
    handleGeneratedPipeline,
    handleClosePipelineEditor,
    handleCreateRawTableDraft,
    handleRenameRawTableDraft,
    handleDeleteRawTableDraft,
    handleImportRawTableSource,
    handleEditRawTable,
    handleRenameRawTable,
    handleUpdateRawTableSource,
    handleUpdateRawTableConfig,
    handleDeletePipeline,
    handleDeleteAllPipelines,
    handleDeleteRawTable,
    handleDeleteAllRawTables,
    handleCreateResultTable,
    handleUpdateResultTable,
    handleDeleteResultTable,
    handleDeleteAllResultTables,
    handleAssignToGroup,
    handleRenameGroup,
    handleDeleteGroup,
  };
}

export type DataActions = ReturnType<typeof useDataActions>;
