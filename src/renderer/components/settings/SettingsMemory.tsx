import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  CoreMemoryEntry,
  MemoryConfidenceSignals,
  MemoryEvidenceRef,
  MemoryInjectionRecord,
  MemoryOverview,
  ProjectMemoryEntry,
} from '../../types';
import { useAppStore } from '../../store';
import type { GlobalNoticeType } from '../../store';
import { showToast } from '../../utils/toast';
import { GlassSwitch } from '../GlassSwitch';
import { useConfirmDialog } from '../ConfirmDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { underlineTabTriggerClass } from '../data-view/shared';

type ManagedMemoryEntry = CoreMemoryEntry | ProjectMemoryEntry;
type MemoryTab = 'all' | 'core' | 'project';

interface MemoryRecord {
  id: string;
  kind: 'core' | 'project';
  title: string;
  summary: string;
  confidence: number;
  confidenceSignals: MemoryConfidenceSignals;
  tags: string[];
  sourceLabel: string;
  evidence: MemoryEvidenceRef[];
  raw: ManagedMemoryEntry;
}

const MEMORY_PAGE_SIZE = 5;

export function SettingsMemory() {
  const { t } = useTranslation();
  const { confirm, confirmDelete } = useConfirmDialog();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const workingDir = useAppStore((state) => state.workingDir);
  const appConfig = useAppStore((state) => state.appConfig);

  const currentSession = sessions.find((session) => session.id === activeSessionId);
  const currentWorkspace = currentSession?.cwd || workingDir || '';
  const hasWorkspace = Boolean(currentWorkspace);

  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [injections, setInjections] = useState<MemoryInjectionRecord[]>([]);
  const [coreEntries, setCoreEntries] = useState<CoreMemoryEntry[]>([]);
  const [projectEntries, setProjectEntries] = useState<ProjectMemoryEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: GlobalNoticeType } | null>(null);

  useEffect(() => {
    if (status) {
      showToast(status.tone, status.text);
      setStatus(null);
    }
  }, [status]);
  const [activeTab, setActiveTab] = useState<MemoryTab>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const enabled = overview?.enabled ?? appConfig?.memoryEnabled ?? true;

  const refreshOverview = async () => {
    const nextOverview = await window.electronAPI.memory.getOverview(currentWorkspace || undefined);
    setOverview(nextOverview);
    try {
      setInjections(await window.electronAPI.memory.listInjections(1));
    } catch {
      setInjections([]);
    }
  };

  const refreshMemoryEntries = async () => {
    const [nextCoreEntries, nextProjectEntries] = await Promise.all([
      window.electronAPI.memory.listCoreEntries(),
      window.electronAPI.memory.listProjectEntries(currentWorkspace || undefined),
    ]);
    setCoreEntries(nextCoreEntries);
    setProjectEntries(nextProjectEntries);
  };

  const refreshAll = async () => {
    await Promise.all([refreshOverview(), refreshMemoryEntries()]);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextOverview, nextCoreEntries, nextProjectEntries, nextInjections] =
          await Promise.all([
            window.electronAPI.memory.getOverview(currentWorkspace || undefined),
            window.electronAPI.memory.listCoreEntries(),
            window.electronAPI.memory.listProjectEntries(currentWorkspace || undefined),
            window.electronAPI.memory.listInjections(1),
          ]);
        if (!cancelled) {
          setOverview(nextOverview);
          setCoreEntries(nextCoreEntries);
          setProjectEntries(nextProjectEntries);
          setInjections(nextInjections);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            text: error instanceof Error ? error.message : String(error),
            tone: 'error',
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentWorkspace]);

  const memoryRecords = useMemo<MemoryRecord[]>(() => {
    const coreRecords = coreEntries.map((entry) => toMemoryRecord(entry, 'core', t));
    const projectRecords = projectEntries.map((entry) => toMemoryRecord(entry, 'project', t));
    return [...coreRecords, ...projectRecords].sort((a, b) => {
      const aTime = getEntryTime(a.raw);
      const bTime = getEntryTime(b.raw);
      return bTime - aTime;
    });
  }, [coreEntries, projectEntries, t]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return memoryRecords.filter((record) => {
      if (activeTab !== 'all' && record.kind !== activeTab) return false;
      if (!normalizedQuery) return true;
      return `${record.title} ${record.summary} ${record.tags.join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [activeTab, memoryRecords, query]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, query]);

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredRecords.some((record) => record.id === selectedId)) {
      setSelectedId(filteredRecords[0].id);
    }
  }, [filteredRecords, selectedId]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / MEMORY_PAGE_SIZE));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), pageCount);
  const visibleRecords = filteredRecords.slice(
    (safeCurrentPage - 1) * MEMORY_PAGE_SIZE,
    safeCurrentPage * MEMORY_PAGE_SIZE
  );
  const selectedRecord =
    filteredRecords.find((record) => record.id === selectedId) ?? filteredRecords[0] ?? null;
  const duplicateCount = countDuplicateMemories(memoryRecords);
  const pendingConfidenceCount = memoryRecords.filter((record) => record.confidence < 0.65).length;
  const activeRecentCount = memoryRecords.filter((record) => {
    const updatedAt = getEntryTime(record.raw);
    return updatedAt > 0 && Date.now() - updatedAt <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  const runBusyAction = async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleToggle = () => {
    void runBusyAction(async () => {
      await window.electronAPI.memory.setEnabled(!enabled);
      await refreshOverview();
    });
  };

  const handleConfirm = (record: MemoryRecord) => {
    void runBusyAction(async () => {
      const updates = { confidence: 1, status: 'active' as const };
      const updated =
        record.kind === 'core'
          ? await window.electronAPI.memory.updateCoreEntry(
              (record.raw as CoreMemoryEntry).combinedKey,
              updates
            )
          : await window.electronAPI.memory.updateProjectEntry(
              (record.raw as ProjectMemoryEntry).id,
              updates
            );
      if (!updated) {
        throw new Error(t('memory.deleteEntryNotFound', '记忆不存在，可能已经被删除'));
      }
      await refreshAll();
      setStatus({ text: t('memory.confirmSuccess', '该记忆已确认'), tone: 'success' });
    });
  };

  const handleDelete = (record: MemoryRecord) => {
    void (async () => {
      const confirmed = await confirmDelete({
        message: t('memory.deleteEntryConfirm', '删除后该记忆不会再参与检索，是否继续？'),
      });
      if (!confirmed) return;
      await runBusyAction(async () => {
        if (record.kind === 'core') {
          const result = await window.electronAPI.memory.deleteCoreEntry(
            (record.raw as CoreMemoryEntry).combinedKey
          );
          if (!result.success) {
            throw new Error(t('memory.deleteEntryNotFound', '记忆不存在，可能已经被删除'));
          }
          setCoreEntries((current) =>
            current.filter(
              (entry) => entry.combinedKey !== (record.raw as CoreMemoryEntry).combinedKey
            )
          );
        } else {
          const result = await window.electronAPI.memory.deleteProjectEntry(
            (record.raw as ProjectMemoryEntry).id
          );
          if (!result.success) {
            throw new Error(t('memory.deleteEntryNotFound', '记忆不存在，可能已经被删除'));
          }
          setProjectEntries((current) =>
            current.filter((entry) => entry.id !== (record.raw as ProjectMemoryEntry).id)
          );
        }
        await refreshAll();
      });
    })();
  };

  const handleRebuildWorkspace = () => {
    if (!currentWorkspace) {
      setStatus({ text: t('memory.noWorkspace', '暂无工作区'), tone: 'warning' });
      return;
    }
    void (async () => {
      const confirmed = await confirm({
        message: t('memory.rebuildConfirm'),
      });
      if (!confirmed) return;
      await runBusyAction(async () => {
        const result = await window.electronAPI.memory.rebuildWorkspace(currentWorkspace);
        await refreshAll();
        // Three honest outcomes: a commit-layer failure, a fully abandoned
        // candidate (nothing was applied — the old generation is intact), or
        // success. `succeededSessionCount` counts committed sessions only, so
        // an abandoned rebuild must never claim sessions were rebuilt.
        setStatus({
          text:
            result.commitError || !result.success
              ? result.commitError
                ? t('memory.rebuildCommitFailed', {
                    defaultValue: `重建提交失败：${result.commitError}`,
                    error: result.commitError,
                  })
                : result.committedSessionCount > 0
                  ? t('memory.rebuildPartialSuccess', {
                      defaultValue: `已重建 ${result.committedSessionCount} 个会话，${result.failedSessionCount} 个会话失败`,
                      succeeded: result.committedSessionCount,
                      failed: result.failedSessionCount,
                    })
                  : t('memory.rebuildAborted', {
                      defaultValue: `重建未完成，原有记忆未受影响（${result.failedSessionCount} 个会话提取失败）`,
                      failed: result.failedSessionCount,
                    })
              : t('memory.rebuildSuccess'),
          tone: result.success ? 'success' : result.commitError ? 'error' : 'warning',
        });
      });
    })();
  };

  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-3">
      <section className="glass-card flex items-center justify-between gap-3 rounded-xl px-4 py-3">
        <h3 className="text-[13px] font-semibold text-text-primary">
          {t('memory.policyTitle', '启用记忆')}
        </h3>
        <GlassSwitch
          checked={enabled}
          onCheckedChange={() => handleToggle()}
          disabled={isBusy}
          ariaLabel={t('memory.policyToggleLabel', '启用记忆机制')}
        />
      </section>

      {enabled ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className="glass-card grid grid-cols-2 rounded-xl xl:grid-cols-4">
            <MemoryStat
              label={t('memory.longTermMemory', '长期记忆')}
              value={overview?.coreCount ?? 0}
              unit={t('memory.itemUnit', '条')}
            />
            <MemoryStat
              label={t('memory.projectMemoryMetric', '项目记忆')}
              value={overview?.projectCount ?? 0}
              unit={t('memory.itemUnitShort', '个')}
            />
            <MemoryStat
              label={t('memory.recentActive', '最近活跃')}
              value={activeRecentCount}
              unit={t('memory.itemUnit', '条')}
            />
            <MemoryStat
              label={t('memory.health')}
              value={
                overview?.failedSessionCount
                  ? `${t('memory.risky', '异常')} · ${overview.failedSessionCount}`
                  : t('memory.good', '良好')
              }
              tone={overview?.failedSessionCount ? 'error' : 'default'}
            />
            {injections[0] ? (
              <div className="col-span-2 border-t border-border-subtle px-4 py-2 text-[11px] font-medium text-text-muted xl:col-span-4">
                {t(
                  'memory.lastInjection',
                  '上次注入 {{time}} · 核心 {{core}} · 项目 {{project}} · 经验 {{experience}} · {{chars}} 字符',
                  {
                    time: formatDate(injections[0].timestamp),
                    core: injections[0].coreKeys.length,
                    project: injections[0].projectKeys.length,
                    experience:
                      injections[0].experienceChunkIds.length +
                      injections[0].experienceSessionIds.length,
                    chars: injections[0].totalChars.toLocaleString(),
                  }
                )}
                {injections[0].truncated ? ` · ${t('memory.injectionTruncated', '已截断')}` : ''}
              </div>
            ) : null}
          </section>

          <section className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.95fr)]">
            <div className="glass-card flex h-full min-h-0 min-w-0 flex-col rounded-xl p-3">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as MemoryTab)}
                className="contents"
              >
                <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border-subtle">
                  <TabsList className="inline-flex items-end gap-3 rounded-none border-0 bg-transparent p-0">
                    <TabsTrigger value="all" className={underlineTabTriggerClass}>
                      {t('memory.allTab', '全部')}
                    </TabsTrigger>
                    <TabsTrigger value="core" className={underlineTabTriggerClass}>
                      {t('memory.coreCapabilityTab', '核心能力')}
                    </TabsTrigger>
                    <TabsTrigger value="project" className={underlineTabTriggerClass}>
                      {t('memory.projectContextTab', '项目上下文')}
                    </TabsTrigger>
                  </TabsList>
                  <button
                    type="button"
                    onClick={handleRebuildWorkspace}
                    disabled={!hasWorkspace || isBusy}
                    className="mb-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('memory.organizeAction', '整理')}
                  </button>
                </div>

                <TabsContent value={activeTab} forceMount className="contents">
                  <label className="relative mt-2.5 block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t('memory.searchListPlaceholder', '搜索记忆标题或标签')}
                      className="h-8 w-full rounded-lg border border-border-muted bg-surface pl-8 pr-3 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
                    />
                  </label>

                  <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                    {visibleRecords.length ? (
                      visibleRecords.map((record) => (
                        <MemoryListItem
                          key={record.id}
                          record={record}
                          selected={selectedRecord?.id === record.id}
                          isBusy={isBusy}
                          onSelect={() => setSelectedId(record.id)}
                          onConfirm={() => handleConfirm(record)}
                          onDelete={() => handleDelete(record)}
                        />
                      ))
                    ) : (
                      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border-muted bg-surface text-sm text-text-muted">
                        {t('memory.noResults')}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex min-h-7 items-center justify-between gap-2 text-xs font-medium text-text-secondary">
                    <span>
                      {t('memory.totalMemories', '共 {{count}} 条记忆', {
                        count: filteredRecords.length,
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        disabled={safeCurrentPage <= 1}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border-muted bg-surface transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-accent px-2 text-accent-foreground shadow-soft">
                        {safeCurrentPage}
                      </span>
                      <span>/ {pageCount}</span>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                        disabled={safeCurrentPage >= pageCount}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border-muted bg-surface transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <MemoryDetailPanel
              record={selectedRecord}
              isBusy={isBusy}
              onConfirm={() => selectedRecord && handleConfirm(selectedRecord)}
            />
          </section>

          {duplicateCount > 0 || pendingConfidenceCount > 0 ? (
            <section className="glass-card flex flex-shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl px-4 py-2.5">
              {duplicateCount > 0 ? (
                <span className="flex items-center gap-2 text-xs text-text-secondary">
                  {t('memory.duplicateMemoryDesc', '检测到 {{count}} 条可能重复的记忆', {
                    count: duplicateCount,
                  })}
                  <button
                    type="button"
                    onClick={handleRebuildWorkspace}
                    disabled={isBusy}
                    className="inline-flex h-6 items-center rounded-md border border-border-muted bg-surface px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {t('memory.organizeDuplicateAction', '去整理')}
                  </button>
                </span>
              ) : null}
              {pendingConfidenceCount > 0 ? (
                <span className="flex items-center gap-2 text-xs text-text-secondary">
                  {t('memory.lowConfidenceDesc', '{{count}} 条记忆需要继续验证', {
                    count: pendingConfidenceCount,
                  })}
                  <button
                    type="button"
                    disabled={isBusy}
                    className="inline-flex h-6 items-center rounded-md border border-border-muted bg-surface px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => {
                      setActiveTab('all');
                      setQuery('');
                      const lowConfidence = memoryRecords.find(
                        (record) => record.confidence < 0.65
                      );
                      if (lowConfidence) {
                        setSelectedId(lowConfidence.id);
                      }
                    }}
                  >
                    {t('memory.optimizeAction', '去查看')}
                  </button>
                </span>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MemoryStat({
  label,
  value,
  unit,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div className="min-w-0 border-border-subtle px-4 py-3 even:border-l [&:nth-child(n+3)]:border-t xl:[&:nth-child(n+2)]:border-l xl:[&:nth-child(n+3)]:border-t-0">
      <p className="text-[11px] font-medium text-text-muted">{label}</p>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`truncate text-[17px] font-semibold leading-none ${
            tone === 'error' ? 'text-error' : 'text-text-primary'
          }`}
        >
          {value}
        </span>
        {unit ? <span className="text-[11px] font-medium text-text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

function isRecordConfirmable(record: MemoryRecord): boolean {
  return getConfidenceLevel(record.confidence) === 'pending' || record.raw.status === 'pending';
}

function MemoryListItem({
  record,
  selected,
  isBusy,
  onSelect,
  onConfirm,
  onDelete,
}: {
  record: MemoryRecord;
  selected: boolean;
  isBusy: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const confidenceLevel = getConfidenceLevel(record.confidence);
  const confidenceDot =
    confidenceLevel === 'high'
      ? 'bg-accent'
      : confidenceLevel === 'medium'
        ? 'bg-warning'
        : 'bg-error';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-accent/55 bg-accent-muted ring-1 ring-inset ring-accent/20'
          : 'border-border-muted bg-surface hover:border-accent/25 hover:bg-surface-hover/50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary">
          {record.title}
        </h4>
        <span className="flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium text-text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${confidenceDot}`} />
          {getConfidenceLevelLabel(confidenceLevel, t)}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-text-secondary">
        {record.summary}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <MemoryTags tags={record.tags} />
        <div className="flex flex-shrink-0 items-center gap-0.5">
          {isRecordConfirmable(record) ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onConfirm();
              }}
              disabled={isBusy}
              aria-label={t('memory.confirmAction', '确认')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-accent/10 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            disabled={isBusy}
            aria-label={t('memory.deleteEntryConfirm', '删除该记忆')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </button>
  );
}

function MemoryDetailPanel({
  record,
  isBusy,
  onConfirm,
}: {
  record: MemoryRecord | null;
  isBusy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  if (!record) {
    return (
      <aside className="glass-card flex h-full min-h-0 items-center justify-center rounded-xl p-4 text-center text-[13px] text-text-muted">
        {t('memory.noSelection')}
      </aside>
    );
  }

  const confidenceLevel = getConfidenceLevel(record.confidence);
  const firstEvidence = record.evidence[0];
  const recentEvidence = record.evidence.slice(0, 3);
  const confidenceReason = getConfidenceReason(record.confidenceSignals, t);

  return (
    <aside className="glass-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-6 items-center rounded-lg bg-accent-muted px-2.5 text-xs font-medium text-accent">
          {record.kind === 'core'
            ? t('memory.coreCapabilityTab', '核心能力')
            : t('memory.projectContextTab', '项目上下文')}
        </span>
      </div>

      <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold text-text-primary">
        {record.title}
      </h3>
      <p className="mt-1.5 line-clamp-3 text-[12px] leading-5 text-text-secondary">
        {record.summary}
      </p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px] font-semibold text-text-primary">
          <span>{t('memory.confidenceLabel', '可信等级')}</span>
          <span className="text-accent">{getConfidenceLevelLabel(confidenceLevel, t)}</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(record.confidence * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-text-muted">{confidenceReason}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
          {t('memory.confidenceEvidenceMeta', '证据 {{evidence}} 条 · 复验 {{corroboration}} 次', {
            evidence: record.confidenceSignals.evidenceCount,
            corroboration: record.confidenceSignals.corroborationCount,
          })}
        </p>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3">
        <h4 className="text-[12px] font-semibold text-text-primary">
          {t('memory.source', '来源')}
        </h4>
        <div className="mt-1.5 flex items-center gap-2 text-[12px] font-medium text-text-secondary">
          <FileText className="h-4 w-4 text-text-muted" />
          <span className="truncate">
            {firstEvidence?.sourceSessionTitle || record.sourceLabel || '-'}
          </span>
        </div>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3">
        <h4 className="text-[12px] font-semibold text-text-primary">
          {t('memory.recentUsage', '最近使用')}
        </h4>
        <div className="mt-2 max-h-24 space-y-1.5 overflow-y-auto pr-1">
          {recentEvidence.length ? (
            recentEvidence.map((evidence, index) => (
              <div
                key={`${evidence.sessionId}:${index}`}
                className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3 text-[12px]"
              >
                <span className="flex min-w-0 items-center gap-2 text-text-secondary">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span className="truncate">
                    {evidence.sourceSessionTitle || evidence.excerpt || '-'}
                  </span>
                </span>
                <span className="text-right text-text-muted">{formatDate(evidence.createdAt)}</span>
              </div>
            ))
          ) : (
            <div className="text-[12px] text-text-muted">
              {t('memory.noEvidence', '暂无来源记录')}
            </div>
          )}
        </div>
      </div>

      {isRecordConfirmable(record) ? (
        <div className="mt-auto flex justify-end border-t border-border-subtle pt-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-foreground shadow-soft transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="h-3.5 w-3.5" />
            {t('memory.confirmAction', '确认')}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function MemoryTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="inline-flex h-6 max-w-full items-center rounded-md bg-surface-muted px-2 text-[11px] font-medium text-text-secondary"
        >
          <span className="truncate">{tag}</span>
        </span>
      ))}
    </div>
  );
}

function toMemoryRecord(
  entry: ManagedMemoryEntry,
  kind: MemoryRecord['kind'],
  t: ReturnType<typeof useTranslation>['t']
): MemoryRecord {
  const title =
    kind === 'core'
      ? formatCoreTitle(entry as CoreMemoryEntry)
      : formatProjectTitle(entry as ProjectMemoryEntry, t);
  const sourceLabel =
    kind === 'project'
      ? (entry as ProjectMemoryEntry).workspaceLabel || (entry as ProjectMemoryEntry).workspaceKey
      : (entry as CoreMemoryEntry).combinedKey;

  return {
    id: `${kind}:${kind === 'core' ? (entry as CoreMemoryEntry).combinedKey : (entry as ProjectMemoryEntry).id}`,
    kind,
    title,
    summary: entry.value,
    confidence: normalizeConfidence(entry.confidence),
    confidenceSignals: entry.confidenceSignals,
    tags: buildMemoryTags(entry, kind, t),
    sourceLabel,
    evidence: entry.evidence || [],
    raw: entry,
  };
}

function formatCoreTitle(entry: CoreMemoryEntry): string {
  if (entry.category && entry.key) {
    return `${entry.category}. ${entry.key}`;
  }
  return entry.combinedKey || entry.key;
}

function formatProjectTitle(
  entry: ProjectMemoryEntry,
  t: ReturnType<typeof useTranslation>['t']
): string {
  return `${t('memory.projectPrefix', '项目')}: ${entry.key}`;
}

function buildMemoryTags(
  entry: ManagedMemoryEntry,
  kind: MemoryRecord['kind'],
  t: ReturnType<typeof useTranslation>['t']
): string[] {
  const tags = new Set<string>();
  tags.add(
    kind === 'core'
      ? t('memory.coreCapabilityTab', '核心能力')
      : t('memory.projectContextTab', '项目上下文')
  );
  if ('category' in entry && entry.category) {
    tags.add(categoryLabel(entry.category, t));
  }
  for (const token of entry.key
    .split(/[._:\s/,-]+/)
    .filter(Boolean)
    .slice(0, 2)) {
    tags.add(token);
  }
  return [...tags].slice(0, 3);
}

function categoryLabel(
  category: CoreMemoryEntry['category'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (category === 'skills') return t('memory.categorySkills', '技能');
  if (category === 'preferences') return t('memory.categoryPreferences', '偏好');
  if (category === 'interests') return t('memory.categoryInterests', '兴趣');
  if (category === 'identity') return t('memory.categoryIdentity', '身份');
  return t('memory.coreCapabilityTab', '核心能力');
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return Math.min(1, value / 100);
  return Math.min(1, Math.max(0, value));
}

type ConfidenceLevel = 'high' | 'medium' | 'pending';

function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.82) return 'high';
  if (confidence >= 0.65) return 'medium';
  return 'pending';
}

