import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type {
  CoreMemoryEntry,
  MemoryItemStatus,
  MemoryOverview,
  ProjectMemoryEntry,
} from '../../types';
import { useAppStore } from '../../store';

type ManagedMemoryEntry = CoreMemoryEntry | ProjectMemoryEntry;

export function SettingsMemory() {
  const { t } = useTranslation();
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
      setStatus(!enabled ? t('memory.enabledStatus') : t('memory.disabledStatus'));
    });
  };

  const handleCoreStatusChange = (entry: CoreMemoryEntry, status: MemoryItemStatus) => {
    void runBusyAction(async () => {
      await window.electronAPI.memory.updateCoreEntry(entry.combinedKey, { status });
      await refreshAll();
    });
  };

  const handleProjectStatusChange = (entry: ProjectMemoryEntry, status: MemoryItemStatus) => {
    void runBusyAction(async () => {
      await window.electronAPI.memory.updateProjectEntry(entry.id, { status });
      await refreshAll();
    });
  };

  const handleCoreDelete = (entry: CoreMemoryEntry) => {
    if (!window.confirm(t('memory.deleteEntryConfirm', '删除后该记忆不会再参与检索，是否继续？'))) {
      return;
    }
    void runBusyAction(async () => {
      await window.electronAPI.memory.deleteCoreEntry(entry.combinedKey);
      await refreshAll();
    });
  };

  const handleProjectDelete = (entry: ProjectMemoryEntry) => {
    if (!window.confirm(t('memory.deleteEntryConfirm', '删除后该记忆不会再参与检索，是否继续？'))) {
      return;
    }
    void runBusyAction(async () => {
      await window.electronAPI.memory.deleteProjectEntry(entry.id);
      await refreshAll();
    });
  };

  const handleRebuildWorkspace = () => {
    if (!currentWorkspace) {
      return;
    }
    if (!window.confirm(t('memory.rebuildConfirm'))) {
      return;
    }
    void runBusyAction(async () => {
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
  };

  return (
    <div className="space-y-4">
      <MemorySection title={t('memory.title')} description={t('memory.description')}>
        <div className="rounded-lg border border-border-muted bg-background/55 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    enabled ? 'bg-accent' : 'bg-text-muted/40'
                  }`}
                />
                <p className="text-sm font-semibold text-text-primary">
                  {enabled ? t('memory.enabled') : t('memory.disabled')}
                </p>
                <InfoTooltip content={currentWorkspace || t('memory.noWorkspace', '暂无工作区')} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRebuildWorkspace}
                disabled={!hasWorkspace || isBusy}
                className="rounded-md border border-border-muted bg-background px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('memory.rebuildWorkspace')}
              </button>
              <button
                onClick={handleToggle}
                disabled={isBusy}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  enabled
                    ? 'border border-border-muted bg-background text-text-secondary hover:bg-surface-hover'
                    : 'bg-accent text-white hover:opacity-90'
                }`}
              >
                {enabled ? t('memory.disableAction') : t('memory.enableAction')}
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryMetric label={t('memory.coreCount')} value={overview?.coreCount ?? 0} />
            <SummaryMetric
              label={t('memory.projectCount', '项目记忆')}
              value={overview?.projectCount ?? 0}
            />
            <SummaryMetric
              label={t('memory.sessionCount')}
              value={overview?.experienceSessionCount ?? 0}
            />
            <SummaryMetric
              label={t('memory.workspaceCount')}
              value={overview?.sourceWorkspaceCount ?? 0}
            />
            <SummaryMetric
              label={t('memory.health')}
              value={
                overview?.failedSessionCount
                  ? t('memory.failedSessions', { count: overview.failedSessionCount })
                  : t('memory.healthy')
              }
              tone={overview?.failedSessionCount ? 'danger' : 'default'}
            />
          </div>
        </div>
      </MemorySection>

      <MemorySection
        title={t('memory.managementTitle', '记忆管理')}
        description={t(
          'memory.managementDescription',
          '管理会参与后续对话的核心记忆和当前项目记忆。'
        )}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <MemoryEntryPanel
            title={t('memory.coreMemoryTitle', '核心记忆')}
            entries={coreEntries}
            emptyLabel={t('memory.noCoreMemory', '暂无核心记忆')}
            isBusy={isBusy}
            getEntryKey={(entry) => entry.combinedKey}
            getEntryTitle={(entry) => entry.combinedKey}
            getEntryValue={(entry) => entry.value}
            onActivate={(entry) => handleCoreStatusChange(entry, 'active')}
            onArchive={(entry) => handleCoreStatusChange(entry, 'archived')}
            onDelete={handleCoreDelete}
            activateLabel={t('memory.activateEntry', '恢复')}
            archiveLabel={t('memory.archiveEntry', '停用')}
            deleteLabel={t('memory.deleteEntry', '删除')}
            evidenceLabel={t('memory.evidenceCount', '证据')}
          />
          <MemoryEntryPanel
            title={t('memory.projectMemoryTitle', '项目记忆')}
            entries={projectEntries}
            emptyLabel={t('memory.noProjectMemory', '暂无项目记忆')}
            isBusy={isBusy}
            getEntryKey={(entry) => entry.id}
            getEntryTitle={(entry) => entry.key}
            getEntryValue={(entry) => entry.value}
            getEntryMeta={(entry) => entry.workspaceLabel || entry.workspaceKey}
            onActivate={(entry) => handleProjectStatusChange(entry, 'active')}
            onArchive={(entry) => handleProjectStatusChange(entry, 'archived')}
            onDelete={handleProjectDelete}
            activateLabel={t('memory.activateEntry', '恢复')}
            archiveLabel={t('memory.archiveEntry', '停用')}
            deleteLabel={t('memory.deleteEntry', '删除')}
            evidenceLabel={t('memory.evidenceCount', '证据')}
          />
        </div>
      </MemorySection>

      {status && (
        <div className="rounded-lg border border-border-muted bg-background-secondary/70 px-3 py-2 text-xs text-text-secondary">
          {status}
        </div>
      )}
    </div>
  );
}

function MemorySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card mb-3 space-y-3 rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5">
        <h4 className="text-[13px] font-medium text-text-primary">{title}</h4>
        {description ? <InfoTooltip content={description} /> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function InfoTooltip({ content }: { content?: string }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  if (!content) {
    return null;
  }

  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left, 12), window.innerWidth - 272);
    setPosition({
      left,
      top: rect.bottom + 6,
    });
  };

  const tooltip = position
    ? createPortal(
        <div
          style={{ left: position.left, top: position.top }}
          className="fixed z-[1000] max-w-[260px] rounded-md border border-border-muted bg-background px-3 py-2 text-xs leading-5 text-text-secondary shadow-lg"
        >
          {content}
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        type="button"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setPosition(null)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setPosition(null)}
        aria-label={content}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {tooltip}
    </>
  );
}

function SummaryMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-background/45 px-3 py-2">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p
        className={`mt-1 truncate text-sm font-semibold ${
          tone === 'danger' ? 'text-rose-600' : 'text-text-primary'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MemoryEntryPanel<TEntry extends ManagedMemoryEntry>({
  title,
  entries,
  emptyLabel,
  isBusy,
  getEntryKey,
  getEntryTitle,
  getEntryValue,
  getEntryMeta,
  onActivate,
  onArchive,
  onDelete,
  activateLabel,
  archiveLabel,
  deleteLabel,
  evidenceLabel,
}: {
  title: string;
  entries: TEntry[];
  emptyLabel: string;
  isBusy: boolean;
  getEntryKey: (entry: TEntry) => string;
  getEntryTitle: (entry: TEntry) => string;
  getEntryValue: (entry: TEntry) => string;
  getEntryMeta?: (entry: TEntry) => string | undefined;
  onActivate: (entry: TEntry) => void;
  onArchive: (entry: TEntry) => void;
  onDelete: (entry: TEntry) => void;
  activateLabel: string;
  archiveLabel: string;
  deleteLabel: string;
  evidenceLabel: string;
}) {
  return (
    <div className="rounded-lg border border-border-muted bg-background/55 p-3">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <span className="rounded-full bg-background-secondary px-2 py-0.5 text-[11px] text-text-muted">
          {entries.length}
        </span>
      </div>
      <div className="mt-2 max-h-72 space-y-1.5 overflow-auto pr-1">
        {entries.length ? (
          entries.map((entry) => {
            const active = entry.status === 'active';
            const meta = getEntryMeta?.(entry);
            return (
              <div
                key={getEntryKey(entry)}
                className="rounded-md border border-border-subtle bg-background/42 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {getEntryTitle(entry)}
                      </p>
                      {meta ? <InfoTooltip content={meta} /> : null}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      active
                        ? 'bg-accent/10 text-accent'
                        : 'bg-background-secondary text-text-muted'
                    }`}
                  >
                    {active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-text-secondary">
                  {getEntryValue(entry)}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-text-muted">
                    {Math.round(entry.confidence * 100)}% · {evidenceLabel} {entry.evidence.length}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {active ? (
                      <button
                        onClick={() => onArchive(entry)}
                        disabled={isBusy}
                        className="rounded border border-border-muted px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                      >
                        {archiveLabel}
                      </button>
                    ) : (
                      <button
                        onClick={() => onActivate(entry)}
                        disabled={isBusy}
                        className="rounded border border-border-muted px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                      >
                        {activateLabel}
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(entry)}
                      disabled={isBusy}
                      className="rounded border border-rose-300/70 px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-500/10"
                    >
                      {deleteLabel}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-border-muted bg-background/45 p-3 text-sm text-text-muted">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
