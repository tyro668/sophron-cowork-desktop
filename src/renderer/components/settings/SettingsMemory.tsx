import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  CoreMemoryEntry,
  MemoryConfidenceSignals,
  MemoryEvidenceRef,
  MemoryOverview,
  ProjectMemoryEntry,
} from '../../types';
import { useAppStore } from '../../store';
import { GlassSwitch } from '../GlassSwitch';
import { useConfirmDialog } from '../ConfirmDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

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

const MEMORY_PAGE_SIZE = 3;

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
  const [coreEntries, setCoreEntries] = useState<CoreMemoryEntry[]>([]);
  const [projectEntries, setProjectEntries] = useState<ProjectMemoryEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MemoryTab>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const enabled = overview?.enabled ?? appConfig?.memoryEnabled ?? true;

  const refreshOverview = async () => {
    const nextOverview = await window.electronAPI.memory.getOverview(currentWorkspace || undefined);
    setOverview(nextOverview);
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
        const [nextOverview, nextCoreEntries, nextProjectEntries] = await Promise.all([
          window.electronAPI.memory.getOverview(currentWorkspace || undefined),
          window.electronAPI.memory.listCoreEntries(),
          window.electronAPI.memory.listProjectEntries(currentWorkspace || undefined),
        ]);
        if (!cancelled) {
          setOverview(nextOverview);
          setCoreEntries(nextCoreEntries);
          setProjectEntries(nextProjectEntries);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error));
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
    setStatus(null);
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
      setStatus(t('memory.noWorkspace', '暂无工作区'));
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
        setStatus(
          result.failedSessionCount > 0
            ? t('memory.rebuildPartialSuccess', {
                defaultValue: `已重建 ${result.succeededSessionCount} 个会话，${result.failedSessionCount} 个会话失败`,
                succeeded: result.succeededSessionCount,
                failed: result.failedSessionCount,
              })
            : t('memory.rebuildSuccess')
        );
      });
    })();
  };

  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-3">
      <section className="glass-card flex min-h-[3.75rem] items-center justify-between gap-3 rounded-xl px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
              enabled ? 'bg-accent-muted text-accent' : 'bg-surface-muted text-text-muted'
            }`}
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold text-text-primary">
                {t('memory.policyTitle', '启用记忆')}
              </h3>
              <span
                className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold ${
                  enabled ? 'bg-accent-muted text-accent' : 'bg-surface-muted text-text-secondary'
                }`}
              >
                {enabled ? t('memory.enabled', '已启用') : t('memory.disabled', '已停用')}
              </span>
            </div>
          </div>
        </div>
        <GlassSwitch
          checked={enabled}
          onCheckedChange={() => handleToggle()}
          disabled={isBusy}
          ariaLabel={t('memory.policyToggleLabel', '启用记忆机制')}
        />
      </section>

      {enabled ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            <MemoryMetricCard
              icon={BrainCircuit}
              label={t('memory.longTermMemory', '长期记忆')}
              value={overview?.coreCount ?? 0}
              unit={t('memory.itemUnit', '条')}
              description={t('memory.longTermMemoryDesc', '核心能力与经验知识')}
            />
            <MemoryMetricCard
              icon={FolderOpen}
              label={t('memory.projectMemoryMetric', '项目记忆')}
              value={overview?.projectCount ?? 0}
              unit={t('memory.itemUnitShort', '个')}
              description={t('memory.projectMemoryDesc', '关联项目上下文')}
            />
            <MemoryMetricCard
              icon={Activity}
              label={t('memory.recentActive', '最近活跃')}
              value={activeRecentCount}
              unit={t('memory.itemUnit', '条')}
              description={t('memory.recentActiveDesc', '7 天内被使用')}
            />
            <MemoryMetricCard
              icon={ShieldCheck}
              label={t('memory.health')}
              value={
                overview?.failedSessionCount ? t('memory.risky', '异常') : t('memory.good', '良好')
              }
              description={
                overview?.failedSessionCount
                  ? t('memory.failedSessions', { count: overview.failedSessionCount })
                  : t('memory.noRisk', '无异常风险')
              }
            />
          </section>

          <section className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.95fr)]">
            <div className="glass-card flex h-full min-h-0 min-w-0 flex-col rounded-xl p-3">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as MemoryTab)}
                className="contents"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TabsList className="inline-flex rounded-full border-0 bg-surface p-1 shadow-soft ring-1 ring-border-subtle">
                    <TabsTrigger value="all" className={memoryTabTriggerClass}>
                      {t('memory.allTab', '全部')}
                    </TabsTrigger>
                    <TabsTrigger value="core" className={memoryTabTriggerClass}>
                      {t('memory.coreCapabilityTab', '核心能力')}
                    </TabsTrigger>
                    <TabsTrigger value="project" className={memoryTabTriggerClass}>
                      {t('memory.projectContextTab', '项目上下文')}
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRebuildWorkspace}
                      disabled={!hasWorkspace || isBusy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('memory.organizeAction', '整理')}
                    </button>
                  </div>
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

            <MemoryDetailPanel record={selectedRecord} />
          </section>

          {status && (
            <div className="rounded-lg border border-border-muted bg-background-secondary/70 px-3 py-2 text-xs text-text-secondary">
              {status}
            </div>
          )}

          <section className="mt-auto flex-shrink-0">
            <h3 className="mb-2 text-[13px] font-semibold text-text-primary">
              {t('memory.suggestionTitle', '建议与整理')}
            </h3>
            <div className="grid gap-2.5 xl:grid-cols-2">
              <MemorySuggestionCard
                icon={Sparkles}
                title={t('memory.duplicateMemoryTitle', '发现冗余记忆')}
                description={t('memory.duplicateMemoryDesc', '检测到 {{count}} 条可能重复的记忆', {
                  count: duplicateCount,
                })}
                actionLabel={t('memory.organizeDuplicateAction', '去整理')}
                disabled={duplicateCount === 0 || isBusy}
                onClick={handleRebuildWorkspace}
              />
              <MemorySuggestionCard
                icon={FileText}
                title={t('memory.lowConfidenceTitle', '待确认记忆')}
                description={t('memory.lowConfidenceDesc', '{{count}} 条记忆需要继续验证', {
                  count: pendingConfidenceCount,
                })}
                actionLabel={t('memory.optimizeAction', '去优化')}
                disabled={pendingConfidenceCount === 0 || isBusy}
                onClick={() => {
                  setActiveTab('all');
                  setQuery('');
                  const lowConfidence = memoryRecords.find((record) => record.confidence < 0.65);
                  if (lowConfidence) {
                    setSelectedId(lowConfidence.id);
                  }
                }}
              />
            </div>
          </section>
        </div>
      ) : null}

      {!enabled && status && (
        <div className="rounded-lg border border-border-muted bg-background-secondary/70 px-3 py-2 text-xs text-text-secondary">
          {status}
        </div>
      )}
    </div>
  );
}

