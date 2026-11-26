import { memoryClient } from '../../features/memory/api/memory-client';
import { formatIpcError } from '../../utils/ipc-error';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import type {
  CoreMemoryEntry,
  MemoryInjectionRecord,
  MemoryOverview,
  ProjectMemoryEntry,
} from '../../types';
import { useAppStore } from '../../store';
import type { GlobalNoticeType } from '../../store';
import { showToast } from '../../utils/toast';
import { Switch } from '../ui';
import { useConfirmDialog } from '../ConfirmDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { underlineTabTriggerClass } from '../data-view/shared';
import {
  countDuplicateMemories,
  formatMemoryDate,
  getEntryTime,
  MEMORY_PAGE_SIZE,
  toMemoryRecord,
  type MemoryRecord,
  type MemoryTab,
} from './memory/memory-helpers';
import { MemoryDetailPanel, MemoryListItem, MemoryStat } from './memory/MemoryDetailAndList';

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
    const nextOverview = await memoryClient.getOverview(currentWorkspace || undefined);
    setOverview(nextOverview);
    try {
      setInjections(await memoryClient.listInjections(1));
    } catch {
      setInjections([]);
    }
  };

  const refreshMemoryEntries = async () => {
    const [nextCoreEntries, nextProjectEntries] = await Promise.all([
      memoryClient.listCoreEntries(),
      memoryClient.listProjectEntries(currentWorkspace || undefined),
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
            memoryClient.getOverview(currentWorkspace || undefined),
            memoryClient.listCoreEntries(),
            memoryClient.listProjectEntries(currentWorkspace || undefined),
            memoryClient.listInjections(1),
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
            text: formatIpcError(error, String(error)),
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
      setStatus({ text: formatIpcError(error, String(error)), tone: 'error' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleToggle = () => {
    void runBusyAction(async () => {
      await memoryClient.setEnabled(!enabled);
      await refreshOverview();
    });
  };

  const handleConfirm = (record: MemoryRecord) => {
    void runBusyAction(async () => {
      const updates = { confidence: 1, status: 'active' as const };
      const updated =
        record.kind === 'core'
          ? await memoryClient.updateCoreEntry((record.raw as CoreMemoryEntry).combinedKey, updates)
          : await memoryClient.updateProjectEntry((record.raw as ProjectMemoryEntry).id, updates);
      if (!updated) {
        throw new Error(t('memory.deleteEntryNotFound'));
      }
      await refreshAll();
      setStatus({ text: t('memory.confirmSuccess'), tone: 'success' });
    });
  };

  const handleDelete = (record: MemoryRecord) => {
    void (async () => {
      const confirmed = await confirmDelete({
        message: t('memory.deleteEntryConfirm'),
      });
      if (!confirmed) return;
      await runBusyAction(async () => {
        if (record.kind === 'core') {
          const result = await memoryClient.deleteCoreEntry(
            (record.raw as CoreMemoryEntry).combinedKey
          );
          if (!result.success) {
            throw new Error(t('memory.deleteEntryNotFound'));
          }
          setCoreEntries((current) =>
            current.filter(
              (entry) => entry.combinedKey !== (record.raw as CoreMemoryEntry).combinedKey
            )
          );
        } else {
          const result = await memoryClient.deleteProjectEntry(
            (record.raw as ProjectMemoryEntry).id
          );
          if (!result.success) {
            throw new Error(t('memory.deleteEntryNotFound'));
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
      setStatus({ text: t('memory.noWorkspace'), tone: 'warning' });
      return;
    }
    void (async () => {
      const confirmed = await confirm({
        message: t('memory.rebuildConfirm'),
      });
      if (!confirmed) return;
      await runBusyAction(async () => {
        const result = await memoryClient.rebuildWorkspace(currentWorkspace);
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
                    error: result.commitError,
                  })
                : result.committedSessionCount > 0
                  ? t('memory.rebuildPartialSuccess', {
                      succeeded: result.committedSessionCount,
                      failed: result.failedSessionCount,
                    })
                  : t('memory.rebuildAborted', {
                      failed: result.failedSessionCount,
                    })
              : t('memory.rebuildSuccess'),
          tone: result.success ? 'success' : result.commitError ? 'error' : 'warning',
        });
      });
    })();
  };

  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-2.5">
      <section className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface px-3 py-2.5">
        <h3 className="text-[13px] font-semibold text-text-primary">{t('memory.policyTitle')}</h3>
        <Switch
          checked={enabled}
          onCheckedChange={() => handleToggle()}
          disabled={isBusy}
          aria-label={t('memory.policyToggleLabel')}
        />
      </section>

      {enabled ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          <section className="grid grid-cols-2 overflow-hidden rounded-md border border-border-subtle bg-surface xl:grid-cols-4">
            <MemoryStat
              label={t('memory.longTermMemory')}
              value={overview?.coreCount ?? 0}
              unit={t('memory.itemUnit')}
            />
            <MemoryStat
              label={t('memory.projectMemoryMetric')}
              value={overview?.projectCount ?? 0}
              unit={t('memory.itemUnitShort')}
            />
            <MemoryStat
              label={t('memory.recentActive')}
              value={activeRecentCount}
              unit={t('memory.itemUnit')}
            />
            <MemoryStat
              label={t('memory.health')}
              value={
                overview?.failedSessionCount
                  ? `${t('memory.risky')} · ${overview.failedSessionCount}`
                  : t('memory.good')
              }
              tone={overview?.failedSessionCount ? 'error' : 'default'}
            />
            {injections[0] ? (
              <div className="col-span-2 border-t border-border-subtle px-4 py-2 text-[11px] font-medium text-text-muted xl:col-span-4">
                {t('memory.lastInjection', {
                  time: formatMemoryDate(injections[0].timestamp),
                  core: injections[0].coreKeys.length,
                  project: injections[0].projectKeys.length,
                  experience:
                    injections[0].experienceChunkIds.length +
                    injections[0].experienceSessionIds.length,
                  chars: injections[0].totalChars.toLocaleString(),
                })}
                {injections[0].truncated ? ` · ${t('memory.injectionTruncated')}` : ''}
              </div>
            ) : null}
          </section>

          <section className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.95fr)]">
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-surface">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as MemoryTab)}
                className="contents"
              >
                <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border-subtle px-3 pt-1.5">
                  <TabsList className="inline-flex items-end gap-3 rounded-none border-0 bg-transparent p-0">
                    <TabsTrigger value="all" className={underlineTabTriggerClass}>
                      {t('memory.allTab')}
                    </TabsTrigger>
                    <TabsTrigger value="core" className={underlineTabTriggerClass}>
                      {t('memory.coreCapabilityTab')}
                    </TabsTrigger>
                    <TabsTrigger value="project" className={underlineTabTriggerClass}>
                      {t('memory.projectContextTab')}
                    </TabsTrigger>
                  </TabsList>
                  <button
                    type="button"
                    onClick={handleRebuildWorkspace}
                    disabled={!hasWorkspace || isBusy}
                    className="mb-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-muted bg-surface px-3 text-xs font-medium text-text-secondary shadow-soft transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('memory.organizeAction')}
                  </button>
                </div>

                <TabsContent value={activeTab} forceMount className="contents">
                  <label className="relative block border-b border-border-subtle px-3 py-2">
                    <Search className="pointer-events-none absolute left-5.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t('memory.searchListPlaceholder')}
                      className="h-8 w-full rounded-lg border border-border-muted bg-surface pl-8 pr-3 text-xs font-medium text-text-secondary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
                    />
                  </label>

                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
                      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-text-muted">
                        {t('memory.noResults')}
                      </div>
                    )}
                  </div>

                  <div className="flex min-h-9 items-center justify-between gap-2 border-t border-border-subtle px-3 text-xs font-medium text-text-secondary">
                    <span>
                      {t('memory.totalMemories', {
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
            <section className="flex flex-shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-border-subtle bg-surface px-3 py-2">
              {duplicateCount > 0 ? (
                <span className="flex items-center gap-2 text-xs text-text-secondary">
                  {t('memory.duplicateMemoryDesc', {
                    count: duplicateCount,
                  })}
                  <button
                    type="button"
                    onClick={handleRebuildWorkspace}
                    disabled={isBusy}
                    className="inline-flex h-6 items-center rounded-md border border-border-muted bg-surface px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {t('memory.organizeDuplicateAction')}
                  </button>
                </span>
              ) : null}
              {pendingConfidenceCount > 0 ? (
                <span className="flex items-center gap-2 text-xs text-text-secondary">
                  {t('memory.lowConfidenceDesc', {
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
                    {t('memory.optimizeAction')}
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
