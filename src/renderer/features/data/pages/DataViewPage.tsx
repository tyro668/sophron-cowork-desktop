import { useDataWorkspaceActivation } from '../hooks/use-data-workspace-activation';
/**
 * Data workspace page — composition layer. Wires the domain hooks together
 * (ui / server state / editor state / preview / actions / navigation) and
 * renders the tabbed workspace. Components below only receive state and
 * action callbacks; every IPC call lives in `features/data/api/data-client`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../../utils/toast';
import { useConfirmDialog } from '../../../components/ConfirmDialog';
import { CloudAnalysisPanel } from '../../../components/data-view/cloud-analysis';
import { TaskEditor, TasksPanel } from '../../../components/data-view/data-tasks';
import {
  InputTableEditor,
  InputTablePreviewDialog,
  InputTablesPanel,
} from '../../../components/data-view/input-tables';
import { OutputTableEditor, OutputTablesPanel } from '../../../components/data-view/output-tables';
import {
  underlineTabBarClass,
  underlineTabListClass,
  underlineTabTriggerClass,
} from '../../../components/data-view/shared';
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
import type { DataDataset } from '../../../types';
import { DataTaskAiGenerateDialog } from '../../../components/data-view/data-tasks/DataTaskAiGenerateDialog';
import type { DataTab } from '../model/types';

export function DataViewPage() {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const isDataApiAvailable = dataClient.isAvailable();

  const [aiTaskRequest, setAiTaskRequest] = useState<{ input?: DataDataset } | null>(null);
  const generateTaskFromTable = (input: DataDataset) => setAiTaskRequest({ input });
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
    draftsCount: drafts.drafts.length,
    setError: ui.setError,
    setLoadingTab: ui.setLoadingTab,
    setPendingNavigationTab: ui.setPendingNavigationTab,
    setGroups: dashboard.setGroups,
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
  const taskGroups = useMemo(
    () => dashboard.dashboard.groups.filter((group) => group.scope === 'task'),
    [dashboard.dashboard.groups]
  );
  const inputGroups = useMemo(
    () => dashboard.dashboard.groups.filter((group) => group.scope === 'input'),
    [dashboard.dashboard.groups]
  );
  const outputGroups = useMemo(
    () => dashboard.dashboard.groups.filter((group) => group.scope === 'output'),
    [dashboard.dashboard.groups]
  );
  const { setPendingNavigationTab, setLoadingTab, setError } = ui;
  const { loadDashboard, invalidateRequests } = dashboard;
  const { loadInputTables } = inputTables;
  useDataWorkspaceActivation(() => {
    if (!isDataApiAvailable) return;
    if (activeTab === 'input_tables') void loadInputTables();
    else void loadDashboard({ preserveError: true });
  });

  useEffect(() => {
    if (error) {
      showToast('error', error);
      setError(null);
    }
  }, [error, setError]);

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
      <div className="flex h-full min-h-0 w-full flex-col">
        {editors.editingTask ? (
          <TaskEditor
            task={editors.editingTask}
            outputTables={dashboard.dashboard.outputTables}
            actionId={actionId}
            runNodeStats={dashboard.runNodeStats}
            lastRunFailure={dashboard.lastRunFailure}
            autoEditTitle={editors.taskNameEditRequested}
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
            onCreateTask={actions.handleCreateTaskFromTable}
            onAiGenerateTask={generateTaskFromTable}
            onSyncCloudSource={actions.handleRefreshCloudInputTable}
          />
        ) : editors.editingOutputTable ? (
          <OutputTableEditor
            outputTable={editors.editingOutputTable}
            inputTables={editors.outputEditorInputTables}
            isInputTablesLoading={editors.outputEditorInputTablesLoading}
            isBusy={actionId === editors.editingOutputTable.id}
            tasks={dashboard.dashboard.tasks}
            onBack={() => editors.setEditingOutputTableId(null)}
            onSave={actions.handleUpdateOutputTable}
            onRunTask={actions.handleRunTask}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="flex min-h-0 flex-1 flex-col">
              <Tabs
                value={activeTab}
                onValueChange={(v) => handleTabChange(v as DataTab)}
                className="contents"
              >
                <div className={underlineTabBarClass}>
                  <TabsList className={underlineTabListClass}>
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
                    groups={taskGroups}
                    groupCounts={dashboard.dashboard.taskGroupCounts}
                    groupPages={dashboard.taskGroupPages}
                    searchQuery={searchQuery}
                    actionId={actionId}
                    isLoading={isTasksLoading}
                    isCreateDisabled={!isDataApiAvailable || actionId === 'create'}
                    onCreate={actions.handleCreateTask}
                    onSearchChange={handleSearchChange}
                    onRefresh={() => dashboard.loadDashboard({ preserveError: true, tab: 'tasks' })}
                    onGroupPageChange={dashboard.setTaskGroupPage}
                    onRun={actions.handleRunTask}
                    onEdit={actions.handleEditTask}
                    onDelete={actions.handleDeleteTask}
                    onDeleteAll={actions.handleDeleteAllTasks}
                    onAssignToGroup={(ids, target) =>
                      actions.handleAssignToGroup('task', ids, target)
                    }
                    onRenameGroup={(group, name) => actions.handleRenameGroup('task', group, name)}
                    onDeleteGroup={(group) => actions.handleDeleteGroup('task', group)}
                  />
                </TabsContent>
                <TabsContent value="input_tables" className="min-h-0 flex-1 bg-transparent">
                  <InputTablesPanel
                    datasets={inputTables.inputTableDatasets}
                    drafts={drafts.drafts}
                    groups={inputGroups}
                    groupCounts={inputTables.inputTableGroupCounts}
                    groupPages={inputTables.datasetGroupPages}
                    totalDatasets={inputTables.totalInputTableDatasets}
                    searchQuery={searchQuery}
                    isLoading={isInputTablesLoading}
                    onSearchChange={handleSearchChange}
                    onCreate={actions.handleCreateInputTableDraft}
                    onRefresh={() => inputTables.loadInputTables({ preserveError: true })}
                    onPreviewDataset={preview.previewInputTable}
                    onDelete={actions.handleDeleteInputTable}
                    onDeleteAll={actions.handleDeleteAllInputTables}
                    onDeleteDraft={actions.handleDeleteInputTableDraft}
                    onEditDraft={editors.setEditingInputTableDraftId}
                    onEditDataset={actions.handleEditInputTableDataset}
                    onCreateTaskFromTable={actions.handleCreateTaskFromTable}
                    onAiGenerateTaskFromTable={generateTaskFromTable}
                    onAssignToGroup={(ids, target) =>
                      actions.handleAssignToGroup('input', ids, target)
                    }
                    onRenameGroup={(group, name) => actions.handleRenameGroup('input', group, name)}
                    onDeleteGroup={(group) => actions.handleDeleteGroup('input', group)}
                    onGroupPageChange={inputTables.setDatasetGroupPage}
                    isCreateDisabled={!isDataApiAvailable}
                    actionId={actionId}
                  />
                </TabsContent>
                <TabsContent value="output_tables" className="min-h-0 flex-1 bg-transparent">
                  <OutputTablesPanel
                    outputTables={dashboard.dashboard.outputTables}
                    totalOutputTables={dashboard.dashboard.totalOutputTables}
                    groups={outputGroups}
                    groupCounts={dashboard.dashboard.outputGroupCounts}
                    groupPages={dashboard.outputGroupPages}
                    searchQuery={searchQuery}
                    isLoading={isOutputTablesLoading}
                    actionId={actionId}
                    isCreateDisabled={!isDataApiAvailable || actionId === 'create-output'}
                    onCreate={actions.handleCreateOutputTable}
                    onSearchChange={handleSearchChange}
                    onRefresh={() =>
                      dashboard.loadDashboard({ preserveError: true, tab: 'output_tables' })
                    }
                    onGroupPageChange={dashboard.setOutputGroupPage}
                    onPreview={preview.previewOutputTable}
                    onEdit={(outputTable) => editors.setEditingOutputTableId(outputTable.id)}
                    onDelete={actions.handleDeleteOutputTable}
                    onDeleteAll={actions.handleDeleteAllOutputTables}
                    onAssignToGroup={(ids, target) =>
                      actions.handleAssignToGroup('output', ids, target)
                    }
                    onRenameGroup={(group, name) =>
                      actions.handleRenameGroup('output', group, name)
                    }
                    onDeleteGroup={(group) => actions.handleDeleteGroup('output', group)}
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
          </div>
        )}
      </div>
      <DataTaskAiGenerateDialog
        onApplied={actions.handleGeneratedTask}
        open={aiTaskRequest !== null}
        boundInputTable={
          aiTaskRequest?.input
            ? { id: aiTaskRequest.input.id, name: aiTaskRequest.input.name }
            : null
        }
        onOpenChange={(open) => {
          if (!open) setAiTaskRequest(null);
        }}
      />
    </div>
  );
}
