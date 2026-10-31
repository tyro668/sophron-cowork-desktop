import { loadDataPipelineResources } from '../../features/data/api/data-pipeline-resources';
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
  TabBarActionSlot,
  underlineTabBarClass,
  useTabBarActionSlot,
  underlineTabListClass,
  fixedUnderlineTabTriggerClass,
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
  const navigateToDataElement = useAppStore((state) => state.navigateToDataElement);
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
  const [tableReturnTarget, setTableReturnTarget] = useState<DataResourceTarget | null>(null);
  const [activeListTab, setActiveListTab] = useState<ListTab>('automations');
  const tabBarAction = useTabBarActionSlot();
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
        draftToPayload(createEmptyDraft(tr('schedule.newAutomation', '新建自动化')), appConfig)
      );
    }
    return null;
  }, [viewMode, selectedId, selectedAutomation, appConfig, tr]);
  const isDraftDirty = draftSignature !== null && draftSignature !== baselineSignature;
  // Which sections differ from the saved automation (for the unsaved bar).
  const unsavedParts = useMemo(() => {
    if (!isDraftDirty || !selectedAutomation) return [];
    const saved = draftToPayload(automationToDraft(selectedAutomation), appConfig);
    const current = draftToPayload(draft, appConfig);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const parts: string[] = [];
    if (saved.name !== current.name) parts.push(tr('schedule.partName', '名称'));
    if (!same(saved.trigger, current.trigger)) parts.push(tr('schedule.partTrigger', '触发条件'));
    if (saved.projectId !== current.projectId) parts.push(tr('schedule.partProject', '执行项目'));
    if (saved.enabled !== current.enabled) parts.push(tr('schedule.partEnabled', '启用状态'));
    if (!same(saved.actionGraph, current.actionGraph)) {
      const savedNodes = saved.actionGraph?.nodes ?? [];
      const changed = (current.actionGraph?.nodes ?? []).filter(
        (node, index) => !same(savedNodes[index] ?? null, node)
      ).length;
      parts.push(
        `${tr('schedule.partActions', '动作')} ${Math.max(changed, 1)} ${tr('schedule.partActionsUnit', '项')}`
      );
    }
    return parts;
  }, [isDraftDirty, selectedAutomation, draft, appConfig, tr]);
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
            window.electronAPI.automation.list({ perGroupLimit: AUTOMATION_TABLE_PAGE_SIZE }),
            window.electronAPI.automation.groups.list(),
            window.electronAPI.automation.listActionDefinitions(),
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
    setTableReturnTarget(outputNavigation.returnTarget ?? null);
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
            outputNavigation.rawTable &&
            !next.actionGraph.nodes.some(
              (node) =>
                node.type === 'cloud.sync' &&
                node.config.direction === 'input' &&
                node.config.rawTableId === outputNavigation.rawTable?.id
            )
          ) {
            const node = {
              id: crypto.randomUUID(),
              type: 'cloud.sync',
              enabled: true,
              config: {
                direction: 'input',
                spaceId: outputNavigation.cloudSource?.spaceId ?? '',
                projectId: outputNavigation.cloudSource?.projectId ?? '',
                tableId: outputNavigation.cloudSource?.tableId ?? '',
                tableKind: outputNavigation.cloudSource?.tableKind ?? 'analysis',
                tableName: outputNavigation.cloudSource?.tableName,
                rawTableId: outputNavigation.rawTable.id,
                rawTableName: outputNavigation.rawTable.name,
              },
            };
            next.actionGraph = relinkLinearGraph({
              ...next.actionGraph,
              nodes: [node, ...next.actionGraph.nodes],
            });
          }
          setDraft(next);
        })
        .catch((error) => setBanner({ tone: 'error', text: String(error) }));
    } else if (outputNavigation.scriptPackage) {
      // 创建自动化 from the script editor: 执行脚本 (this package) on a daily trigger; not saved.
      const pkg = outputNavigation.scriptPackage;
      const base = createEmptyDraft(pkg.name);
      setSelectedId(null);
      setDraft({
        ...base,
        trigger: { ...base.trigger, kind: 'daily', times: [pkg.time] },
        actionGraph: {
          version: 1,
          edges: [],
          nodes: [
            {
              id: crypto.randomUUID(),
              type: 'script.run',
              enabled: true,
              config: { packageId: pkg.id, timeoutMs: 120_000, onScriptError: 'notify' },
            },
          ],
        },
      });
    } else if (outputNavigation.resultTable) {
      const table = outputNavigation.resultTable;
      setSelectedId(null);
      setDraft({
        ...createEmptyDraft(table.name),
        triggerMode: 'manual',
        trigger: {
          kind: 'manual',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        tableBindings: [
          { kind: 'result', tableId: table.id, runOnChange: true, runOnTrigger: true },
        ],
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
                resultTableId: table.id,
                type: 'drive_file',
                writeMode: 'create',
                spaceId: '',
                projectId: '',
              },
            },
          ],
        },
      });
    } else if (outputNavigation.rawTable || outputNavigation.newRawTableName !== undefined) {
      const table = outputNavigation.rawTable;
      const cloudSource = outputNavigation.cloudSource;
      const name =
        table?.name ||
        outputNavigation.newRawTableName ||
        tr('schedule.cloudInput.title', '云端表同步到原始表');
      setSelectedId(null);
      if (table && !cloudSource) {
        setDraft({
          ...createEmptyDraft(name),
          triggerMode: 'manual',
          trigger: {
            kind: 'manual',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          },
          tableBindings: [
            { kind: 'raw', tableId: table.id, runOnChange: true, runOnTrigger: false },
          ],
          actionGraph: {
            version: 1,
            edges: [],
            nodes: [
              {
                id: crypto.randomUUID(),
                type: 'data.pipeline.run',
                enabled: true,
                config: { pipelineId: '', outputMode: 'persisted' },
              },
            ],
          },
        });
        return;
      }
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
                rawTableId: table?.id,
                rawTableName:
                  table?.name || outputNavigation.newRawTableName || cloudSource?.tableName || '',
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
            ? tr('schedule.localTargetRequired', '请选择目标结果表')
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

  const toggleEnabled = async (automation: Automation, enabled: boolean) => {
    setAutomations((rows) =>
      rows.map((row) => (row.id === automation.id ? { ...row, enabled } : row))
    );
    try {
      let saved = await window.electronAPI.automation.update(automation.id, { enabled });
      if (saved?.status === 'paused' && enabled) {
        saved = await window.electronAPI.automation.resume(saved.id);
      }
      await load();
      setBanner({
        tone: 'success',
        text: enabled
          ? tr('schedule.enabledNotice', '已启用「{{name}}」').replace('{{name}}', automation.name)
          : tr('schedule.disabledNotice', '已停用「{{name}}」').replace(
              '{{name}}',
              automation.name
            ),
      });
    } catch (error) {
      await load();
      setBanner({
        tone: 'error',
        text: error instanceof Error ? error.message : tr('schedule.saveFailed', '保存自动化失败'),
      });
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
          isDirty={isDraftDirty}
          onDraftChange={setDraft}
          onEnabledChange={updateDraftEnabled}
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
          tr={tr}
        />
        {isDraftDirty && selectedAutomation && (
          <div className="flex h-9 flex-shrink-0 items-center justify-between gap-3 border-b border-warning/20 bg-warning/8 px-4 text-[12.5px] text-text-primary">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warning" />
              <span className="truncate">
                {tr('schedule.unsavedChanges', '有未保存的修改')}
                {unsavedParts.length > 0 && `：${unsavedParts.join('、')}`}
              </span>
            </span>
            <button
              type="button"
              className="flex-shrink-0 text-xs text-text-secondary hover:text-text-primary"
              onClick={() => setDraft(automationToDraft(selectedAutomation))}
            >
              {tr('schedule.discardChanges', '放弃修改')}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:overflow-hidden">
          <div className="min-h-0 border-b border-border-subtle md:overflow-y-auto md:border-b-0 md:border-r">
            <div>
              <ExecutionProjectPanel
                draft={draft}
                projects={projects}
                onDraftChange={setDraft}
                tr={tr}
              />
              <TriggerConditionPanel
                draft={draft}
                projects={projects}
                nextRunAt={selectedAutomation?.nextRunAt ?? null}
                triggerDirty={
                  !selectedAutomation ||
                  (() => {
                    const saved = automationToDraft(selectedAutomation);
                    return (
                      saved.triggerMode !== draft.triggerMode ||
                      JSON.stringify(saved.trigger) !== JSON.stringify(draft.trigger)
                    );
                  })()
                }
                onDraftChange={setDraft}
                tr={tr}
              />
            </div>
          </div>
          <ActionChainSection
            baselineNodes={
              selectedAutomation
                ? automationToDraft(selectedAutomation).actionGraph.nodes
                : undefined
            }
            workingDirectory={projects.find((project) => project.id === draft.projectId)?.cwd}
            draft={draft}
            actionDefinitions={actionDefinitions}
            dataPipelines={dataPipelines}
            rawTables={rawTables}
            resultTables={resultTables}
            appConfig={appConfig}
            onDraftChange={(next) => {
              suppressSelectedAutomationSyncRef.current = true;
              setDraft(next);
            }}
            onGeneratedPipelineSuccess={(workflowDslAvailable) => {
              void loadDataPipelineResources()
                .then((resources) => {
                  if (isMountedRef.current) setDataDashboard(resources);
                })
                .catch((error) => {
                  showTransientBanner({
                    tone: 'error',
                    text: error instanceof Error ? error.message : String(error),
                  });
                });
              showTransientBanner({
                tone: workflowDslAvailable ? 'success' : 'warning',
                text: workflowDslAvailable
                  ? tr('schedule.generatedPipelineReady', '数据加工已生成，后续将复用该任务执行。')
                  : tr(
                      'schedule.generatedPipelineReadyWithoutDsl',
                      '数据加工已生成，但任务逻辑预览暂时不可用。'
                    ),
              });
            }}
            tr={tr}
          />
        </div>
      </div>
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
                  title={tr('schedule.tabs.automations', '自动化')}
                  data-fixed-tab
                >
                  <span className="truncate">{tr('schedule.tabs.automations', '自动化')}</span>
                </TabsTrigger>
                <TabsTrigger
                  value="runs"
                  className={fixedUnderlineTabTriggerClass}
                  title={tr('schedule.tabs.runs', '执行日志')}
                  data-fixed-tab
                >
                  <span className="truncate">{tr('schedule.tabs.runs', '执行日志')}</span>
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
