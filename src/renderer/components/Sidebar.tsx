import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Moon,
  Sun,
  Monitor,
  Settings,
  Search as SearchIcon,
  Plus,
  Layers,
  Package,
  ListChecks,
  Check,
} from 'lucide-react';
import type { AppUpdateState, Session } from '../types';

import sidebarLogoSrc from '../assets/logo.png';

type SessionGroup = {
  key: string;
  label: string;
  sessions: Session[];
};

export function Sidebar() {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const mainView = useAppStore((s) => s.mainView);
  const settings = useAppStore((s) => s.settings);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMainView = useAppStore((s) => s.setMainView);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const {
    deleteSession,
    batchDeleteSessions,
    getSessionMessages,
    getSessionTraceSteps,
    isElectron,
  } = useIPC();
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null);

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const filteredSessions = useMemo(() => {
    return normalizedQuery
      ? sessions.filter((session) => session.title.toLowerCase().includes(normalizedQuery))
      : sessions;
  }, [sessions, normalizedQuery]);

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions, t),
    [filteredSessions, t]
  );
  const hasAvailableUpdate = updateState?.status === 'available';
  const updateBadgeTitle = updateState?.availableVersion
    ? t('general.updateAvailableBadgeTitle', { version: updateState.availableVersion })
    : t('general.updateAvailableBadge');

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.update
      ?.getState()
      .then((state) => {
        if (!cancelled && state) {
          setUpdateState(state);
        }
      })
      .catch(() => undefined);
    const cleanup = window.electronAPI?.update?.onState((state) => {
      setUpdateState(state);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Exit select mode when sidebar collapses
  useEffect(() => {
    if (sidebarCollapsed && isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    }
  }, [sidebarCollapsed, isSelectMode]);

  // Escape key exits select mode
  useEffect(() => {
    if (!isSelectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSelectMode(false);
        setSelectedIds(new Set());
        setShowDeleteConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectMode]);

  // Reset selection when search query changes to avoid deleting hidden sessions
  useEffect(() => {
    if (isSelectMode) {
      setSelectedIds(new Set());
    }
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  }, []);

  const handleDataPage = useCallback(() => {
    exitSelectMode();
    setMainView('data');
    setActiveSession(null);
    setShowSettings(false);
  }, [exitSelectMode, setActiveSession, setMainView, setShowSettings]);

  const handleSkillsPage = useCallback(() => {
    exitSelectMode();
    setMainView('skills');
    setActiveSession(null);
    setShowSettings(false);
  }, [exitSelectMode, setActiveSession, setMainView, setShowSettings]);

  const toggleSelectSession = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const visibleSessionIds = useMemo(() => filteredSessions.map((s) => s.id), [filteredSessions]);

  const allVisibleSelected =
    visibleSessionIds.length > 0 && visibleSessionIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      // Deselect all visible, keep others
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      // Select all visible, keep existing selections
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleSessionIds) {
          next.add(id);
        }
        return next;
      });
    }
  }, [allVisibleSelected, visibleSessionIds]);

  const handleBatchDelete = useCallback(() => {
    const visibleSet = new Set(visibleSessionIds);
    const ids = Array.from(selectedIds).filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    batchDeleteSessions(ids);
    exitSelectMode();
  }, [selectedIds, visibleSessionIds, batchDeleteSessions, exitSelectMode]);

  const handleSessionClick = useCallback(
    async (sessionId: string) => {
      setShowSettings(false);
      setMainView('chat');

      if (activeSessionId === sessionId) return;

      setActiveSession(sessionId);

      // Read sessionStates at call-time from the store rather than closing over
      // the selector value. The selector returns a new object reference every
      // time any session's state changes (patchSession spreads the whole map),
      // so including it in deps would rebuild this callback on every streaming
      // tick and cause a React #185 "Maximum update depth exceeded" loop when
      // rapidly switching sessions on slow renderers (e.g. Windows).
      const currentSessionStates = useAppStore.getState().sessionStates;

      const existingMessages = currentSessionStates[sessionId]?.messages;
      if ((!existingMessages || existingMessages.length === 0) && isElectron) {
        try {
          const messages = await getSessionMessages(sessionId);
          if (messages && messages.length > 0) {
            setMessages(sessionId, messages);
          }
        } catch (error) {
          console.error('[Sidebar] Failed to load messages:', error);
        }
      }

      const existingSteps = currentSessionStates[sessionId]?.traceSteps;
      if ((!existingSteps || existingSteps.length === 0) && isElectron) {
        try {
          const steps = await getSessionTraceSteps(sessionId);
          setTraceSteps(sessionId, steps || []);
        } catch (error) {
          console.error('[Sidebar] Failed to load trace steps:', error);
        }
      }
    },
    [
      activeSessionId,
      getSessionMessages,
      getSessionTraceSteps,
      isElectron,
      setActiveSession,
      setMainView,
      setMessages,
      setShowSettings,
      setTraceSteps,
    ]
  );

  const handleNewSession = () => {
    setMainView('chat');
    setActiveSession(null);
    setShowSettings(false);
  };

  const handleUpdateBadgeClick = useCallback(async () => {
    try {
      const state = await window.electronAPI?.update?.checkAndInstall();
      if (state) {
        setUpdateState(state);
      }
    } catch (error) {
      console.error('[Sidebar] Failed to start update:', error);
    }
  }, []);

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const toggleTheme = () => {
    const next =
      settings.theme === 'dark' ? 'light' : settings.theme === 'light' ? 'system' : 'dark';
    updateSettings({ theme: next });
  };

  const themeIcon =
    settings.theme === 'dark' ? (
      <Sun className="w-4 h-4" />
    ) : settings.theme === 'light' ? (
      <Moon className="w-4 h-4" />
    ) : (
      <Monitor className="w-4 h-4" />
    );
  const isDataPageActive = mainView === 'data' && !showSettings;
  const isSkillsPageActive = mainView === 'skills' && !showSettings;

  if (sidebarCollapsed) {
    return (
      <aside className="glass-surface mr-3 w-[4.25rem] rounded-2xl flex flex-col overflow-hidden">
        <div className="px-2.5 pt-3 pb-3 flex flex-col items-center gap-2 border-b border-border-subtle">
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('context.expandPanel')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleNewSession}
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-accent hover:bg-accent-hover transition-colors text-white shadow-soft"
            title={t('sidebar.newTask')}
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={handleDataPage}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
              isDataPageActive
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
            title={t('mainNav.data')}
          >
            <Layers className="w-4 h-4" />
          </button>
          <button
            onClick={handleSkillsPage}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
              isSkillsPageActive
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
            title={t('mainNav.skills')}
          >
            <Package className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-3 py-4">
          <button
            onClick={toggleSidebar}
            className="rounded-2xl px-2 py-3 text-[11px] leading-4 text-center text-text-muted hover:bg-surface-hover transition-colors"
            title={t('sidebar.expandToView')}
          >
            {t('sidebar.expandToView')}
          </button>
        </div>

        <div className="border-t border-border-subtle py-2 flex flex-col items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-full h-9 flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
            title={t('sidebar.themeToggle')}
          >
            {themeIcon}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-full h-9 flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary relative"
            title={t('sidebar.settings')}
          >
            <Settings className="w-4 h-4" />
            {!isConfigured && (
              <span className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="glass-surface mr-3 w-[19rem] rounded-2xl flex flex-col overflow-hidden">
      <div className="px-3.5 pt-4 pb-3.5 border-b border-border-subtle">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <img
              src={sidebarLogoSrc}
              alt={t('common.appLogoAlt')}
              className="w-10 h-10 rounded-xl object-contain p-1.5 border border-border-subtle bg-background/60 flex-shrink-0 shadow-soft"
            />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <h1 className="min-w-0 truncate text-[1.08rem] leading-none font-semibold tracking-normal text-text-primary">
                  {t('common.appName')}
                </h1>
                {hasAvailableUpdate && (
                  <button
                    type="button"
                    onClick={() => void handleUpdateBadgeClick()}
                    className="h-5 flex-shrink-0 rounded-full border border-accent/25 bg-accent/10 px-1.5 text-[10px] font-medium leading-none text-accent transition-colors hover:bg-accent hover:text-white"
                    title={updateBadgeTitle}
                  >
                    {t('general.updateAvailableBadge')}
                  </button>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary flex-shrink-0"
            title={t('context.collapsePanel')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={handleNewSession}
          className="mt-3 w-full flex h-9 items-center gap-2 rounded-xl bg-accent px-3 text-left text-white hover:bg-accent-hover transition-colors shadow-soft"
        >
          <Plus className="w-4 h-4 text-white flex-shrink-0" />
          <span className="text-[13px] font-medium">{t('sidebar.newTask')}</span>
        </button>

        {sessions.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search')}
                className="w-full h-9 rounded-xl border border-border-muted bg-background/72 pl-9 pr-3 text-[13px] text-text-primary shadow-soft placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-background/92 focus:ring-2 focus:ring-accent/20 transition-colors"
              />
            </div>
            <button
              onClick={() => {
                if (isSelectMode) {
                  exitSelectMode();
                } else {
                  setIsSelectMode(true);
                }
              }}
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelectMode
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
              title={t('sidebar.manage')}
            >
              <ListChecks className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <nav className="mt-4 space-y-1" aria-label={t('mainNav.label')}>
          <button
            onClick={handleDataPage}
            className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
              isDataPageActive
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Layers className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('mainNav.data')}</span>
          </button>
          <button
            onClick={handleSkillsPage}
            className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
              isSkillsPageActive
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Package className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('mainNav.skills')}</span>
          </button>
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div
          className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold ${
            (activeSessionId || mainView === 'chat') && !showSettings
              ? 'bg-accent/10 text-accent'
              : 'text-text-primary'
          }`}
        >
          <ListChecks className="h-4 w-4 flex-shrink-0" />
          <span>{t('mainNav.tasks')}</span>
        </div>
        {groupedSessions.length === 0 ? (
          <div className="px-3 py-6">
            <p className="text-[13px] text-text-secondary">{t('sidebar.noTasks')}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedSessions.map((group) => (
              <section key={group.key}>
                <div className="px-3 pb-2 text-[11px] font-medium tracking-[0.04em] text-text-muted">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const isActive = activeSessionId === session.id;
                    const isSelected = selectedIds.has(session.id);
                    return (
                      <div
                        key={session.id}
                        onClick={() => {
                          if (isSelectMode) {
                            toggleSelectSession(session.id);
                          } else {
                            handleSessionClick(session.id);
                          }
                        }}
                        onMouseEnter={() => setHoveredSession(session.id)}
                        onMouseLeave={() => setHoveredSession(null)}
                        className={`group relative cursor-pointer rounded-xl px-2.5 py-1.5 transition-colors ${
	                          isSelectMode && isSelected
	                            ? 'bg-accent/10 text-text-primary ring-1 ring-inset ring-accent/20'
	                            : isActive && !isSelectMode
                              ? 'bg-accent/10'
                              : 'hover:bg-surface-hover/60'
                        }`}
                      >
                        {isActive && !isSelectMode && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent" />
                        )}
                        <div className={`flex items-center gap-2 ${!isSelectMode ? 'pr-6' : ''}`}>
                          {isSelectMode && (
                            <div
                              className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-accent text-white'
                                  : 'border border-border-muted bg-background'
                              }`}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5" />}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium leading-5 text-text-primary truncate">
                              {session.title}
                            </div>
                          </div>
                        </div>

                        {!isSelectMode && hoveredSession === session.id && (
                          <button
                            onClick={(e) => handleDeleteSession(e, session.id)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-surface-active transition-colors"
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {isSelectMode ? (
        <div className="px-3 py-3 border-t border-border-subtle">
          {showDeleteConfirm ? (
            <div className="border border-error/30 bg-error/10 rounded-lg px-3 py-3">
              <p className="text-[13px] text-text-primary mb-3">
                {t('sidebar.batchDeleteConfirm', { count: selectedIds.size })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  onClick={handleBatchDelete}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-error text-white hover:bg-error/90 transition-colors"
                >
                  {t('sidebar.confirmDelete')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={toggleSelectAll}
                  className="text-[12px] font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  {allVisibleSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
                </button>
                <span className="text-[12px] text-text-muted">
                  {t('sidebar.nSelected', { count: selectedIds.size })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exitSelectMode}
                  className="flex-1 px-3 py-2 rounded-xl text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t('sidebar.cancel')}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={selectedIds.size === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-error text-white hover:bg-error/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('common.delete')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-border-subtle">
          <div className="flex h-14 w-full items-center gap-2 bg-background/42 px-4 backdrop-blur-xl">
            <button
              onClick={() => setShowSettings(true)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2 text-left text-text-secondary transition-colors hover:text-text-primary"
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              <span className="min-w-0 flex-shrink-0 text-[13px] font-semibold text-text-primary">
                {t('sidebar.settings')}
              </span>
              <span className="min-w-0 truncate text-[12px] font-medium text-text-muted">
                {isConfigured ? t('sidebar.apiConfigured') : t('sidebar.apiNotConfigured')}
              </span>
            </button>

            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
              title={t('sidebar.themeToggle')}
            >
              {themeIcon}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function groupSessionsByDate(sessions: Session[], t: (key: string) => string): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfPreviousWeek = startOfToday - 7 * 86_400_000;

  const buckets: SessionGroup[] = [
    { key: 'today', label: t('sidebar.today'), sessions: [] },
    { key: 'yesterday', label: t('sidebar.yesterday'), sessions: [] },
    { key: 'previousWeek', label: t('sidebar.previousWeek'), sessions: [] },
    { key: 'older', label: t('sidebar.older'), sessions: [] },
  ];

  const sortedSessions = [...sessions].sort(
    (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
  );
  for (const session of sortedSessions) {
    const timestamp = session.updatedAt || session.createdAt;
    if (timestamp >= startOfToday) {
      buckets[0].sessions.push(session);
    } else if (timestamp >= startOfYesterday) {
      buckets[1].sessions.push(session);
    } else if (timestamp >= startOfPreviousWeek) {
      buckets[2].sessions.push(session);
    } else {
      buckets[3].sessions.push(session);
    }
  }

  return buckets.filter((bucket) => bucket.sessions.length > 0);
}
