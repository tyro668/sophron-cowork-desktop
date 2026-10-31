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
import { PipelineEditor, PipelinesPanel } from '../../../components/data-view/data-pipelines';
import {
  RawTableEditor,
  RawTablePreviewDialog,
  RawTablesPanel,
} from '../../../components/data-view/raw-tables';
import { ResultTableEditor, ResultTablesPanel } from '../../../components/data-view/result-tables';
import {
  TabBarActionSlot,
  underlineTabBarClass,
  useTabBarActionSlot,
  underlineTabListClass,
  fixedUnderlineTabTriggerClass,
} from '../../../components/data-view/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { dataClient } from '../api/data-client';
import { useDataViewUi } from '../hooks/use-data-view-ui';
import { useDataDashboard } from '../hooks/use-data-dashboard';
import { useRawTables } from '../hooks/use-raw-tables';
import { useRawTableDrafts } from '../hooks/use-raw-table-drafts';
import { useDataViewEditors } from '../hooks/use-data-view-editors';
import { useStoredPreview } from '../hooks/use-stored-preview';
import { useDataActions } from '../hooks/use-data-actions';
import { useDataNavigation } from '../hooks/use-data-navigation';
import type {
  DataRawSource,
  DataRawSourceBuildMode,
  DataRawSourceCreateResult,
  DataRawTable,
} from '../../../types';
import { RawSourceWizard } from '../../../components/data-view/raw-source-wizard';
import { RawSourceDetail } from '../../../components/data-view/raw-source-detail';
import { useRawSourceRefresh } from '../../../components/data-view/raw-source-refresh-dialog';
import { useAppStore } from '../../../store';
import { DataPipelineAiGenerateDialog } from '../../../components/data-view/data-pipelines/DataPipelineAiGenerateDialog';
import type { DataTab } from '../model/types';

