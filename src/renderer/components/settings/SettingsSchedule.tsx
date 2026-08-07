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
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, Play, X } from 'lucide-react';
import { useConfirmDialog } from '../ConfirmDialog';
import type {
  Automation,
  AutomationActionDefinitionSummary,
  AutomationCreateInput,
  DataDashboard,
} from '../../types';
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
  draftToPayload,
  getCloudAutomationConfigsFromDraft,
  normalizeDraftTrigger,
  parsePendingCloudAutomationTemplate,
  validateEnabledActionNodes,
} from './schedule/model';
import {
  AutomationListPanel,
  AutomationRunLogPanel,
  StatCard,
  TabButton,
  getRunSortTime,
} from './schedule/listPanels';
import {
  ActionChainSection,
  EditorHeader,
  ExecutionProjectPanel,
  TaskStatusSection,
  TriggerConditionPanel,
} from './schedule/editorPanels';

export function SettingsSchedule({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const { confirmDelete } = useConfirmDialog();
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
  const [actionDefinitions, setActionDefinitions] = useState<AutomationActionDefinitionSummary[]>(
    []
  );
  const [dataDashboard, setDataDashboard] = useState<DataDashboard | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [activeListTab, setActiveListTab] = useState<ListTab>('automations');
  const [automationRunLogs, setAutomationRunLogs] = useState<AutomationRunLogEntry[]>([]);
  const [draft, setDraft] = useState<AutomationDraft>(() => createEmptyDraft());
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
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

  const filteredAutomations = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return automations;
    return automations.filter((automation) =>
      [automation.name, automation.description ?? '', automation.status]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    );
  }, [automations, search]);
  const totalPages = Math.max(
    1,
    Math.ceil(filteredAutomations.length / AUTOMATION_TABLE_PAGE_SIZE)
  );
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageAutomations = useMemo(() => {
    const start = (safeCurrentPage - 1) * AUTOMATION_TABLE_PAGE_SIZE;
    return filteredAutomations.slice(start, start + AUTOMATION_TABLE_PAGE_SIZE);
  }, [filteredAutomations, safeCurrentPage]);
  const hasRunningAutomation = useMemo(
    () => automations.some((automation) => automation.status === 'running'),
    [automations]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

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

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!isElectron) return;
      const requestId = ++loadRequestSeq.current;
      if (!silent) {
        setIsLoading(true);
        setBanner(null);
      }
      try {
        const [automationRows, actions, dashboard] = await Promise.all([
          window.electronAPI.automation.list(),
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

  const createNew = () => {
    suppressSelectedAutomationSyncRef.current = false;
    setSelectedId(null);
    setDraft(createEmptyDraft());
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
      const saved = selectedAutomation
        ? await window.electronAPI.automation.update(selectedAutomation.id, payload)
        : await window.electronAPI.automation.create(payload as AutomationCreateInput);
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
    setDraft(createEmptyDraft());
    setViewMode('list');
    await load();
  };

  const summaryContent = (
    <section className="grid flex-shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label={tr('schedule.summary.total', '总数')}
        description={tr('schedule.summary.totalDesc', '全部自动化流程')}
        value={automations.length}
        Icon={CalendarClock}
        iconClassName="bg-accent/10 text-accent"
      />
      <StatCard
        label={tr('schedule.summary.enabled', '开启')}
        description={tr('schedule.summary.enabledDesc', '当前会自动触发')}
        value={automations.filter((item) => item.enabled).length}
        Icon={CheckCircle2}
        iconClassName="bg-success/10 text-success"
      />
      <StatCard
        label={tr('schedule.summary.running', '运行中')}
        description={tr('schedule.summary.runningDesc', '正在执行动作链')}
        value={automations.filter((item) => item.status === 'running').length}
        Icon={Play}
        iconClassName="bg-[#E9F7F5] text-[#238C80]"
      />
      <StatCard
        label={tr('schedule.summary.failed', '失败')}
        description={tr('schedule.summary.failedDesc', '最近执行失败')}
        value={automations.filter((item) => item.lastRunStatus === 'failed').length}
        Icon={Clock3}
        iconClassName="bg-warning/10 text-warning"
      />
    </section>
  );
  const bannerContent = banner ? (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
        banner.tone === 'error'
          ? 'border-error/30 bg-error/10 text-text-primary'
          : banner.tone === 'warning'
            ? 'border-warning/30 bg-warning/10 text-warning'
            : 'border-success/30 bg-success/10 text-success'
      }`}
    >
      <AlertCircle
        size={14}
        className={
          banner.tone === 'error'
            ? 'text-error'
            : banner.tone === 'warning'
              ? 'text-warning'
              : 'text-success'
        }
      />
      <span className="min-w-0 flex-1">{banner.text}</span>
      <button
        type="button"
        onClick={() => setBanner(null)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-current/70 transition-colors hover:bg-current/10 hover:text-current"
        aria-label={tr('common.close', '关闭')}
        title={tr('common.close', '关闭')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;

  if (viewMode === 'detail') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 text-sm text-text-primary">
        <EditorHeader
          selectedAutomation={selectedAutomation}
          draft={draft}
          isSaving={isSaving}
          onDraftChange={setDraft}
          onSave={() => void save()}
          onRun={() => void runNow()}
          onBack={() => {
            setViewMode('list');
            setBanner(null);
          }}
          tr={tr}
        />
        {bannerContent}

        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <TaskStatusSection enabled={draft.enabled} onEnabledChange={updateDraftEnabled} tr={tr} />
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(340px,0.58fr)_minmax(620px,1fr)]">
            <div className="flex min-h-0 flex-col gap-4">
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
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-text-primary">
      {summaryContent}
      {bannerContent}

      <section className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex min-h-10 flex-shrink-0 items-end gap-5">
          <TabButton
            active={activeListTab === 'automations'}
            label={tr('schedule.tabs.automations', '自动化')}
            onClick={() => setActiveListTab('automations')}
          />
          <TabButton
            active={activeListTab === 'runs'}
            label={tr('schedule.tabs.runs', '执行日志')}
            onClick={() => setActiveListTab('runs')}
          />
        </div>
        {activeListTab === 'automations' ? (
          <AutomationListPanel
            automations={pageAutomations}
            totalAutomations={filteredAutomations.length}
            currentPage={safeCurrentPage}
            selectedId={selectedId}
            selectedAutomation={selectedAutomation}
            searchQuery={search}
            isLoading={isLoading}
            onCreate={createNew}
            onSearchChange={setSearch}
            onRefresh={() => void load()}
            onPageChange={setCurrentPage}
            onRun={() => void runNow()}
            onEdit={openSelectedDetail}
            onDelete={() => void remove()}
            onSelect={(automation) => {
              suppressSelectedAutomationSyncRef.current = false;
              setSelectedId(automation.id);
              setDraft(automationToDraft(automation));
            }}
            tr={tr}
          />
        ) : (
          <AutomationRunLogPanel
            automations={automations}
            entries={automationRunLogs}
            isLoading={isRunsLoading}
            onRefresh={() => void loadRuns()}
            tr={tr}
          />
        )}
      </section>
    </div>
  );
}
