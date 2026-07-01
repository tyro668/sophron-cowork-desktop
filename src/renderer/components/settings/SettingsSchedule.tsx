import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Clock3,
  Cloud,
  Database,
  Folder,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useConfirmDialog } from '../ConfirmDialog';
import type {
  Automation,
  AutomationActionDefinitionSummary,
  AutomationActionGraph,
  AutomationActionNode,
  AutomationCreateInput,
  AutomationRun,
  AutomationTrigger,
  AutomationUpdateInput,
  AppConfig,
  DataCleaningTask,
  DataDashboard,
  DesktopAuthStatus,
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
  Project,
} from '../../types';
import { useAppStore } from '../../store';
import { getAgentModelLabel } from '../AgentModelSelector';
import { GlassDateTimePicker } from '../GlassDateTimePicker';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { GlassSelect } from '../GlassSelect';
import { GlassTimePicker } from '../GlassTimePicker';
import { GlassSwitch } from '../GlassSwitch';
import { LlmPromptComposer } from '../LlmPromptComposer';
import { formatAppDateTime } from '../../utils/i18n-format';
import { getWorkingDirDisplayName } from '../../utils/working-dir-label';
import {
  normalizePermissionPolicy,
  type PermissionPolicyId,
} from '../../../shared/permission-policies';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DEFAULT_TIME = '09:00';
const AUTOMATION_TABLE_PAGE_SIZE = 10;
const CLOUD_TARGET_TABLE_PAGE_SIZE = 50;
// Top-level "添加动作" menu only exposes two intents: a free-form task (conversation.run)
// and the unified data-processing action (CLOUD_TABLE_PROCESS_ACTION_TYPE). "复用数据任务"
// (data.task.run) is no longer a separate entry — it is a mode inside 数据处理.
const ACTION_MENU_TYPES = ['conversation.run'];
const CLOUD_TABLE_PROCESS_ACTION_TYPE = 'cloud.table.process';
const DATA_ACTION_TYPES = ['data.task.run'];
const DATA_PREVIEW_ACTION_TYPES = ['data.input.preview', 'data.output.preview'];
const DATA_PROCESS_AI_CONFIG_KEY = '__dataProcessAiConfig';
const DATA_PROCESS_TASK_CONFIG_KEY = '__dataProcessTaskConfig';

type CloudAutomationWriteMode = 'create' | 'replace';
// Where an AI-described data-processing action reads from / writes to. For 'local',
// `tableId`/`tableName` carry the local dataset (source) or output-table (target) id+name,
// and cloud-only fields stay empty. Defaults to 'cloud' so existing saved configs are unchanged.
type DataProcessLocation = 'cloud' | 'local';

interface CloudAutomationSourceTable {
  location?: DataProcessLocation;
  tableId: string;
  tableName: string;
  spaceId?: string;
  spaceName?: string;
  projectId?: string;
  projectName?: string;
  datasourceId?: string;
  rowCount?: number | null;
  columns?: Array<string | { name?: string; type?: string }>;
}

interface PendingCloudAutomationTemplate {
  createdAt: number;
  source: CloudAutomationSourceTable;
  accessModeLabel?: string;
  connectionLabel?: string;
}

interface CloudTableAutomationConfig {
  kind: 'cloud_table_auto_process';
  source: CloudAutomationSourceTable;
  processRequirement: string;
  output: {
    location?: DataProcessLocation;
    writeMode: CloudAutomationWriteMode;
    targetTableId: string;
    tableName: string;
  };
  accessModeLabel?: string;
  connectionLabel?: string;
}

function normalizeDataProcessLocation(location: unknown): DataProcessLocation {
  return location === 'local' ? 'local' : 'cloud';
}

function getSourceLocation(config: CloudTableAutomationConfig): DataProcessLocation {
  return normalizeDataProcessLocation(config.source.location);
}

function getOutputLocation(config: CloudTableAutomationConfig): DataProcessLocation {
  return normalizeDataProcessLocation(config.output.location);
}

interface CloudConnectionPayload {
  apiOrigin: string;
  apiKey?: string;
}

function getProjectOptionLabel(
  project: Project,
  tr: (key: string, fallback: string) => string
): string {
  const name = project.name?.trim();
  if (name) return name;
  return getWorkingDirDisplayName(
    project.cwd,
    tr('welcome.defaultWorkingFolder', '默认工作目录'),
    tr('schedule.projectPlaceholder', '不指定项目')
  );
}

type EditableAutomationTrigger = Exclude<AutomationTrigger, { kind: 'cron' }>;
type ScheduledAutomationTrigger = Exclude<
  EditableAutomationTrigger,
  { kind: 'file_change' | 'manual' }
>;
type TriggerMode = EditableAutomationTrigger['kind'];
type ListTab = 'automations' | 'runs';
type Banner = { tone: 'error' | 'success'; text: string };
interface AutomationRunLogEntry {
  automation: Pick<Automation, 'id' | 'name'>;
  run: AutomationRun;
}

