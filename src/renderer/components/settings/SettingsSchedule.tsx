import { formatIpcError } from '../../utils/ipc-error';
import { loadDataPipelineResources } from '../../features/data/api/data-pipeline-resources';
import { automationClient } from '../../features/automation/api/automation-client';
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmDialog } from '../ConfirmDialog';
import { showToast } from '../../utils/toast';
import type {
  Automation,
  AutomationActionDefinitionSummary,
  AutomationCreateInput,
  AutomationGroup,
  DataDashboard,
} from '../../types';
import { buildGroupSections } from '../data-view/group-ui';
import type { AssignGroupTarget, DataListGroup } from '../data-view/group-ui';
import { useAppStore } from '../../store';
import type { DataResourceTarget } from '../../../shared/data-resource-link';
import {
  AUTOMATION_TABLE_PAGE_SIZE,
  type AutomationDraft,
  type AutomationRunLogEntry,
  type Banner,
  type ListTab,
  isElectron,
} from './schedule/types';
import {
  automationToDraft,
  createCloudTableAutomationDraft,
  createEmptyDraft,
  draftToPayload,
  parsePendingCloudAutomationTemplate,
} from './schedule/model';
import { AutomationListPanel, AutomationRunLogPanel, getRunSortTime } from './schedule/listPanels';
import {
  TabBarActionSlot,
  underlineTabBarClass,
  useTabBarActionSlot,
  underlineTabListClass,
  fixedUnderlineTabTriggerClass,
} from '../data-view/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { AutomationDetailView } from './schedule/AutomationDetailView';
import {
  buildTableNavigationDraft,
  computeUnsavedDraftParts,
  prependMissingCloudInputNode,
  validateAutomationDraft,
} from './schedule/draft-navigation';

