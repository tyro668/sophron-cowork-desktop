import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  Clock3,
  Database,
  Folder,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type {
  Automation,
  AutomationActionDefinitionSummary,
  AutomationActionGraph,
  AutomationActionNode,
  AutomationCreateInput,
  AutomationTrigger,
  AutomationUpdateInput,
  AppConfig,
  DataCleaningTask,
  DataDashboard,
  Project,
} from '../../types';
import { useAppStore } from '../../store';
import { AgentModelSelector, getAgentModelLabel } from '../AgentModelSelector';
import { GlassDropdownMenu, GlassMenuItem } from '../GlassDropdownMenu';
import { GlassSelect } from '../GlassSelect';
import { formatAppDateTime } from '../../utils/i18n-format';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const AUTOMATION_TABLE_PAGE_SIZE = 10;
const DEFAULT_NOTIFICATION_RECIPIENT = '运营群';
const NOTIFICATION_RECIPIENT_OPTIONS = [
  { value: DEFAULT_NOTIFICATION_RECIPIENT, labelKey: 'schedule.notificationOpsGroup', fallback: '运营群' },
  { value: '销售群', labelKey: 'schedule.notificationSalesGroup', fallback: '销售群' },
  { value: '数据团队', labelKey: 'schedule.notificationDataTeam', fallback: '数据团队' },
];

type TriggerMode = AutomationTrigger['kind'];
type Banner = { tone: 'error' | 'success'; text: string };