export function SettingsSchedule({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const { confirm, confirmDelete } = useConfirmDialog();
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
    };
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
    const previousPermissionPolicy = selectedAutomation
      ? getAutomationPermissionPolicy(selectedAutomation.actionGraph)
      : null;
    if (draft.permissionPolicy === 'full_access' && previousPermissionPolicy !== 'full_access') {
      const confirmed = await confirm({
        title: tr('schedule.fullAccessConfirmTitle', '确认以完全访问权限运行？'),
        message: (
          <div className="space-y-2">
            <p>
              {tr(
                'schedule.fullAccessConfirmIntro',
                '这条自动化将跳过大多数运行时权限确认，适合无人值守执行，但也意味着它可以直接执行高风险操作。'
              )}
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                {tr('schedule.fullAccessConfirmReadWrite', '读取、创建或修改工作区内文件与数据表')}
              </li>
              <li>
                {tr('schedule.fullAccessConfirmCommands', '调用连接器、运行命令或发起网络请求')}
              </li>
              <li>
                {tr('schedule.fullAccessConfirmCloud', '按自动化配置访问外部服务或写回云分析空间')}
              </li>
            </ul>
          </div>
        ),
        confirmLabel: tr('schedule.fullAccessConfirmSave', '确认保存'),
        cancelLabel: tr('common.cancel', '取消'),
      });
      if (!confirmed) return;
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
    <>
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

      {banner && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            banner.tone === 'error'
              ? 'border-danger/30 bg-danger/10 text-danger'
              : 'border-success/30 bg-success/10 text-success'
          }`}
        >
          <AlertCircle size={14} />
          {banner.text}
        </div>
      )}
    </>
  );

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
          onBack={() => setViewMode('list')}
          tr={tr}
        />

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
              onPermissionPolicyChange={(permissionPolicy) =>
                setDraft((current) => ({ ...current, permissionPolicy }))
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

interface AutomationDraft {
  name: string;
  description: string;
  projectId: string;
  enabled: boolean;
  permissionPolicy: PermissionPolicyId;
  triggerMode: TriggerMode;
  trigger: EditableAutomationTrigger;
  actionGraph: AutomationActionGraph;
}

function createEmptyDraft(): AutomationDraft {
  const trigger: EditableAutomationTrigger = {
    kind: 'daily',
    times: ['09:00'],
    timezone: SYSTEM_TIMEZONE,
  };
  const conversationNodeId = crypto.randomUUID();
  const dataTaskNodeId = crypto.randomUUID();
  return {
    name: 'New automation',
    description: '',
    projectId: '',
    enabled: true,
    permissionPolicy: 'full_access',
    triggerMode: 'daily',
    trigger,
    actionGraph: {
      version: 1,
      nodes: [
        {
          id: conversationNodeId,
          type: 'conversation.run',
          label: '',
          enabled: true,
          config: {
            prompt: '',
            selectedSkillNames: [],
            projectId: '',
            modelConfigSetId: null,
            model: null,
            completionMode: 'wait',
            timeoutMs: 30 * 60 * 1000,
            collectArtifacts: true,
            permissionPolicy: 'full_access',
          },
        },
        {
          id: dataTaskNodeId,
          type: 'data.task.run',
          label: '',
          enabled: true,
          config: {
            taskId: '',
            outputMode: 'persisted',
          },
        },
      ],
      edges: [
        { id: crypto.randomUUID(), sourceNodeId: conversationNodeId, targetNodeId: dataTaskNodeId },
      ],
    },
  };
}

function createCloudTableAutomationDraft(
  template: PendingCloudAutomationTemplate,
  tr: (key: string, fallback: string) => string
): AutomationDraft {
  const trigger: EditableAutomationTrigger = {
    kind: 'daily',
    times: ['09:00'],
    timezone: SYSTEM_TIMEZONE,
  };
  const config: CloudTableAutomationConfig = {
    kind: 'cloud_table_auto_process',
    source: { ...template.source, location: 'cloud' },
    processRequirement: '',
    output: {
      location: 'cloud',
      writeMode: 'create',
      targetTableId: '',
      tableName: `${template.source.tableName || 'cloud_table'}_processed`,
    },
    accessModeLabel: template.accessModeLabel,
    connectionLabel: template.connectionLabel,
  };
  const tableName = template.source.tableName || tr('schedule.cloudTableFallbackName', '云表');
  return {
    name: tr('schedule.cloudAutomationDefaultName', '{{name}}自动处理').replace(
      '{{name}}',
      tableName
    ),
    description: tr(
      'schedule.cloudAutomationDescription',
      '自动导入云分析表，完成数据处理后回写云端'
    ),
    projectId: '',
    enabled: true,
    permissionPolicy: 'full_access',
    triggerMode: 'daily',
    trigger,
    actionGraph: {
      version: 1,
      nodes: [
        {
          id: crypto.randomUUID(),
          type: 'conversation.run',
          label: tr('schedule.cloudAutoProcessTitle', '云表自动处理'),
          enabled: true,
          config: {
            prompt: buildCloudAutomationPrompt(config),
            selectedSkillNames: [],
            projectId: '',
            modelConfigSetId: null,
            model: null,
            completionMode: 'wait',
            timeoutMs: 30 * 60 * 1000,
            collectArtifacts: true,
            permissionPolicy: 'full_access',
            cloudAutomation: config,
          },
        },
      ],
      edges: [],
    },
  };
}

function createEmptyCloudTableAutomationConfig(): CloudTableAutomationConfig {
  // Manually added 数据处理 actions default to local→local: most users without a connected
  // cloud-analysis space can use it immediately. The cloud deep-link overrides to cloud.
  return {
    kind: 'cloud_table_auto_process',
    source: {
      location: 'local',
      tableId: '',
      tableName: '',
      columns: [],
      rowCount: null,
    },
    processRequirement: '',
    output: {
      location: 'local',
      writeMode: 'create',
      targetTableId: '',
      tableName: 'processed_table',
    },
  };
}

function createCloudTableProcessNode(): AutomationActionNode {
  const config = createEmptyCloudTableAutomationConfig();
  return {
    id: crypto.randomUUID(),
    type: 'conversation.run',
    label: '',
    enabled: true,
    config: {
      ...defaultConfigForAction('conversation.run'),
      prompt: buildCloudAutomationPrompt(config),
      cloudAutomation: config,
    },
  };
}

function parsePendingCloudAutomationTemplate(raw: string): PendingCloudAutomationTemplate | null {
  try {
    const value = JSON.parse(raw) as Partial<PendingCloudAutomationTemplate>;
    if (!value.source || typeof value.source.tableId !== 'string') return null;
    return {
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
      source: {
        tableId: value.source.tableId,
        tableName:
          typeof value.source.tableName === 'string' && value.source.tableName.trim()
            ? value.source.tableName
            : value.source.tableId,
        spaceId: typeof value.source.spaceId === 'string' ? value.source.spaceId : undefined,
        spaceName: typeof value.source.spaceName === 'string' ? value.source.spaceName : undefined,
        projectId: typeof value.source.projectId === 'string' ? value.source.projectId : undefined,
        projectName:
          typeof value.source.projectName === 'string' ? value.source.projectName : undefined,
        datasourceId:
          typeof value.source.datasourceId === 'string' ? value.source.datasourceId : undefined,
        rowCount:
          typeof value.source.rowCount === 'number' && Number.isFinite(value.source.rowCount)
            ? value.source.rowCount
            : null,
        columns: Array.isArray(value.source.columns) ? value.source.columns : [],
      },
      accessModeLabel:
        typeof value.accessModeLabel === 'string' ? value.accessModeLabel : undefined,
      connectionLabel:
        typeof value.connectionLabel === 'string' ? value.connectionLabel : undefined,
    };
  } catch {
    return null;
  }
}

function parseCloudAutomationConfig(value: unknown): CloudTableAutomationConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Partial<CloudTableAutomationConfig>;
  if (config.kind !== 'cloud_table_auto_process') return null;
  const source = config.source;
  if (!source || typeof source.tableId !== 'string') return null;
  const output = config.output ?? {
    writeMode: 'create' as const,
    targetTableId: '',
    tableName: `${source.tableName || source.tableId}_processed`,
  };
  const writeMode: CloudAutomationWriteMode = output.writeMode === 'replace' ? 'replace' : 'create';
  const sourceLocation = normalizeDataProcessLocation(source.location);
  const outputLocation = normalizeDataProcessLocation(output.location);
  return {
    kind: 'cloud_table_auto_process',
    source: {
      ...source,
      location: sourceLocation,
      tableName:
        typeof source.tableName === 'string' && source.tableName.trim()
          ? source.tableName
          : source.tableId,
      columns: Array.isArray(source.columns) ? source.columns : [],
    },
    processRequirement:
      typeof config.processRequirement === 'string' ? config.processRequirement : '',
    output: {
      location: outputLocation,
      writeMode,
      // Only cloud "replace" falls back to the source table id (overwrite the same cloud
      // table). For local, never default the target to the input — that would overwrite the
      // source dataset; require an explicit target instead.
      targetTableId:
        typeof output.targetTableId === 'string' && output.targetTableId.trim()
          ? output.targetTableId
          : writeMode === 'replace' && outputLocation === 'cloud'
            ? source.tableId
            : '',
      tableName:
        typeof output.tableName === 'string' && output.tableName.trim()
          ? output.tableName
          : `${source.tableName || source.tableId}_processed`,
    },
    accessModeLabel:
      typeof config.accessModeLabel === 'string' ? config.accessModeLabel : undefined,
    connectionLabel:
      typeof config.connectionLabel === 'string' ? config.connectionLabel : undefined,
  };
}

function getCloudAutomationConfigsFromDraft(draft: AutomationDraft): CloudTableAutomationConfig[] {
  return draft.actionGraph.nodes
    .map((node) => parseCloudAutomationConfig(node.config.cloudAutomation))
    .filter((config): config is CloudTableAutomationConfig => Boolean(config));
}

function getAutomationPermissionPolicy(actionGraph: AutomationActionGraph): PermissionPolicyId {
  const conversationNode = actionGraph.nodes.find((node) => node.type === 'conversation.run');
  return normalizePermissionPolicy(conversationNode?.config.permissionPolicy);
}

function buildCloudAutomationPrompt(config: CloudTableAutomationConfig): string {
  const source = config.source;
  const sourceLocation = getSourceLocation(config);
  const outputLocation = getOutputLocation(config);
  const spacePath = [source.spaceName || source.spaceId, source.projectName || source.projectId]
    .filter(Boolean)
    .join(' / ');
  const columns =
    source.columns && source.columns.length > 0
      ? source.columns
          .slice(0, 20)
          .map((column) => (typeof column === 'string' ? column : column.name))
          .filter(Boolean)
          .join(', ')
      : '未知';

  const isLocalSource = sourceLocation === 'local';
  const isLocalOutput = outputLocation === 'local';

  const sourceLines = isLocalSource
    ? [
        '输入数据表（本地）：',
        `- 表名：${source.tableName || '（待选择）'}`,
        `- 输入表 ID：${source.tableId || '（待选择）'}`,
        typeof source.rowCount === 'number' ? `- 行数：${source.rowCount}` : '',
        `- 字段：${columns}`,
      ]
    : [
        '输入云表：',
        `- 表名：${source.tableName}`,
        `- 表 ID：${source.tableId}`,
        spacePath ? `- 空间/项目：${spacePath}` : '',
        typeof source.rowCount === 'number' ? `- 行数：${source.rowCount}` : '',
        `- 字段：${columns}`,
      ];

  const outputInstruction = isLocalOutput
    ? config.output.writeMode === 'replace'
      ? `将处理后的结果覆盖写入本地输出表 ${config.output.targetTableId || '（待填写）'}。`
      : `将处理后的结果保存为新的本地输出表，建议表名为 ${config.output.tableName || '处理结果表'}。`
    : config.output.writeMode === 'replace'
      ? `将处理后的输出表覆盖上传到云表 ${config.output.targetTableId || '（待填写）'}。`
      : `将处理后的输出表上传为新的云表，建议表名为 ${config.output.tableName || '处理结果表'}。`;
  const requirement =
    config.processRequirement.trim() ||
    (isLocalSource
      ? '请根据输入表字段与业务含义生成合理的数据清洗流程。'
      : '请根据云表字段与业务含义生成合理的数据清洗流程。');

  const sourceStep = isLocalSource
    ? '- 直接读取上述本地输入表。'
    : '- 先将上述云表导入为本地输入表。';
  const executionLines = [
    '执行要求：',
    isLocalSource && isLocalOutput
      ? '- 完成本地数据处理并产出输出表，除非遇到会破坏数据的覆盖风险。'
      : '- 自动完成数据导入、本地数据处理、结果输出，除非遇到会破坏数据的覆盖风险。',
    '- 每个关键步骤完成后说明输入表、数据任务、输出表或云表的名称与 ID。',
    '- 如果字段结构不匹配、权限不足或目标表不可覆盖，请停止并说明具体原因。',
  ];

  return [
    isLocalSource ? '请执行一个数据表自动处理流程。' : '请执行一个云分析表自动处理流程。',
    '',
    ...sourceLines,
    '',
    '处理方式：',
    sourceStep,
    '- 根据处理要求创建或更新一个数据任务，在数据任务中完成筛选、字段选择、去重、缺失值处理、汇总统计等步骤。',
    `- 处理要求：${requirement}`,
    '',
    '输出方式：',
    `- ${outputInstruction}`,
    '',
    ...executionLines,
  ]
    .filter(Boolean)
    .join('\n');
}

function automationToDraft(automation: Automation): AutomationDraft {
  const trigger = automation.trigger as EditableAutomationTrigger;
  return {
    name: automation.name,
    description: automation.description ?? '',
    projectId: automation.projectId ?? '',
    enabled: automation.enabled,
    permissionPolicy: getAutomationPermissionPolicy(automation.actionGraph),
    triggerMode: trigger.kind,
    trigger,
    actionGraph: automation.actionGraph.nodes.length
      ? automation.actionGraph
      : createEmptyDraft().actionGraph,
  };
}

function draftToPayload(
  draft: AutomationDraft,
  appConfig: AppConfig | null
): AutomationCreateInput | AutomationUpdateInput {
  return {
    name: draft.name,
    description: draft.description || null,
    projectId: draft.projectId || null,
    enabled: draft.enabled,
    trigger: normalizeDraftTrigger(draft.triggerMode, draft.trigger),
    actionGraph: relinkLinearGraph(
      enrichActionGraphDefaults(draft.actionGraph, appConfig, draft.permissionPolicy)
    ),
  };
}

function enrichActionGraphDefaults(
  actionGraph: AutomationActionGraph,
  appConfig: AppConfig | null,
  permissionPolicy: PermissionPolicyId
): AutomationActionGraph {
  return {
    ...actionGraph,
    nodes: actionGraph.nodes.map((node) => {
      if (node.type !== 'conversation.run') return node;
      const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
      const modelConfigSetId =
        typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
          ? node.config.modelConfigSetId
          : appConfig?.activeConfigSetId;
      const nextConfig = {
        ...node.config,
        permissionPolicy,
        ...(cloudAutomation ? { prompt: buildCloudAutomationPrompt(cloudAutomation) } : {}),
      };
      if (!modelConfigSetId) return { ...node, config: nextConfig };
      return {
        ...node,
        config: {
          ...nextConfig,
          modelConfigSetId,
          model: getAgentModelLabel(appConfig, '', modelConfigSetId) || node.config.model || null,
        },
      };
    }),
  };
}

function normalizeDraftTrigger(
  mode: TriggerMode,
  trigger: EditableAutomationTrigger
): EditableAutomationTrigger {
  const timezone = SYSTEM_TIMEZONE;
  if (mode === 'manual') {
    return {
      kind: 'manual',
      timezone,
    };
  }
  if (mode === 'file_change') {
    const source = trigger.kind === 'file_change' ? trigger : null;
    return {
      kind: 'file_change',
      projectId: source?.projectId ?? null,
      patterns: source?.patterns?.length ? source.patterns : ['**/*'],
      debounceMs: source?.debounceMs ?? 30_000,
      timezone,
    };
  }
  if (mode === 'interval') {
    const source = trigger.kind === 'interval' ? trigger : null;
    return {
      kind: 'interval',
      every: source?.every ?? 1,
      unit: source?.unit ?? 'day',
      startAt: source?.startAt ?? Date.now(),
      endAt: source?.endAt ?? null,
      timezone,
    };
  }
  if (mode === 'daily') {
    return {
      kind: 'daily',
      times: trigger.kind === 'daily' && trigger.times.length ? trigger.times : [DEFAULT_TIME],
      timezone,
    };
  }
  if (mode === 'weekly') {
    return {
      kind: 'weekly',
      weekdays: trigger.kind === 'weekly' ? trigger.weekdays : [1],
      times: trigger.kind === 'weekly' && trigger.times.length ? trigger.times : [DEFAULT_TIME],
      timezone,
    };
  }
  return {
    kind: 'once',
    runAt: trigger.kind === 'once' ? trigger.runAt : Date.now() + 5 * 60 * 1000,
    timezone,
  };
}

function relinkLinearGraph(graph: AutomationActionGraph): AutomationActionGraph {
  return {
    version: 1,
    nodes: graph.nodes,
    edges: graph.nodes.slice(1).map((node, index) => ({
      id: graph.edges[index]?.id ?? crypto.randomUUID(),
      sourceNodeId: graph.nodes[index].id,
      targetNodeId: node.id,
    })),
  };
}

function StatCard({
  label,
  description,
  value,
  Icon,
  iconClassName,
}: {
  label: string;
  description: string;
  value: number;
  Icon: LucideIcon;
  iconClassName: string;
}) {
  return (
    <article className="glass-card flex h-[5.75rem] items-center gap-3 rounded-xl px-3">
      <div
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-[1.25rem] font-medium leading-none text-text-secondary">{value}</div>
        <div className="mt-1.5 whitespace-nowrap text-[13px] font-medium leading-4 text-text-secondary">
          {label}
        </div>
        <div className="mt-1 truncate text-[11px] leading-4 text-text-secondary">{description}</div>
      </div>
    </article>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative h-9 px-2.5 text-left text-[13px] font-medium transition-colors ${
        active ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
      {active && <span className="absolute bottom-0 left-0 h-px w-full rounded-full bg-accent" />}
    </button>
  );
}

function AutomationListPanel({
  automations,
  totalAutomations,
  currentPage,
  selectedId,
  selectedAutomation,
  searchQuery,
  isLoading,
  onCreate,
  onSearchChange,
  onRefresh,
  onPageChange,
  onRun,
  onEdit,
  onDelete,
  onSelect,
  tr,
}: {
  automations: Automation[];
  totalAutomations: number;
  currentPage: number;
  selectedId: string | null;
  selectedAutomation: Automation | null;
  searchQuery: string;
  isLoading: boolean;
  onCreate: () => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: (automation: Automation) => void;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            onClick={onCreate}
            className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {tr('schedule.newAutomation', '新建自动化')}
          </button>
          <DataTableSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={tr('schedule.searchPlaceholder', '搜索自动化')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataToolbarButton
            icon={<Play className="h-3.5 w-3.5" />}
            label={tr('schedule.runNow', '立即运行')}
            disabled={!selectedAutomation || selectedAutomation.status === 'running'}
            onClick={onRun}
          />
          <DataToolbarButton
            icon={<PencilLine className="h-3.5 w-3.5" />}
            label={tr('schedule.configure', '配置')}
            disabled={!selectedAutomation}
            onClick={onEdit}
          />
          <DataToolbarButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={tr('schedule.delete', '删除')}
            disabled={!selectedAutomation}
            danger
            onClick={onDelete}
          />
          <DataMoreMenu
            items={[
              {
                key: 'refresh',
                label: tr('schedule.refresh', '刷新'),
                icon: <RefreshCw className="h-3.5 w-3.5" />,
                onClick: onRefresh,
              },
            ]}
            tr={tr}
          />
        </div>
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <AutomationTable
            automations={automations}
            selectedId={selectedId}
            isLoading={isLoading}
            onSelect={onSelect}
            onEdit={onEdit}
            tr={tr}
          />
        </div>
        <PaginationFooter
          count={totalAutomations}
          currentPage={currentPage}
          onPageChange={onPageChange}
          embedded
        />
      </div>
    </div>
  );
}

function AutomationRunLogPanel({
  automations,
  entries,
  isLoading,
  onRefresh,
  tr,
}: {
  automations: Automation[];
  entries: AutomationRunLogEntry[];
  isLoading: boolean;
  onRefresh: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="mb-3 flex flex-shrink-0 justify-end">
        <DataToolbarButton
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          label={tr('schedule.refresh', '刷新')}
          disabled={automations.length === 0 || isLoading}
          onClick={onRefresh}
        />
      </div>
      <div className="glass-table flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <AutomationRunTable
            entries={entries}
            isLoading={isLoading}
            hasAutomations={automations.length > 0}
            tr={tr}
          />
        </div>
      </div>
    </div>
  );
}

function AutomationRunTable({
  entries,
  isLoading,
  hasAutomations,
  tr,
}: {
  entries: AutomationRunLogEntry[];
  isLoading: boolean;
  hasAutomations: boolean;
  tr: (key: string, fallback: string) => string;
}) {
  if (!hasAutomations) {
    return <EmptyState label={tr('schedule.empty', '还没有自动化')} />;
  }
  if (isLoading) {
    return <LoadingState label={tr('schedule.runsLoading', '正在加载执行日志...')} />;
  }
  if (entries.length === 0) {
    return <EmptyState label={tr('schedule.runsEmpty', '暂无执行记录')} />;
  }
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
            <th className="w-[22%] whitespace-nowrap px-3">
              {tr('schedule.runColumns.automation', '自动化')}
            </th>
            <th className="w-[12%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.status', '状态')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.reason', '触发')}
            </th>
            <th className="w-[18%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.startedAt', '开始时间')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.duration', '耗时')}
            </th>
            <th className="w-[8%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.artifacts', '产物')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.delivery', '交付')}
            </th>
            <th className="w-[20%] whitespace-nowrap px-2">
              {tr('schedule.runColumns.error', '错误信息')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ automation, run }) => (
            <tr
              key={run.id}
              className="h-[3.25rem] border-b border-border-muted/85 last:border-b-0 transition-colors hover:bg-surface-hover/35"
            >
              <td className="truncate px-3 text-[13px] font-medium text-text-secondary">
                {automation.name}
              </td>
              <td className="px-3">
                <AutomationRunStatusBadge status={run.status} tr={tr} />
              </td>
              <td className="truncate px-2 text-[13px] font-medium text-text-secondary">
                {formatRunReason(run.triggerReason, tr)}
              </td>
              <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                {formatAppDateTime(run.startedAt ?? run.queuedAt ?? run.createdAt)}
              </td>
              <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                {formatDurationMs(run.durationMs)}
              </td>
              <td className="px-2 text-[13px] font-medium text-text-secondary">
                {run.artifactCount}
              </td>
              <td className="truncate px-2 text-[13px] font-medium text-text-secondary">
                {formatDeliveryStatus(run.deliveryStatus, tr)}
              </td>
              <td className="truncate px-2 text-[12px] text-text-muted" title={run.error ?? ''}>
                {run.error ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomationTable({
  automations,
  selectedId,
  isLoading,
  onSelect,
  onEdit,
  tr,
}: {
  automations: Automation[];
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (automation: Automation) => void;
  onEdit: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  if (isLoading) {
    return <LoadingState label={tr('schedule.loadingTasks', '正在加载自动化...')} />;
  }
  if (automations.length === 0) {
    return <EmptyState label={tr('schedule.empty', '还没有自动化')} />;
  }
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="h-10 border-b border-border-muted bg-[var(--data-grid-header-surface)] text-xs font-medium text-text-muted backdrop-blur-xl">
            <th className="w-[3%] px-3">
              <span className="sr-only">{tr('schedule.selection', '选择')}</span>
            </th>
            <th className="w-[39%] whitespace-nowrap px-2">
              {tr('schedule.columns.name', '名称')}
            </th>
            <th className="w-[14%] whitespace-nowrap px-2">
              {tr('schedule.columns.status', '状态')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              {tr('schedule.columns.actions', '动作')}
            </th>
            <th className="w-[24%] whitespace-nowrap px-2">
              {tr('schedule.columns.nextRun', '下次执行')}
            </th>
            <th className="w-[10%] whitespace-nowrap px-2">
              <span className="inline-flex items-center gap-1">
                {tr('schedule.columns.updatedAt', '更新时间')}
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {automations.map((automation, index) => {
            const selected = automation.id === selectedId;
            const icon = AUTOMATION_ICON_STYLES[index % AUTOMATION_ICON_STYLES.length];
            const RowIcon = icon.Icon;
            return (
              <tr
                key={automation.id}
                onClick={() => onSelect(automation)}
                onDoubleClick={onEdit}
                className={`h-[3.25rem] cursor-pointer border-b border-border-muted/85 last:border-b-0 transition-colors ${
                  selected
                    ? 'bg-accent/10 ring-1 ring-inset ring-accent/20'
                    : 'hover:bg-surface-hover/35'
                }`}
              >
                <td className="px-3">
                  <input
                    type="radio"
                    name="automation-selection"
                    checked={selected}
                    onChange={() => onSelect(automation)}
                    onClick={(event) => event.stopPropagation()}
                    className="h-3.5 w-3.5 accent-accent"
                    aria-label={automation.name}
                  />
                </td>
                <td className="px-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${icon.className}`}
                    >
                      <RowIcon className="h-4 w-4" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium text-text-secondary">
                        {automation.name}
                      </span>
                      {automation.description && (
                        <span className="truncate text-[11px] text-text-muted">
                          {automation.description}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-2">
                  <AutomationStatusBadge automation={automation} tr={tr} />
                </td>
                <td className="px-2 text-[13px] font-medium text-text-secondary">
                  {automation.actionGraph.nodes.length}
                </td>
                <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                  <span className="truncate">{formatAutomationNextRun(automation, tr)}</span>
                </td>
                <td className="truncate whitespace-nowrap px-2 text-[13px] font-medium text-text-secondary">
                  <span className="truncate">{formatAppDateTime(automation.updatedAt)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const AUTOMATION_ICON_STYLES: Array<{ Icon: LucideIcon; className: string }> = [
  { Icon: CalendarClock, className: 'bg-accent/10 text-accent' },
  { Icon: Database, className: 'bg-[#E9F7F5] text-[#238C80]' },
  { Icon: Bell, className: 'bg-warning/10 text-warning' },
];

const AUTOMATION_STATUS_TONES: Record<Automation['status'], string> = {
  enabled: 'bg-success/10 text-success',
  disabled: 'bg-bg-tertiary text-text-muted',
  failed: 'bg-error/10 text-error',
  paused: 'bg-bg-tertiary text-text-muted',
  running: 'bg-warning/10 text-warning',
};

const AUTOMATION_RUN_STATUS_TONES: Record<AutomationRun['status'], string> = {
  cancelled: 'bg-bg-tertiary text-text-muted',
  failed: 'bg-error/10 text-error',
  queued: 'bg-warning/10 text-warning',
  running: 'bg-warning/10 text-warning',
  succeeded: 'bg-success/10 text-success',
};

function StatusBadge({
  status,
  labelKeyPrefix,
  tone,
  tr,
}: {
  status: string;
  labelKeyPrefix: string;
  tone: string;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <span
      className={`inline-flex h-6 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {tr(`${labelKeyPrefix}.${status}`, status)}
    </span>
  );
}

function AutomationStatusBadge({
  automation,
  tr,
}: {
  automation: Automation;
  tr: (key: string, fallback: string) => string;
}) {
  const tone =
    AUTOMATION_STATUS_TONES[automation.status] ??
    (automation.enabled ? 'bg-success/10 text-success' : 'bg-bg-tertiary text-text-muted');
  return (
    <StatusBadge status={automation.status} labelKeyPrefix="schedule.status" tone={tone} tr={tr} />
  );
}

function formatAutomationNextRun(
  automation: Automation,
  tr: (key: string, fallback: string) => string
): string {
  if (automation.trigger.kind === 'manual') {
    return tr('schedule.manualNextRun', '手动执行');
  }
  return automation.nextRunAt ? formatAppDateTime(automation.nextRunAt) : '-';
}

function AutomationRunStatusBadge({
  status,
  tr,
}: {
  status: AutomationRun['status'];
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <StatusBadge
      status={status}
      labelKeyPrefix="schedule.runStatus"
      tone={AUTOMATION_RUN_STATUS_TONES[status]}
      tr={tr}
    />
  );
}

function formatRunReason(
  reason: AutomationRun['triggerReason'],
  tr: (key: string, fallback: string) => string
): string {
  return tr(`schedule.runReason.${reason}`, reason);
}

function formatDeliveryStatus(
  status: AutomationRun['deliveryStatus'],
  tr: (key: string, fallback: string) => string
): string {
  if (!status) return '-';
  return tr(`schedule.deliveryStatus.${status}`, status);
}

function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null) return '-';
  if (durationMs < 1000) return `${durationMs}ms`;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getRunSortTime(run: AutomationRun): number {
  return run.startedAt ?? run.queuedAt ?? run.createdAt;
}

function DataTableSearch({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-[18rem]">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-border-muted bg-surface pl-8 pr-3 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

function DataToolbarButton({
  icon,
  label,
  disabled,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium shadow-soft transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? 'text-error hover:border-error/30 hover:bg-error/10'
          : 'text-text-secondary hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface DataMoreMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function DataMoreMenu({
  items,
  tr,
}: {
  items: DataMoreMenuItem[];
  tr: (key: string, fallback: string) => string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <GlassDropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      contentClassName="w-40"
      trigger={
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-muted bg-surface text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
          title={tr('data.actions.more', '更多')}
          aria-label={tr('data.actions.more', '更多')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      {items.map((item) => (
        <GlassMenuItem
          key={item.key}
          disabled={item.disabled}
          danger={item.danger}
          icon={item.icon}
          onSelect={item.onClick}
        >
          {item.label}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs text-text-muted">
      {label}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center px-4 py-10 text-center text-xs font-medium text-text-muted">
      <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-background/42 px-3 py-2 shadow-soft">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
        {label}
      </div>
    </div>
  );
}

function PaginationFooter({
  count,
  currentPage,
  onPageChange,
  embedded = false,
}: {
  count: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  embedded?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(count / AUTOMATION_TABLE_PAGE_SIZE));

  return (
    <div
      className={`flex min-h-11 flex-col items-center justify-between gap-2 px-4 text-xs font-medium text-text-secondary sm:flex-row ${
        embedded ? 'border-t border-border-muted py-2.5' : 'mt-3'
      }`}
    >
      <span>共 {count} 条</span>
      <div className="flex items-center gap-2">
        <button className="inline-flex h-8 min-w-[7rem] items-center justify-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-text-secondary shadow-soft">
          {AUTOMATION_TABLE_PAGE_SIZE} 条/页
        </button>
        <button
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border-muted bg-surface px-2 text-text-secondary shadow-soft disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ‹
        </button>
        <span className="min-w-[4rem] text-center">
          {currentPage} / {pageCount}
        </span>
        <button
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border-muted bg-surface px-2 text-text-secondary shadow-soft disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function EditorHeader({
  selectedAutomation,
  draft,
  isSaving,
  onDraftChange,
  onSave,
  onRun,
  onBack,
  tr,
}: {
  selectedAutomation: Automation | null;
  draft: AutomationDraft;
  isSaving: boolean;
  onDraftChange: (draft: AutomationDraft) => void;
  onSave: () => void;
  onRun: () => void;
  onBack: () => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(draft.name);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditingTitle) {
      setLocalTitle(draft.name);
    }
  }, [draft.name, isEditingTitle]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  const commitTitle = () => {
    const nextTitle = localTitle.trim();
    if (nextTitle) {
      onDraftChange({ ...draft, name: nextTitle });
    } else {
      setLocalTitle(draft.name);
    }
    setIsEditingTitle(false);
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 lg:h-10 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <button
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {tr('schedule.backToList', '返回列表')}
        </button>
        <div className="flex min-w-0 items-center gap-2">
          {isEditingTitle ? (
            <span className="flex h-8 min-w-0 max-w-[22rem] items-center rounded-lg border border-accent/40 bg-background/48 px-2.5 shadow-soft ring-2 ring-accent/15">
              <input
                ref={titleInputRef}
                value={localTitle}
                maxLength={80}
                onChange={(event) => setLocalTitle(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setLocalTitle(draft.name);
                    setIsEditingTitle(false);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text-secondary outline-none"
              />
            </span>
          ) : (
            <h1 className="truncate text-[16px] font-semibold text-text-secondary">{draft.name}</h1>
          )}
          {!isEditingTitle && (
            <button
              onClick={() => setIsEditingTitle(true)}
              disabled={isSaving}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
              title={tr('common.edit', '编辑')}
            >
              <PencilLine className="h-3.5 w-3.5" />
              <span className="sr-only">{tr('common.edit', '编辑')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Save className="h-3.5 w-3.5" />
          {tr('schedule.save', '保存')}
        </button>
        {selectedAutomation && (
          <button
            onClick={onRun}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg jade-primary-button px-3 text-xs font-medium text-white shadow-soft transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            {tr('schedule.runNowDetail', '立即运行')}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskStatusSection({
  enabled,
  onEnabledChange,
  tr,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [localEnabled, setLocalEnabled] = useState(enabled);

  useEffect(() => {
    setLocalEnabled(enabled);
  }, [enabled]);

  const handleCheckedChange = useCallback(
    (checked: boolean) => {
      setLocalEnabled(checked);
      onEnabledChange(checked);
    },
    [onEnabledChange]
  );

  return (
    <section className="glass-card grid flex-shrink-0 gap-4 rounded-xl border border-border-muted bg-surface/70 p-4 lg:grid-cols-[360px] lg:items-center">
      <div className="flex min-h-10 items-center gap-4">
        <span className="text-[13px] font-medium text-text-secondary">
          {tr('schedule.taskStatus', '任务状态')}
        </span>
        <GlassSwitch
          checked={localEnabled}
          onCheckedChange={handleCheckedChange}
          ariaLabel={tr('schedule.taskStatus', '任务状态')}
        />
        <span className="text-[13px] font-medium text-text-secondary">
          {localEnabled ? tr('schedule.enabled', '启用') : tr('schedule.disabled', '停用')}
        </span>
      </div>
    </section>
  );
}

function ManualConfigCard({ tr }: { tr: (key: string, fallback: string) => string }) {
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-success">
        <Play className="h-4 w-4" />
        {tr('schedule.manualConfig', '手动触发')}
      </div>
      <p className="text-[12px] leading-5 text-text-muted">
        {tr(
          'schedule.manualConfigDesc',
          '任务保存后不会自动触发。你可以在自动化列表或详情页点击“运行”立即执行。'
        )}
      </p>
    </div>
  );
}

function ExecutionProjectPanel({
  draft,
  projects,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  projects: Project[];
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const updateProject = (projectId: string) => {
    onDraftChange({
      ...draft,
      projectId,
      trigger:
        draft.trigger.kind === 'file_change'
          ? { ...draft.trigger, projectId: projectId || null }
          : draft.trigger,
    });
  };

  return (
    <section className="glass-card flex flex-shrink-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
      <div className="flex h-9 flex-shrink-0 items-center border-b border-border-muted">
        <h2 className="text-[16px] font-semibold text-text-secondary">
          {tr('schedule.projectPanelTitle', '执行项目')}
        </h2>
      </div>
      <div className="pt-4">
        <GlassSelect
          value={draft.projectId}
          options={[
            { value: '', label: tr('schedule.projectPlaceholder', '不指定项目') },
            ...projects.map((project) => ({
              value: project.id,
              label: getProjectOptionLabel(project, tr),
            })),
          ]}
          onValueChange={updateProject}
          placeholder={tr('schedule.projectPlaceholder', '不指定项目')}
          triggerClassName="h-9 w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
      </div>
    </section>
  );
}

function AutomationPermissionPolicyMenu({
  value,
  onChange,
  tr,
}: {
  value: PermissionPolicyId;
  onChange: (policy: PermissionPolicyId) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const activePolicy = normalizePermissionPolicy(value);
  const options = getCloudPermissionPolicyOptions(tr);
  const activeOption = options.find((option) => option.value === activePolicy) ?? options[0];

  return (
    <div className="space-y-2">
      <GlassDropdownMenu
        open={open}
        onOpenChange={setOpen}
        align="start"
        side="bottom"
        contentClassName="w-[30rem] max-w-[calc(100vw-3rem)] p-2"
        trigger={
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-border-muted bg-background/70 px-3 py-2 text-left text-[13px] text-text-secondary shadow-soft transition-colors hover:border-accent/30 hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          >
            <ShieldCheck className="h-4 w-4 flex-shrink-0 text-success" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-text-primary">
                {activeOption.label}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                {activeOption.shortDescription}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
          </button>
        }
      >
        <div className="space-y-1">
          {options.map((option) => {
            const selected = option.value === activePolicy;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? 'bg-accent/10 text-text-primary ring-1 ring-inset ring-accent/20'
                    : 'text-text-secondary hover:bg-background/58 hover:text-text-primary'
                }`}
              >
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  {selected ? (
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                  ) : option.value === 'full_access' ? (
                    <AlertCircle className="h-4 w-4 text-warning" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-text-muted" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-[12px] leading-5 text-text-muted">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </GlassDropdownMenu>
    </div>
  );
}

function getCloudPermissionPolicyOptions(tr: (key: string, fallback: string) => string): Array<{
  value: PermissionPolicyId;
  label: string;
  shortDescription: string;
  description: string;
}> {
  return [
    {
      value: 'full_access',
      label: tr('schedule.cloudPermissionFullAccessRecommended', '完全访问权限（推荐）'),
      shortDescription: tr('schedule.cloudPermissionFullAccessShort', '适合无人值守的自动化任务'),
      description: tr(
        'schedule.cloudPermissionFullAccessDesc',
        '推荐用于无人值守的自动化任务。系统会在该自动化执行会话中跳过大多数权限确认，避免定时任务被中断。'
      ),
    },
    {
      value: 'auto_review',
      label: tr('chat.permissionPolicyAutoReview', '自动审查'),
      shortDescription: tr(
        'schedule.cloudPermissionAutoReviewShort',
        '常见操作自动通过，未知操作仍确认'
      ),
      description: tr(
        'schedule.cloudPermissionAutoReviewDesc',
        '适合需要保留一层审查的自动化任务。常见数据处理和写入会自动通过，未知或高风险操作仍会请求确认。'
      ),
    },
    {
      value: 'default',
      label: tr('chat.permissionPolicyDefault', '默认权限'),
      shortDescription: tr('schedule.cloudPermissionDefaultShort', '敏感操作需要用户确认'),
      description: tr(
        'schedule.cloudPermissionDefaultDesc',
        '适合调试或手动监督的自动化任务。执行到写入、命令等敏感操作时会请求确认，定时任务可能因此暂停等待。'
      ),
    },
  ];
}

function AutomationPromptPermissionFields({
  value,
  onChange,
  selectedSkillNames,
  onSelectedSkillNamesChange,
  onSkillSelectionCommit,
  appConfig,
  selectedModelConfigSetId,
  onModelSelect,
  permissionPolicy,
  onPermissionPolicyChange,
  placeholder,
  label,
  tr,
}: {
  value: string;
  onChange: (value: string) => void;
  selectedSkillNames: string[];
  onSelectedSkillNamesChange: (names: string[]) => void;
  onSkillSelectionCommit: (selection: { value: string; selectedSkillNames: string[] }) => void;
  appConfig: AppConfig | null;
  selectedModelConfigSetId?: string;
  onModelSelect: (selection: { configSetId: string; model: string }) => void;
  permissionPolicy: PermissionPolicyId;
  onPermissionPolicyChange: (policy: PermissionPolicyId) => void;
  placeholder: string;
  label?: string;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <>
      <ConfigRow label={label ?? tr('schedule.conversationPrompt', '指令内容')}>
        <LlmPromptComposer
          value={value}
          onChange={onChange}
          selectedSkillNames={selectedSkillNames}
          onSelectedSkillNamesChange={onSelectedSkillNamesChange}
          onSkillSelectionCommit={onSkillSelectionCommit}
          appConfig={appConfig}
          selectedModelConfigSetId={selectedModelConfigSetId}
          modelDisabled={!appConfig?.model?.trim()}
          modelFallbackLabel={tr('chat.noModel', '未配置模型')}
          placeholder={placeholder}
          onModelSelect={onModelSelect}
        />
      </ConfigRow>
      <ConfigRow label={tr('schedule.permissionPolicy', '权限策略')}>
        <AutomationPermissionPolicyMenu
          value={permissionPolicy}
          onChange={onPermissionPolicyChange}
          tr={tr}
        />
      </ConfigRow>
    </>
  );
}

function TriggerConditionPanel({
  draft,
  projects,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  projects: Project[];
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const trigger = normalizeDraftTrigger(draft.triggerMode, draft.trigger);
  const triggerMethod =
    draft.triggerMode === 'manual'
      ? 'manual'
      : draft.triggerMode === 'file_change'
        ? 'file_change'
        : 'scheduled';
  const setMode = (mode: TriggerMode) => {
    onDraftChange({
      ...draft,
      triggerMode: mode,
      trigger: normalizeDraftTrigger(mode, draft.trigger),
    });
  };

  return (
    <section className="glass-card flex min-h-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
      <div className="flex h-9 flex-shrink-0 items-center border-b border-border-muted">
        <h2 className="text-[16px] font-semibold text-text-secondary">
          {tr('schedule.triggerTitle', '触发条件')}
        </h2>
      </div>
      <div className="pt-4">
        <ConfigRow label={tr('schedule.triggerMethod', '触发方式')}>
          <GlassSelect
            value={triggerMethod}
            options={[
              { value: 'manual', label: tr('schedule.triggerManual', '手动触发') },
              { value: 'scheduled', label: tr('schedule.triggerScheduled', '定时触发') },
              { value: 'file_change', label: tr('schedule.triggerFileChange', '文件变更时触发') },
            ]}
            onValueChange={(value) => {
              if (value === 'manual') {
                setMode('manual');
                return;
              }
              setMode(value === 'file_change' ? 'file_change' : 'daily');
            }}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </ConfigRow>
      </div>

      <div className="mt-6 min-h-0 flex-1">
        {trigger.kind === 'manual' ? (
          <ManualConfigCard tr={tr} />
        ) : trigger.kind === 'file_change' ? (
          <FileChangeConfigCard
            draft={draft}
            trigger={trigger}
            projects={projects}
            onDraftChange={onDraftChange}
            tr={tr}
          />
        ) : (
          <ScheduledConfigCard
            trigger={trigger}
            mode={draft.triggerMode}
            onModeChange={setMode}
            onChange={(next) => onDraftChange({ ...draft, triggerMode: next.kind, trigger: next })}
            tr={tr}
          />
        )}
      </div>
    </section>
  );
}

// Display order Monday→Sunday; encoding stays 0=Sunday … 6=Saturday.
const WEEKDAY_ORDER: Array<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT_FALLBACK: Record<number, string> = {
  0: '日',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
};

function WeekdayPicker({
  value,
  onChange,
  tr,
}: {
  value: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
  onChange: (value: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const selected = new Set(value ?? []);
  const toggle = (day: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {
    const next = new Set(selected);
    if (next.has(day)) {
      // Keep at least one weekday selected — an empty list never computes a next run.
      if (next.size <= 1) return;
      next.delete(day);
    } else {
      next.add(day);
    }
    onChange(WEEKDAY_ORDER.filter((day) => next.has(day)));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAY_ORDER.map((day) => {
        const active = selected.has(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(day)}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-[12px] font-medium transition-colors ${
              active
                ? 'border-success bg-success text-white shadow-soft'
                : 'border-border-muted bg-background/42 text-text-secondary hover:border-accent/25 hover:bg-accent/10 hover:text-accent'
            }`}
          >
            {tr(`schedule.weekdayShort${day}`, WEEKDAY_SHORT_FALLBACK[day])}
          </button>
        );
      })}
    </div>
  );
}

function TimesEditor({
  times,
  onChange,
  tr,
}: {
  times: string[];
  onChange: (times: string[]) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const safeTimes = times && times.length > 0 ? times : [DEFAULT_TIME];
  const updateAt = (index: number, time: string) => {
    onChange(safeTimes.map((existing, position) => (position === index ? time : existing)));
  };
  const removeAt = (index: number) => {
    onChange(safeTimes.filter((_, position) => position !== index));
  };
  return (
    <div className="space-y-1.5">
      {safeTimes.map((time, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <GlassTimePicker value={time} onChange={(next) => updateAt(index, next)} />
          {safeTimes.length > 1 && (
            <button
              type="button"
              onClick={() => removeAt(index)}
              title={tr('schedule.removeTime', '删除')}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-muted text-text-muted transition-colors hover:border-error/30 hover:bg-error/10 hover:text-error"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">{tr('schedule.removeTime', '删除')}</span>
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...safeTimes, DEFAULT_TIME])}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-border-muted px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        {tr('schedule.addTime', '添加时间')}
      </button>
    </div>
  );
}

function ScheduledConfigCard({
  trigger,
  mode,
  onModeChange,
  onChange,
  tr,
}: {
  trigger: ScheduledAutomationTrigger;
  mode: TriggerMode;
  onModeChange: (mode: TriggerMode) => void;
  onChange: (trigger: ScheduledAutomationTrigger) => void;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
      <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-success">
        <Clock className="h-4 w-4" />
        {tr('schedule.scheduledConfig', '定时配置')}
      </div>
      <div className="space-y-3.5">
        <ConfigRow label={tr('schedule.frequency', '执行频率')}>
          <SegmentedControl<'recurring' | 'interval' | 'once'>
            value={mode === 'interval' ? 'interval' : mode === 'once' ? 'once' : 'recurring'}
            options={[
              { value: 'recurring', label: tr('schedule.familyRecurring', '周期') },
              { value: 'interval', label: tr('schedule.familyInterval', '按间隔') },
              { value: 'once', label: tr('schedule.modeOnce', '单次') },
            ]}
            onChange={(family) =>
              onModeChange(
                family === 'interval' ? 'interval' : family === 'once' ? 'once' : 'daily'
              )
            }
          />
        </ConfigRow>
        {(mode === 'daily' || mode === 'weekly') && (
          <ConfigRow label={tr('schedule.repeat', '重复')}>
            <GlassSelect
              value={mode}
              options={[
                { value: 'daily', label: tr('schedule.modeDaily', '每天') },
                { value: 'weekly', label: tr('schedule.modeWeekly', '每周') },
              ]}
              onValueChange={(value: string) => onModeChange(value as TriggerMode)}
              triggerClassName="h-9 w-full justify-between"
            />
          </ConfigRow>
        )}
        {trigger.kind === 'once' && (
          <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
            <div className="space-y-1.5">
              <GlassDateTimePicker
                value={trigger.runAt}
                onChange={(runAt) => onChange({ ...trigger, runAt })}
              />
              {trigger.runAt < Date.now() && (
                <p className="text-[11px] font-medium text-warning">
                  {tr(
                    'schedule.pastTimeWarning',
                    '所选时间已过去，保存后不会触发，请选择未来的时间。'
                  )}
                </p>
              )}
            </div>
          </ConfigRow>
        )}
        {trigger.kind === 'daily' && (
          <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
            <TimesEditor
              times={trigger.times}
              onChange={(times) => onChange({ ...trigger, times })}
              tr={tr}
            />
          </ConfigRow>
        )}
        {trigger.kind === 'weekly' && (
          <>
            <ConfigRow label={tr('schedule.weekday', '执行星期')}>
              <WeekdayPicker
                value={trigger.weekdays}
                onChange={(weekdays) => onChange({ ...trigger, weekdays })}
                tr={tr}
              />
            </ConfigRow>
            <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
              <TimesEditor
                times={trigger.times}
                onChange={(times) => onChange({ ...trigger, times })}
                tr={tr}
              />
            </ConfigRow>
          </>
        )}
        {trigger.kind === 'interval' && (
          <>
            <ConfigRow label={tr('schedule.every', '每')}>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_108px] gap-2">
                  <input
                    type="number"
                    min={1}
                    value={trigger.every}
                    onChange={(event) =>
                      onChange({ ...trigger, every: Number(event.target.value) || 1 })
                    }
                    className="input h-9 w-full text-xs"
                  />
                  <GlassSelect
                    value={trigger.unit}
                    options={[
                      { value: 'minute', label: tr('schedule.repeatUnitMinute', '分钟') },
                      { value: 'hour', label: tr('schedule.repeatUnitHour', '小时') },
                      { value: 'day', label: tr('schedule.repeatUnitDay', '天') },
                    ]}
                    onValueChange={(value: string) =>
                      onChange({ ...trigger, unit: value as 'minute' | 'hour' | 'day' })
                    }
                    triggerClassName="h-9 w-full justify-between"
                  />
                </div>
                <p className="text-[11px] text-text-muted">
                  {tr('schedule.intervalHint', '从开始时间起，每隔固定时长重复一次。')}
                </p>
              </div>
            </ConfigRow>
            <ConfigRow label={tr('schedule.startAt', '开始')}>
              <GlassDateTimePicker
                value={trigger.startAt}
                onChange={(startAt) => onChange({ ...trigger, startAt })}
              />
            </ConfigRow>
            <ConfigRow label={tr('schedule.endAtLabel', '结束')}>
              {trigger.endAt == null ? (
                <button
                  type="button"
                  onClick={() => onChange({ ...trigger, endAt: trigger.startAt + 86400000 })}
                  className="inline-flex h-9 items-center gap-1 self-start rounded-lg border border-dashed border-border-muted px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('schedule.setEndAt', '设置结束时间')}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <GlassDateTimePicker
                    value={trigger.endAt}
                    onChange={(endAt) => onChange({ ...trigger, endAt })}
                  />
                  <button
                    type="button"
                    onClick={() => onChange({ ...trigger, endAt: null })}
                    title={tr('schedule.clearEndAt', '清除结束时间')}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-muted text-text-muted transition-colors hover:border-error/30 hover:bg-error/10 hover:text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">{tr('schedule.clearEndAt', '清除结束时间')}</span>
                  </button>
                </div>
              )}
            </ConfigRow>
          </>
        )}
      </div>
    </div>
  );
}

function FileChangeConfigCard({
  draft,
  trigger,
  projects,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  trigger: Extract<EditableAutomationTrigger, { kind: 'file_change' }>;
  projects: Project[];
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const projectId = trigger.projectId ?? draft.projectId;
  const updateTrigger = (next: Extract<AutomationTrigger, { kind: 'file_change' }>) => {
    onDraftChange({ ...draft, projectId: next.projectId ?? draft.projectId, trigger: next });
  };
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
      <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-success">
        <Folder className="h-4 w-4" />
        {tr('schedule.fileChangeConfig', '文件变更配置')}
      </div>
      <div className="space-y-3.5">
        <ConfigRow label={tr('schedule.watchProject', '监听项目')}>
          <GlassSelect
            value={projectId ?? ''}
            options={[
              { value: '', label: tr('schedule.projectPlaceholder', '不指定项目') },
              ...projects.map((project) => ({
                value: project.id,
                label: getProjectOptionLabel(project, tr),
              })),
            ]}
            onValueChange={(value) => updateTrigger({ ...trigger, projectId: value || null })}
            placeholder={tr('schedule.projectPlaceholder', '不指定项目')}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </ConfigRow>
        <ConfigRow label={tr('schedule.watchPatterns', '文件范围')}>
          <input
            value={trigger.patterns.join(', ')}
            onChange={(event) =>
              updateTrigger({ ...trigger, patterns: splitCsv(event.target.value) })
            }
            placeholder="**/*, **/*.csv"
            className="input h-9 w-full text-xs"
          />
        </ConfigRow>
        <ConfigRow label={tr('schedule.debounceSeconds', '防抖秒数')}>
          <input
            type="number"
            min={1}
            value={Math.round(trigger.debounceMs / 1000)}
            onChange={(event) =>
              updateTrigger({
                ...trigger,
                debounceMs: Math.max(1, Number(event.target.value) || 30) * 1000,
              })
            }
            className="input h-9 w-full text-xs"
          />
        </ConfigRow>
      </div>
    </div>
  );
}

function CloudTableProcessActionEditor({
  node,
  config,
  inputTables,
  outputTables,
  appConfig,
  permissionPolicy,
  onPermissionPolicyChange,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  config: CloudTableAutomationConfig;
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  permissionPolicy: PermissionPolicyId;
  onPermissionPolicyChange: (permissionPolicy: PermissionPolicyId) => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const sourceLocation = getSourceLocation(config);
  const outputLocation = getOutputLocation(config);
  const desktopAuthStatus = useAppStore((state) => state.desktopAuthStatus);
  const cloudConnection = useMemo(
    () => getCloudConnectionPayload(appConfig, desktopAuthStatus),
    [appConfig, desktopAuthStatus]
  );
  const conversationSelectedSkillNames = Array.isArray(node.config.selectedSkillNames)
    ? node.config.selectedSkillNames.filter((name): name is string => typeof name === 'string')
    : [];
  const selectedModelConfigSetId =
    typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
      ? node.config.modelConfigSetId
      : appConfig?.activeConfigSetId;

  const updateConfig = (
    next: CloudTableAutomationConfig,
    nodeConfigUpdates: Record<string, unknown> = {}
  ) => {
    onChange({
      ...node,
      label: '',
      config: {
        ...node.config,
        prompt: buildCloudAutomationPrompt(next),
        cloudAutomation: next,
        ...nodeConfigUpdates,
      },
    });
  };
  const updateSource = (source: CloudAutomationSourceTable) => {
    const previousDefaultName = `${config.source.tableName || 'cloud_table'}_processed`;
    const nextDefaultName = `${source.tableName || 'cloud_table'}_processed`;
    updateConfig({
      ...config,
      source,
      output: {
        ...config.output,
        tableName:
          !config.output.tableName || config.output.tableName === previousDefaultName
            ? nextDefaultName
            : config.output.tableName,
        targetTableId:
          config.output.writeMode === 'replace' &&
          config.output.targetTableId === config.source.tableId
            ? source.tableId
            : config.output.targetTableId,
      },
    });
  };
  const updateSourceLocation = (location: DataProcessLocation) => {
    if (location === sourceLocation) return;
    updateSource({ location, tableId: '', tableName: '', columns: [], rowCount: null });
  };
  const updateLocalSource = (datasetId: string) => {
    const dataset = inputTables.find((table) => table.id === datasetId);
    updateSource({
      location: 'local',
      tableId: datasetId,
      tableName: dataset?.name ?? datasetId,
      columns: [],
      rowCount: dataset?.rowCount ?? null,
    });
  };
  const updateOutputLocation = (location: DataProcessLocation) => {
    if (location === outputLocation) return;
    // Target tables differ between cloud and local, so clear the target on switch.
    updateConfig({ ...config, output: { ...config.output, location, targetTableId: '' } });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-success">
            {sourceLocation === 'local' ? (
              <Database className="h-4 w-4" />
            ) : (
              <Cloud className="h-4 w-4" />
            )}
            {sourceLocation === 'local'
              ? tr('schedule.localInputSection', '输入数据表')
              : tr('schedule.cloudInputTable', '输入云表')}
          </div>
          <SegmentedControl<DataProcessLocation>
            value={sourceLocation}
            options={[
              { value: 'cloud', label: tr('schedule.dataSourceCloud', '云端表') },
              { value: 'local', label: tr('schedule.dataSourceLocal', '本地表') },
            ]}
            onChange={updateSourceLocation}
          />
        </div>
        {sourceLocation === 'local' ? (
          <ConfigRow label={tr('schedule.localInputTable', '数据表')}>
            <LocalTableSelect
              value={config.source.tableId}
              tables={inputTables}
              placeholder={tr('schedule.inputTablePlaceholder', '选择输入表')}
              searchPlaceholder={tr('schedule.localInputSearchPlaceholder', '搜索数据表')}
              onChange={updateLocalSource}
            />
          </ConfigRow>
        ) : (
          <CloudSourceTableSelector
            source={config.source}
            connection={cloudConnection}
            onSourceChange={updateSource}
            tr={tr}
          />
        )}
      </div>

      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-success">
          <Wand2 className="h-4 w-4" />
          {tr('schedule.cloudProcessSection', '处理逻辑')}
        </div>
        <div className="space-y-4">
          <AutomationPromptPermissionFields
            value={config.processRequirement}
            onChange={(processRequirement) =>
              updateConfig({
                ...config,
                processRequirement,
              })
            }
            selectedSkillNames={conversationSelectedSkillNames}
            onSelectedSkillNamesChange={(selectedSkillNames) =>
              updateConfig(config, { selectedSkillNames })
            }
            onSkillSelectionCommit={({ value, selectedSkillNames }) =>
              updateConfig(
                {
                  ...config,
                  processRequirement: value,
                },
                { selectedSkillNames }
              )
            }
            appConfig={appConfig}
            selectedModelConfigSetId={selectedModelConfigSetId}
            onModelSelect={({ configSetId, model }) =>
              updateConfig(config, {
                modelConfigSetId: configSetId,
                model,
              })
            }
            permissionPolicy={permissionPolicy}
            onPermissionPolicyChange={onPermissionPolicyChange}
            label={tr('schedule.cloudProcessRequirement', '处理要求')}
            placeholder={
              sourceLocation === 'local'
                ? tr(
                    'schedule.dataProcessRequirementPlaceholder',
                    '描述你希望对这张表做的处理，例如：筛选 Profit > 0 的数据，保留指定字段，去重后按地区汇总销售额。'
                  )
                : tr(
                    'schedule.cloudProcessRequirementPlaceholder',
                    '描述你希望对云表做的处理，例如：筛选 Profit > 0 的数据，保留指定字段，去重后按地区汇总销售额。'
                  )
            }
            tr={tr}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-success">
            {outputLocation === 'local' ? (
              <Save className="h-4 w-4" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {outputLocation === 'local'
              ? tr('schedule.localOutputSection', '输出到本地')
              : tr('schedule.cloudOutputSection', '输出到云分析')}
          </div>
          <SegmentedControl<DataProcessLocation>
            value={outputLocation}
            options={[
              { value: 'cloud', label: tr('schedule.dataOutputCloud', '云端表') },
              { value: 'local', label: tr('schedule.dataOutputLocal', '本地表') },
            ]}
            onChange={updateOutputLocation}
          />
        </div>
        <div className="space-y-3.5">
          <ConfigRow label={tr('schedule.cloudWriteMode', '写入方式')}>
            <GlassSelect
              value={config.output.writeMode}
              options={[
                { value: 'create', label: tr('schedule.cloudWriteCreate', '新建结果表') },
                { value: 'replace', label: tr('schedule.cloudWriteReplace', '覆盖指定表') },
              ]}
              onValueChange={(value) =>
                updateConfig({
                  ...config,
                  output: {
                    ...config.output,
                    writeMode: value as CloudAutomationWriteMode,
                    targetTableId:
                      value === 'replace'
                        ? config.output.targetTableId ||
                          (outputLocation === 'cloud' ? config.source.tableId : '')
                        : config.output.targetTableId,
                  },
                })
              }
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </ConfigRow>
          {config.output.writeMode === 'replace' ? (
            outputLocation === 'local' ? (
              <ConfigRow label={tr('schedule.localTargetOutputTable', '目标输出表')}>
                <LocalTableSelect
                  value={config.output.targetTableId}
                  tables={outputTables}
                  placeholder={tr('schedule.outputTablePlaceholder', '选择输出表')}
                  searchPlaceholder={tr('schedule.localOutputSearchPlaceholder', '搜索输出表')}
                  onChange={(tableId) =>
                    updateConfig({
                      ...config,
                      output: { ...config.output, targetTableId: tableId },
                    })
                  }
                />
              </ConfigRow>
            ) : (
              <ConfigRow label={tr('schedule.cloudTargetTable', '目标表')}>
                <CloudReplaceTargetSelector
                  config={config}
                  connection={cloudConnection}
                  onTargetChange={(tableId) =>
                    updateConfig({
                      ...config,
                      output: { ...config.output, targetTableId: tableId },
                    })
                  }
                  tr={tr}
                />
              </ConfigRow>
            )
          ) : (
            <ConfigRow label={tr('schedule.cloudOutputTableName', '结果表名')}>
              <input
                value={config.output.tableName}
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    output: { ...config.output, tableName: event.target.value },
                  })
                }
                className="input h-9 w-full text-xs"
              />
            </ConfigRow>
          )}
        </div>
      </div>
    </div>
  );
}

function CloudSourceTableSelector({
  source,
  connection,
  onSourceChange,
  tr,
}: {
  source: CloudAutomationSourceTable;
  connection: CloudConnectionPayload;
  onSourceChange: (source: CloudAutomationSourceTable) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [spaces, setSpaces] = useState<PersonalAnalysisSpace[]>([]);
  const [projects, setProjects] = useState<PersonalAnalysisProject[]>([]);
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const spacesRequestSeq = useRef(0);
  const projectsRequestSeq = useRef(0);
  const tablesRequestSeq = useRef(0);
  const canBrowseCloud = Boolean(connection.apiOrigin && isElectron && window.electronAPI?.data);
  const error = tablesError ?? projectsError ?? spacesError;

  useEffect(() => {
    if (!canBrowseCloud) {
      setSpaces([]);
      setLoadingSpaces(false);
      spacesRequestSeq.current += 1;
      return;
    }
    const requestId = ++spacesRequestSeq.current;
    setLoadingSpaces(true);
    setSpacesError(null);
    void window.electronAPI.data
      .listCloudSpaces(connection)
      .then((result) => {
        if (requestId !== spacesRequestSeq.current) return;
        setSpaces(result.spaces);
      })
      .catch((loadError) => {
        if (requestId !== spacesRequestSeq.current) return;
        setSpaces([]);
        setSpacesError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudCatalogLoadFailed', '加载云分析空间失败')
        );
      })
      .finally(() => {
        if (requestId === spacesRequestSeq.current) {
          setLoadingSpaces(false);
        }
      });
  }, [canBrowseCloud, connection, tr]);

  useEffect(() => {
    if (!canBrowseCloud || !source.spaceId) {
      setProjects([]);
      setLoadingProjects(false);
      setProjectsError(null);
      projectsRequestSeq.current += 1;
      return;
    }
    const requestId = ++projectsRequestSeq.current;
    setLoadingProjects(true);
    setProjectsError(null);
    void window.electronAPI.data
      .listCloudProjects({ ...connection, spaceId: source.spaceId })
      .then((result) => {
        if (requestId !== projectsRequestSeq.current) return;
        setProjects(result.projects);
      })
      .catch((loadError) => {
        if (requestId !== projectsRequestSeq.current) return;
        setProjects([]);
        setProjectsError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudProjectsLoadFailed', '加载云分析项目失败')
        );
      })
      .finally(() => {
        if (requestId === projectsRequestSeq.current) {
          setLoadingProjects(false);
        }
      });
  }, [canBrowseCloud, connection, source.spaceId, tr]);

  useEffect(() => {
    if (!canBrowseCloud || !source.spaceId || !source.projectId) {
      setTables([]);
      setLoadingTables(false);
      setTablesError(null);
      tablesRequestSeq.current += 1;
      return;
    }
    const requestId = ++tablesRequestSeq.current;
    setLoadingTables(true);
    setTablesError(null);
    void window.electronAPI.data
      .listCloudTables({
        ...connection,
        spaceId: source.spaceId,
        projectId: source.projectId,
        keyword: keyword.trim(),
        page: 1,
        pageSize: CLOUD_TARGET_TABLE_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      })
      .then((result) => {
        if (requestId !== tablesRequestSeq.current) return;
        setTables(result.tables);
      })
      .catch((loadError) => {
        if (requestId !== tablesRequestSeq.current) return;
        setTables([]);
        setTablesError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudTablesLoadFailed', '加载云分析表格失败')
        );
      })
      .finally(() => {
        if (requestId === tablesRequestSeq.current) {
          setLoadingTables(false);
        }
      });
  }, [canBrowseCloud, connection, keyword, source.projectId, source.spaceId, tr]);

  const spaceOptions = [
    { value: '', label: tr('schedule.cloudSpacePlaceholder', '选择空间') },
    ...spaces.map((space) => ({ value: space.spaceId, label: space.spaceName || space.spaceId })),
  ];
  const projectOptions = [
    { value: '', label: tr('schedule.cloudProjectPlaceholder', '选择项目') },
    ...projects.map((project) => ({
      value: project.projectId,
      label: project.projectName || project.projectId,
    })),
  ];
  const tableOptions = [
    { value: '', label: tr('schedule.cloudTablePlaceholder', '选择云表') },
    ...tables.map((table) => ({
      value: table.tableId,
      label: `${table.tableName} (${table.tableId})`,
    })),
  ];
  if (source.tableId && !tableOptions.some((option) => option.value === source.tableId)) {
    tableOptions.push({
      value: source.tableId,
      label: `${source.tableName || source.tableId} (${source.tableId})`,
    });
  }

  const selectedTable =
    tables.find((table) => table.tableId === source.tableId) ??
    (source.tableId
      ? ({
          tableId: source.tableId,
          tableName: source.tableName || source.tableId,
          spaceId: source.spaceId,
          projectId: source.projectId || '',
          datasourceId: source.datasourceId,
          columns: source.columns
            ?.map((column) => (typeof column === 'string' ? column : column.name))
            .filter((column): column is string => Boolean(column)),
          rowCount: typeof source.rowCount === 'number' ? source.rowCount : undefined,
        } satisfies PersonalAnalysisTable)
      : null);

  return (
    <div className="space-y-3.5">
      <ConfigRow label={tr('schedule.cloudSpace', '空间')}>
        <div className="relative">
          <GlassSelect
            value={source.spaceId || ''}
            options={spaceOptions}
            onValueChange={(spaceId) => {
              const nextSpace = spaces.find((space) => space.spaceId === spaceId);
              onSourceChange({
                tableId: '',
                tableName: '',
                spaceId: spaceId || undefined,
                spaceName: nextSpace?.spaceName,
                columns: [],
                rowCount: null,
              });
            }}
            disabled={!canBrowseCloud}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
          {loadingSpaces && (
            <Loader2 className="absolute top-1/2 right-8 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </ConfigRow>
      <ConfigRow label={tr('schedule.cloudProject', '项目')}>
        <div className="relative">
          <GlassSelect
            value={source.projectId || ''}
            options={projectOptions}
            onValueChange={(projectId) => {
              const nextProject = projects.find((project) => project.projectId === projectId);
              onSourceChange({
                tableId: '',
                tableName: '',
                spaceId: source.spaceId,
                spaceName: source.spaceName,
                projectId: projectId || undefined,
                projectName: nextProject?.projectName,
                columns: [],
                rowCount: null,
              });
            }}
            disabled={!canBrowseCloud || !source.spaceId}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
          {loadingProjects && (
            <Loader2 className="absolute top-1/2 right-8 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </ConfigRow>
      <ConfigRow label={tr('schedule.cloudTable', '云表')}>
        <div className="space-y-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
            <GlassSelect
              value={source.tableId || ''}
              options={tableOptions}
              onValueChange={(tableId) => {
                const nextTable = tables.find((table) => table.tableId === tableId);
                onSourceChange({
                  tableId,
                  tableName: nextTable?.tableName || '',
                  spaceId: nextTable?.spaceId || source.spaceId,
                  spaceName: source.spaceName,
                  projectId: nextTable?.projectId || source.projectId,
                  projectName: source.projectName,
                  datasourceId: nextTable?.datasourceId,
                  rowCount: nextTable?.rowCount ?? null,
                  columns: nextTable?.columns ?? [],
                });
              }}
              disabled={!canBrowseCloud || !source.spaceId || !source.projectId}
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                disabled={!canBrowseCloud || !source.spaceId || !source.projectId}
                placeholder={tr('schedule.cloudSourceSearchPlaceholder', '搜索云表')}
                className="input h-9 w-full pr-9 pl-8 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              />
              {loadingTables && (
                <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
              )}
            </div>
          </div>
          {selectedTable && (
            <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-3 text-[12px] leading-5 text-text-secondary">
              <div className="grid gap-2 sm:grid-cols-2">
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableName', '表名')}
                  value={selectedTable.tableName}
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableId', '表 ID')}
                  value={selectedTable.tableId}
                  mono
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableLocation', '位置')}
                  value={formatCloudTargetLocation(selectedTable, source)}
                />
                <CloudTargetInfoItem
                  label={tr('schedule.cloudTableRows', '行数')}
                  value={formatCloudTargetRows(selectedTable)}
                />
              </div>
            </div>
          )}
        </div>
      </ConfigRow>

      {!canBrowseCloud && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-2 text-[12px] leading-5 text-text-muted">
          {tr('schedule.cloudConnectRequired', '请先连接云分析空间后再选择云端表。')}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </div>
      )}
    </div>
  );
}

function CloudReplaceTargetSelector({
  config,
  connection,
  onTargetChange,
  tr,
}: {
  config: CloudTableAutomationConfig;
  connection: CloudConnectionPayload;
  onTargetChange: (tableId: string) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const [keyword, setKeyword] = useState('');
  const [tables, setTables] = useState<PersonalAnalysisTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const source = config.source;
  const sourceTable = useMemo<PersonalAnalysisTable>(
    () => ({
      tableId: source.tableId,
      tableName: source.tableName,
      spaceId: source.spaceId,
      projectId: source.projectId || '',
      datasourceId: source.datasourceId,
      columns: source.columns
        ?.map((column) => (typeof column === 'string' ? column : column.name))
        .filter((column): column is string => Boolean(column)),
      rowCount: typeof source.rowCount === 'number' ? source.rowCount : undefined,
    }),
    [source]
  );
  const canBrowseProjectTables = Boolean(
    connection.apiOrigin &&
    source.spaceId &&
    source.projectId &&
    isElectron &&
    window.electronAPI?.data
  );
  const selectedTargetId = config.output.targetTableId || source.tableId;

  useEffect(() => {
    if (!canBrowseProjectTables || !source.spaceId || !source.projectId) {
      setTables([]);
      setLoading(false);
      setError(null);
      requestSeq.current += 1;
      return;
    }

    const requestId = ++requestSeq.current;
    setLoading(true);
    setError(null);
    void window.electronAPI.data
      .listCloudTables({
        ...connection,
        spaceId: source.spaceId,
        projectId: source.projectId,
        keyword: keyword.trim(),
        page: 1,
        pageSize: CLOUD_TARGET_TABLE_PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      })
      .then((result) => {
        if (requestId !== requestSeq.current) return;
        setTables(result.tables);
      })
      .catch((loadError) => {
        if (requestId !== requestSeq.current) return;
        setTables([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : tr('schedule.cloudTargetLoadFailed', '加载同项目云表失败')
        );
      })
      .finally(() => {
        if (requestId === requestSeq.current) {
          setLoading(false);
        }
      });
  }, [canBrowseProjectTables, connection, keyword, source.projectId, source.spaceId, tr]);

  const targetTables = useMemo(() => {
    const byId = new Map<string, PersonalAnalysisTable>();
    byId.set(sourceTable.tableId, sourceTable);
    for (const table of tables) {
      byId.set(table.tableId, table);
    }
    return Array.from(byId.values());
  }, [sourceTable, tables]);
  const selectedTable =
    targetTables.find((table) => table.tableId === selectedTargetId) ??
    (selectedTargetId === source.tableId ? sourceTable : null);
  const isReplacingSource = selectedTargetId === source.tableId;
  const options = [
    {
      value: source.tableId,
      label: tr('schedule.cloudReplaceSourceOption', '覆盖源表：{{name}}').replace(
        '{{name}}',
        source.tableName
      ),
    },
    ...targetTables
      .filter((table) => table.tableId !== source.tableId)
      .map((table) => ({
        value: table.tableId,
        label: `${table.tableName} (${table.tableId})`,
      })),
  ];
  if (selectedTargetId && !options.some((option) => option.value === selectedTargetId)) {
    options.push({
      value: selectedTargetId,
      label: tr('schedule.cloudSelectedTargetFallback', '已选目标表：{{id}}').replace(
        '{{id}}',
        selectedTargetId
      ),
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
        <GlassSelect
          value={selectedTargetId}
          options={options}
          onValueChange={onTargetChange}
          triggerClassName="h-9 w-full justify-between"
          contentClassName="w-[var(--radix-select-trigger-width)]"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            disabled={!canBrowseProjectTables}
            placeholder={tr('schedule.cloudTargetSearchPlaceholder', '搜索同项目云表')}
            className="input h-9 w-full pr-9 pl-8 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />
          )}
        </div>
      </div>

      {!canBrowseProjectTables && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-2 text-[12px] leading-5 text-text-muted">
          {tr(
            'schedule.cloudTargetBrowseUnavailable',
            '当前连接或源表项目信息不足，暂时只能默认覆盖源表。'
          )}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-5 text-warning">
          {error}
        </div>
      )}

      {selectedTable && (
        <div className="rounded-lg border border-border-muted bg-bg-secondary/30 px-3 py-3 text-[12px] leading-5 text-text-secondary">
          <div
            className={`mb-2 flex items-center gap-2 font-semibold ${
              isReplacingSource ? 'text-error' : 'text-warning'
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {isReplacingSource
              ? tr('schedule.cloudReplaceSourceWarningTitle', '将覆盖原始输入云表')
              : tr('schedule.cloudReplaceTargetWarningTitle', '将覆盖所选云表')}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableName', '表名')}
              value={selectedTable.tableName}
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableLocation', '位置')}
              value={formatCloudTargetLocation(selectedTable, source)}
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableId', '表 ID')}
              value={selectedTable.tableId}
              mono
            />
            <CloudTargetInfoItem
              label={tr('schedule.cloudTableRows', '行数')}
              value={formatCloudTargetRows(selectedTable)}
            />
          </div>
          <div className="mt-2 text-[12px] text-text-muted">
            {isReplacingSource
              ? tr(
                  'schedule.cloudReplaceSourceWarningDesc',
                  '运行后会用处理结果覆盖这张源表的数据，请确认这是预期操作。'
                )
              : tr(
                  'schedule.cloudReplaceTargetWarningDesc',
                  '运行后会用处理结果覆盖目标表数据，请确认目标表选择正确。'
                )}
          </div>
        </div>
      )}
    </div>
  );
}

function CloudTargetInfoItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-text-primary ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '-'}
      </div>
    </div>
  );
}

function getCloudConnectionPayload(
  appConfig: AppConfig | null,
  desktopAuthStatus: DesktopAuthStatus
): CloudConnectionPayload {
  const storedConnection = appConfig?.personalAnalysis;
  if (desktopAuthStatus.authenticated && desktopAuthStatus.apiOrigin) {
    return { apiOrigin: desktopAuthStatus.apiOrigin };
  }
  if (storedConnection?.apiOrigin && storedConnection.apiKey) {
    return { apiOrigin: storedConnection.apiOrigin, apiKey: storedConnection.apiKey };
  }
  return { apiOrigin: storedConnection?.apiOrigin || '' };
}

function formatCloudTargetLocation(
  table: PersonalAnalysisTable,
  source: CloudAutomationSourceTable
): string {
  const space =
    table.spaceId === source.spaceId ? source.spaceName || table.spaceId : table.spaceId;
  const project =
    table.projectId === source.projectId ? source.projectName || table.projectId : table.projectId;
  return [space, project].filter(Boolean).join(' / ') || '-';
}

function formatCloudTargetRows(table: PersonalAnalysisTable): string {
  return typeof table.rowCount === 'number' ? String(table.rowCount) : '-';
}

function ActionChainSection({
  draft,
  actionDefinitions,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onDraftChange,
  onPermissionPolicyChange,
  tr,
}: {
  draft: AutomationDraft;
  actionDefinitions: AutomationActionDefinitionSummary[];
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onDraftChange: (draft: AutomationDraft) => void;
  onPermissionPolicyChange: (permissionPolicy: PermissionPolicyId) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const nodes = draft.actionGraph.nodes;
  const updateNodes = (nextNodes: AutomationActionNode[]) =>
    onDraftChange({
      ...draft,
      actionGraph: relinkLinearGraph({ version: 1, nodes: nextNodes, edges: [] }),
    });
  const availableActionTypes = new Set(actionDefinitions.map((definition) => definition.type));
  const menuActionTypes = [
    ...ACTION_MENU_TYPES.filter((type) => availableActionTypes.has(type)),
    ...(availableActionTypes.has('conversation.run') ? [CLOUD_TABLE_PROCESS_ACTION_TYPE] : []),
  ];
  const addNode = (type: string) => {
    if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) {
      updateNodes([...nodes, createCloudTableProcessNode()]);
      return;
    }
    updateNodes([
      ...nodes,
      {
        id: crypto.randomUUID(),
        type,
        label: '',
        enabled: true,
        config: defaultConfigForAction(type),
      },
    ]);
  };
  const addActionButton = (
    <GlassDropdownMenu
      trigger={
        <button className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-success bg-success/5 px-2.5 text-xs font-semibold text-success transition-colors hover:bg-success/10">
          <Plus size={13} />
          {tr('schedule.addAction', '添加动作')}
        </button>
      }
    >
      {menuActionTypes.map((type) => (
        <GlassMenuItem
          key={type}
          onSelect={() => addNode(type)}
          description={getActionMenuDescription(type, tr)}
        >
          {getActionTitle(type, type, tr)}
        </GlassMenuItem>
      ))}
    </GlassDropdownMenu>
  );
  return (
    <section className="glass-card flex min-h-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-b border-border-muted">
        <h2 className="min-w-0 text-[16px] font-semibold text-text-secondary">
          {tr('schedule.actionsTitle', '执行动作')}
        </h2>
        {addActionButton}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto pt-4 pr-1">
        {nodes.map((node, index) => (
          <ActionStepCard
            key={node.id}
            node={node}
            index={index}
            dataTasks={dataTasks}
            inputTables={inputTables}
            outputTables={outputTables}
            appConfig={appConfig}
            permissionPolicy={draft.permissionPolicy}
            onPermissionPolicyChange={onPermissionPolicyChange}
            onRemove={() => updateNodes(nodes.filter((item) => item.id !== node.id))}
            onChange={(next) =>
              updateNodes(nodes.map((item) => (item.id === next.id ? next : item)))
            }
            tr={tr}
          />
        ))}
      </div>
    </section>
  );
}

function ActionStepCard({
  node,
  index,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  permissionPolicy,
  onPermissionPolicyChange,
  onRemove,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  index: number;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  permissionPolicy: PermissionPolicyId;
  onPermissionPolicyChange: (permissionPolicy: PermissionPolicyId) => void;
  onRemove: () => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const Icon = getActionIcon(node.type, node);
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/20 p-4">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-success/12 text-[13px] font-semibold text-success">
          {index + 1}
        </span>
        <Icon className="h-5 w-5 flex-shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-secondary">
          {getNodeLabel(node, tr)}
        </div>
        <MiniIcon
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={13} />
        </MiniIcon>
      </div>
      <ActionConfigEditor
        node={node}
        dataTasks={dataTasks}
        inputTables={inputTables}
        outputTables={outputTables}
        appConfig={appConfig}
        permissionPolicy={permissionPolicy}
        onPermissionPolicyChange={onPermissionPolicyChange}
        onChange={onChange}
        tr={tr}
      />
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border-muted bg-bg-secondary/30 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-md px-3 text-[12px] font-medium transition-colors ${
              active ? 'bg-success/15 text-success' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type DataProcessMode = 'ai' | 'task';

// Unified "数据处理" action editor. A single "处理方式" switch toggles between describing
// the transformation with AI (a cloud-table conversation node) and reusing a saved data
// task (a data.task.run node). Switching modes rewrites the underlying node type in place.
function getStashedDataProcessConfig(
  config: Record<string, unknown>,
  key: typeof DATA_PROCESS_AI_CONFIG_KEY | typeof DATA_PROCESS_TASK_CONFIG_KEY
): Record<string, unknown> | null {
  const value = config[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function DataProcessActionEditor({
  node,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  permissionPolicy,
  onPermissionPolicyChange,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  permissionPolicy: PermissionPolicyId;
  onPermissionPolicyChange: (permissionPolicy: PermissionPolicyId) => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
  const mode: DataProcessMode = node.type === 'data.task.run' ? 'task' : 'ai';
  const setConfig = (config: Record<string, unknown>) => onChange({ ...node, config });
  const switchMode = (next: DataProcessMode) => {
    if (next === mode) return;
    if (next === 'task') {
      const stashedTaskConfig =
        getStashedDataProcessConfig(node.config, DATA_PROCESS_TASK_CONFIG_KEY) ??
        defaultConfigForAction('data.task.run');
      onChange({
        ...node,
        type: 'data.task.run',
        label: '',
        config: {
          ...stashedTaskConfig,
          [DATA_PROCESS_AI_CONFIG_KEY]: node.config,
        },
      });
      return;
    }
    const cloudNode = createCloudTableProcessNode();
    const stashedAiConfig =
      getStashedDataProcessConfig(node.config, DATA_PROCESS_AI_CONFIG_KEY) ?? cloudNode.config;
    onChange({
      ...node,
      type: 'conversation.run',
      label: '',
      config: {
        ...stashedAiConfig,
        [DATA_PROCESS_TASK_CONFIG_KEY]: node.config,
      },
    });
  };
  return (
    <div className="space-y-4">
      <ConfigRow label={tr('schedule.dataProcessModeLabel', '处理方式')}>
        <SegmentedControl<DataProcessMode>
          value={mode}
          options={[
            { value: 'ai', label: tr('schedule.dataProcessModeAi', 'AI 处理') },
            { value: 'task', label: tr('schedule.dataProcessModeTask', '复用数据任务') },
          ]}
          onChange={switchMode}
        />
      </ConfigRow>
      {mode === 'ai' && cloudAutomation && (
        <CloudTableProcessActionEditor
          node={node}
          config={cloudAutomation}
          inputTables={inputTables}
          outputTables={outputTables}
          appConfig={appConfig}
          permissionPolicy={permissionPolicy}
          onPermissionPolicyChange={onPermissionPolicyChange}
          onChange={onChange}
          tr={tr}
        />
      )}
      {mode === 'task' && (
        <>
          <ConfigRow label={tr('schedule.dataTaskLabel', '数据任务')}>
            <LocalTableSelect
              value={String(node.config.taskId ?? '')}
              tables={dataTasks}
              placeholder={tr('schedule.dataTaskPlaceholder', '选择数据任务')}
              searchPlaceholder={tr('schedule.dataTaskSearchPlaceholder', '搜索数据任务')}
              onChange={(value) =>
                setConfig({ ...node.config, taskId: value, outputMode: 'persisted' })
              }
            />
          </ConfigRow>
          <ConfigRow label={tr('schedule.executionMode', '执行方式')}>
            <GlassSelect
              value={String(node.config.outputMode ?? 'persisted')}
              options={[
                { value: 'persisted', label: tr('schedule.executionFormal', '正式执行') },
                { value: 'temporary', label: tr('schedule.executionTemporary', '临时执行') },
              ]}
              onValueChange={(value) => setConfig({ ...node.config, outputMode: value })}
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </ConfigRow>
        </>
      )}
    </div>
  );
}

function ActionConfigEditor({
  node,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  permissionPolicy,
  onPermissionPolicyChange,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  permissionPolicy: PermissionPolicyId;
  onPermissionPolicyChange: (permissionPolicy: PermissionPolicyId) => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const configRef = useRef(node.config);
  useEffect(() => {
    configRef.current = node.config;
  }, [node.config]);
  const setConfig = (config: Record<string, unknown>) => {
    configRef.current = config;
    onChange({ ...node, config });
  };
  const conversationPrompt = String(node.config.prompt ?? '');
  const conversationSelectedSkillNames = useMemo(
    () =>
      Array.isArray(node.config.selectedSkillNames)
        ? node.config.selectedSkillNames.filter((name): name is string => typeof name === 'string')
        : [],
    [node.config.selectedSkillNames]
  );
  const selectedModelConfigSetId =
    typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
      ? node.config.modelConfigSetId
      : appConfig?.activeConfigSetId;
  const cloudAutomation = parseCloudAutomationConfig(node.config.cloudAutomation);
  return (
    <div className="space-y-4">
      {isDataProcessNode(node) && (
        <DataProcessActionEditor
          node={node}
          dataTasks={dataTasks}
          inputTables={inputTables}
          outputTables={outputTables}
          appConfig={appConfig}
          permissionPolicy={permissionPolicy}
          onPermissionPolicyChange={onPermissionPolicyChange}
          onChange={onChange}
          tr={tr}
        />
      )}
      {node.type === 'data.input.preview' && (
        <ConfigRow label={tr('schedule.inputDataLabel', '输入数据')}>
          <SelectLine
            value={String(node.config.inputTableId ?? '')}
            options={inputTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.inputTablePlaceholder', '选择输入表')}
            onChange={(value) => setConfig({ ...node.config, inputTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'data.output.preview' && (
        <ConfigRow label={tr('schedule.outputDataLabel', '输出表')}>
          <SelectLine
            value={String(node.config.outputTableId ?? '')}
            options={outputTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.outputTablePlaceholder', '选择输出表')}
            onChange={(value) => setConfig({ ...node.config, outputTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'conversation.run' && !cloudAutomation && (
        <AutomationPromptPermissionFields
          value={conversationPrompt}
          onChange={(prompt) => setConfig({ ...node.config, prompt })}
          selectedSkillNames={conversationSelectedSkillNames}
          onSelectedSkillNamesChange={(selectedSkillNames) =>
            setConfig({ ...node.config, selectedSkillNames })
          }
          onSkillSelectionCommit={({ value, selectedSkillNames }) =>
            setConfig({ ...node.config, prompt: value, selectedSkillNames })
          }
          appConfig={appConfig}
          selectedModelConfigSetId={selectedModelConfigSetId}
          onModelSelect={({ configSetId, model }) =>
            setConfig({
              ...node.config,
              modelConfigSetId: configSetId,
              model,
            })
          }
          permissionPolicy={permissionPolicy}
          onPermissionPolicyChange={onPermissionPolicyChange}
          placeholder={tr('schedule.promptPlaceholder', '输入任务对话要执行的内容')}
          tr={tr}
        />
      )}
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-[12px] font-medium text-text-secondary sm:grid-cols-[112px_1fr] sm:items-start">
      <span className="pt-2">{label}</span>
      {children}
    </label>
  );
}

function SelectLine({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <GlassSelect
      value={value}
      options={[{ value: '', label: placeholder }, ...options]}
      onValueChange={onChange}
      placeholder={placeholder}
      triggerClassName="h-9 w-full justify-between"
      contentClassName="w-[var(--radix-select-trigger-width)]"
    />
  );
}

// A dropdown paired with a client-side name filter, mirroring the cloud table picker layout.
// Use for local input/output tables, where the full list can be large.
function LocalTableSelect({
  value,
  tables,
  placeholder,
  searchPlaceholder,
  onChange,
}: {
  value: string;
  tables: Array<{ id: string; name: string }>;
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const normalized = keyword.trim().toLowerCase();
  const filtered = normalized
    ? tables.filter((table) => table.name.toLowerCase().includes(normalized))
    : tables;
  const selected = tables.find((table) => table.id === value);
  // Keep the selected table in the option list even when filtered out, so its label still shows.
  const visible =
    selected && !filtered.some((table) => table.id === value) ? [selected, ...filtered] : filtered;
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(11rem,0.5fr)]">
      <GlassSelect
        value={value}
        options={[
          { value: '', label: placeholder },
          ...visible.map((table) => ({ value: table.id, label: table.name })),
        ]}
        onValueChange={onChange}
        placeholder={placeholder}
        triggerClassName="h-9 w-full justify-between"
        contentClassName="w-[var(--radix-select-trigger-width)]"
      />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={searchPlaceholder}
          className="input h-9 w-full pr-3 pl-8 text-xs"
        />
      </div>
    </div>
  );
}

function MiniIcon({
  onClick,
  children,
}: {
  onClick: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-tertiary"
    >
      {children}
    </span>
  );
}

function getActionTitle(
  type: string,
  fallback: string,
  tr: (key: string, fallback: string) => string
): string {
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  if (type === 'conversation.run') {
    return tr('schedule.actionTypes.conversationRun.title', fallback);
  }
  if (type === 'data.task.run') {
    return tr('schedule.actionTypes.dataTaskRun.title', fallback);
  }
  if (isDataActionType(type)) {
    return tr('schedule.actionTypes.data.title', fallback);
  }
  return fallback;
}

function getActionMenuDescription(
  type: string,
  tr: (key: string, fallback: string) => string
): string | undefined {
  if (type === CLOUD_TABLE_PROCESS_ACTION_TYPE) {
    return tr(
      'schedule.dataProcessActionDescription',
      '对指定数据表做结构化加工（AI 生成或复用已有数据任务）'
    );
  }
  if (type === 'conversation.run') {
    return tr(
      'schedule.actionTypes.conversationRun.description',
      '用自然语言下达开放式指令，由 AI 自主完成'
    );
  }
  return undefined;
}

function getActionIcon(type: string, node?: AutomationActionNode): LucideIcon {
  if (node && isDataProcessNode(node)) return Database;
  if (type === 'conversation.run') return MessagesSquare;
  if (isDataActionType(type)) return Database;
  return CalendarClock;
}

// A node belongs to the unified "数据处理" action when it either runs a saved data task
// (复用数据任务) or is a cloud-table conversation carrying a cloudAutomation config (AI 描述).
function isDataProcessNode(node: AutomationActionNode): boolean {
  if (node.type === 'data.task.run') return true;
  return (
    node.type === 'conversation.run' &&
    Boolean(parseCloudAutomationConfig(node.config.cloudAutomation))
  );
}

function getNodeLabel(
  node: AutomationActionNode,
  tr: (key: string, fallback: string) => string
): string {
  if (isDataProcessNode(node)) {
    return tr('schedule.dataProcessActionTitle', '数据处理');
  }
  const fallback = getActionTitle(node.type, node.type, tr);
  if (!node.label || node.label === node.type) return fallback;
  if (node.type === 'conversation.run' && node.label === 'Conversation') return fallback;
  if (node.type === 'data.task.run' && node.label === 'Data task') return fallback;
  return node.label;
}

function defaultConfigForAction(type: string): Record<string, unknown> {
  if (type === 'conversation.run') {
    return {
      prompt: '',
      selectedSkillNames: [],
      projectId: '',
      modelConfigSetId: null,
      model: null,
      completionMode: 'wait',
      timeoutMs: 30 * 60 * 1000,
      collectArtifacts: true,
      permissionPolicy: 'full_access',
    };
  }
  if (type === 'data.task.run') return { taskId: '', outputMode: 'persisted' };
  if (type === 'data.input.preview') return { inputTableId: '', limit: 20 };
  if (type === 'data.output.preview') return { outputTableId: '', limit: 20 };
  return {};
}

function isDataActionType(type: string): boolean {
  return DATA_ACTION_TYPES.includes(type) || DATA_PREVIEW_ACTION_TYPES.includes(type);
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