export function SettingsSchedule({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const outputNavigation = useAppStore((state) => state.pendingTableAutomationNavigation);
  const clearOutputNavigation = useAppStore((state) => state.clearTableAutomationNavigation);
  const projects = useAppStore((state) => state.projects);
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
  const appConfig = useAppStore((state) => state.appConfig);
  const pendingCloudAutomationTemplateNavigation = useAppStore(
    (state) => state.pendingCloudAutomationTemplateNavigation
  );
  const clearCloudAutomationTemplateNavigation = useAppStore(
    (state) => state.clearCloudAutomationTemplateNavigation
  );
  const tr = useCallback(
    (key: string, fallback?: string) =>
      fallback !== undefined ? t(key, { defaultValue: fallback }) : t(key),
    [t]
  );
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationGroupCounts, setAutomationGroupCounts] = useState<Record<string, number>>({});
  const [automationGroupPages, setAutomationGroupPages] = useState<Record<string, number>>({});
  const [automationGroups, setAutomationGroups] = useState<AutomationGroup[]>([]);
  const [actionDefinitions, setActionDefinitions] = useState<AutomationActionDefinitionSummary[]>(
    []
  );
  const [dataDashboard, setDataDashboard] = useState<DataDashboard | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [tableReturnTarget, setTableReturnTarget] = useState<DataResourceTarget | null>(null);
  const [activeListTab, setActiveListTab] = useState<ListTab>('automations');
  const tabBarAction = useTabBarActionSlot();
  const [automationRunLogs, setAutomationRunLogs] = useState<AutomationRunLogEntry[]>([]);
  const [draft, setDraft] = useState<AutomationDraft>(() =>
    createEmptyDraft(tr('schedule.newAutomation'))
  );
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRunsLoading, setIsRunsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const automationsRef = useRef<Automation[]>([]);
  const isMountedRef = useRef(true);
  const loadRequestSeq = useRef(0);
  const loadRunsRequestSeq = useRef(0);
  const selectedIdRef = useRef<string | null>(selectedId);
  const skipNextAutoSelectRef = useRef(false);
  const skipSearchLoadRef = useRef(true);
  const suppressSelectedAutomationSyncRef = useRef(false);
  const consumedCloudTemplateNonceRef = useRef<number | null>(null);
  const transientBannerTimerRef = useRef<number | null>(null);
  const updateDraftEnabled = useCallback((enabled: boolean) => {
    startTransition(() => {
      setDraft((current) => ({ ...current, enabled }));
    });
  }, []);

  const selectedAutomation = automations.find((automation) => automation.id === selectedId) ?? null;
  // Save affordance is driven by whether the draft actually differs from what
  // would be persisted — compare normalized payloads, same as save().
  const draftSignature = useMemo(
    () => (viewMode === 'detail' ? JSON.stringify(draftToPayload(draft, appConfig)) : null),
    [viewMode, draft, appConfig]
  );
  const baselineSignature = useMemo(() => {
    if (viewMode !== 'detail') return null;
    if (selectedId && selectedAutomation) {
      return JSON.stringify(draftToPayload(automationToDraft(selectedAutomation), appConfig));
    }
    if (!selectedId) {
      return JSON.stringify(
        draftToPayload(createEmptyDraft(tr('schedule.newAutomation')), appConfig)
      );
    }
    return null;
  }, [viewMode, selectedId, selectedAutomation, appConfig, tr]);
  const isDraftDirty = draftSignature !== null && draftSignature !== baselineSignature;
  const unsavedParts = useMemo(
    () => (isDraftDirty ? computeUnsavedDraftParts(selectedAutomation, draft, appConfig, tr) : []),
    [isDraftDirty, selectedAutomation, draft, appConfig, tr]
  );
  const dataPipelines = dataDashboard?.pipelines ?? [];
  const rawTables = dataDashboard?.rawTables ?? [];
  const resultTables = dataDashboard?.resultTables ?? [];

  const hasRunningAutomation = useMemo(
    () => automations.some((automation) => automation.status === 'running'),
    [automations]
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    automationsRef.current = automations;
  }, [automations]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      loadRequestSeq.current += 1;
      loadRunsRequestSeq.current += 1;
      if (transientBannerTimerRef.current !== null) {
        window.clearTimeout(transientBannerTimerRef.current);
        transientBannerTimerRef.current = null;
      }
    };
  }, []);

  const showTransientBanner = useCallback((nextBanner: Banner, durationMs = 2400) => {
    if (transientBannerTimerRef.current !== null) {
      window.clearTimeout(transientBannerTimerRef.current);
    }
    setBanner(nextBanner);
    transientBannerTimerRef.current = window.setTimeout(() => {
      transientBannerTimerRef.current = null;
      setBanner((current) => (current === nextBanner ? null : current));
    }, durationMs);
  }, []);

  useEffect(() => {
    if (banner) {
      showToast(banner.tone, banner.text);
      setBanner(null);
    }
  }, [banner]);

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!isElectron) return;
      const requestId = ++loadRequestSeq.current;
      if (!silent) {
        setIsLoading(true);
        setBanner(null);
      }
      try {
        const [{ automations: automationRows, groupCounts }, groups, actions, dashboard] =
          await Promise.all([
            automationClient.list({ perGroupLimit: AUTOMATION_TABLE_PAGE_SIZE }),
            automationClient.groups.list(),
            automationClient.listActionDefinitions(),
            loadDataPipelineResources(),
          ]);
        if (!isMountedRef.current || requestId !== loadRequestSeq.current) return;
        automationsRef.current = automationRows;
        setAutomations(automationRows);
        setAutomationGroupCounts(groupCounts);
        setAutomationGroups(groups);
        setActionDefinitions(actions);
        setDataDashboard(dashboard);
        if (
          !skipNextAutoSelectRef.current &&
          !suppressSelectedAutomationSyncRef.current &&
          !selectedIdRef.current &&
          automationRows[0]
        ) {
          setSelectedId(automationRows[0].id);
          setDraft(automationToDraft(automationRows[0]));
        }
        skipNextAutoSelectRef.current = false;
      } catch (error) {
        if (!isMountedRef.current || requestId !== loadRequestSeq.current) return;
        if (!silent) {
          setBanner({
            tone: 'error',
            text: formatIpcError(error, tr('schedule.loadFailed')),
          });
        }
      } finally {
        if (!silent && isMountedRef.current && requestId === loadRequestSeq.current) {
          setIsLoading(false);
        }
      }
    },
    [tr]
  );

  const loadAutomations = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!isElectron) return;
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const { automations: automationRows, groupCounts } = await automationClient.list({
          query: search,
          perGroupLimit: AUTOMATION_TABLE_PAGE_SIZE,
        });
        if (!isMountedRef.current) return;
        automationsRef.current = automationRows;
        setAutomations(automationRows);
        setAutomationGroupCounts(groupCounts);
      } catch (error) {
        if (!isMountedRef.current) return;
        if (!silent) {
          setBanner({
            tone: 'error',
            text: formatIpcError(error, tr('schedule.loadFailed')),
          });
        }
      } finally {
        if (!silent && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [search, tr]
  );

  const setAutomationGroupPage = useCallback(
    async (groupKey: string, page: number) => {
      if (!isElectron) return;
      const groupId =
        groupKey === 'ungrouped' ? null : groupKey.startsWith('g:') ? groupKey.slice(2) : groupKey;
      setAutomationGroupPages((current) => ({ ...current, [groupKey]: page }));
      try {
        const { automations: loadedRows, groupCounts } = await automationClient.list({
          query: search,
          groupId,
          offset: (page - 1) * AUTOMATION_TABLE_PAGE_SIZE,
          limit: AUTOMATION_TABLE_PAGE_SIZE,
        });
        setAutomations((current) => {
          const combined = [...current.filter((item) => item.groupId !== groupId), ...loadedRows];
          return buildGroupSections(combined, automationGroups, (item) => item.groupId).flatMap(
            (section) => section.rows
          );
        });
        setAutomationGroupCounts((current) => ({ ...current, ...groupCounts }));
      } catch (error) {
        setBanner({
          tone: 'error',
          text: formatIpcError(error, tr('schedule.loadFailed')),
        });
      }
    },
    [search, automationGroups, tr]
  );

  useEffect(() => {
    if (skipSearchLoadRef.current) {
      skipSearchLoadRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void loadAutomations({ silent: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loadAutomations, search]);

  const loadRuns = useCallback(
    async (sourceAutomations = automationsRef.current) => {
      if (!isElectron) return;
      const requestId = ++loadRunsRequestSeq.current;
      if (sourceAutomations.length === 0) {
        setAutomationRunLogs([]);
        return;
      }
      setIsRunsLoading(true);
      try {
        const entries = (
          await Promise.all(
            sourceAutomations.map(async (automation) => {
              const rows = await automationClient.listRuns(automation.id, {
                limit: 20,
                status: 'all',
              });
              return rows.map((run) => ({
                automation: { id: automation.id, name: automation.name },
                run,
              }));
            })
          )
        )
          .flat()
          .sort((left, right) => getRunSortTime(right.run) - getRunSortTime(left.run))
          .slice(0, 100);
        if (!isMountedRef.current || requestId !== loadRunsRequestSeq.current) return;
        setAutomationRunLogs(entries);
      } catch (error) {
        if (!isMountedRef.current || requestId !== loadRunsRequestSeq.current) return;
        setBanner({
          tone: 'error',
          text: formatIpcError(error, tr('schedule.runsLoadFailed')),
        });
      } finally {
        if (isMountedRef.current && requestId === loadRunsRequestSeq.current) {
          setIsRunsLoading(false);
        }
      }
    },
    [tr]
  );

  const applyCloudAutomationTemplate = useCallback(
    (rawTemplate: string, nonce?: number) => {
      if (nonce !== undefined) {
        if (consumedCloudTemplateNonceRef.current === nonce) return;
        consumedCloudTemplateNonceRef.current = nonce;
      }
      const template = parsePendingCloudAutomationTemplate(rawTemplate);
      if (nonce !== undefined) {
        clearCloudAutomationTemplateNavigation(nonce);
      }
      if (!template) return;
      skipNextAutoSelectRef.current = true;
      suppressSelectedAutomationSyncRef.current = true;
      setSelectedId(null);
      setDraft(createCloudTableAutomationDraft(template, tr));
      setViewMode('detail');
      setActiveListTab('automations');
      setBanner({
        tone: 'success',
        text: tr('schedule.cloudTemplateLoaded'),
      });
    },
    [clearCloudAutomationTemplateNavigation, tr]
  );

  useLayoutEffect(() => {
    if (!pendingCloudAutomationTemplateNavigation) return;
    const { rawTemplate, nonce } = pendingCloudAutomationTemplateNavigation;
    applyCloudAutomationTemplate(rawTemplate, nonce);
  }, [applyCloudAutomationTemplate, pendingCloudAutomationTemplateNavigation]);

  useEffect(() => {
    if (!isActive) return;
    void load();
  }, [isActive, load]);

  useEffect(() => {
    if (!isActive || activeListTab !== 'runs') return;
    void loadRuns();
  }, [activeListTab, isActive, loadRuns]);

  useEffect(() => {
    if (!isActive || !hasRunningAutomation) return;
    const timer = window.setInterval(() => {
      void load({ silent: true });
      if (activeListTab === 'runs') {
        void loadRuns();
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeListTab, hasRunningAutomation, isActive, load, loadRuns]);

  useEffect(() => {
    if (!selectedAutomation) return;
    if (suppressSelectedAutomationSyncRef.current) return;
    setDraft(automationToDraft(selectedAutomation));
  }, [selectedAutomation]);

  useEffect(() => {
    if (!outputNavigation) return;
    clearOutputNavigation();
    skipNextAutoSelectRef.current = true;
    suppressSelectedAutomationSyncRef.current = true;
    setTableReturnTarget(outputNavigation.returnTarget ?? null);
    setViewMode('detail');
    setActiveListTab('automations');
    setBanner(null);
    if (outputNavigation.automationId) {
      const id = outputNavigation.automationId;
      setSelectedId(id);
      void automationClient
        .get(id)
        .then((automation) => {
          if (!automation) throw new Error(tr('schedule.taskMissing'));
          setAutomations((rows) => [...rows.filter((row) => row.id !== id), automation]);
          setDraft(prependMissingCloudInputNode(automationToDraft(automation), outputNavigation));
        })
        .catch((error) => setBanner({ tone: 'error', text: String(error) }));
      return;
    }
    const nextDraft = buildTableNavigationDraft(outputNavigation, tr);
    if (nextDraft) {
      setSelectedId(null);
      setDraft(nextDraft);
    }
  }, [outputNavigation, clearOutputNavigation, tr]);

  const createNew = () => {
    suppressSelectedAutomationSyncRef.current = false;
    setSelectedId(null);
    setDraft(createEmptyDraft(tr('schedule.newAutomation')));
    setViewMode('detail');
    setBanner(null);
  };

  const openSelectedDetail = () => {
    if (!selectedAutomation) return;
    suppressSelectedAutomationSyncRef.current = false;
    setDraft(automationToDraft(selectedAutomation));
    setViewMode('detail');
    setBanner(null);
  };

  const save = async () => {
    const validationError = validateAutomationDraft(draft, tr);
    if (validationError) {
      setBanner({ tone: 'error', text: validationError });
      return;
    }
    setIsSaving(true);
    setBanner(null);
    try {
      const payload = draftToPayload(draft, appConfig);
      let saved = selectedId
        ? await automationClient.update(selectedId, payload)
        : await automationClient.create(payload as AutomationCreateInput);
      if (saved?.status === 'paused' && payload.enabled) {
        saved = await automationClient.resume(saved.id);
      }
      if (!saved) {
        throw new Error(tr('schedule.taskMissing'));
      }
      await load();
      setSelectedId(saved.id);
      suppressSelectedAutomationSyncRef.current = false;
      setViewMode('detail');
    } catch (error) {
      setBanner({
        tone: 'error',
        text: formatIpcError(error, tr('schedule.saveFailed')),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEnabled = async (automation: Automation, enabled: boolean) => {
    setAutomations((rows) =>
      rows.map((row) => (row.id === automation.id ? { ...row, enabled } : row))
    );
    try {
      let saved = await automationClient.update(automation.id, { enabled });
      if (saved?.status === 'paused' && enabled) {
        saved = await automationClient.resume(saved.id);
      }
      await load();
      setBanner({
        tone: 'success',
        text: enabled
          ? tr('schedule.enabledNotice').replace('{{name}}', automation.name)
          : tr('schedule.disabledNotice').replace('{{name}}', automation.name),
      });
    } catch (error) {
      await load();
      setBanner({
        tone: 'error',
        text: formatIpcError(error, tr('schedule.saveFailed')),
      });
    }
  };

  const runNow = async () => {
    if (!selectedAutomation) return;
    try {
      await automationClient.runNow(selectedAutomation.id);
      await load();
      if (activeListTab === 'runs') {
        await loadRuns();
      }
      setBanner({ tone: 'success', text: tr('schedule.runNowSuccess') });
    } catch (error) {
      setBanner({
        tone: 'error',
        text: formatIpcError(error, tr('schedule.runNowFailed')),
      });
    }
  };

  const remove = async () => {
    if (!selectedAutomation) return;
    const confirmed = await confirmDelete({
      message: t('schedule.deleteConfirm', {
        title: selectedAutomation.name,
      }),
    });
    if (!confirmed) return;
    await automationClient.delete(selectedAutomation.id);
    setSelectedId(null);
    setAutomationRunLogs([]);
    setDraft(createEmptyDraft(tr('schedule.newAutomation')));
    setViewMode('list');
    await load();
  };

  const assignToGroup = async (target: AssignGroupTarget) => {
    if (!selectedAutomation) return;
    try {
      let groupId = target.groupId;
      if (target.newGroupName) {
        const group = await automationClient.groups.create({
          name: target.newGroupName,
        });
        groupId = group.id;
      }
      await automationClient.groups.assign({
        ids: [selectedAutomation.id],
        groupId,
      });
      await load({ silent: true });
    } catch (error) {
      showToast('error', formatIpcError(error, String(error)));
      await load({ silent: true });
    }
  };

  const renameGroup = async (group: DataListGroup, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    try {
      await automationClient.groups.rename({ id: group.id, name: trimmed });
      await load({ silent: true });
    } catch (error) {
      showToast('error', formatIpcError(error, String(error)));
      await load({ silent: true });
    }
  };

  const deleteGroup = async (group: DataListGroup) => {
    const confirmed = await confirmDelete({
      message: t('data.groups.deleteConfirm', { name: group.name }),
    });
    if (!confirmed) return;
    try {
      await automationClient.groups.delete(group.id);
      await load({ silent: true });
    } catch (error) {
      showToast('error', formatIpcError(error, String(error)));
      await load({ silent: true });
    }
  };

  if (viewMode === 'detail') {
    return (
      <AutomationDetailView
        selectedAutomation={selectedAutomation}
        draft={draft}
        projects={projects}
        actionDefinitions={actionDefinitions}
        dataPipelines={dataPipelines}
        rawTables={rawTables}
        resultTables={resultTables}
        appConfig={appConfig}
        isSaving={isSaving}
        isDraftDirty={isDraftDirty}
        unsavedParts={unsavedParts}
        onDraftChange={setDraft}
        onActionDraftChange={(next) => {
          suppressSelectedAutomationSyncRef.current = true;
          setDraft(next);
        }}
        onEnabledChange={updateDraftEnabled}
        onDiscardChanges={() => {
          if (selectedAutomation) setDraft(automationToDraft(selectedAutomation));
        }}
        onSave={() => void save()}
        onRun={() => void runNow()}
        onBack={() => {
          if (tableReturnTarget) {
            setTableReturnTarget(null);
            setBanner(null);
            navigateToDataElement(tableReturnTarget);
            return;
          }
          setViewMode('list');
          setBanner(null);
        }}
        onGeneratedPipelineSuccess={(workflowDslAvailable) => {
          void loadDataPipelineResources()
            .then((resources) => {
              if (isMountedRef.current) setDataDashboard(resources);
            })
            .catch((error) => {
              showTransientBanner({
                tone: 'error',
                text: formatIpcError(error, String(error)),
              });
            });
          showTransientBanner({
            tone: workflowDslAvailable ? 'success' : 'warning',
            text: workflowDslAvailable
              ? tr('schedule.generatedPipelineReady')
              : tr('schedule.generatedPipelineReadyWithoutDsl'),
          });
        }}
        tr={tr}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-text-primary">
      <section className="flex min-h-0 flex-1 flex-col">
        <tabBarAction.Provider value={tabBarAction.slot}>
          <Tabs
            value={activeListTab}
            onValueChange={(v) => setActiveListTab(v as ListTab)}
            className="contents"
          >
            <div className={underlineTabBarClass}>
              <TabsList className={underlineTabListClass}>
                <TabsTrigger
                  value="automations"
                  className={fixedUnderlineTabTriggerClass}
                  title={tr('schedule.tabs.automations')}
                  data-fixed-tab
                >
                  <span className="truncate">{tr('schedule.tabs.automations')}</span>
                </TabsTrigger>
                <TabsTrigger
                  value="runs"
                  className={fixedUnderlineTabTriggerClass}
                  title={tr('schedule.tabs.runs')}
                  data-fixed-tab
                >
                  <span className="truncate">{tr('schedule.tabs.runs')}</span>
                </TabsTrigger>
              </TabsList>
              <TabBarActionSlot slotRef={tabBarAction.slotRef} />
            </div>
            <TabsContent value="automations" className="contents">
              <AutomationListPanel
                automations={automations}
                groups={automationGroups}
                groupCounts={automationGroupCounts}
                groupPages={automationGroupPages}
                selectedId={selectedId}
                selectedAutomation={selectedAutomation}
                searchQuery={search}
                isLoading={isLoading}
                onCreate={createNew}
                onSearchChange={setSearch}
                onRefresh={() => void load()}
                onGroupPageChange={setAutomationGroupPage}
                onRun={() => void runNow()}
                onEdit={openSelectedDetail}
                onDelete={() => void remove()}
                onToggleEnabled={(automation, enabled) => void toggleEnabled(automation, enabled)}
                onAssignToGroup={(target) => void assignToGroup(target)}
                onRenameGroup={(group, name) => void renameGroup(group, name)}
                onDeleteGroup={(group) => void deleteGroup(group)}
                onSelect={(automation) => {
                  suppressSelectedAutomationSyncRef.current = false;
                  setSelectedId(automation.id);
                  setDraft(automationToDraft(automation));
                }}
                tr={tr}
              />
            </TabsContent>
            <TabsContent value="runs" className="contents">
              <AutomationRunLogPanel
                automations={automations}
                entries={automationRunLogs}
                isLoading={isRunsLoading}
                onRefresh={() => void loadRuns()}
                tr={tr}
              />
            </TabsContent>
          </Tabs>
        </tabBarAction.Provider>
      </section>
    </div>
  );
}
