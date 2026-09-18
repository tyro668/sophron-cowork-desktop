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
  LogIn,
  LogOut,
  ChartNoAxesCombined,
  Loader2,
  CircleDollarSign,
  Search as SearchIcon,
  Plus,
  Layers,
  Package,
  Clock3,
  ListChecks,
  Check,
  MoreHorizontal,
  PencilLine,
  Folder,
  FolderOpen,
  X,
} from 'lucide-react';
import type { AppUpdateState } from '../types';
import { GlassDropdownMenu, GlassMenuItem } from './GlassDropdownMenu';
import { Button } from './ui';
import { BrandMark } from './BrandMark';
import {
  buildSessionProjectGroups,
  buildProjectNameLookup,
  type SessionProjectGroup,
} from '../utils/sidebar-project-groups';

const SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY = 'sophron.sidebar.projectExpansion.v1';

export function Sidebar({ forceCollapsed = false }: { forceCollapsed?: boolean }) {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const mainView = useAppStore((s) => s.mainView);
  const settings = useAppStore((s) => s.settings);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMainView = useAppStore((s) => s.setMainView);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const isConfigured = useAppStore((s) => s.isConfigured);
  const preferredSidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const sidebarCollapsed = forceCollapsed || preferredSidebarCollapsed;
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const desktopAuthStatus = useAppStore((s) => s.desktopAuthStatus);
  const setDesktopAuthStatus = useAppStore((s) => s.setDesktopAuthStatus);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const {
    deleteSession,
    batchDeleteSessions,
    renameProject,
    deleteProject,
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
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [projectExpansion, setProjectExpansion] = useState<Record<string, boolean>>(() =>
    readStoredProjectExpansion()
  );
  const [renamingProjectKey, setRenamingProjectKey] = useState<string | null>(null);
  const [savingProjectRenameKey, setSavingProjectRenameKey] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [removingProjectKey, setRemovingProjectKey] = useState<string | null>(null);
  const [authBusyMode, setAuthBusyMode] = useState<'login' | 'logout' | null>(null);
  const [authMenuOpen, setAuthMenuOpen] = useState(false);
  const [failedAuthAvatarUrls, setFailedAuthAvatarUrls] = useState<Set<string>>(() => new Set());
  const isAuthBusy = authBusyMode !== null;
  const isLoginBusy = authBusyMode === 'login';
  const isLogoutBusy = authBusyMode === 'logout';

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const rendererPlatform = typeof window !== 'undefined' ? window.electronAPI?.platform : undefined;
  const persistedProjectNames = useMemo(() => {
    return buildProjectNameLookup(projects, rendererPlatform);
  }, [projects, rendererPlatform]);
  const effectiveProjectNames = useMemo(
    () => ({ ...persistedProjectNames, ...projectNames }),
    [persistedProjectNames, projectNames]
  );
  const groupedSessions = useMemo(
    () =>
      buildSessionProjectGroups(sessions, {
        noWorkspaceLabel: t('sidebar.noWorkspaceProject'),
        platform: rendererPlatform,
        projectNames: effectiveProjectNames,
        query: normalizedQuery,
      }),
    [effectiveProjectNames, normalizedQuery, rendererPlatform, sessions, t]
  );
  const expandedProjectKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of groupedSessions) {
      const explicitState = projectExpansion[group.key];
      const hasActiveSession = group.sessions.some((session) => session.id === activeSessionId);
      const isExpanded = Boolean(normalizedQuery) || (explicitState ?? hasActiveSession);
      if (isExpanded) {
        keys.add(group.key);
      }
    }
    return keys;
  }, [activeSessionId, groupedSessions, normalizedQuery, projectExpansion]);
  const hasAvailableUpdate = updateState?.status === 'available';
  const updateBadgeTitle = updateState?.availableVersion
    ? t('general.updateAvailableBadgeTitle', { version: updateState.availableVersion })
    : t('general.updateAvailableBadge');
  const authUser = desktopAuthStatus.user;
  const authAvatarUrl = authUser?.avatarUrl?.trim() || '';
  const canUseAuthAvatar = Boolean(authAvatarUrl && !failedAuthAvatarUrls.has(authAvatarUrl));
  const authDisplayName =
    authUser?.displayName?.trim() || authUser?.username?.trim() || authUser?.userId?.trim() || '';
  const authSecondaryText = isAuthBusy
    ? isLoginBusy
      ? t('sidebar.loginWaitingBrowser')
      : t('sidebar.loginProcessing')
    : desktopAuthStatus.authenticated
      ? t('sidebar.loggedIn')
      : t('sidebar.loginDesc');
  const authCreditsLabel = t('sidebar.aiCredits');
  const authCreditsText = useMemo(() => {
    const value = desktopAuthStatus.aiCredits?.availableCredits;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 4,
      }).format(value);
    }
    return t('sidebar.creditsUnavailable');
  }, [desktopAuthStatus.aiCredits?.availableCredits, t]);

  const refreshDesktopAuthStatus = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.auth) return;
    try {
      const status = await window.electronAPI.auth.getStatus();
      setDesktopAuthStatus(status);
    } catch (error) {
      setGlobalNotice({
        id: `desktop-auth-status-${Date.now()}`,
        type: 'warning',
        message: error instanceof Error ? error.message : t('sidebar.loginStatusFailed'),
      });
    }
  }, [isElectron, setDesktopAuthStatus, setGlobalNotice, t]);

  const handleCancelLoginClick = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.auth || !isLoginBusy) return;

    setAuthBusyMode(null);
    try {
      const status = await window.electronAPI.auth.cancelLogin();
      setDesktopAuthStatus(status);
    } catch (error) {
      setGlobalNotice({
        id: `desktop-auth-cancel-${Date.now()}`,
        type: 'warning',
        message: error instanceof Error ? error.message : t('sidebar.loginFailed'),
      });
    }
  }, [isElectron, isLoginBusy, setDesktopAuthStatus, setGlobalNotice, t]);

  const handleLoginEntryClick = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.auth || desktopAuthStatus.authenticated) {
      return;
    }

    if (isLoginBusy) {
      await handleCancelLoginClick();
      return;
    }

    if (isAuthBusy) return;

    setAuthBusyMode('login');
    try {
      const status = await window.electronAPI.auth.login();
      setDesktopAuthStatus(status);
    } catch (error) {
      const isCancelled = error instanceof Error && error.message === 'Login cancelled';
      setGlobalNotice({
        id: `desktop-auth-login-${Date.now()}`,
        type: isCancelled ? 'info' : 'error',
        message: isCancelled
          ? t('sidebar.loginCancelled')
          : error instanceof Error
            ? error.message
            : t('sidebar.loginFailed'),
      });
    } finally {
      setAuthBusyMode(null);
    }
  }, [
    desktopAuthStatus.authenticated,
    handleCancelLoginClick,
    isAuthBusy,
    isElectron,
    isLoginBusy,
    setDesktopAuthStatus,
    setGlobalNotice,
    t,
  ]);

  const handleLogoutClick = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.auth || isAuthBusy) return;

    setAuthBusyMode('logout');
    try {
      const status = await window.electronAPI.auth.logout();
      setDesktopAuthStatus(status);
      setAuthMenuOpen(false);
    } catch (error) {
      setGlobalNotice({
        id: `desktop-auth-logout-${Date.now()}`,
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.logoutFailed'),
      });
    } finally {
      setAuthBusyMode(null);
    }
  }, [isAuthBusy, isElectron, setDesktopAuthStatus, setGlobalNotice, t]);

  const handleAuthMenuOpenChange = useCallback(
    (open: boolean) => {
      setAuthMenuOpen(open);
      if (open && desktopAuthStatus.authenticated) {
        void refreshDesktopAuthStatus();
      }
    },
    [desktopAuthStatus.authenticated, refreshDesktopAuthStatus]
  );

  const handleAuthAvatarError = useCallback((avatarUrl: string) => {
    setFailedAuthAvatarUrls((current) => {
      if (current.has(avatarUrl)) {
        return current;
      }
      const next = new Set(current);
      next.add(avatarUrl);
      return next;
    });
  }, []);

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

  useEffect(() => {
    void refreshDesktopAuthStatus();
  }, [refreshDesktopAuthStatus]);

  // Exit select mode when sidebar collapses
  useEffect(() => {
    if (sidebarCollapsed && isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    }
    if (sidebarCollapsed) {
      setRenamingProjectKey(null);
      setProjectNameDraft('');
      setRemovingProjectKey(null);
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

  const saveProjectExpansion = useCallback(
    (updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
      setProjectExpansion((current) => {
        const next = updater(current);
        writeStoredProjectExpansion(next);
        return next;
      });
    },
    []
  );

  const handleToggleProject = useCallback(
    (group: SessionProjectGroup) => {
      const isExpanded = expandedProjectKeys.has(group.key);
      saveProjectExpansion((current) => ({
        ...current,
        [group.key]: !isExpanded,
      }));
      setRemovingProjectKey(null);
    },
    [expandedProjectKeys, saveProjectExpansion]
  );

  const handleStartRenameProject = useCallback((group: SessionProjectGroup) => {
    setRenamingProjectKey(group.key);
    setSavingProjectRenameKey(null);
    setProjectNameDraft(group.label);
    setRemovingProjectKey(null);
  }, []);

  const handleCancelRenameProject = useCallback(() => {
    setRenamingProjectKey(null);
    setProjectNameDraft('');
  }, []);

  const handleSaveProjectName = useCallback(
    async (group: SessionProjectGroup) => {
      const nextName = projectNameDraft.trim();
      const persistedName = !nextName || nextName === group.defaultLabel ? null : nextName;
      setSavingProjectRenameKey(group.key);
      try {
        if (group.projectId || group.path) {
          await renameProject(
            group.projectId ? group.projectId : { cwd: group.path ?? undefined },
            persistedName
          );
        }
        setProjectNames((current) => {
          const next = { ...current };
          if (persistedName) {
            next[group.key] = persistedName;
          } else {
            delete next[group.key];
          }
          return next;
        });
        handleCancelRenameProject();
      } catch (error) {
        console.error('[Sidebar] Failed to rename project:', error);
      } finally {
        setSavingProjectRenameKey(null);
      }
    },
    [handleCancelRenameProject, projectNameDraft, renameProject]
  );

  const handleRemoveProject = useCallback(
    (group: SessionProjectGroup) => {
      const sessionIds = group.sessions.map((session) => session.id);
      if (sessionIds.length === 0) return;
      batchDeleteSessions(sessionIds);
      setProjectNames((current) => {
        const next = { ...current };
        delete next[group.key];
        return next;
      });
      if (group.projectId) {
        void deleteProject(group.projectId).catch((error) => {
          console.error('[Sidebar] Failed to delete project:', error);
        });
      }
      saveProjectExpansion((current) => {
        const next = { ...current };
        delete next[group.key];
        return next;
      });
      setRemovingProjectKey(null);
      handleCancelRenameProject();
      exitSelectMode();
    },
    [
      batchDeleteSessions,
      deleteProject,
      exitSelectMode,
      handleCancelRenameProject,
      saveProjectExpansion,
    ]
  );

  const handleDataPage = useCallback(() => {
    exitSelectMode();
    setMainView('data');
    setShowSettings(false);
  }, [exitSelectMode, setMainView, setShowSettings]);

  const handleSkillsPage = useCallback(() => {
    exitSelectMode();
    setMainView('skills');
    setShowSettings(false);
  }, [exitSelectMode, setMainView, setShowSettings]);

  const handleAutomationPage = useCallback(() => {
    exitSelectMode();
    setMainView('automation');
    setShowSettings(false);
  }, [exitSelectMode, setMainView, setShowSettings]);

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

  const visibleSessionIds = useMemo(
    () =>
      groupedSessions.flatMap((group) =>
        expandedProjectKeys.has(group.key) ? group.sessions.map((session) => session.id) : []
      ),
    [expandedProjectKeys, groupedSessions]
  );

  // Keep bulk selection aligned with currently visible tasks.
  useEffect(() => {
    if (!isSelectMode) return;

    const visibleSet = new Set(visibleSessionIds);
    setSelectedIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (visibleSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [isSelectMode, visibleSessionIds]);

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
  const isAutomationPageActive = mainView === 'automation' && !showSettings;
  const renderAuthAvatar = (containerClassName: string, iconClassName: string) => {
    const showAnalyticsAvatar = desktopAuthStatus.authenticated && !canUseAuthAvatar && !isAuthBusy;

    return (
      <span
        className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border ${
          showAnalyticsAvatar
            ? 'border-accent/25 bg-accent-muted text-accent shadow-soft'
            : 'border-border-subtle bg-background text-text-secondary'
        } ${containerClassName}`}
      >
        {isAuthBusy ? (
          <Loader2 className={`${iconClassName} animate-spin`} />
        ) : canUseAuthAvatar ? (
          <img
            src={authAvatarUrl}
            alt={t('sidebar.accountAvatar')}
            className="h-full w-full object-cover"
            onError={() => handleAuthAvatarError(authAvatarUrl)}
          />
        ) : desktopAuthStatus.authenticated ? (
          <span className="relative flex h-full w-full items-center justify-center">
            <span className="absolute inset-0 bg-accent-muted" />
            <span className="absolute left-[18%] top-[22%] h-1.5 w-1.5 rounded-full bg-accent/35" />
            <span className="absolute bottom-[20%] right-[18%] h-2 w-2 rounded-full bg-accent-muted" />
            <ChartNoAxesCombined className={`relative z-10 ${iconClassName}`} />
          </span>
        ) : (
          <LogIn className={iconClassName} />
        )}
      </span>
    );
  };
  const authAccountMenu = (
    <div className="w-64 p-1.5">
      <div className="flex items-center gap-3 rounded-lg px-2.5 py-2">
        {renderAuthAvatar('h-9 w-9', 'h-4 w-4')}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-5 text-text-primary">
            {authDisplayName || t('sidebar.loggedIn')}
          </div>
        </div>
      </div>
      <div className="mx-1 my-1 h-px bg-border-subtle" />
      <div className="mx-1 mb-1 flex items-center justify-between gap-3 rounded-lg bg-surface px-2.5 py-2 text-[12px]">
        <span className="flex min-w-0 items-center gap-2 font-medium text-text-secondary">
          <CircleDollarSign className="h-3.5 w-3.5 flex-shrink-0 text-accent" />
          <span className="truncate">{authCreditsLabel}</span>
        </span>
        <span className="flex-shrink-0 font-semibold text-text-primary">{authCreditsText}</span>
      </div>
      <GlassMenuItem
        danger
        disabled={isLogoutBusy}
        icon={<LogOut className="h-3.5 w-3.5" />}
        onSelect={() => void handleLogoutClick()}
      >
        {t('sidebar.logout')}
      </GlassMenuItem>
    </div>
  );

  if (sidebarCollapsed) {
    return (
      <aside className="glass-surface mr-3 w-[4.25rem] rounded-2xl flex flex-col overflow-hidden">
        <div className="px-2.5 pt-3 pb-3 flex flex-col items-center gap-2 border-b border-border-subtle">
          {!forceCollapsed && (
            <button
              onClick={toggleSidebar}
              className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-surface-hover transition-colors text-text-secondary"
              title={t('context.expandPanel')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          <Button
            variant="primary"
            size="icon"
            onClick={handleNewSession}
            className="rounded-xl shadow-soft"
            title={t('sidebar.newTask')}
            aria-label={t('sidebar.newTask')}
          >
            <Plus className="w-4 h-4" />
          </Button>
          <button
            onClick={handleDataPage}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
              isDataPageActive
                ? 'bg-accent-muted text-accent'
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
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
            title={t('mainNav.skills')}
          >
            <Package className="w-4 h-4" />
          </button>
          <button
            onClick={handleAutomationPage}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
              isAutomationPageActive
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
            title={t('mainNav.automation')}
          >
            <Clock3 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-3 py-4">
          {!forceCollapsed && (
            <button
              onClick={toggleSidebar}
              className="rounded-2xl px-2 py-3 text-[11px] leading-4 text-center text-text-muted hover:bg-surface-hover transition-colors"
              title={t('sidebar.expandToView')}
            >
              {t('sidebar.expandToView')}
            </button>
          )}
        </div>

        <div className="border-t border-border-subtle py-2 flex flex-col items-center gap-2">
          {desktopAuthStatus.authenticated ? (
            <GlassDropdownMenu
              open={authMenuOpen}
              onOpenChange={handleAuthMenuOpenChange}
              align="start"
              side="top"
              sideOffset={6}
              contentClassName="p-0"
              trigger={
                <button
                  disabled={isLogoutBusy}
                  className="relative flex h-9 w-full items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
                  title={t('sidebar.accountMenu')}
                >
                  {renderAuthAvatar('h-5 w-5', 'h-4 w-4')}
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-success" />
                </button>
              }
            >
              {authAccountMenu}
            </GlassDropdownMenu>
          ) : (
            <button
              onClick={handleLoginEntryClick}
              disabled={isAuthBusy && !isLoginBusy}
              className="relative flex h-9 w-full items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
              title={isLoginBusy ? t('sidebar.cancelLogin') : t('sidebar.login')}
            >
              {renderAuthAvatar('h-5 w-5 border-0 bg-transparent', 'h-4 w-4')}
            </button>
          )}
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
            <BrandMark
              variant={settings.logoVariant}
              label={t('common.appLogoAlt')}
              className="h-10 w-10 transition-colors"
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
                    className="h-5 flex-shrink-0 rounded-full border border-accent/25 bg-accent-muted px-1.5 text-[10px] font-medium leading-none text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
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

        <Button
          variant="primary"
          onClick={handleNewSession}
          className="mt-3 h-9 w-full justify-start gap-2 rounded-xl px-3 shadow-soft"
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          <span className="text-[13px]">{t('sidebar.newTask')}</span>
        </Button>

        {sessions.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search')}
                className="w-full h-9 rounded-xl border border-border-muted bg-background pl-9 pr-3 text-[13px] text-text-primary shadow-soft placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-surface-hover focus:ring-2 focus:ring-accent/20 transition-colors"
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
                  ? 'bg-accent text-accent-foreground'
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
                ? 'bg-accent-muted text-accent'
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
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Package className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('mainNav.skills')}</span>
          </button>
          <button
            onClick={handleAutomationPage}
            className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
              isAutomationPageActive
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Clock3 className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('mainNav.automation')}</span>
          </button>
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-2 px-3 text-[12px] font-semibold leading-5 text-text-muted">
          {t('sidebar.projectsTitle')}
        </div>
        {groupedSessions.length === 0 ? (
          <div className="px-3 py-6">
            <p className="text-[13px] text-text-secondary">{t('sidebar.noTasks')}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {groupedSessions.map((group) => {
              const isProjectExpanded = expandedProjectKeys.has(group.key);
              const isSavingProjectName = savingProjectRenameKey === group.key;
              return (
                <section key={group.key} className="space-y-1">
                  <div className="px-1.5">
                    {renamingProjectKey === group.key ? (
                      <form
                        className="flex items-center gap-1.5 rounded-lg border border-accent/25 bg-background p-1 shadow-soft"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleSaveProjectName(group);
                        }}
                      >
                        <input
                          autoFocus
                          disabled={isSavingProjectName}
                          value={projectNameDraft}
                          onChange={(event) => setProjectNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              handleCancelRenameProject();
                            }
                          }}
                          placeholder={t('sidebar.projectNamePlaceholder')}
                          className="min-w-0 flex-1 rounded-md border border-border-muted bg-background px-2 py-1 text-[12px] font-medium text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
                        />
                        <button
                          type="submit"
                          disabled={isSavingProjectName}
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-60"
                          title={t('sidebar.saveProjectName')}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isSavingProjectName}
                          onClick={handleCancelRenameProject}
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                          title={t('sidebar.cancelProjectRename')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-hover/50">
                        <button
                          type="button"
                          onClick={() => handleToggleProject(group)}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:text-text-primary"
                          aria-expanded={isProjectExpanded}
                          title={group.label}
                        >
                          {isProjectExpanded ? (
                            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                          ) : (
                            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-4 text-text-secondary">
                            {group.label}
                          </span>
                        </button>
                        <GlassDropdownMenu
                          align="end"
                          sideOffset={4}
                          trigger={
                            <button
                              type="button"
                              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-active hover:text-text-primary"
                              title={t('sidebar.projectMenu')}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          }
                        >
                          <GlassMenuItem
                            icon={<PencilLine className="h-3.5 w-3.5" />}
                            onSelect={() => handleStartRenameProject(group)}
                          >
                            {t('sidebar.renameProject')}
                          </GlassMenuItem>
                          <GlassMenuItem
                            danger
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            onSelect={() => {
                              setRemovingProjectKey(group.key);
                              setRenamingProjectKey(null);
                              setProjectNameDraft('');
                            }}
                          >
                            {t('sidebar.removeProject')}
                          </GlassMenuItem>
                        </GlassDropdownMenu>
                      </div>
                    )}
                  </div>
                  {removingProjectKey === group.key && (
                    <div className="mx-1.5 rounded-lg border border-error/25 bg-error/10 px-2.5 py-2">
                      <p className="text-[12px] leading-4 text-text-primary">
                        {t('sidebar.removeProjectConfirm', {
                          count: group.sessions.length,
                          name: group.label,
                        })}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1"
                          onClick={() => setRemovingProjectKey(null)}
                        >
                          {t('sidebar.cancel')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleRemoveProject(group)}
                        >
                          {t('sidebar.confirmRemoveProject')}
                        </Button>
                      </div>
                    </div>
                  )}
                  {isProjectExpanded && (
                    <div className="ml-6 space-y-0.5 pl-2">
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
                                ? 'bg-accent-muted text-text-primary ring-1 ring-inset ring-accent/20'
                                : isActive && !isSelectMode
                                  ? 'bg-accent-muted'
                                  : 'hover:bg-surface-hover/60'
                            }`}
                          >
                            {isActive && !isSelectMode && (
                              <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent" />
                            )}
                            <div
                              className={`flex items-center gap-2 ${!isSelectMode ? 'pr-6' : ''}`}
                            >
                              {isSelectMode && (
                                <div
                                  className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                                    isSelected
                                      ? 'bg-accent text-accent-foreground'
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
                  )}
                </section>
              );
            })}
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  {t('sidebar.cancel')}
                </Button>
                <Button variant="danger" size="sm" className="flex-1" onClick={handleBatchDelete}>
                  {t('sidebar.confirmDelete')}
                </Button>
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
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-error text-error-foreground hover:bg-error/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="flex h-14 w-full items-center gap-2 bg-surface px-4">
            {desktopAuthStatus.authenticated ? (
              <GlassDropdownMenu
                open={authMenuOpen}
                onOpenChange={handleAuthMenuOpenChange}
                align="start"
                side="top"
                sideOffset={6}
                contentClassName="p-0"
                trigger={
                  <button
                    disabled={isLogoutBusy}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2 text-left text-text-secondary transition-colors hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
                    title={t('sidebar.accountMenu')}
                  >
                    {renderAuthAvatar('h-8 w-8', 'h-4 w-4')}
                    <span className="min-w-0 flex-shrink-0 text-[13px] font-medium text-text-primary">
                      {authDisplayName || t('sidebar.loggedIn')}
                    </span>
                    <span className="min-w-0 truncate text-[12px] font-medium text-text-muted">
                      {authSecondaryText}
                    </span>
                  </button>
                }
              >
                {authAccountMenu}
              </GlassDropdownMenu>
            ) : (
              <button
                onClick={handleLoginEntryClick}
                disabled={isAuthBusy && !isLoginBusy}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2 text-left text-text-secondary transition-colors hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
                title={isLoginBusy ? t('sidebar.cancelLogin') : t('sidebar.login')}
              >
                {renderAuthAvatar('h-8 w-8', 'h-4 w-4')}
                <span className="min-w-0 flex-shrink-0 text-[13px] font-medium text-text-primary">
                  {isLoginBusy ? t('sidebar.cancelLogin') : t('sidebar.login')}
                </span>
                <span className="min-w-0 truncate text-[12px] font-medium text-text-muted">
                  {authSecondaryText}
                </span>
              </button>
            )}

            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
              title={t('sidebar.themeToggle')}
            >
              {themeIcon}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              title={t('sidebar.settings')}
            >
              <Settings className="h-4 w-4" />
              {!isConfigured && (
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function readStoredProjectExpansion(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const expansion: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') {
        expansion[key] = value;
      }
    }
    return expansion;
  } catch {
    return {};
  }
}

function writeStoredProjectExpansion(projectExpansion: Record<string, boolean>) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY,
      JSON.stringify(projectExpansion)
    );
  } catch {
    // Ignore storage failures so sidebar navigation remains usable.
  }
}