export function DataViewPage() {
  const { t } = useTranslation();
  const tabBarAction = useTabBarActionSlot();
  const { confirmDelete } = useConfirmDialog();
  const isDataApiAvailable = dataClient.isAvailable();

  const [aiPipelineRequest, setAiPipelineRequest] = useState<{ input?: DataRawTable } | null>(null);
  const generatePipelineFromTable = (input: DataRawTable) => setAiPipelineRequest({ input });
  const ui = useDataViewUi();
  const drafts = useRawTableDrafts();
  const dashboard = useDataDashboard({
    activeTab: ui.activeTab,
    searchQuery: ui.searchQuery,
    setError: ui.setError,
    setLoadingTab: ui.setLoadingTab,
    setPendingNavigationTab: ui.setPendingNavigationTab,
  });
  const rawTables = useRawTables({
    searchQuery: ui.searchQuery,
    draftsCount: drafts.drafts.length,
    setError: ui.setError,
    setLoadingTab: ui.setLoadingTab,
    setPendingNavigationTab: ui.setPendingNavigationTab,
    setGroups: dashboard.setGroups,
  });
  const editors = useDataViewEditors({
    pipelines: dashboard.dashboard.pipelines,
    rawTables: rawTables.rawTables,
    resultTables: dashboard.dashboard.resultTables,
    drafts: drafts.drafts,
    setError: ui.setError,
  });
  const preview = useStoredPreview();
  const actions = useDataActions({
    ui,
    dashboard,
    rawTables,
    drafts,
    editors,
    t,
    confirmDelete,
  });
  useDataNavigation({
    ui,
    dashboard,
    rawTables,
    editors,
    preview,
    isDataApiAvailable,
    t,
  });

  const { activeTab, searchQuery, error, actionId } = ui;
  const navigateToAutomation = useAppStore((state) => state.navigateToTableAutomation);
  const [sourceWizard, setSourceWizard] = useState<{
    rebuild?: { source: DataRawSource; buildMode: DataRawSourceBuildMode };
  } | null>(null);
  const [rawSources, setRawSources] = useState<DataRawSource[]>([]);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [openSourceTableId, setOpenSourceTableId] = useState<string | null>(null);
  const [sourceTables, setSourceTables] = useState<DataRawTable[]>([]);
  const [editorInitialTab, setEditorInitialTab] = useState<'data' | undefined>(undefined);
  const loadRawSources = useCallback(async () => {
    if (!isDataApiAvailable || !dataClient.has('listRawSources')) return;
    try {
      setRawSources(await dataClient.listRawSources());
    } catch {
      setRawSources([]);
    }
  }, [isDataApiAvailable]);
  useEffect(() => {
    void loadRawSources();
  }, [loadRawSources, rawTables.rawTables]);
  useEffect(() => {
    if (!editors.editingRawTableId) setEditorInitialTab(undefined);
  }, [editors.editingRawTableId]);
  const openSource = rawSources.find((source) => source.id === openSourceId) ?? null;
  useEffect(() => {
    if (!openSource) return;
    let cancelled = false;
    void Promise.all(
      openSource.memberIds.map((id) => dataClient.getRawTable(id).catch(() => null))
    ).then((tables) => {
      if (!cancelled) setSourceTables(tables.filter((table): table is DataRawTable => !!table));
    });
    return () => {
      cancelled = true;
    };
  }, [openSource]);
  const openRawTableOnData = (table: DataRawTable) => {
    editors.setFocusedRawTable(table);
    editors.setEditingRawTableDraftId(null);
    setEditorInitialTab('data');
    editors.setEditingRawTableId(table.id);
  };
  const sourceRefresh = useRawSourceRefresh(() => {
    void loadRawTables({ preserveError: true });
    void loadRawSources();
  });
  const handleRefreshSource = (source: DataRawSource) => sourceRefresh.refresh(source.id);
  const refreshingSourceId = sourceRefresh.refreshingId;

  const pipelineGroups = useMemo(
    () => dashboard.dashboard.groups.filter((group) => group.scope === 'pipeline'),
    [dashboard.dashboard.groups]
  );
  const inputGroups = useMemo(
    () => dashboard.dashboard.groups.filter((group) => group.scope === 'raw'),
    [dashboard.dashboard.groups]
  );
  const outputGroups = useMemo(
    () => dashboard.dashboard.groups.filter((group) => group.scope === 'result'),
    [dashboard.dashboard.groups]
  );
  const { setPendingNavigationTab, setLoadingTab, setError } = ui;
  const { loadDashboard, invalidateRequests } = dashboard;
  const { loadRawTables } = rawTables;
  useDataWorkspaceActivation(() => {
    if (!isDataApiAvailable) return;
    if (activeTab === 'raw_tables') void loadRawTables();
    else void loadDashboard({ preserveError: true });
  });

  useEffect(() => {
    if (error) {
      showToast('error', error);
      setError(null);
    }
  }, [error, setError]);

  // Auto-load: react to tab/search changes with a two-frame delay so the tab
  // switch paints before the fetch starts; pipeline search debounces 180ms.
  // `loadDashboard`/`loadRawTables` identities change on page/filter changes,
  // so pagination and source filters reload through this effect too.
  useEffect(() => {
    if (!isDataApiAvailable) {
      setPendingNavigationTab(null);
      setLoadingTab(null);
      return;
    }
    invalidateRequests();
    const delay = activeTab === 'pipelines' && searchQuery ? 180 : 0;
    let timer: number | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          if (activeTab === 'raw_tables') {
            void loadRawTables();
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
    loadRawTables,
    setPendingNavigationTab,
    setLoadingTab,
  ]);

  const handleSearchChange = useCallback(
    (value: string) => {
      ui.setLoadingTab(activeTab);
      if (activeTab === 'raw_tables') {
        rawTables.setRawTablesLoading(true);
        rawTables.setRawTablePage(1);
      } else if (activeTab === 'result_tables') {
        dashboard.setOutputPage(1);
      } else {
        dashboard.setPipelinePage(1);
      }
      ui.setSearchQuery(value);
    },
    [activeTab, dashboard, rawTables, ui]
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

  const isPipelinesLoading =
    ui.loadingTab === 'pipelines' ||
    (activeTab === 'pipelines' && ui.pendingNavigationTab === 'pipelines');
  const isRawTablesLoading =
    rawTables.rawTablesLoading ||
    ui.loadingTab === 'raw_tables' ||
    (activeTab === 'raw_tables' && ui.pendingNavigationTab === 'raw_tables');
  const isResultTablesLoading =
    ui.loadingTab === 'result_tables' ||
    (activeTab === 'result_tables' && ui.pendingNavigationTab === 'result_tables');

  // Inline 组织方式 change saved: the old tables are gone — land on the rebuilt source
  // (its detail page for several tables, the table editor for one).
  const handleBuildModeRebuilt = (result: DataRawSourceCreateResult) => {
    void loadRawTables({ preserveError: true });
    void loadRawSources();
    const [only, ...rest] = result.tables;
    if (only && rest.length === 0) {
      setOpenSourceId(null);
      editors.setFocusedRawTable(only);
      editors.setEditingRawTableId(only.id);
    } else {
      editors.setEditingRawTableId(null);
      setOpenSourceTableId(null);
      setOpenSourceId(result.source.id);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-transparent">
      <div className="flex h-full min-h-0 w-full flex-col">
        {sourceRefresh.dialog}
        {sourceWizard ? (
          <RawSourceWizard
            key={sourceWizard.rebuild ? `rebuild:${sourceWizard.rebuild.source.id}` : 'new'}
            rebuild={sourceWizard.rebuild}
            onBack={() => setSourceWizard(null)}
            onOpenCloud={() => {
              setSourceWizard(null);
              navigateToAutomation({ newRawTableName: '' });
            }}
            onCreated={() => {
              // A rebuild deletes the tables that were open behind the wizard.
              if (sourceWizard.rebuild) {
                editors.setEditingRawTableId(null);
                setOpenSourceId(null);
              }
              void loadRawTables({ preserveError: true });
              void loadRawSources();
            }}
            onOpenData={(tableId) => {
              void dataClient.getRawTable(tableId).then((table) => {
                setSourceWizard(null);
                setOpenSourceId(null);
                if (table) openRawTableOnData(table);
              });
            }}
            onCreatePipeline={(tableId) => {
              void dataClient.getRawTable(tableId).then((table) => {
                setSourceWizard(null);
                if (table) actions.handleCreatePipelineFromTable(table);
              });
            }}
          />
        ) : editors.editingPipeline ? (
          <PipelineEditor
            pipeline={editors.editingPipeline}
            resultTables={dashboard.dashboard.resultTables}
            actionId={actionId}
            runNodeStats={dashboard.runNodeStats}
            lastRunFailure={dashboard.lastRunFailure}
            autoEditTitle={editors.pipelineNameEditRequested}
            onBack={actions.handleClosePipelineEditor}
            onRun={actions.handleRunPipeline}
            onWorkflowSaved={() => dashboard.loadDashboard({ preserveError: true })}
          />
        ) : editors.editingRawTableDraft ? (
          <RawTableEditor
            draft={editors.editingRawTableDraft}
            isBusy={actionId === editors.editingRawTableDraft.id}
            onBack={() => editors.setEditingRawTableDraftId(null)}
            onRenameDraft={actions.handleRenameRawTableDraft}
            onChooseDraftSource={actions.handleImportRawTableSource}
          />
        ) : editors.editingRawTable ? (
          <RawTableEditor
            rawTable={editors.editingRawTable}
            isBusy={actionId === editors.editingRawTable.id}
            onBack={() => editors.setEditingRawTableId(null)}
            onRenameRawTable={actions.handleRenameRawTable}
            onChooseRawTableSource={actions.handleUpdateRawTableSource}
            onUpdateRawTableConfig={actions.handleUpdateRawTableConfig}
            onSyncCloudSource={actions.handleRefreshCloudRawTable}
            onRefreshSource={actions.handleRefreshRawTable}
            onDelete={actions.handleDeleteRawTable}
            initialViewTab={editorInitialTab}
            rawSource={
              rawSources.find((source) => source.id === editors.editingRawTable?.sourceId) ?? null
            }
            onBuildModeRebuilt={handleBuildModeRebuilt}
          />
        ) : openSource ? (
          <RawSourceDetail
            key={openSource.id}
            initialTableId={openSourceTableId ?? undefined}
            source={openSource}
            rawTables={sourceTables}
            onBack={() => setOpenSourceId(null)}
            onOpenTable={(table) => {
              setEditorInitialTab(undefined);
              editors.setFocusedRawTable(table);
              editors.setEditingRawTableId(table.id);
            }}
            onRebuilt={handleBuildModeRebuilt}
            onChanged={() => {
              void loadRawTables({ preserveError: true });
              void loadRawSources();
            }}
          />
        ) : editors.editingResultTable ? (
          <ResultTableEditor
            resultTable={editors.editingResultTable}
            rawTables={editors.outputEditorRawTables}
            isRawTablesLoading={editors.outputEditorRawTablesLoading}
            isBusy={actionId === editors.editingResultTable.id}
            pipelines={dashboard.dashboard.pipelines}
            onBack={() => editors.setEditingResultTableId(null)}
            onSave={actions.handleUpdateResultTable}
            onRunPipeline={actions.handleRunPipeline}
            onDelete={actions.handleDeleteResultTable}
            onOpenPipeline={(pipeline) => {
              editors.setEditingResultTableId(null);
              actions.handleEditPipeline(pipeline);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="flex min-h-0 flex-1 flex-col">
              <tabBarAction.Provider value={tabBarAction.slot}>
                <Tabs
                  value={activeTab}
                  onValueChange={(v) => handleTabChange(v as DataTab)}
                  className="contents"
                >
                  <div className={underlineTabBarClass}>
                    <TabsList className={underlineTabListClass}>
                      {(
                        [
                          ['pipelines', 'data.tabs.pipelines'],
                          ['raw_tables', 'data.tabs.rawTables'],
                          ['result_tables', 'data.tabs.resultTables'],
                          ['cloud_analysis', 'data.tabs.cloudAnalysis'],
                        ] as const
                      ).map(([value, key]) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          className={fixedUnderlineTabTriggerClass}
                          title={t(key)}
                          data-fixed-tab
                        >
                          <span className="truncate">{t(key)}</span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    <TabBarActionSlot slotRef={tabBarAction.slotRef} />
                  </div>

                  <TabsContent value="pipelines" className="contents">
                    <PipelinesPanel
                      pipelines={dashboard.dashboard.pipelines}
                      totalPipelines={dashboard.dashboard.totalPipelines}
                      groups={pipelineGroups}
                      groupCounts={dashboard.dashboard.pipelineGroupCounts}
                      groupPages={dashboard.pipelineGroupPages}
                      searchQuery={searchQuery}
                      actionId={actionId}
                      isLoading={isPipelinesLoading}
                      isCreateDisabled={!isDataApiAvailable || actionId === 'create'}
                      onCreate={actions.handleCreatePipeline}
                      onSearchChange={handleSearchChange}
                      onRefresh={() =>
                        dashboard.loadDashboard({ preserveError: true, tab: 'pipelines' })
                      }
                      onGroupPageChange={dashboard.setPipelineGroupPage}
                      onRun={actions.handleRunPipeline}
                      onEdit={actions.handleEditPipeline}
                      onDelete={actions.handleDeletePipeline}
                      onDeleteAll={actions.handleDeleteAllPipelines}
                      onAssignToGroup={(ids, target) =>
                        actions.handleAssignToGroup('pipeline', ids, target)
                      }
                      onRenameGroup={(group, name) =>
                        actions.handleRenameGroup('pipeline', group, name)
                      }
                      onDeleteGroup={(group) => actions.handleDeleteGroup('pipeline', group)}
                    />
                  </TabsContent>
                  <TabsContent value="raw_tables" className="min-h-0 flex-1 bg-transparent">
                    <RawTablesPanel
                      rawTables={rawTables.rawTables}
                      drafts={drafts.drafts}
                      groups={inputGroups}
                      groupCounts={rawTables.rawTableGroupCounts}
                      groupPages={rawTables.rawTableGroupPages}
                      totalRawTables={rawTables.totalRawTables}
                      searchQuery={searchQuery}
                      isLoading={isRawTablesLoading}
                      onSearchChange={handleSearchChange}
                      onCreate={() =>
                        dataClient.has('createRawSource')
                          ? setSourceWizard({})
                          : actions.handleCreateRawTableDraft()
                      }
                      sources={rawSources}
                      onOpenSource={(source, tableId) => {
                        setOpenSourceTableId(tableId ?? null);
                        setOpenSourceId(source.id);
                      }}
                      onRefreshSource={(source) => void handleRefreshSource(source)}
                      onRefresh={() => rawTables.loadRawTables({ preserveError: true })}
                      onPreviewRawTable={preview.previewRawTable}
                      onDelete={actions.handleDeleteRawTable}
                      onDeleteAll={actions.handleDeleteAllRawTables}
                      onDeleteDraft={actions.handleDeleteRawTableDraft}
                      onEditDraft={editors.setEditingRawTableDraftId}
                      onEditRawTable={actions.handleEditRawTable}
                      onCreatePipelineFromTable={actions.handleCreatePipelineFromTable}
                      onAiGeneratePipelineFromTable={generatePipelineFromTable}
                      onAssignToGroup={(ids, target) =>
                        actions.handleAssignToGroup('raw', ids, target)
                      }
                      onRenameGroup={(group, name) => actions.handleRenameGroup('raw', group, name)}
                      onDeleteGroup={(group) => actions.handleDeleteGroup('raw', group)}
                      onGroupPageChange={rawTables.setRawTableGroupPage}
                      isCreateDisabled={!isDataApiAvailable}
                      actionId={
                        refreshingSourceId ? `refresh-source:${refreshingSourceId}` : actionId
                      }
                    />
                  </TabsContent>
                  <TabsContent value="result_tables" className="min-h-0 flex-1 bg-transparent">
                    <ResultTablesPanel
                      resultTables={dashboard.dashboard.resultTables}
                      totalResultTables={dashboard.dashboard.totalResultTables}
                      groups={outputGroups}
                      groupCounts={dashboard.dashboard.outputGroupCounts}
                      groupPages={dashboard.outputGroupPages}
                      searchQuery={searchQuery}
                      isLoading={isResultTablesLoading}
                      actionId={actionId}
                      isCreateDisabled={!isDataApiAvailable || actionId === 'create-output'}
                      onCreate={actions.handleCreateResultTable}
                      onSearchChange={handleSearchChange}
                      onRefresh={() =>
                        dashboard.loadDashboard({ preserveError: true, tab: 'result_tables' })
                      }
                      onGroupPageChange={dashboard.setOutputGroupPage}
                      onPreview={preview.previewResultTable}
                      onEdit={(resultTable) => editors.setEditingResultTableId(resultTable.id)}
                      onDelete={actions.handleDeleteResultTable}
                      onDeleteAll={actions.handleDeleteAllResultTables}
                      onAssignToGroup={(ids, target) =>
                        actions.handleAssignToGroup('result', ids, target)
                      }
                      onRenameGroup={(group, name) =>
                        actions.handleRenameGroup('result', group, name)
                      }
                      onDeleteGroup={(group) => actions.handleDeleteGroup('result', group)}
                    />
                  </TabsContent>
                  <TabsContent value="cloud_analysis" className="min-h-0 flex-1 bg-transparent">
                    <CloudAnalysisPanel />
                  </TabsContent>
                </Tabs>
              </tabBarAction.Provider>
            </section>
            {preview.storedPreviewOpen && (
              <RawTablePreviewDialog
                tableKind={preview.storedPreviewTarget?.kind ?? 'raw'}
                preview={preview.storedPreviewData}
                isLoading={preview.storedPreviewLoading}
                error={preview.storedPreviewError}
                currentPage={preview.storedPreviewPage}
                onPageChange={(page) => {
                  if (preview.storedPreviewTarget?.kind === 'raw') {
                    void preview.previewRawTable(preview.storedPreviewTarget.rawTable, page);
                  } else if (preview.storedPreviewTarget?.kind === 'result') {
                    void preview.previewResultTable(preview.storedPreviewTarget.resultTable, page);
                  }
                }}
                onClose={preview.close}
              />
            )}
          </div>
        )}
      </div>
      <DataPipelineAiGenerateDialog
        onApplied={actions.handleGeneratedPipeline}
        open={aiPipelineRequest !== null}
        boundRawTable={
          aiPipelineRequest?.input
            ? { id: aiPipelineRequest.input.id, name: aiPipelineRequest.input.name }
            : null
        }
        onOpenChange={(open) => {
          if (!open) setAiPipelineRequest(null);
        }}
      />
    </div>
  );
}