export function SettingsSchedule({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const appConfig = useAppStore((state) => state.appConfig);
  const tr = useCallback(
    (key: string, fallback: string) => t(key, { defaultValue: fallback }),
    [t]
  );
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [actionDefinitions, setActionDefinitions] = useState<AutomationActionDefinitionSummary[]>([]);
  const [dataDashboard, setDataDashboard] = useState<DataDashboard | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [draft, setDraft] = useState<AutomationDraft>(() => createEmptyDraft());
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

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
  const totalPages = Math.max(1, Math.ceil(filteredAutomations.length / AUTOMATION_TABLE_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageAutomations = useMemo(() => {
    const start = (safeCurrentPage - 1) * AUTOMATION_TABLE_PAGE_SIZE;
    return filteredAutomations.slice(start, start + AUTOMATION_TABLE_PAGE_SIZE);
  }, [filteredAutomations, safeCurrentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const load = useCallback(async () => {
    if (!isElectron) return;
    setIsLoading(true);
    setBanner(null);
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
      setAutomations(automationRows);
      setActionDefinitions(actions);
      setDataDashboard(dashboard);
      if (!selectedId && automationRows[0]) {
        setSelectedId(automationRows[0].id);
        setDraft(automationToDraft(automationRows[0]));
      }
    } catch (error) {
      setBanner({
        tone: 'error',
        text: error instanceof Error ? error.message : tr('schedule.loadFailed', '加载自动化失败'),
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedId, tr]);

  useEffect(() => {
    if (!isActive) return;
    void load();
  }, [isActive, load]);

  useEffect(() => {
    if (!selectedAutomation) return;
    setDraft(automationToDraft(selectedAutomation));
  }, [selectedAutomation]);

  const createNew = () => {
    setSelectedId(null);
    setDraft(createEmptyDraft());
    setViewMode('detail');
    setBanner(null);
  };

  const openSelectedDetail = () => {
    if (!selectedAutomation) return;
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
      setDraft(automationToDraft(saved));
      setViewMode('detail');
      setBanner({ tone: 'success', text: tr('schedule.saved', '自动化已保存') });
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
    if (!window.confirm(tr('schedule.deleteConfirm', '确认删除这个自动化？'))) return;
    await window.electronAPI.automation.delete(selectedAutomation.id);
    setSelectedId(null);
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
          onDelete={() => void remove()}
          onBack={() => setViewMode('list')}
          tr={tr}
        />

        <section className="flex min-h-0 flex-1 flex-col gap-4">
          <TaskStatusSection draft={draft} onDraftChange={setDraft} tr={tr} />
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
          <TabButton active label={tr('schedule.tabs.automations', '自动化')} onClick={() => undefined} />
        </div>
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
            setSelectedId(automation.id);
            setDraft(automationToDraft(automation));
          }}
          tr={tr}
        />
      </section>
    </div>
  );
}

interface AutomationDraft {
  name: string;
  description: string;
  projectId: string;
  enabled: boolean;
  triggerMode: TriggerMode;
  trigger: AutomationTrigger;
  actionGraph: AutomationActionGraph;
}

function createEmptyDraft(): AutomationDraft {
  const trigger: AutomationTrigger = {
    kind: 'once',
    runAt: Date.now() + 5 * 60 * 1000,
    timezone: SYSTEM_TIMEZONE,
  };
  const conversationNodeId = crypto.randomUUID();
  const dataTaskNodeId = crypto.randomUUID();
  return {
    name: 'New automation',
    description: '',
    projectId: '',
    enabled: true,
    triggerMode: 'once',
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
            projectId: '',
            modelConfigSetId: null,
            model: null,
            completionMode: 'wait',
            timeoutMs: 30 * 60 * 1000,
            collectArtifacts: true,
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
      edges: [{ id: crypto.randomUUID(), sourceNodeId: conversationNodeId, targetNodeId: dataTaskNodeId }],
    },
  };
}

function automationToDraft(automation: Automation): AutomationDraft {
  return {
    name: automation.name,
    description: automation.description ?? '',
    projectId: automation.projectId ?? '',
    enabled: automation.enabled,
    triggerMode: automation.trigger.kind,
    trigger: automation.trigger,
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
    actionGraph: relinkLinearGraph(enrichActionGraphDefaults(draft.actionGraph, appConfig)),
  };
}

function enrichActionGraphDefaults(
  actionGraph: AutomationActionGraph,
  appConfig: AppConfig | null
): AutomationActionGraph {
  return {
    ...actionGraph,
    nodes: actionGraph.nodes.map((node) => {
      if (node.type !== 'conversation.run') return node;
      const modelConfigSetId =
        typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
          ? node.config.modelConfigSetId
          : appConfig?.activeConfigSetId;
      if (!modelConfigSetId) return node;
      return {
        ...node,
        config: {
          ...node.config,
          modelConfigSetId,
          model: getAgentModelLabel(appConfig, '', modelConfigSetId) || node.config.model || null,
        },
      };
    }),
  };
}

function normalizeDraftTrigger(mode: TriggerMode, trigger: AutomationTrigger): AutomationTrigger {
  const timezone = trigger.timezone || SYSTEM_TIMEZONE;
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
      times: trigger.kind === 'daily' ? trigger.times : ['08:00'],
      timezone,
    };
  }
  if (mode === 'weekly') {
    return {
      kind: 'weekly',
      weekdays: trigger.kind === 'weekly' ? trigger.weekdays : [1],
      times: trigger.kind === 'weekly' ? trigger.times : ['08:00'],
      timezone,
    };
  }
  if (mode === 'cron') {
    return {
      kind: 'cron',
      expression: trigger.kind === 'cron' ? trigger.expression : '0 9 * * 1',
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
        <div className="mt-1 truncate text-[11px] leading-4 text-text-secondary">
          {description}
        </div>
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
      {active && (
        <span className="absolute bottom-0 left-0 h-px w-full rounded-full bg-accent" />
      )}
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
            <th className="w-[39%] whitespace-nowrap px-2">{tr('schedule.columns.name', '名称')}</th>
            <th className="w-[14%] whitespace-nowrap px-2">{tr('schedule.columns.status', '状态')}</th>
            <th className="w-[10%] whitespace-nowrap px-2">{tr('schedule.columns.actions', '动作')}</th>
            <th className="w-[24%] whitespace-nowrap px-2">{tr('schedule.columns.nextRun', '下次执行')}</th>
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
                  <span className="truncate">
                    {automation.nextRunAt ? formatAppDateTime(automation.nextRunAt) : '-'}
                  </span>
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
  { Icon: MessageSquare, className: 'bg-surface-active/70 text-text-secondary' },
];

function AutomationStatusBadge({
  automation,
  tr,
}: {
  automation: Automation;
  tr: (key: string, fallback: string) => string;
}) {
  const tone =
    automation.status === 'failed'
      ? 'bg-error/10 text-error'
      : automation.status === 'running'
        ? 'bg-warning/10 text-warning'
        : automation.status === 'paused'
          ? 'bg-bg-tertiary text-text-muted'
          : automation.enabled
            ? 'bg-success/10 text-success'
            : 'bg-bg-tertiary text-text-muted';
  return (
    <span
      className={`inline-flex h-6 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {tr(`schedule.status.${automation.status}`, automation.status)}
    </span>
  );
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
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);

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
          disabled={safeCurrentPage <= 1}
          onClick={() => onPageChange(safeCurrentPage - 1)}
        >
          ‹
        </button>
        <span className="min-w-[4rem] text-center">
          {safeCurrentPage} / {pageCount}
        </span>
        <button
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border-muted bg-surface px-2 text-text-secondary shadow-soft disabled:cursor-not-allowed disabled:opacity-45"
          disabled={safeCurrentPage >= pageCount}
          onClick={() => onPageChange(safeCurrentPage + 1)}
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
  onDelete,
  onBack,
  tr,
}: {
  selectedAutomation: Automation | null;
  draft: AutomationDraft;
  isSaving: boolean;
  onDraftChange: (draft: AutomationDraft) => void;
  onSave: () => void;
  onRun: () => void;
  onDelete: () => void;
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
        {selectedAutomation && (
          <IconButton label={tr('schedule.delete', '删除')} onClick={onDelete}>
            <Trash2 size={14} />
          </IconButton>
        )}
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
            {tr('schedule.runNow', '立即运行')}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskStatusSection({
  draft,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  return (
    <section className="glass-card grid flex-shrink-0 gap-4 rounded-xl border border-border-muted bg-surface/70 p-4 lg:grid-cols-[360px] lg:items-center">
      <div className="flex min-h-10 items-center gap-4">
        <span className="text-[13px] font-medium text-text-secondary">
          {tr('schedule.taskStatus', '任务状态')}
        </span>
        <Switch.Root
          checked={draft.enabled}
          onCheckedChange={(checked) => onDraftChange({ ...draft, enabled: checked })}
          className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border p-0.5 shadow-soft outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 ${
            draft.enabled ? 'border-success bg-success' : 'border-border-muted bg-bg-tertiary'
          }`}
          aria-label={tr('schedule.taskStatus', '任务状态')}
        >
          <Switch.Thumb
            className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
              draft.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </Switch.Root>
        <span className="text-[13px] font-medium text-text-secondary">
          {draft.enabled ? tr('schedule.enabled', '启用') : tr('schedule.disabled', '停用')}
        </span>
      </div>
    </section>
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
      <h2 className="pb-3 text-[16px] font-semibold text-text-secondary">
        {tr('schedule.projectPanelTitle', '执行项目')}
      </h2>
      <div className="border-t border-border-muted pt-4">
        <GlassSelect
          value={draft.projectId}
          options={[
            { value: '', label: tr('schedule.projectPlaceholder', '不指定项目') },
            ...projects.map((project) => ({
              value: project.id,
              label: project.name?.trim() || project.cwd,
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
  const triggerMethod = draft.triggerMode === 'file_change' ? 'file_change' : 'scheduled';
  const setMode = (mode: TriggerMode) => {
    onDraftChange({ ...draft, triggerMode: mode, trigger: normalizeDraftTrigger(mode, draft.trigger) });
  };

  return (
    <section className="glass-card flex min-h-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
      <h2 className="pb-3 text-[16px] font-semibold text-text-secondary">
        {tr('schedule.triggerTitle', '触发条件')}
      </h2>
      <div className="border-t border-border-muted pt-4">
        <ConfigRow label={tr('schedule.triggerMethod', '触发方式')}>
          <GlassSelect
            value={triggerMethod}
            options={[
              { value: 'scheduled', label: tr('schedule.triggerScheduled', '定时触发') },
              { value: 'file_change', label: tr('schedule.triggerFileChange', '文件变更时触发') },
            ]}
            onValueChange={(value) => setMode(value === 'file_change' ? 'file_change' : 'daily')}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </ConfigRow>
      </div>

      <div className="mt-6 min-h-0 flex-1">
        {trigger.kind === 'file_change' ? (
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

function ScheduledConfigCard({
  trigger,
  mode,
  onModeChange,
  onChange,
  tr,
}: {
  trigger: Exclude<AutomationTrigger, { kind: 'file_change' }>;
  mode: TriggerMode;
  onModeChange: (mode: TriggerMode) => void;
  onChange: (trigger: AutomationTrigger) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const timezone = trigger.timezone || SYSTEM_TIMEZONE;
  return (
    <div className="rounded-lg border border-border-muted bg-bg-secondary/30 p-4">
      <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-success">
        <Clock className="h-4 w-4" />
        {tr('schedule.scheduledConfig', '定时配置')}
      </div>
      <div className="space-y-3.5">
        <ConfigRow label={tr('schedule.frequency', '频率')}>
          <GlassSelect
            value={mode === 'file_change' ? 'daily' : mode}
            options={[
              { value: 'once', label: tr('schedule.modeOnce', '单次') },
              { value: 'daily', label: tr('schedule.modeDaily', '每天') },
              { value: 'weekly', label: tr('schedule.modeWeekly', '每周') },
              { value: 'interval', label: tr('schedule.modeInterval', '周期') },
              { value: 'cron', label: tr('schedule.modeCron', 'Cron') },
            ]}
            onValueChange={(value: string) => onModeChange(value as TriggerMode)}
            triggerClassName="h-9 w-full justify-between"
          />
        </ConfigRow>
        {trigger.kind === 'once' && (
          <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
            <input
              type="datetime-local"
              value={toLocalInput(trigger.runAt)}
              onChange={(event) => onChange({ ...trigger, runAt: new Date(event.target.value).getTime() })}
              className="input h-9 w-full text-xs"
            />
          </ConfigRow>
        )}
        {trigger.kind === 'daily' && (
          <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
            <input
              type="time"
              value={trigger.times[0] ?? '09:00'}
              onChange={(event) => onChange({ ...trigger, times: [event.target.value || '09:00'] })}
              className="input h-9 w-full text-xs"
            />
          </ConfigRow>
        )}
        {trigger.kind === 'weekly' && (
          <>
            <ConfigRow label={tr('schedule.weekday', '星期')}>
              <input
                value={trigger.weekdays.join(',')}
                onChange={(event) =>
                  onChange({
                    ...trigger,
                    weekdays: splitCsv(event.target.value)
                      .map(Number)
                      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6) as Array<0 | 1 | 2 | 3 | 4 | 5 | 6>,
                  })
                }
                placeholder="1,2,3,4,5"
                className="input h-9 w-full text-xs"
              />
            </ConfigRow>
            <ConfigRow label={tr('schedule.executionTime', '执行时间')}>
              <input
                type="time"
                value={trigger.times[0] ?? '09:00'}
                onChange={(event) => onChange({ ...trigger, times: [event.target.value || '09:00'] })}
                className="input h-9 w-full text-xs"
              />
            </ConfigRow>
          </>
        )}
        {trigger.kind === 'interval' && (
          <>
            <ConfigRow label={tr('schedule.every', '每')}>
              <div className="grid grid-cols-[1fr_108px] gap-2">
                <input
                  type="number"
                  min={1}
                  value={trigger.every}
                  onChange={(event) => onChange({ ...trigger, every: Number(event.target.value) || 1 })}
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
            </ConfigRow>
            <ConfigRow label={tr('schedule.startAt', '开始')}>
              <input
                type="datetime-local"
                value={toLocalInput(trigger.startAt)}
                onChange={(event) => onChange({ ...trigger, startAt: new Date(event.target.value).getTime() })}
                className="input h-9 w-full text-xs"
              />
            </ConfigRow>
          </>
        )}
        {trigger.kind === 'cron' && (
          <ConfigRow label={tr('schedule.cronExpression', 'Cron 表达式')}>
            <input
              value={trigger.expression}
              onChange={(event) => onChange({ ...trigger, expression: event.target.value })}
              placeholder="0 9 * * 1"
              className="input h-9 w-full text-xs"
            />
          </ConfigRow>
        )}
        <ConfigRow label={tr('schedule.timezone', '时区')}>
          <GlassSelect
            value={timezone}
            options={Array.from(new Set([SYSTEM_TIMEZONE, 'Asia/Shanghai', 'UTC'])).map((value) => ({
              value,
              label: value,
            }))}
            onValueChange={(value) => onChange({ ...trigger, timezone: value })}
            triggerClassName="h-9 w-full justify-between"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        </ConfigRow>
        <div className="mt-1 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-xs font-medium text-success">
          <CalendarClock className="h-4 w-4" />
          {formatTriggerSummary(trigger, tr)}
        </div>
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
  trigger: Extract<AutomationTrigger, { kind: 'file_change' }>;
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
                label: project.name?.trim() || project.cwd,
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
            onChange={(event) => updateTrigger({ ...trigger, patterns: splitCsv(event.target.value) })}
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
              updateTrigger({ ...trigger, debounceMs: Math.max(1, Number(event.target.value) || 30) * 1000 })
            }
            className="input h-9 w-full text-xs"
          />
        </ConfigRow>
        <div className="mt-1 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-xs font-medium text-success">
          <CalendarClock className="h-4 w-4" />
          {projectId
            ? tr('schedule.fileChangeSummary', '文件变更后自动执行')
            : tr('schedule.fileChangeNeedsProject', '请选择一个项目用于监听文件变更')}
        </div>
      </div>
    </div>
  );
}

function ActionChainSection({
  draft,
  actionDefinitions,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onDraftChange,
  tr,
}: {
  draft: AutomationDraft;
  actionDefinitions: AutomationActionDefinitionSummary[];
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onDraftChange: (draft: AutomationDraft) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const nodes = draft.actionGraph.nodes;
  const updateNodes = (nextNodes: AutomationActionNode[]) =>
    onDraftChange({ ...draft, actionGraph: relinkLinearGraph({ version: 1, nodes: nextNodes, edges: [] }) });
  const addNode = (definition: AutomationActionDefinitionSummary) => {
    updateNodes([
      ...nodes,
      {
        id: crypto.randomUUID(),
        type: definition.type,
        label: '',
        enabled: true,
        config: defaultConfigForAction(definition.type),
      },
    ]);
  };
  return (
    <section className="glass-card flex min-h-0 flex-col rounded-xl border border-border-muted bg-surface/70 p-4">
      <h2 className="pb-3 text-[16px] font-semibold text-text-secondary">
        {tr('schedule.actionsTitle', '执行操作')}
      </h2>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto border-t border-border-muted pt-4 pr-1">
        {nodes.map((node, index) => (
          <ActionStepCard
            key={node.id}
            node={node}
            index={index}
            dataTasks={dataTasks}
            inputTables={inputTables}
            outputTables={outputTables}
            appConfig={appConfig}
            onRemove={() => updateNodes(nodes.filter((item) => item.id !== node.id))}
            onChange={(next) => updateNodes(nodes.map((item) => (item.id === next.id ? next : item)))}
            tr={tr}
          />
        ))}
        <GlassDropdownMenu
          trigger={
            <button className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-success bg-success/5 text-[13px] font-semibold text-success transition-colors hover:bg-success/10">
              <Plus size={16} />
              {tr('schedule.addAction', '添加操作')}
            </button>
          }
        >
          {actionDefinitions.map((definition) => (
            <GlassMenuItem key={definition.type} onSelect={() => addNode(definition)}>
              {getActionTitle(definition.type, definition.title, tr)}
            </GlassMenuItem>
          ))}
        </GlassDropdownMenu>
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
  onRemove: () => void;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const Icon = getActionIcon(node.type);
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
        <div className="flex flex-shrink-0 items-center gap-1 text-text-muted">
          <GripVertical className="h-4 w-4" />
          <MiniIcon onClick={(event) => { event.stopPropagation(); onRemove(); }}>
            <Trash2 size={13} />
          </MiniIcon>
        </div>
      </div>
      <ActionConfigEditor
        node={node}
        dataTasks={dataTasks}
        inputTables={inputTables}
        outputTables={outputTables}
        appConfig={appConfig}
        onChange={onChange}
        tr={tr}
      />
    </div>
  );
}

function ActionConfigEditor({
  node,
  dataTasks,
  inputTables,
  outputTables,
  appConfig,
  onChange,
  tr,
}: {
  node: AutomationActionNode;
  dataTasks: DataCleaningTask[];
  inputTables: DataDashboard['datasets'];
  outputTables: DataDashboard['outputTables'];
  appConfig: AppConfig | null;
  onChange: (node: AutomationActionNode) => void;
  tr: (key: string, fallback: string) => string;
}) {
  const setConfig = (config: Record<string, unknown>) => onChange({ ...node, config });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const currentRecipient = String(node.config.recipient ?? '');
  const selectedModelConfigSetId =
    typeof node.config.modelConfigSetId === 'string' && node.config.modelConfigSetId.trim()
      ? node.config.modelConfigSetId
      : appConfig?.activeConfigSetId;
  const notificationRecipientOptions = [
    ...NOTIFICATION_RECIPIENT_OPTIONS.map((option) => ({
      value: option.value,
      label: tr(option.labelKey, option.fallback),
    })),
    ...(currentRecipient &&
    !NOTIFICATION_RECIPIENT_OPTIONS.some((option) => option.value === currentRecipient)
      ? [{ value: currentRecipient, label: currentRecipient }]
      : []),
  ];
  return (
    <div className="space-y-4">
      {node.type === 'notification.send' && (
        <>
          <ConfigRow label={tr('schedule.notificationRecipient', '通知对象')}>
            <GlassSelect
              value={currentRecipient}
              options={[
                { value: '', label: tr('schedule.recipientPlaceholder', '选择通知对象') },
                ...notificationRecipientOptions,
              ]}
              onValueChange={(value) => setConfig({ ...node.config, channel: 'feishu', recipient: value })}
              placeholder={tr('schedule.recipientPlaceholder', '选择通知对象')}
              triggerClassName="h-9 w-full justify-between"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </ConfigRow>
          <ConfigRow label={tr('schedule.notificationContent', '通知内容')}>
            <textarea
              value={String(node.config.message ?? '')}
              onChange={(event) => setConfig({ ...node.config, message: event.target.value })}
              placeholder={tr('schedule.notificationContentPlaceholder', '销售数据已更新，请查看仪表板')}
              className="input min-h-[74px] w-full resize-none text-xs leading-5"
            />
          </ConfigRow>
        </>
      )}
      {node.type === 'data.task.run' && (
        <>
          <ConfigRow label={tr('schedule.dataTaskLabel', '任务')}>
            <SelectLine
              value={String(node.config.taskId ?? '')}
              options={dataTasks.map((task) => ({ value: task.id, label: task.name }))}
              placeholder={tr('schedule.dataTaskPlaceholder', '选择数据任务')}
              onChange={(value) => setConfig({ ...node.config, taskId: value, outputMode: 'persisted' })}
            />
          </ConfigRow>
          <ConfigRow label={tr('schedule.executionMode', '执行方式')}>
            <SelectLine
              value={String(node.config.outputMode ?? 'persisted')}
              options={[
                { value: 'persisted', label: tr('schedule.executionImmediate', '立即执行') },
                { value: 'temporary', label: tr('schedule.executionTemporary', '临时执行') },
              ]}
              placeholder={tr('schedule.executionImmediate', '立即执行')}
              onChange={(value) => setConfig({ ...node.config, outputMode: value })}
            />
          </ConfigRow>
        </>
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
      {(node.type === 'data.output.preview' || node.type === 'data.output.export') && (
        <ConfigRow label={tr('schedule.outputDataLabel', '输出表')}>
          <SelectLine
            value={String(node.config.outputTableId ?? '')}
            options={outputTables.map((table) => ({ value: table.id, label: table.name }))}
            placeholder={tr('schedule.outputTablePlaceholder', '选择输出表')}
            onChange={(value) => setConfig({ ...node.config, outputTableId: value, limit: 20 })}
          />
        </ConfigRow>
      )}
      {node.type === 'conversation.run' && (
        <ConfigRow label={tr('schedule.conversationPrompt', '任务内容')}>
          <div className="chat-composer-panel flex min-h-[116px] flex-col px-3 py-2.5">
            <textarea
              value={String(node.config.prompt ?? '')}
              onChange={(event) => setConfig({ ...node.config, prompt: event.target.value })}
              placeholder={tr('schedule.promptPlaceholder', '输入任务对话要执行的内容')}
              className="min-h-[58px] flex-1 resize-none overflow-y-auto border-none bg-transparent text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <AgentModelSelector
                open={modelMenuOpen}
                onOpenChange={setModelMenuOpen}
                appConfig={appConfig}
                selectedConfigSetId={selectedModelConfigSetId}
                fallbackLabel={tr('chat.noModel', '未配置模型')}
                disabled={!appConfig?.model?.trim()}
                side="bottom"
                align="end"
                triggerClassName="composer-flat-pill inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-medium"
                onSelect={(configSetId) =>
                  setConfig({
                    ...node.config,
                    modelConfigSetId: configSetId,
                    model: getAgentModelLabel(appConfig, '', configSetId),
                  })
                }
              />
            </div>
          </div>
        </ConfigRow>
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

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-text-muted hover:bg-bg-secondary"
    >
      {children}
    </button>
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
  if (type === 'notification.send') {
    return tr('schedule.actionTypes.notificationSend.title', fallback);
  }
  if (type === 'conversation.run') {
    return tr('schedule.actionTypes.conversationRun.title', fallback);
  }
  if (type === 'data.task.run') {
    return tr('schedule.actionTypes.dataTaskRun.title', fallback);
  }
  if (type === 'data.input.preview') {
    return tr('schedule.actionTypes.dataInputPreview.title', fallback);
  }
  if (type === 'data.output.preview') {
    return tr('schedule.actionTypes.dataOutputPreview.title', fallback);
  }
  if (type === 'data.output.export') {
    return tr('schedule.actionTypes.dataOutputExport.title', fallback);
  }
  return fallback;
}

function getActionIcon(type: string): LucideIcon {
  if (type === 'notification.send') return MessageSquare;
  if (type === 'conversation.run') return MessageSquare;
  if (type.startsWith('data.')) return Database;
  return CalendarClock;
}

function formatTriggerSummary(
  trigger: Exclude<AutomationTrigger, { kind: 'file_change' }>,
  tr: (key: string, fallback: string) => string
): string {
  if (trigger.kind === 'daily') {
    return tr('schedule.summaryDaily', `每天 ${trigger.times[0] ?? '09:00'} 自动执行`).replace(
      '{{time}}',
      trigger.times[0] ?? '09:00'
    );
  }
  if (trigger.kind === 'weekly') {
    return tr('schedule.summaryWeekly', `每周 ${trigger.weekdays.join(',')} ${trigger.times[0] ?? '09:00'} 自动执行`)
      .replace('{{weekdays}}', trigger.weekdays.join(','))
      .replace('{{time}}', trigger.times[0] ?? '09:00');
  }
  if (trigger.kind === 'interval') {
    return tr('schedule.summaryInterval', `每 ${trigger.every} ${trigger.unit} 自动执行`)
      .replace('{{every}}', String(trigger.every))
      .replace('{{unit}}', trigger.unit);
  }
  if (trigger.kind === 'cron') {
    return tr('schedule.summaryCron', `按 Cron ${trigger.expression} 自动执行`).replace(
      '{{expression}}',
      trigger.expression
    );
  }
  return tr('schedule.summaryOnce', `在 ${formatAppDateTime(trigger.runAt)} 自动执行`).replace(
    '{{time}}',
    formatAppDateTime(trigger.runAt)
  );
}

function getNodeLabel(
  node: AutomationActionNode,
  tr: (key: string, fallback: string) => string
): string {
  const fallback = getActionTitle(node.type, node.type, tr);
  if (!node.label || node.label === node.type) return fallback;
  if (node.type === 'conversation.run' && node.label === 'Conversation') return fallback;
  if (node.type === 'data.task.run' && node.label === 'Data task') return fallback;
  return node.label;
}

function defaultConfigForAction(type: string): Record<string, unknown> {
  if (type === 'notification.send') {
    return { channel: 'feishu', recipient: DEFAULT_NOTIFICATION_RECIPIENT, message: '' };
  }
  if (type === 'conversation.run') {
    return {
      prompt: '',
      projectId: '',
      modelConfigSetId: null,
      model: null,
      completionMode: 'wait',
      timeoutMs: 30 * 60 * 1000,
      collectArtifacts: true,
    };
  }
  if (type === 'data.task.run') return { taskId: '', outputMode: 'persisted' };
  if (type === 'data.input.preview') return { inputTableId: '', limit: 20 };
  if (type === 'data.output.preview') return { outputTableId: '', limit: 20 };
  if (type === 'data.output.export') return { outputTableId: '', format: 'csv' };
  return {};
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