function MemoryMetricCard({
  icon: Icon,
  label,
  value,
  unit,
  description,
}: {
  icon: typeof BrainCircuit;
  label: string;
  value: string | number;
  unit?: string;
  description: string;
}) {
  return (
    <article className="glass-card flex h-[4.75rem] items-center gap-2.5 rounded-xl px-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-muted text-accent">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-text-muted">{label}</p>
        <div className="mt-0.5 flex items-end gap-1">
          <span className="truncate text-[19px] font-semibold leading-none text-text-primary">
            {value}
          </span>
          {unit ? (
            <span className="pb-0.5 text-[12px] font-medium text-text-secondary">{unit}</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-text-muted">{description}</p>
      </div>
    </article>
  );
}

const memoryTabTriggerClass =
  'h-7 rounded-full px-3 text-xs shadow-none data-[state=active]:bg-accent ' +
  'data-[state=active]:text-accent-foreground data-[state=active]:shadow-soft';

function MemoryListItem({
  record,
  selected,
  isBusy,
  onSelect,
  onDelete,
}: {
  record: MemoryRecord;
  selected: boolean;
  isBusy: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const confidenceLevel = getConfidenceLevel(record.confidence);
  const confidenceTone =
    confidenceLevel === 'high'
      ? 'bg-accent-muted text-accent'
      : confidenceLevel === 'medium'
        ? 'bg-warning/10 text-warning'
        : 'bg-error/10 text-error';

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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[13px] font-semibold text-text-primary">{record.title}</h4>
          <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-text-secondary">
            {record.summary}
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end">
          <span
            className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold ${confidenceTone}`}
          >
            {getConfidenceLevelLabel(confidenceLevel, t)}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <MemoryTags tags={record.tags} />
        <div className="flex items-center gap-1.5 text-text-muted">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            disabled={isBusy}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </button>
  );
}

function MemoryDetailPanel({ record }: { record: MemoryRecord | null }) {
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
      <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-text-secondary">
        {record.summary}
      </p>
      <div className="mt-2">
        <MemoryTags tags={record.tags} />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[12px] font-semibold text-text-primary">
          <span>{t('memory.confidenceLabel', '可信等级')}</span>
          <span className="text-accent">{getConfidenceLevelLabel(confidenceLevel, t)}</span>
        </div>
        <div className="mt-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[12px] leading-5 text-text-secondary">
          <p>{confidenceReason}</p>
          <p className="mt-1 text-text-muted">
            {t(
              'memory.confidenceEvidenceMeta',
              '证据 {{evidence}} 条 · 复验 {{corroboration}} 次',
              {
                evidence: record.confidenceSignals.evidenceCount,
                corroboration: record.confidenceSignals.corroborationCount,
              }
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 border-b border-border-muted pb-3">
        <h4 className="text-[12px] font-semibold text-text-primary">
          {t('memory.source', '来源')}
        </h4>
        <div className="mt-2 flex items-center gap-2 text-[12px] font-medium text-text-secondary">
          <FileText className="h-4 w-4 text-text-muted" />
          <span className="truncate">
            {firstEvidence?.sourceSessionTitle || record.sourceLabel || '-'}
          </span>
        </div>
      </div>

      <div className="mt-3">
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
    </aside>
  );
}

function MemorySuggestionCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  disabled,
  onClick,
}: {
  icon: typeof Sparkles;
  title: string;
  description: string;
  actionLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="glass-card flex min-h-[3.75rem] items-center gap-2.5 rounded-xl px-3 py-2">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-muted text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-[13px] font-semibold text-text-primary">{title}</h4>
        <p className="mt-0.5 truncate text-[12px] text-text-muted">{description}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex h-7 items-center rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        {actionLabel}
      </button>
    </div>
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
