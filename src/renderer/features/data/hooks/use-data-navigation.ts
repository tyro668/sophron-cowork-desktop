/**
 * Deep-link navigation for the data workspace: reacts to the app store's
 * pending data navigation targets (task / input table / output table / tab)
 * and drives the editors + server-state hooks to focus the target.
 */
import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import { useAppStore } from '../../../store';
import { dataClient } from '../api/data-client';
import type { DataViewUi } from './use-data-view-ui';
import type { DataDashboardState } from './use-data-dashboard';
import type { InputTablesState } from './use-input-tables';
import type { DataViewEditors } from './use-data-view-editors';
import type { StoredPreviewState } from './use-stored-preview';

export function useDataNavigation(deps: {
  ui: DataViewUi;
  dashboard: DataDashboardState;
  inputTables: InputTablesState;
  editors: DataViewEditors;
  preview: StoredPreviewState;
  isDataApiAvailable: boolean;
  t: TFunction;
}) {
  const { ui, dashboard, inputTables, editors, preview, isDataApiAvailable, t } = deps;
  const pendingDataNavigation = useAppStore((state) => state.pendingDataNavigation);
  const pendingDataTabNavigation = useAppStore((state) => state.pendingDataTabNavigation);
  const clearDataNavigation = useAppStore((state) => state.clearDataNavigation);
  const clearDataTabNavigation = useAppStore((state) => state.clearDataTabNavigation);

  // Plain tab switches — just reset the workspace and activate the tab.
  useEffect(() => {
    if (!pendingDataTabNavigation) return;
    preview.close();
    editors.resetWorkspace();
    ui.setPendingNavigationTab(pendingDataTabNavigation.tab);
    ui.setLoadingTab(pendingDataTabNavigation.tab);
    ui.setActiveTab(pendingDataTabNavigation.tab);
    ui.setSearchQuery('');
    clearDataTabNavigation(pendingDataTabNavigation.nonce);
  }, [clearDataTabNavigation, editors, pendingDataTabNavigation, preview, ui]);

  // Deep links to a specific record — fetch it, focus it, open its editor.
  useEffect(() => {
    if (!pendingDataNavigation || !isDataApiAvailable) {
      return undefined;
    }

    const target = pendingDataNavigation;
    let cancelled = false;

    const run = async () => {
      ui.setError(null);
      preview.close();
      editors.resetWorkspace();

      if (target.kind === 'task') {
        ui.setActiveTab('tasks');
        ui.setPendingNavigationTab('tasks');
        ui.setLoadingTab('tasks');
        const task = await dataClient.getTask(target.id);
        if (cancelled) return;
        if (!task) {
          ui.setError(t('data.navigationNotFound'));
          return;
        }
        editors.setFocusedTask(task);
        dashboard.prependTask(task);
        ui.setSearchQuery('');
        dashboard.setTaskPage(1);
        editors.setEditingTaskId(task.id);
        return;
      }

      if (target.kind === 'input_table') {
        ui.setActiveTab('input_tables');
        ui.setPendingNavigationTab('input_tables');
        ui.setLoadingTab('input_tables');
        inputTables.setInputTablesLoading(true);
        const inputTable = await dataClient.getInputTable(target.id);
        if (cancelled) return;
        if (!inputTable) {
          ui.setError(t('data.navigationNotFound'));
          return;
        }
        editors.setFocusedInputTable(inputTable);
        ui.setInputTableSourceFilter('all');
        inputTables.upsertDataset(inputTable, false);
        inputTables.setTotalInputTableDatasets((current) => Math.max(current, 1));
        inputTables.setDatasetPage(1);
        editors.setEditingInputTableDatasetId(inputTable.id);
        return;
      }

      ui.setActiveTab('output_tables');
      ui.setPendingNavigationTab('output_tables');
      ui.setLoadingTab('output_tables');
      const outputTable = await dataClient.getOutputTable(target.id);
      if (cancelled) return;
      if (!outputTable) {
        ui.setError(t('data.navigationNotFound'));
        return;
      }
      editors.setFocusedOutputTable(outputTable);
      dashboard.prependOutputTable(outputTable);
      dashboard.setOutputPage(1);
      editors.setEditingOutputTableId(outputTable.id);
    };

    void run()
      .catch((err) => {
        if (!cancelled) {
          ui.setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          ui.setPendingNavigationTab(null);
          ui.setLoadingTab(null);
          inputTables.setInputTablesLoading(false);
          clearDataNavigation(target.nonce);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    clearDataNavigation,
    dashboard,
    editors,
    inputTables,
    isDataApiAvailable,
    pendingDataNavigation,
    preview,
    t,
    ui,
  ]);
}