function getConfidenceLevelLabel(
  level: ConfidenceLevel,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (level === 'high') return t('memory.confidenceHigh', '高可信');
  if (level === 'medium') return t('memory.confidenceMedium', '中可信');
  return t('memory.confidencePending', '待确认');
}

function getConfidenceReason(
  signals: MemoryConfidenceSignals,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (signals.reason) {
    return signals.reason;
  }
  if (signals.userVerified) {
    return t('memory.confidenceReasonManual', '用户确认或手动调整过这条记忆。');
  }
  if (signals.sourceType === 'explicit_user_statement') {
    return t('memory.confidenceReasonExplicit', '来自用户明确表达，并保存了对应对话证据。');
  }
  if (signals.sourceType === 'conversation_summary') {
    return t(
      'memory.confidenceReasonSummary',
      '来自会话总结，可信度取决于证据轮次和重复支持次数。'
    );
  }
  if (signals.sourceType === 'llm_inference') {
    return t('memory.confidenceReasonInference', '来自模型推断，建议在后续使用中继续验证。');
  }
  return t('memory.confidenceReasonSummary', '来自会话总结，可信度取决于证据轮次和重复支持次数。');
}

function getEntryTime(entry: ManagedMemoryEntry): number {
  const updatedAt = Date.parse(entry.updatedAt);
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(entry.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function countDuplicateMemories(records: MemoryRecord[]): number {
  const seen = new Map<string, number>();
  for (const record of records) {
    const key = record.title.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].reduce((count, value) => count + Math.max(0, value - 1), 0);
}
