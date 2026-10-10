/**
 * Deep-link navigation for the data workspace: reacts to the app store's
 * pending data navigation targets (pipeline / input table / output table / tab)
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
import type { RawTablesState } from './use-raw-tables';
import type { DataViewEditors } from './use-data-view-editors';
import type { StoredPreviewState } from './use-stored-preview';

export function useDataNavigation(deps: {
  ui: DataViewUi;
  dashboard: DataDashboardState;
  rawTables: RawTablesState;
  editors: DataViewEditors;
  preview: StoredPreviewState;
  isDataApiAvailable: boolean;
  t: TFunction;
}) {
  const { ui, dashboard, rawTables, editors, preview, isDataApiAvailable, t } = deps;
  const pendingDataNavigation = useAppStore((state) => state.pendingDataNavigation);
  const pendingDataTabNavigation = useAppStore((state) => state.pendingDataTabNavigation);
  const clearDataNavigation = useAppStore((state) => state.clearDataNavigation);
  const clearDataTabNavigation = useAppStore((state) => state.clearDataTabNavigation);

  // Stable members only — slice objects are recreated every render.
  const { setError, setActiveTab, setPendingNavigationTab, setLoadingTab, setSearchQuery } = ui;
  const { prependPipeline, prependResultTable, setPipelinePage, setOutputPage } = dashboard;
  const { setRawTablesLoading, upsertRawTable, setTotalRawTables, setRawTablePage } = rawTables;
  const {
    resetWorkspace,
    setFocusedPipeline,
    setEditingPipelineId,
    setFocusedRawTable,
    setEditingRawTableId,
    setFocusedResultTable,
    setEditingResultTableId,
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

      if (target.kind === 'pipeline') {
        setActiveTab('pipelines');
        setPendingNavigationTab('pipelines');
        setLoadingTab('pipelines');
        const pipeline = await dataClient.getPipeline(target.id);
        if (cancelled) return;
        if (!pipeline) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedPipeline(pipeline);
        prependPipeline(pipeline);
        setSearchQuery('');
        setPipelinePage(1);
        setEditingPipelineId(pipeline.id);
        return;
      }

      if (target.kind === 'raw_table') {
        setActiveTab('raw_tables');
        setPendingNavigationTab('raw_tables');
        setLoadingTab('raw_tables');
        setRawTablesLoading(true);
        const rawTable = await dataClient.getRawTable(target.id);
        if (cancelled) return;
        if (!rawTable) {
          setError(t('data.navigationNotFound'));
          return;
        }
        setFocusedRawTable(rawTable);
        upsertRawTable(rawTable, false);
        setTotalRawTables((current) => Math.max(current, 1));
        setRawTablePage(1);
        setEditingRawTableId(rawTable.id);
        return;
      }

      setActiveTab('result_tables');
      setPendingNavigationTab('result_tables');
      setLoadingTab('result_tables');
      const resultTable = await dataClient.getResultTable(target.id);
      if (cancelled) return;
      if (!resultTable) {
        setError(t('data.navigationNotFound'));
        return;
      }
      setFocusedResultTable(resultTable);
      prependResultTable(resultTable);
      setOutputPage(1);
      setEditingResultTableId(resultTable.id);
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
          setRawTablesLoading(false);
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
    prependResultTable,
    prependPipeline,
    resetWorkspace,
    setActiveTab,
    setRawTablePage,
    setEditingRawTableId,
    setEditingResultTableId,
    setEditingPipelineId,
    setError,
    setFocusedRawTable,
    setFocusedResultTable,
    setFocusedPipeline,
    setRawTablesLoading,
    setLoadingTab,
    setOutputPage,
    setPendingNavigationTab,
    setSearchQuery,
    setPipelinePage,
    setTotalRawTables,
    t,
    upsertRawTable,
  ]);
}
