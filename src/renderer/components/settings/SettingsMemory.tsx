import { memoryClient } from '../../features/memory/api/memory-client';
import { formatIpcError } from '../../utils/ipc-error';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainCircuit, RefreshCw, Search } from 'lucide-react';
import type { CoreMemoryEntry, MemoryOverview, ProjectMemoryEntry } from '../../types';
import { useAppStore } from '../../store';
import type { GlobalNoticeType } from '../../store';
import { showToast } from '../../utils/toast';
import { Badge, Button, Switch } from '../ui';
import { useConfirmDialog } from '../ConfirmDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { underlineTabTriggerClass } from '../data-view/shared';
import {
  getEntryTime,
  toMemoryRecord,
  type MemoryRecord,
  type MemoryTab,
} from './memory/memory-helpers';
import { MemoryDetailPanel, MemoryListItem } from './memory/MemoryDetailAndList';

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
  const [status, setStatus] = useState<{ text: string; tone: GlobalNoticeType } | null>(null);
  const [activeTab, setActiveTab] = useState<MemoryTab>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (status) {
      showToast(status.tone, status.text);
      setStatus(null);
    }
  }, [status]);

  const enabled = overview?.enabled ?? appConfig?.memoryEnabled ?? true;

  const refreshOverview = async () => {
    const nextOverview = await memoryClient.getOverview(currentWorkspace || undefined);
    setOverview(nextOverview);
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
        const [nextOverview, nextCoreEntries, nextProjectEntries] = await Promise.all([
          memoryClient.getOverview(currentWorkspace || undefined),
          memoryClient.listCoreEntries(),
          memoryClient.listProjectEntries(currentWorkspace || undefined),
        ]);
        if (!cancelled) {
          setOverview(nextOverview);
          setCoreEntries(nextCoreEntries);
          setProjectEntries(nextProjectEntries);
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
      return `${record.title} ${record.summary}`.toLowerCase().includes(normalizedQuery);
    });
  }, [activeTab, memoryRecords, query]);

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredRecords.some((record) => record.id === selectedId)) {
      setSelectedId(filteredRecords[0].id);
    }
  }, [filteredRecords, selectedId]);

  const selectedRecord =
    filteredRecords.find((record) => record.id === selectedId) ?? filteredRecords[0] ?? null;

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface">
      {/* Compact top control bar */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4">
        <div className="flex min-w-0 items-center gap-2">
          <BrainCircuit className="h-4 w-4 shrink-0 text-text-muted" />
          <h2 className="truncate text-[13px] font-semibold text-text-primary">
            {t('memory.policyTitle')}
          </h2>
          {enabled && (
            <span className="text-[11.5px] tabular-nums text-text-muted">
              {t('memory.totalMemories', { count: memoryRecords.length })}
            </span>
          )}
          {enabled && Boolean(overview?.failedSessionCount) && (
            <Badge tone="error">
              {t('memory.risky')} · {overview?.failedSessionCount}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {enabled && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRebuildWorkspace}
              disabled={!hasWorkspace || isBusy}
              className="h-7 px-2.5 text-[12px]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
              {t('memory.organizeAction')}
            </Button>
          )}
          <Switch
            size="sm"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isBusy}
            aria-label={t('memory.policyToggleLabel')}
          />
        </div>
      </header>

      {enabled ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* Left rail: filter tabs, flush search, smooth list */}
          <aside className="flex w-full shrink-0 flex-col border-b border-border-subtle bg-background-secondary/45 md:w-[272px] md:border-b-0 md:border-r lg:w-[296px]">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as MemoryTab)}
              className="contents"
            >
              <TabsList className="flex h-9 w-full shrink-0 items-stretch gap-0 rounded-none border-0 border-b border-border-subtle bg-surface-muted/35 p-0">
                <TabsTrigger
                  value="all"
                  className={`${underlineTabTriggerClass} flex-1 justify-center px-2 text-[12px]`}
                >
                  {t('memory.allTab')}
                </TabsTrigger>
                <TabsTrigger
                  value="core"
                  className={`${underlineTabTriggerClass} flex-1 justify-center px-2 text-[12px]`}
                >
                  {t('memory.coreCapabilityTab')}
                </TabsTrigger>
                <TabsTrigger
                  value="project"
                  className={`${underlineTabTriggerClass} flex-1 justify-center px-2 text-[12px] border-r-0`}
                >
                  {t('memory.projectContextTab')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} forceMount className="contents">
                <label className="relative flex h-9 shrink-0 items-center border-b border-border-subtle bg-surface">
                  <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-text-muted" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('memory.searchListPlaceholder')}
                    className="h-full w-full bg-transparent pl-8 pr-3 text-[12px] text-text-primary outline-none placeholder:text-text-muted"
                  />
                </label>

                <div className="scrollbar-hover max-h-56 flex-1 space-y-0.5 overflow-y-auto p-1.5 md:max-h-none">
                  {filteredRecords.length ? (
                    filteredRecords.map((record) => (
                      <MemoryListItem
                        key={record.id}
                        record={record}
                        selected={selectedRecord?.id === record.id}
                        onSelect={() => setSelectedId(record.id)}
                      />
                    ))
                  ) : (
                    <div className="px-3 py-8 text-center text-[12px] text-text-muted">
                      {t('memory.noResults')}
                    </div>
                  )}
                </div>

                <div className="flex h-8 shrink-0 items-center border-t border-border-subtle px-3 text-[11.5px] tabular-nums text-text-muted">
                  {t('memory.totalMemories', { count: filteredRecords.length })}
                </div>
              </TabsContent>
            </Tabs>
          </aside>

          {/* Right pane: selected memory detail */}
          <MemoryDetailPanel
            record={selectedRecord}
            isBusy={isBusy}
            onConfirm={() => selectedRecord && handleConfirm(selectedRecord)}
            onDelete={() => selectedRecord && handleDelete(selectedRecord)}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-surface-muted text-text-muted">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <p className="text-[13px] font-medium text-text-primary">{t('memory.disabledStatus')}</p>
          <p className="mt-1 max-w-sm text-[12px] text-text-muted">{t('memory.toggleHint')}</p>
        </div>
      )}
    </div>
  );
}
