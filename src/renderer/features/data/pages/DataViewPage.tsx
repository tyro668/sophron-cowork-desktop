/**
 * Data workspace page — composition layer. Wires the domain hooks together
 * (ui / server state / editor state / preview / actions / navigation) and
 * renders the tabbed workspace. Components below only receive state and
 * action callbacks; every IPC call lives in `features/data/api/data-client`.
 */
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { useConfirmDialog } from '../../../components/ConfirmDialog';
import { CloudAnalysisPanel } from '../../../components/data-view/cloud-analysis';
import { TaskEditor, TasksPanel } from '../../../components/data-view/data-tasks';
import {
  InputTableEditor,
  InputTablePreviewDialog,
  InputTablesPanel,
} from '../../../components/data-view/input-tables';
import {
  OutputTableEditor,
  OutputTablesPanel,
  UploadOutputTableToCloudDialog,
} from '../../../components/data-view/output-tables';
import { underlineTabTriggerClass } from '../../../components/data-view/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { dataClient } from '../api/data-client';
import { useDataViewUi } from '../hooks/use-data-view-ui';
import { useDataDashboard } from '../hooks/use-data-dashboard';
import { useInputTables } from '../hooks/use-input-tables';
import { useInputTableDrafts } from '../hooks/use-input-table-drafts';
import { useDataViewEditors } from '../hooks/use-data-view-editors';
import { useStoredPreview } from '../hooks/use-stored-preview';
import { useDataActions } from '../hooks/use-data-actions';
import { useDataNavigation } from '../hooks/use-data-navigation';
import type { DataTab, InputTableSourceFilter } from '../model/types';

