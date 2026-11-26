import { resultTableDeleteImpact } from '../utils/delete-impact';
import { formatDataErrorMessage } from '../model/errors';
import { useCallback } from 'react';
import type { DataResultTable } from '../../../../shared/contracts';
import { DATA_DELETE_BATCH_SIZE } from '../../../components/data-view/shared';
import { dataClient } from '../api/data-client';
import { showToast } from '../../../utils/toast';
import type { DataActionsDeps } from './data-action-deps';

export function useResultTableActions({
  ui,
  dashboard,
  editors,
  t,
  confirmDelete,
}: Pick<DataActionsDeps, 'ui' | 'dashboard' | 'editors' | 't' | 'confirmDelete'>) {
  const { loadDashboard } = dashboard;
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
        ui.setError(formatDataErrorMessage(err, t));
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
        ui.setError(formatDataErrorMessage(err, t));
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
        title: t('data.deleteImpact.resultTableTitle'),
        name: resultTable.name,
        impact: resultTableDeleteImpact(resultTable, t),
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
        ui.setError(formatDataErrorMessage(err, t));
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
      ui.setError(formatDataErrorMessage(err, t));
      await loadDashboard({ preserveError: true, tab: 'result_tables' });
    } finally {
      ui.setActionId(null);
    }
  }, [confirmDelete, dashboard, editors, loadDashboard, t, ui]);
  return {
    handleCreateResultTable,
    handleUpdateResultTable,
    handleDeleteResultTable,
    handleDeleteAllResultTables,
  };
}
