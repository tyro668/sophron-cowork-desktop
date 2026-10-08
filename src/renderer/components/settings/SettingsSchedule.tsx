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
import {
  AUTOMATION_TABLE_PAGE_SIZE,
  type AutomationDraft,
  type AutomationRunLogEntry,
  type Banner,
  type ListTab,
  getOutputLocation,
  getSourceLocation,
  isElectron,
} from './schedule/types';
import {
  automationToDraft,
  createCloudTableAutomationDraft,
  createEmptyDraft,
  relinkLinearGraph,
  draftToPayload,
  getCloudAutomationConfigsFromDraft,
  normalizeDraftTrigger,
  parsePendingCloudAutomationTemplate,
  validateEnabledActionNodes,
} from './schedule/model';
import { AutomationListPanel, AutomationRunLogPanel, getRunSortTime } from './schedule/listPanels';
import {
  underlineTabBarClass,
  underlineTabListClass,
  underlineTabTriggerClass,
} from '../data-view/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  ActionChainSection,
  EditorHeader,
  ExecutionProjectPanel,
  TriggerConditionPanel,
} from './schedule/editorPanels';

export function SettingsSchedule({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
  const outputNavigation = useAppStore((state) => state.pendingTableAutomationNavigation);
  const clearOutputNavigation = useAppStore((state) => state.clearTableAutomationNavigation);
  const projects = useAppStore((state) => state.projects);
  const appConfig = useAppStore((state) => state.appConfig);
  const pendingCloudAutomationTemplateNavigation = useAppStore(
    (state) => state.pendingCloudAutomationTemplateNavigation
  );
  const clearCloudAutomationTemplateNavigation = useAppStore(
    (state) => state.clearCloudAutomationTemplateNavigation
  );
  const tr = useCallback(
    (key: string, fallback: string) => t(key, { defaultValue: fallback }),
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
  const [activeListTab, setActiveListTab] = useState<ListTab>('automations');
  const [automationRunLogs, setAutomationRunLogs] = useState<AutomationRunLogEntry[]>([]);
  const [draft, setDraft] = useState<AutomationDraft>(() =>
    createEmptyDraft(tr('schedule.newAutomation', '新建自动化'))
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
  const dataTasks = dataDashboard?.tasks ?? [];
  const inputTables = dataDashboard?.datasets ?? [];
  const outputTables = dataDashboard?.outputTables ?? [];

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
            window.electronAPI.automation.list({ perGroupLimit: AUTOMATION_TABLE_PAGE_SIZE }),
            window.electronAPI.automation.groups.list(),
            window.electronAPI.automation.listActionDefinitions(),
            window.electronAPI.data.getDashboard({
              includeSummary: false,
              includeTasks: true,
              includeDatasets: true,
              includeOutputTables: true,
              taskLimit: 200,
              datasetLimit: 200,
              outputLimit: 200,
            }),
          ]);
        if (!isMountedRef.current || requestId !== loadRequestSeq.current) return;
        automationsRef.current = automationRows;
        setAutomations(automationRows);
        setAutomationGroupCounts(groupCounts);
        setAutomationGroups(groups);
        setActionDefinitions(actions);
        setDataDashboard(dashboard);
        if (!skipNextAutoSelectRef.current && !selectedIdRef.current && automationRows[0]) {
          setSelectedId(automationRows[0].id);
          setDraft(automationToDraft(automationRows[0]));
        }
        skipNextAutoSelectRef.current = false;
      } catch (error) {
        if (!isMountedRef.current || requestId !== loadRequestSeq.current) return;
        if (!silent) {
          setBanner({
            tone: 'error',
            text:
              error instanceof Error ? error.message : tr('schedule.loadFailed', '加载自动化失败'),
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
        const { automations: automationRows, groupCounts } =
          await window.electronAPI.automation.list({
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
            text:
              error instanceof Error ? error.message : tr('schedule.loadFailed', '加载自动化失败'),
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
        const { automations: loadedRows, groupCounts } = await window.electronAPI.automation.list({
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
          text:
            error instanceof Error ? error.message : tr('schedule.loadFailed', '加载自动化失败'),
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
              const rows = await window.electronAPI.automation.listRuns(automation.id, {
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
          text:
            error instanceof Error
              ? error.message
              : tr('schedule.runsLoadFailed', '加载执行日志失败'),
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
        text: tr(
          'schedule.cloudTemplateLoaded',
          '已从云表创建自动处理草稿，请补充处理方式和执行频率。'
        ),
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
    setViewMode('detail');
    setActiveListTab('automations');
    setBanner(null);
    if (outputNavigation.automationId) {
      const id = outputNavigation.automationId;
      setSelectedId(id);
      void window.electronAPI.automation
        .get(id)
        .then((automation) => {
          if (!automation) throw new Error(tr('schedule.taskMissing', '自动化不存在'));
          setAutomations((rows) => [...rows.filter((row) => row.id !== id), automation]);
          const next = automationToDraft(automation);
          if (
            outputNavigation.inputTable &&
            !next.actionGraph.nodes.some(
              (node) =>
                node.type === 'cloud.sync' &&
                node.config.direction === 'input' &&
                node.config.inputTableId === outputNavigation.inputTable?.id
            )
          ) {
            const node = {
              id: crypto.randomUUID(),
              type: 'cloud.sync',
              enabled: true,
              config: {
                direction: 'input',
                spaceId: '',
                projectId: '',
                tableId: '',
                tableKind: 'analysis',
                inputTableId: outputNavigation.inputTable.id,
                inputTableName: outputNavigation.inputTable.name,
              },
            };
            next.actionGraph = relinkLinearGraph({
              ...next.actionGraph,
              nodes: [...next.actionGraph.nodes, node],
            });
          }
          setDraft(next);
        })
        .catch((error) => setBanner({ tone: 'error', text: String(error) }));
    } else if (outputNavigation.outputTable) {
      const table = outputNavigation.outputTable;
      setSelectedId(null);
      setDraft({
        ...createEmptyDraft(table.name),
        triggerMode: 'manual',
        trigger: {
          kind: 'manual',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        outputBindings: [{ outputTableId: table.id, runOnChange: true }],
        actionGraph: {
          version: 1,
          edges: [],
          nodes: [
            {
              id: crypto.randomUUID(),
              type: 'cloud.sync',
              enabled: true,
              config: {
                direction: 'output',
                outputTableId: table.id,
                type: 'drive_file',
                writeMode: 'create',
                spaceId: '',
                projectId: '',
              },
            },
          ],
        },
      });
    } else if (outputNavigation.inputTable || outputNavigation.newInputTableName !== undefined) {
      const table = outputNavigation.inputTable;
      const cloudSource = outputNavigation.cloudSource;
      const name =
        table?.name ||
        outputNavigation.newInputTableName ||
        tr('schedule.cloudInput.title', '云端表同步到输入表');
      setSelectedId(null);
      setDraft({
        ...createEmptyDraft(name),
        actionGraph: {
          version: 1,
          edges: [],
          nodes: [
            {
              id: crypto.randomUUID(),
              type: 'cloud.sync',
              enabled: true,
              config: {
                direction: 'input',
                spaceId: cloudSource?.spaceId ?? '',
                projectId: cloudSource?.projectId ?? '',
                tableId: cloudSource?.tableId ?? '',
                tableKind: cloudSource?.tableKind ?? 'analysis',
                tableName: cloudSource?.tableName,
                inputTableId: table?.id,
                inputTableName:
                  table?.name || outputNavigation.newInputTableName || cloudSource?.tableName || '',
              },
            },
          ],
        },
      });
    }
  }, [outputNavigation, clearOutputNavigation, tr]);

  const createNew = () => {
    suppressSelectedAutomationSyncRef.current = false;
    setSelectedId(null);
    setDraft(createEmptyDraft(tr('schedule.newAutomation', '新建自动化')));
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
    if (!draft.name.trim()) {
      setBanner({ tone: 'error', text: tr('schedule.titleRequired', '请输入自动化名称') });
      return;
    }
    if (draft.actionGraph.nodes.length === 0) {
      setBanner({ tone: 'error', text: tr('schedule.actionRequired', '至少添加一个动作') });
      return;
    }
    const normalizedTrigger = normalizeDraftTrigger(draft.triggerMode, draft.trigger);
    if (normalizedTrigger.kind === 'weekly' && normalizedTrigger.weekdays.length === 0) {
      setBanner({ tone: 'error', text: tr('schedule.weekdayRequired', '请至少选择一个执行星期') });
      return;
    }
    if (
      normalizedTrigger.kind === 'monthly' &&
      normalizedTrigger.daysOfMonth.length === 0 &&
      !normalizedTrigger.includeLastDay
    ) {
      setBanner({ tone: 'error', text: tr('schedule.monthDayRequired', '请至少选择一个执行日期') });
      return;
    }
    if (
      normalizedTrigger.kind === 'interval' &&
      normalizedTrigger.endAt != null &&
      normalizedTrigger.endAt <= normalizedTrigger.startAt
    ) {
      setBanner({
        tone: 'error',
        text: tr('schedule.endAtAfterStartRequired', '结束时间必须晚于开始时间'),
      });
      return;
    }
    const actionValidationError = validateEnabledActionNodes(draft, tr);
    if (actionValidationError) {
      setBanner({ tone: 'error', text: actionValidationError });
      return;
    }
    const cloudAutomations = getCloudAutomationConfigsFromDraft(draft);
    const missingSource = cloudAutomations.find(
      (cloudAutomation) =>
        !cloudAutomation.source.tableId.trim() || !cloudAutomation.source.tableName.trim()
    );
    if (missingSource) {
      setBanner({
        tone: 'error',
        text:
          getSourceLocation(missingSource) === 'local'
            ? tr('schedule.localSourceRequired', '请选择输入数据表')
            : tr('schedule.cloudSourceRequired', '请选择输入云表'),
      });
      return;
    }
    const missingTarget = cloudAutomations.find(
      (cloudAutomation) =>
        cloudAutomation.output.writeMode === 'replace' &&
        !cloudAutomation.output.targetTableId.trim()
    );
    if (missingTarget) {
      setBanner({
        tone: 'error',
        text:
          getOutputLocation(missingTarget) === 'local'
            ? tr('schedule.localTargetRequired', '请选择目标输出表')
            : tr('schedule.cloudTargetRequired', '请选择目标云表'),
      });
      return;
    }
    setIsSaving(true);
    setBanner(null);
    try {
      const payload = draftToPayload(draft, appConfig);
      let saved = selectedId
        ? await window.electronAPI.automation.update(selectedId, payload)
        : await window.electronAPI.automation.create(payload as AutomationCreateInput);
      if (saved?.status === 'paused' && payload.enabled) {
        saved = await window.electronAPI.automation.resume(saved.id);
      }
      if (!saved) {
        throw new Error(tr('schedule.taskMissing', '自动化不存在'));
      }
      await load();
      setSelectedId(saved.id);
      suppressSelectedAutomationSyncRef.current = false;
      setViewMode('detail');
    } catch (error) {
      setBanner({
        tone: 'error',
        text: error instanceof Error ? error.message : tr('schedule.saveFailed', '保存自动化失败'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const runNow = async () => {
    if (!selectedAutomation) return;
    try {
      await window.electronAPI.automation.runNow(selectedAutomation.id);
      await load();
      if (activeListTab === 'runs') {
        await loadRuns();
      }
      setBanner({ tone: 'success', text: tr('schedule.runNowSuccess', '自动化已开始运行') });
    } catch (error) {
      setBanner({
        tone: 'error',
        text: error instanceof Error ? error.message : tr('schedule.runNowFailed', '运行失败'),
      });
    }
  };

  const remove = async () => {
    if (!selectedAutomation) return;
    const confirmed = await confirmDelete({
      message: t('schedule.deleteConfirm', {
        title: selectedAutomation.name,
        defaultValue: '确认删除自动化「{{title}}」？',
      }),
    });
    if (!confirmed) return;
    await window.electronAPI.automation.delete(selectedAutomation.id);
    setSelectedId(null);
    setAutomationRunLogs([]);
    setDraft(createEmptyDraft(tr('schedule.newAutomation', '新建自动化')));
    setViewMode('list');
    await load();
  };

  const assignToGroup = async (target: AssignGroupTarget) => {
    if (!selectedAutomation) return;
    try {
      let groupId = target.groupId;
      if (target.newGroupName) {
        const group = await window.electronAPI.automation.groups.create({
          name: target.newGroupName,
        });
        groupId = group.id;
      }
      await window.electronAPI.automation.groups.assign({
        ids: [selectedAutomation.id],
        groupId,
      });
      await load({ silent: true });
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : String(error));
      await load({ silent: true });
    }
  };

  const renameGroup = async (group: DataListGroup, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    try {
      await window.electronAPI.automation.groups.rename({ id: group.id, name: trimmed });
      await load({ silent: true });
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : String(error));
      await load({ silent: true });
    }
  };

  const deleteGroup = async (group: DataListGroup) => {
    const confirmed = await confirmDelete({
      message: t('data.groups.deleteConfirm', { name: group.name }),
    });
    if (!confirmed) return;
    try {
      await window.electronAPI.automation.groups.delete(group.id);
      await load({ silent: true });
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : String(error));
      await load({ silent: true });
    }
  };

  if (viewMode === 'detail') {
    return (
      <div className="flex h-full min-h-0 flex-col text-sm text-text-primary">
        <EditorHeader
          selectedAutomation={selectedAutomation}
          draft={draft}
          isSaving={isSaving}
          onDraftChange={setDraft}
          onEnabledChange={updateDraftEnabled}
          onSave={() => void save()}
          onRun={() => void runNow()}
          onBack={() => {
            setViewMode('list');
            setBanner(null);
          }}
          tr={tr}
        />

        <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] md:overflow-hidden">
          <div className="min-h-0 border-b border-border-muted md:overflow-y-auto md:border-b-0 md:border-r">
            <div className="divide-y divide-border-muted">
              <ExecutionProjectPanel
                draft={draft}
                projects={projects}
                onDraftChange={setDraft}
                tr={tr}
              />
              <TriggerConditionPanel
                draft={draft}
                projects={projects}
                onDraftChange={setDraft}
                tr={tr}
              />
            </div>
          </div>
          <ActionChainSection
            draft={draft}
            actionDefinitions={actionDefinitions}
            dataTasks={dataTasks}
            inputTables={inputTables}
            outputTables={outputTables}
            appConfig={appConfig}
            onDraftChange={setDraft}
            onGeneratedTaskSuccess={(workflowDslAvailable) =>
              showTransientBanner({
                tone: workflowDslAvailable ? 'success' : 'warning',
                text: workflowDslAvailable
                  ? tr('schedule.generatedTaskReady', '数据任务已生成，后续将复用该任务执行。')
                  : tr(
                      'schedule.generatedTaskReadyWithoutDsl',
                      '数据任务已生成，但任务逻辑预览暂时不可用。'
                    ),
              })
            }
            tr={tr}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-text-primary">
      <section className="flex min-h-0 flex-1 flex-col">
        <Tabs
          value={activeListTab}
          onValueChange={(v) => setActiveListTab(v as ListTab)}
          className="contents"
        >
          <div className={underlineTabBarClass}>
            <TabsList className={underlineTabListClass}>
              <TabsTrigger value="automations" className={underlineTabTriggerClass}>
                {tr('schedule.tabs.automations', '自动化')}
              </TabsTrigger>
              <TabsTrigger value="runs" className={underlineTabTriggerClass}>
                {tr('schedule.tabs.runs', '执行日志')}
              </TabsTrigger>
            </TabsList>
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
      </section>
    </div>
  );
}
