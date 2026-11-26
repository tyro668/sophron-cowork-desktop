import { formatIpcError } from '../../../utils/ipc-error';
import { pipelineDeleteImpact } from '../utils/delete-impact';
import { formatDataErrorMessage } from '../model/errors';
import { useCallback } from 'react';
import type {
  DataPipeline,
  DataRawTable,
  DataGeneratePipelineFromRequirementResult,
  DataRunPipelineInput,
} from '../../../../shared/contracts';
import { DATA_DELETE_BATCH_SIZE } from '../../../components/data-view/shared';
import { getOperatorCatalog } from '../../../components/data-view/data-pipelines/workflow/operator-catalog';
import { buildWorkflowStarterGraph } from '../../../components/data-view/data-pipelines/workflow/workflow-starter';
import { dataClient } from '../api/data-client';
import { uniquePipelineName } from '../model/pipeline-names';
import type { DataActionsDeps } from './data-action-deps';

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

export function usePipelineActions({
  ui,
  dashboard,
  editors,
  t,
  confirmDelete,
}: Pick<DataActionsDeps, 'ui' | 'dashboard' | 'editors' | 't' | 'confirmDelete'>) {
  const { loadDashboard } = dashboard;
  /**
   * Creates a pipeline with a guaranteed-unique name and opens the editor in
   * rename mode. With `sourceRawTable`, the pipeline is persisted with a bound
   * `input` node — the "create pipeline from this table" flow lands on a
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
                input: t(getOperatorCatalog('input').labelKey),
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
            ui.setError(formatDataErrorMessage(err, t));
          }
        }
        editors.setFocusedPipeline(focused);
        editors.setEditingPipelineId(focused.id);
        editors.setPipelineNameEditRequested(true);
        await loadDashboard({ query: '', pipelinePage: 1 });
      } catch (err) {
        ui.setError(formatDataErrorMessage(err, t));
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
        const message = formatIpcError(err, String(err));
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
        ui.setError(formatDataErrorMessage(err, t));
      }
    },
    [ui, editors, dashboard, loadDashboard, t]
  );

  const handleClosePipelineEditor = useCallback(() => {
    editors.setPipelineNameEditRequested(false);
    editors.setEditingPipelineId(null);
    editors.setFocusedPipeline(null);
  }, [editors]);

  const handleDeletePipeline = useCallback(
    async (pipeline: DataPipeline) => {
      if (!dataClient.isAvailable()) return;
      const confirmed = await confirmDelete({
        message: t('data.deletePipelineConfirm', { name: pipeline.name }),
        title: t('data.deleteImpact.pipelineTitle'),
        name: pipeline.name,
        impact: pipelineDeleteImpact(pipeline, t),
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
        ui.setError(formatDataErrorMessage(err, t));
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
      ui.setError(formatDataErrorMessage(err, t));
      await loadDashboard({ preserveError: true, tab: 'pipelines' });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, dashboard, editors, loadDashboard, t, ui]);
  return {
    handleCreatePipeline,
    handleCreatePipelineFromTable,
    handleRunPipeline,
    handleEditPipeline,
    handleGeneratedPipeline,
    handleClosePipelineEditor,
    handleDeletePipeline,
    handleDeleteAllPipelines,
  };
}
