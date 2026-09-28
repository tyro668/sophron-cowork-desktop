/**
 * Deep-link navigation for the data workspace: reacts to the app store's
 * pending data navigation targets (task / input table / output table / tab)
 * and drives the editors + server-state hooks to focus the target.
 *
 * The effect bodies only consume the STABLE members of each slice (useState
 * setters and `useCallback` actions). Depending on the slice objects
 * themselves would re-run the effect on every render and cancel any
 * in-flight navigation request — members are destructured up front so the
 * dep arrays stay honest.
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

  // Stable members only — slice objects are recreated every render.
  const { setError, setActiveTab, setPendingNavigationTab, setLoadingTab, setSearchQuery } = ui;
  const { prependTask, prependOutputTable, setTaskPage, setOutputPage } = dashboard;
  const { setInputTablesLoading, upsertDataset, setTotalInputTableDatasets, setDatasetPage } =
    inputTables;
  const {
    resetWorkspace,
    setFocusedTask,
    setEditingTaskId,
    setFocusedInputTable,
    setEditingInputTableDatasetId,
    setFocusedOutputTable,
    setEditingOutputTableId,
  } = editors;
  const { close: closePreview } = preview;

  // Plain tab switches — just reset the workspace and activate the tab.
  useEffect(() => {
    if (!pendingDataTabNavigation) return;
    closePreview();
    resetWorkspace();
    setPendingNavigationTab(pendingDataTabNavigation.tab);
    setLoadingTab(pendingDataTabNavigation.tab);
    setActiveTab(pendingDataTabNavigation.tab);
    setSearchQuery('');
    clearDataTabNavigation(pendingDataTabNavigation.nonce);
  }, [
    clearDataTabNavigation,
    closePreview,
    pendingDataTabNavigation,
    resetWorkspace,
    setActiveTab,
    setLoadingTab,
    setPendingNavigationTab,
    setSearchQuery,
  ]);

  // Deep links to a specific record — fetch it, focus it, open its editor.
  useEffect(() => {
    if (!pendingDataNavigation || !isDataApiAvailable) {
      return undefined;
    }

    const target = pendingDataNavigation;
    let cancelled = false;

    const run = async () => {
      setError(null);
      closePreview();
      resetWorkspace();

      if (target.kind === 'task') {
        setActiveTab('tasks');
        setPendingNavigationTab('tasks');
        setLoadingTab('tasks');
        const task = await dataClient.getTask(target.id);
        if (cancelled) return;
        if (!task) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedTask(task);
        prependTask(task);
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
        const inputTable = await dataClient.getInputTable(target.id);
        if (cancelled) return;
        if (!inputTable) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedInputTable(inputTable);
        upsertDataset(inputTable, false);
        setTotalInputTableDatasets((current) => Math.max(current, 1));
        setDatasetPage(1);
        setEditingInputTableDatasetId(inputTable.id);
        return;
      }

      setActiveTab('output_tables');
      setPendingNavigationTab('output_tables');
      setLoadingTab('output_tables');
      const outputTable = await dataClient.getOutputTable(target.id);
      if (cancelled) return;
      if (!outputTable) {
        setError(t('data.navigationNotFound'));
        return;
      }
      setFocusedOutputTable(outputTable);
      prependOutputTable(outputTable);
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
  }, [
    clearDataNavigation,
    closePreview,
    isDataApiAvailable,
    pendingDataNavigation,
    prependOutputTable,
    prependTask,
    resetWorkspace,
    setActiveTab,
    setDatasetPage,
    setEditingInputTableDatasetId,
    setEditingOutputTableId,
    setEditingTaskId,
    setError,
    setFocusedInputTable,
    setFocusedOutputTable,
    setFocusedTask,
    setInputTablesLoading,
    setLoadingTab,
    setOutputPage,
    setPendingNavigationTab,
    setSearchQuery,
    setTaskPage,
    setTotalInputTableDatasets,
    t,
    upsertDataset,
  ]);
}