export function DataViewPage() {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const isDataApiAvailable = dataClient.isAvailable();

  const ui = useDataViewUi();
  const drafts = useInputTableDrafts();
  const dashboard = useDataDashboard({
    activeTab: ui.activeTab,
    searchQuery: ui.searchQuery,
    setError: ui.setError,
    setLoadingTab: ui.setLoadingTab,
    setPendingNavigationTab: ui.setPendingNavigationTab,
  });
  const inputTables = useInputTables({
    searchQuery: ui.searchQuery,
    sourceFilter: ui.inputTableSourceFilter,
    draftsCount: drafts.drafts.length,
    setError: ui.setError,
    setLoadingTab: ui.setLoadingTab,
    setPendingNavigationTab: ui.setPendingNavigationTab,
  });
  const editors = useDataViewEditors({
    tasks: dashboard.dashboard.tasks,
    inputTableDatasets: inputTables.inputTableDatasets,
    outputTables: dashboard.dashboard.outputTables,
    drafts: drafts.drafts,
    setError: ui.setError,
  });
  const preview = useStoredPreview();
  const actions = useDataActions({
    ui,
    dashboard,
    inputTables,
    drafts,
    editors,
    t,
    confirmDelete,
  });
  useDataNavigation({
    ui,
    dashboard,
    inputTables,
    editors,
    preview,
    isDataApiAvailable,
    t,
  });

  const { activeTab, searchQuery, error, actionId } = ui;
  const { setPendingNavigationTab, setLoadingTab } = ui;
  const { loadDashboard, invalidateRequests } = dashboard;
  const { loadInputTables } = inputTables;

  // Auto-load: react to tab/search changes with a two-frame delay so the tab
  // switch paints before the fetch starts; task search debounces 180ms.
  // `loadDashboard`/`loadInputTables` identities change on page/filter changes,
  // so pagination and source filters reload through this effect too.
  useEffect(() => {
    if (!isDataApiAvailable) {
      setPendingNavigationTab(null);
      setLoadingTab(null);
      return;
    }
    invalidateRequests();
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
  }, [
    activeTab,
    isDataApiAvailable,
    searchQuery,
    loadDashboard,
    invalidateRequests,
    loadInputTables,
    setPendingNavigationTab,
    setLoadingTab,
  ]);

  const handleSearchChange = useCallback(
    (value: string) => {
      ui.setLoadingTab(activeTab);
      if (activeTab === 'input_tables') {
        inputTables.setInputTablesLoading(true);
        inputTables.setDatasetPage(1);
      } else if (activeTab === 'output_tables') {
        dashboard.setOutputPage(1);
      } else {
        dashboard.setTaskPage(1);
      }
      ui.setSearchQuery(value);
    },
    [activeTab, dashboard, inputTables, ui]
  );

  const handleInputTableSourceFilterChange = useCallback(
    (value: InputTableSourceFilter) => {
      ui.setLoadingTab('input_tables');
      inputTables.setInputTablesLoading(true);
      ui.setInputTableSourceFilter(value);
      inputTables.setDatasetPage(1);
    },
    [inputTables, ui]
  );

  const handleTabChange = useCallback(
    (tab: DataTab) => {
      if (tab === activeTab) return;
      dashboard.invalidateRequests();
      ui.setPendingNavigationTab(tab);
      ui.setLoadingTab(tab);
      ui.setActiveTab(tab);
      ui.setSearchQuery('');
    },
    [activeTab, dashboard, ui]
  );

  const handleTaskPageChange = useCallback(
    (page: number) => {
      ui.setLoadingTab('tasks');
      dashboard.setTaskPage(page);
    },
    [dashboard, ui]
  );

  const handleDatasetPageChange = useCallback(
    (page: number) => {
      ui.setLoadingTab('input_tables');
      inputTables.setInputTablesLoading(true);
      inputTables.setDatasetPage(page);
    },
    [inputTables, ui]
  );

  const handleOutputPageChange = useCallback(
    (page: number) => {
      ui.setLoadingTab('output_tables');
      dashboard.setOutputPage(page);
    },
    [dashboard, ui]
  );

  const isInputTableEditor = Boolean(
    editors.editingInputTableDraft || editors.editingInputTableDataset
  );
  const isTasksLoading =
    ui.loadingTab === 'tasks' || (activeTab === 'tasks' && ui.pendingNavigationTab === 'tasks');
  const isInputTablesLoading =
    inputTables.inputTablesLoading ||
    ui.loadingTab === 'input_tables' ||
    (activeTab === 'input_tables' && ui.pendingNavigationTab === 'input_tables');
  const isOutputTablesLoading =
    ui.loadingTab === 'output_tables' ||
    (activeTab === 'output_tables' && ui.pendingNavigationTab === 'output_tables');

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

        {editors.editingTask ? (
          <TaskEditor
            task={editors.editingTask}
            outputTables={dashboard.dashboard.outputTables}
            actionId={actionId}
            runNodeStats={dashboard.runNodeStats}
            onBack={actions.handleCloseTaskEditor}
            onRun={actions.handleRunTask}
            onWorkflowSaved={() => dashboard.loadDashboard({ preserveError: true })}
          />
        ) : editors.editingInputTableDraft ? (
          <InputTableEditor
            draft={editors.editingInputTableDraft}
            isBusy={actionId === editors.editingInputTableDraft.id}
            onBack={() => editors.setEditingInputTableDraftId(null)}
            onRenameDraft={actions.handleRenameInputTableDraft}
            onChooseDraftSource={actions.handleImportInputTableSource}
          />
        ) : editors.editingInputTableDataset ? (
          <InputTableEditor
            dataset={editors.editingInputTableDataset}
            isBusy={actionId === editors.editingInputTableDataset.id}
            onBack={() => editors.setEditingInputTableDatasetId(null)}
            onRenameDataset={actions.handleRenameInputTableDataset}
            onChooseDatasetSource={actions.handleUpdateInputTableSource}
            onUpdateDatasetConfig={actions.handleUpdateInputTableConfig}
          />
        ) : editors.editingOutputTable ? (
          <OutputTableEditor
            outputTable={editors.editingOutputTable}
            inputTables={editors.outputEditorInputTables}
            isInputTablesLoading={editors.outputEditorInputTablesLoading}
            isBusy={actionId === editors.editingOutputTable.id}
            onBack={() => editors.setEditingOutputTableId(null)}
            onSave={actions.handleUpdateOutputTable}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="flex min-h-0 flex-1 flex-col">
              <Tabs
                value={activeTab}
                onValueChange={(v) => handleTabChange(v as DataTab)}
                className="contents"
              >
                <div className="mb-2 flex min-h-10 flex-shrink-0 flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
                  <TabsList className="inline-flex items-end gap-5 rounded-none border-0 bg-transparent p-0">
                    {(
                      [
                        ['tasks', 'data.tabs.tasks'],
                        ['input_tables', 'data.tabs.inputTables'],
                        ['output_tables', 'data.tabs.outputTables'],
                        ['cloud_analysis', 'data.tabs.cloudAnalysis'],
                      ] as const
                    ).map(([value, key]) => (
                      <TabsTrigger key={value} value={value} className={underlineTabTriggerClass}>
                        {t(key)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <TabsContent value="tasks" className="contents">
                  <TasksPanel
                    tasks={dashboard.dashboard.tasks}
                    totalTasks={dashboard.dashboard.totalTasks}
                    currentPage={dashboard.taskPage}
                    searchQuery={searchQuery}
                    actionId={actionId}
                    isLoading={isTasksLoading}
                    isCreateDisabled={!isDataApiAvailable || actionId === 'create'}
                    onCreate={actions.handleCreateTask}
                    onSearchChange={handleSearchChange}
                    onRefresh={() => dashboard.loadDashboard({ preserveError: true, tab: 'tasks' })}
                    onPageChange={handleTaskPageChange}
                    onRun={actions.handleRunTask}
                    onEdit={actions.handleEditTask}
                    onDelete={actions.handleDeleteTask}
                    onDeleteAll={actions.handleDeleteAllTasks}
                  />
                </TabsContent>
                <TabsContent value="input_tables" className="min-h-0 flex-1 bg-transparent">
                  <InputTablesPanel
                    datasets={inputTables.inputTableDatasets}
                    drafts={drafts.drafts}
                    totalDatasets={inputTables.totalInputTableDatasets}
                    currentPage={inputTables.datasetPage}
                    searchQuery={searchQuery}
                    isLoading={isInputTablesLoading}
                    sourceFilter={ui.inputTableSourceFilter}
                    onSearchChange={handleSearchChange}
                    onSourceFilterChange={handleInputTableSourceFilterChange}
                    onPageChange={handleDatasetPageChange}
                    onCreate={actions.handleCreateInputTableDraft}
                    onRefresh={() => inputTables.loadInputTables({ preserveError: true })}
                    onPreviewDataset={preview.previewInputTable}
                    onDelete={actions.handleDeleteInputTable}
                    onDeleteAll={actions.handleDeleteAllInputTables}
                    onDeleteDraft={actions.handleDeleteInputTableDraft}
                    onEditDraft={editors.setEditingInputTableDraftId}
                    onEditDataset={actions.handleEditInputTableDataset}
                    isCreateDisabled={!isDataApiAvailable}
                    actionId={actionId}
                  />
                </TabsContent>
                <TabsContent value="output_tables" className="min-h-0 flex-1 bg-transparent">
                  <OutputTablesPanel
                    outputTables={dashboard.dashboard.outputTables}
                    totalOutputTables={dashboard.dashboard.totalOutputTables}
                    currentPage={dashboard.outputPage}
                    searchQuery={searchQuery}
                    isLoading={isOutputTablesLoading}
                    actionId={actionId}
                    isCreateDisabled={!isDataApiAvailable || actionId === 'create-output'}
                    onCreate={actions.handleCreateOutputTable}
                    onSearchChange={handleSearchChange}
                    onRefresh={() =>
                      dashboard.loadDashboard({ preserveError: true, tab: 'output_tables' })
                    }
                    onPageChange={handleOutputPageChange}
                    onPreview={preview.previewOutputTable}
                    onUpload={(outputTable) => editors.setUploadCloudOutputTable(outputTable)}
                    onEdit={(outputTable) => editors.setEditingOutputTableId(outputTable.id)}
                    onDelete={actions.handleDeleteOutputTable}
                    onDeleteAll={actions.handleDeleteAllOutputTables}
                  />
                </TabsContent>
                <TabsContent value="cloud_analysis" className="min-h-0 flex-1 bg-transparent">
                  <CloudAnalysisPanel />
                </TabsContent>
              </Tabs>
            </section>
            {preview.storedPreviewOpen && (
              <InputTablePreviewDialog
                tableKind={preview.storedPreviewTarget?.kind ?? 'input'}
                preview={preview.storedPreviewData}
                isLoading={preview.storedPreviewLoading}
                error={preview.storedPreviewError}
                currentPage={preview.storedPreviewPage}
                onPageChange={(page) => {
                  if (preview.storedPreviewTarget?.kind === 'input') {
                    void preview.previewInputTable(preview.storedPreviewTarget.dataset, page);
                  } else if (preview.storedPreviewTarget?.kind === 'output') {
                    void preview.previewOutputTable(preview.storedPreviewTarget.outputTable, page);
                  }
                }}
                onClose={preview.close}
              />
            )}
            {editors.uploadCloudOutputTable && (
              <UploadOutputTableToCloudDialog
                outputTable={editors.uploadCloudOutputTable}
                onClose={() => editors.setUploadCloudOutputTable(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
