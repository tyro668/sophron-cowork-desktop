import { createPortal } from 'react-dom';
import { useDesktopAuthConnection } from '../hooks/useDesktopAuthConnection';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  Trash2,
  Moon,
  Sun,
  Monitor,
  ChevronDown,
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
  Minus,
  MoreHorizontal,
  PencilLine,
  Folder,
  FolderOpen,
  ArrowLeftToLine,
  ArrowRightFromLine,
  X,
  Pin,
  PinOff,
  Copy,
} from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialog';
import type { AppUpdateState } from '../types';
import { GlassDropdownMenu, GlassMenuItem } from './GlassDropdownMenu';
import { Badge, Button, Dialog, DialogHeader, DialogTitle, Input } from './ui';
import { BrandMark } from './BrandMark';
import {
  buildSessionProjectGroups,
  buildProjectNameLookup,
  type SessionProjectGroup,
} from '../utils/sidebar-project-groups';

const SIDEBAR_PROJECT_EXPANSION_STORAGE_KEY = 'sophron.sidebar.projectExpansion.v1';
const SIDEBAR_EDGE_DRAG_THRESHOLD = 56;
const SIDEBAR_PINNED_STORAGE_KEY = 'sophron.sidebar.pinnedSessions.v1';

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
    renameSession,
    duplicateSession,
    batchDeleteSessions,
    renameProject,
    deleteProject,
    getSessionMessages,
    getSessionTraceSteps,
    setWorkingDirPath,
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
  const [loginDialogHidden, setLoginDialogHidden] = useState(false);
  const isLogoutBusy = authBusyMode === 'logout';

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const rendererPlatform = typeof window !== 'undefined' ? window.electronAPI?.platform : undefined;
  const isMac = rendererPlatform === 'darwin';
  const [titlebarBrandSlot, setTitlebarBrandSlot] = useState<HTMLElement | null>(null);
  // Re-resolve every render: the titlebar slot can remount (e.g. HMR / route
  // changes) and a stale detached node would make the brand disappear.
  useEffect(() => {
    if (isMac) return;
    const slot = document.getElementById('titlebar-brand-slot');
    if (slot !== titlebarBrandSlot) setTitlebarBrandSlot(slot);
  });

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
      ? t(
          desktopAuthStatus.connectionStatus === 'disconnected'
            ? 'sidebar.loggedInDisconnected'
            : 'sidebar.loggedIn'
        )
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

  const refreshDesktopAuthStatus = useDesktopAuthConnection(isElectron);

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
    setLoginDialogHidden(false);
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
  const someVisibleSelected =
    !allVisibleSelected && visibleSessionIds.some((id) => selectedIds.has(id));

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
    // Default the welcome picker to the previous conversation's project:
    // the session being viewed, or the most recently updated one.
    const previousCwd =
      sessions.find((session) => session.id === activeSessionId)?.cwd ??
      [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.cwd;
    setMainView('chat');
    setActiveSession(null);
    setShowSettings(false);
    if (previousCwd && previousCwd !== useAppStore.getState().workingDir) {
      void setWorkingDirPath(previousCwd);
    }
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

  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');
  const { confirmDelete } = useConfirmDialog();

  const togglePinSession = useCallback((sessionId: string) => {
    setPinnedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      try {
        window.localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  const handleStartRenameSession = (sessionId: string, title: string) => {
    setRenamingSessionId(sessionId);
    setSessionTitleDraft(title);
  };

  const [renameDialog, setRenameDialog] = useState<{ id: string; title: string } | null>(null);
  const openRenameDialog = useCallback((sessionId: string, title: string) => {
    setRenameDialog({ id: sessionId, title });
  }, []);
  const submitRenameDialog = () => {
    if (!renameDialog) return;
    const next = renameDialog.title.trim();
    const current = sessions.find((item) => item.id === renameDialog.id)?.title ?? '';
    if (next && next !== current) renameSession(renameDialog.id, next);
    setRenameDialog(null);
  };

  // Cmd/Ctrl+N starts a new task (same as the button). Works from text inputs too, since
  // N has no editing meaning there; ignored with Shift/Alt and while a modal dialog is open.
  const newSessionRef = useRef<() => void>(() => {});
  newSessionRef.current = handleNewSession;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isNewTaskShortcut(event, isMac)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      newSessionRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMac]);

  // F2 renames the active task (ignored while typing in a field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F2' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
      const active = sessions.find((item) => item.id === activeSessionId);
      if (!active) return;
      event.preventDefault();
      openRenameDialog(active.id, active.title);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSessionId, openRenameDialog, sessions]);

  const handleCommitRenameSession = (sessionId: string) => {
    if (renamingSessionId !== sessionId) return;
    const current = sessions.find((item) => item.id === sessionId)?.title ?? '';
    const next = sessionTitleDraft.trim();
    setRenamingSessionId(null);
    if (next && next !== current) {
      renameSession(sessionId, next);
    }
  };

  const handleConfirmDeleteSession = async (sessionId: string, title: string) => {
    const ok = await confirmDelete({
      message: t('sidebar.deleteTaskConfirm', { title }),
      title: t('sidebar.deleteTaskTitle'),
      name: title,
    });
    if (ok) deleteSession(sessionId);
  };

  const pinnedSessions = useMemo(
    () => sessions.filter((session) => pinnedSessionIds.has(session.id)),
    [sessions, pinnedSessionIds]
  );

  const renderSessionRow = (session: (typeof sessions)[number]) => {
    const isActive = activeSessionId === session.id;
    const isSelected = selectedIds.has(session.id);
    const isRenaming = renamingSessionId === session.id;
    const isPinned = pinnedSessionIds.has(session.id);
    return (
      <div
        key={session.id}
        onClick={() => {
          if (isRenaming) return;
          if (isSelectMode) {
            toggleSelectSession(session.id);
          } else {
            handleSessionClick(session.id);
          }
        }}
        onDoubleClick={() => {
          if (!isSelectMode) handleStartRenameSession(session.id, session.title);
        }}
        onMouseEnter={() => setHoveredSession(session.id)}
        onMouseLeave={() => setHoveredSession(null)}
        className={`group relative flex h-[31px] cursor-pointer items-center pl-7 pr-2.5 transition-colors ${
          isSelectMode && isSelected
            ? 'bg-accent-muted text-text-primary ring-1 ring-inset ring-accent/20'
            : isActive && !isSelectMode
              ? 'bg-accent-muted/70'
              : 'hover:bg-surface-hover'
        }`}
      >
        {isActive && !isSelectMode && (
          <span className={`absolute left-0 w-[2px] bg-accent inset-y-0`} />
        )}
        <div className={`flex min-w-0 flex-1 items-center gap-2 ${!isSelectMode ? 'pr-6' : ''}`}>
          {isSelectMode && (
            <div
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-md border transition-colors ${
                isSelected
                  ? 'border-accent bg-accent text-accent-foreground'
                  : 'border-border-muted bg-surface group-hover:border-accent/50'
              }`}
            >
              {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                autoFocus
                value={sessionTitleDraft}
                onChange={(e) => setSessionTitleDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => handleCommitRenameSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitRenameSession(session.id);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingSessionId(null);
                  }
                }}
                className="h-[26px] w-full rounded-md border border-accent bg-surface px-1.5 text-[13px] text-text-primary outline-none ring-2 ring-accent/25"
              />
            ) : (
              <div className="truncate text-[13px] font-medium leading-5 text-text-primary">
                {session.title}
              </div>
            )}
          </div>
        </div>

        {!isSelectMode && !isRenaming && (
          <div
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={(e) => e.stopPropagation()}
          >
            <GlassDropdownMenu
              align="end"
              sideOffset={4}
              trigger={
                <button
                  type="button"
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-active hover:text-text-primary data-[state=open]:bg-surface-active data-[state=open]:opacity-100 ${
                    hoveredSession === session.id ? 'opacity-100' : 'opacity-0'
                  } group-hover:opacity-100`}
                  title={t('sidebar.taskMenu')}
                  aria-label={t('sidebar.taskMenu')}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              }
            >
              <GlassMenuItem
                icon={<PencilLine className="h-3.5 w-3.5" />}
                onSelect={() => openRenameDialog(session.id, session.title)}
              >
                <span className="flex w-full items-center justify-between gap-4">
                  {t('sidebar.renameTask')}
                  <span className="text-[11px] text-text-muted">F2</span>
                </span>
              </GlassMenuItem>
              <GlassMenuItem
                icon={
                  isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />
                }
                onSelect={() => togglePinSession(session.id)}
              >
                {isPinned ? t('sidebar.unpinTask') : t('sidebar.pinTask')}
              </GlassMenuItem>
              <GlassMenuItem
                icon={<Copy className="h-3.5 w-3.5" />}
                onSelect={() => duplicateSession(session.id, t('sidebar.copySuffix'))}
              >
                {t('sidebar.copyTask')}
              </GlassMenuItem>
              <GlassMenuItem
                danger
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onSelect={() => void handleConfirmDeleteSession(session.id, session.title)}
              >
                {t('sidebar.deleteTask')}
              </GlassMenuItem>
            </GlassDropdownMenu>
          </div>
        )}
      </div>
    );
  };

  // Divider affordance: a click toggles the sidebar; dragging left past the
  // threshold collapses it, dragging right expands it.
  const handleEdgePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || forceCollapsed) return;
      event.preventDefault();
      const startX = event.clientX;
      const wasCollapsed = sidebarCollapsed;
      let moved = false;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        if (Math.abs(dx) > 6) moved = true;
        if (
          (!wasCollapsed && dx <= -SIDEBAR_EDGE_DRAG_THRESHOLD) ||
          (wasCollapsed && dx >= SIDEBAR_EDGE_DRAG_THRESHOLD)
        ) {
          finish();
          toggleSidebar();
        }
      };
      const onUp = (upEvent: PointerEvent) => {
        const wasClick = !moved && Math.abs(upEvent.clientX - startX) <= 6;
        finish();
        if (wasClick) {
          toggleSidebar();
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [forceCollapsed, sidebarCollapsed, toggleSidebar]
  );

  const edgeHandle = !forceCollapsed ? (
    <div
      role="button"
      tabIndex={0}
      aria-label={sidebarCollapsed ? t('context.expandPanel') : t('context.collapsePanel')}
      title={sidebarCollapsed ? t('context.expandPanel') : t('context.collapsePanel')}
      onPointerDown={handleEdgePointerDown}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleSidebar();
        }
      }}
      className="titlebar-no-drag group absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-ew-resize touch-none outline-none"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/40" />
      <div className="absolute left-1/2 top-1/2 flex h-8 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-surface text-text-muted opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {sidebarCollapsed ? (
          <ArrowRightFromLine className="h-3 w-3" />
        ) : (
          <ArrowLeftToLine className="h-3 w-3" />
        )}
      </div>
    </div>
  ) : null;

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
          {desktopAuthStatus.connectionStatus === 'disconnected' && (
            <div className="text-xs text-text-muted">{authSecondaryText}</div>
          )}
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

  const navItemShape = 'h-9 px-3.5';

  const renderBrand = (compact: boolean, showLogo = true) => (
    <div className="min-w-0 flex items-center gap-3">
      {showLogo && (
        <BrandMark
          variant={settings.logoVariant}
          label={t('common.appLogoAlt')}
          className={compact ? 'h-5 w-5 transition-colors' : 'h-10 w-10 transition-colors'}
        />
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1
            className={`min-w-0 truncate leading-none font-semibold tracking-normal text-text-primary ${compact ? 'text-[13px]' : 'text-[1.08rem]'}`}
          >
            {t('common.appName')}
          </h1>
          {hasAvailableUpdate && (
            <button
              type="button"
              onClick={() => void handleUpdateBadgeClick()}
              className="titlebar-no-drag h-5 flex-shrink-0 rounded-full border border-accent/25 bg-accent-muted px-1.5 text-[10px] font-medium leading-none text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
              title={updateBadgeTitle}
            >
              {t('general.updateAvailableBadge')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (sidebarCollapsed) {
    return (
      <aside className="relative flex h-full w-[4.25rem] shrink-0 flex-col border-r border-border-subtle bg-background-secondary">
        {/* macOS traffic lights overlay the top of the rail — keep the strip clear + draggable */}
        {isMac && (
          <div
            data-testid="mac-sidebar-titlebar-row"
            className="titlebar-drag h-12 shrink-0 border-b border-border-subtle"
          />
        )}
        {!isMac && titlebarBrandSlot && createPortal(renderBrand(true), titlebarBrandSlot)}
        <div className="px-2.5 pt-3 pb-3 flex flex-col items-center gap-2 border-b border-border-subtle">
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
        {edgeHandle}
      </aside>
    );
  }

  return (
    <aside className="relative flex h-full w-[19rem] shrink-0 flex-col border-r border-border-subtle bg-background-secondary">
      <Dialog
        open={renameDialog !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialog(null);
        }}
        ariaLabel={t('sidebar.renameTaskTitle')}
        className="ui-dialog-pad max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>{t('sidebar.renameTaskTitle')}</DialogTitle>
        </DialogHeader>
        <div className="ui-group bg-surface">
          <div className="ui-form-row">
            <span className="ui-form-label items-center">{t('sidebar.taskNameLabel')}</span>
            <div className="ui-form-value">
              <Input
                data-autofocus
                aria-label={t('sidebar.taskNameLabel')}
                value={renameDialog?.title ?? ''}
                onChange={(event) =>
                  setRenameDialog((cur) => (cur ? { ...cur, title: event.target.value } : cur))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitRenameDialog();
                  }
                }}
                className="h-8 text-[13px]"
              />
            </div>
          </div>
        </div>
        <div className="ui-footer-split">
          <Button variant="ghost" onClick={() => setRenameDialog(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!renameDialog?.title.trim()}
            onClick={submitRenameDialog}
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>
      {isMac ? (
        /* macOS: one 48px drag row shared with the traffic lights (centered via
           trafficLightPosition), name only — same height as the right-side tab/title bar. */
        <div
          data-testid="mac-sidebar-titlebar-row"
          className="titlebar-drag flex h-12 shrink-0 select-none items-center pl-[84px] pr-3.5"
        >
          <div className="pointer-events-none min-w-0 [&_button]:pointer-events-auto">
            {renderBrand(true, false)}
          </div>
        </div>
      ) : (
        titlebarBrandSlot && createPortal(renderBrand(true), titlebarBrandSlot)
      )}

      <div data-testid="sidebar-top">
        <div className={'flex h-12 items-stretch'}>
          <Button
            variant="primary"
            onClick={handleNewSession}
            className={'h-full min-w-0 flex-1 justify-start gap-2 rounded-none px-3.5'}
            title={`${t('sidebar.newTask')} (${isMac ? '⌘N' : 'Ctrl+N'})`}
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span className="text-[13px]">{t('sidebar.newTask')}</span>
          </Button>
          <span
            aria-hidden="true"
            data-testid="new-task-shortcut-cell"
            className="flex w-[52px] flex-shrink-0 items-center justify-center bg-accent text-[11px] font-semibold text-accent-foreground shadow-[inset_0_0_0_999px_rgba(0,0,0,0.12)]"
          >
            {isMac ? '⌘N' : 'Ctrl+N'}
          </span>
        </div>

        {sessions.length > 0 && (
          <div className={'flex h-10 items-stretch bg-surface-active/60'}>
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search')}
                className={`w-full h-full rounded-none border-0 bg-transparent pl-9 pr-3 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-surface-hover focus:ring-2 focus:ring-accent/20 transition-colors`}
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
              className={`w-10 flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelectMode
                  ? 'bg-accent text-accent-foreground'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
              title={t('sidebar.manage')}
            >
              {isSelectMode ? (
                <X className="w-3.5 h-3.5" />
              ) : (
                <ListChecks className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}

        <nav className={'flex flex-col pt-1.5'} aria-label={t('mainNav.label')}>
          <button
            onClick={handleDataPage}
            className={`group flex w-full items-center gap-2 text-left text-[13px] font-medium transition-colors ${navItemShape} ${
              isDataPageActive
                ? `bg-accent-muted text-accent shadow-[inset_2px_0_0_var(--color-accent)]`
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Layers className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('mainNav.data')}</span>
          </button>
          <button
            onClick={handleSkillsPage}
            className={`group flex w-full items-center gap-2 text-left text-[13px] font-medium transition-colors ${navItemShape} ${
              isSkillsPageActive
                ? `bg-accent-muted text-accent shadow-[inset_2px_0_0_var(--color-accent)]`
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Package className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('mainNav.skills')}</span>
          </button>
          <button
            onClick={handleAutomationPage}
            className={`group flex w-full items-center gap-2 text-left text-[13px] font-medium transition-colors ${navItemShape} ${
              isAutomationPageActive
                ? `bg-accent-muted text-accent shadow-[inset_2px_0_0_var(--color-accent)]`
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Clock3 className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('mainNav.automation')}</span>
          </button>
        </nav>
      </div>

      <div className={`flex-1 overflow-y-auto `}>
        {pinnedSessions.length > 0 && !isSelectMode && (
          <div className={''}>
            <div
              className={`flex items-center gap-1.5 text-[11.5px] font-semibold leading-5 text-text-muted h-7 mt-2 px-3.5`}
            >
              <Pin className="h-3 w-3" />
              {t('sidebar.pinnedTitle')}
            </div>
            <div className={'pb-1'}>
              {pinnedSessions.map((session) => renderSessionRow(session))}
            </div>
          </div>
        )}
        <div
          className={`text-[11.5px] font-semibold leading-5 text-text-muted flex h-7 mt-2 items-center px-3.5`}
        >
          {t('sidebar.projectsTitle')}
        </div>
        {groupedSessions.length === 0 ? (
          <div className="px-3 py-6">
            <p className="text-[13px] text-text-secondary">{t('sidebar.noTasks')}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('sidebar.noTasksHint')}</p>
          </div>
        ) : (
          <div className={''}>
            {groupedSessions.map((group) => {
              const isProjectExpanded = expandedProjectKeys.has(group.key);
              const isSavingProjectName = savingProjectRenameKey === group.key;
              return (
                <section key={group.key} className={'mt-1.5'} data-testid="sidebar-project">
                  <div className="">
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
                      <div
                        className={`flex items-center gap-1.5 transition-colors hover:bg-surface-hover/50 h-[26px] pl-2.5 pr-1`}
                      >
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
                          <span className="min-w-0 flex-1 truncate text-[11.5px] font-normal leading-4 text-text-muted">
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
                    <div className={'pb-0.5'}>
                      {group.sessions.map((session) => renderSessionRow(session))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {isSelectMode ? (
        <div className="border-t border-border-subtle bg-surface px-3 py-3">
          {showDeleteConfirm ? (
            <div className="rounded-xl border border-error/25 bg-error/10 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Trash2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-error" />
                <p className="min-w-0 flex-1 text-[12px] leading-4 text-text-primary">
                  {t('sidebar.batchDeleteConfirm', { count: selectedIds.size })}
                </p>
              </div>
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                  {t('sidebar.cancel')}
                </Button>
                <Button variant="danger" size="sm" onClick={handleBatchDelete}>
                  {t('sidebar.confirmDelete')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-0.5">
                <button
                  onClick={toggleSelectAll}
                  className="group flex items-center gap-2 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                >
                  <span
                    aria-hidden
                    className={`flex h-4 w-4 items-center justify-center rounded-md border transition-colors ${
                      allVisibleSelected || someVisibleSelected
                        ? 'border-accent bg-accent text-accent-foreground'
                        : 'border-border-muted bg-surface group-hover:border-accent/50'
                    }`}
                  >
                    {allVisibleSelected ? (
                      <Check className="h-3 w-3" strokeWidth={3} />
                    ) : someVisibleSelected ? (
                      <Minus className="h-3 w-3" strokeWidth={3} />
                    ) : null}
                  </span>
                  {allVisibleSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
                </button>
                <Badge tone={selectedIds.size > 0 ? 'accent' : 'default'}>
                  {t('sidebar.nSelected', { count: selectedIds.size })}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  className="flex-1 rounded-xl"
                  onClick={exitSelectMode}
                >
                  {t('sidebar.cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  className="flex-1 rounded-xl"
                  disabled={selectedIds.size === 0}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-border-subtle">
          <div className={`flex h-12 w-full items-center items-stretch pl-3.5`}>
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
                    <span
                      className={`flex min-w-0 flex-1 ${desktopAuthStatus.connectionStatus === 'disconnected' ? 'flex-col' : 'items-center gap-3'}`}
                    >
                      <span className="min-w-0 truncate text-[13px] font-medium text-text-primary">
                        {authDisplayName || t('sidebar.loggedIn')}
                      </span>
                      <span className="text-[12px] font-medium text-text-muted">
                        {authSecondaryText}
                      </span>
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

            <GlassDropdownMenu
              align="end"
              side="top"
              sideOffset={6}
              trigger={
                <button
                  className={`inline-flex flex-shrink-0 items-center gap-1 px-2 text-[12px] text-text-secondary h-full px-3 transition-colors hover:bg-surface-hover hover:text-text-primary`}
                  title={t('sidebar.themeToggle')}
                >
                  {settings.theme === 'dark' ? (
                    <Moon className="h-3.5 w-3.5" />
                  ) : settings.theme === 'light' ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5" />
                  )}
                  {settings.theme === 'dark'
                    ? t('general.themeDark')
                    : settings.theme === 'light'
                      ? t('general.themeLight')
                      : t('general.themeSystem')}
                  <ChevronDown className="h-3 w-3 text-text-muted" />
                </button>
              }
            >
              {(
                [
                  ['light', t('general.themeLight'), Sun],
                  ['dark', t('general.themeDark'), Moon],
                  ['system', t('general.themeSystem'), Monitor],
                ] as const
              ).map(([value, label, Icon]) => (
                <GlassMenuItem
                  key={value}
                  icon={<Icon className="h-3.5 w-3.5" />}
                  selected={settings.theme === value}
                  onSelect={() => updateSettings({ theme: value })}
                >
                  {label}
                </GlassMenuItem>
              ))}
            </GlassDropdownMenu>
            <button
              onClick={() => setShowSettings(true)}
              className={`relative flex flex-shrink-0 items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary h-full w-10`}
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
      <Dialog
        open={isLoginBusy && !loginDialogHidden}
        onOpenChange={(open) => {
          if (!open) setLoginDialogHidden(true);
        }}
        closeOnOverlayClick
        ariaLabelledBy="login-waiting-title"
        className="max-w-[400px] gap-0 overflow-hidden p-0"
      >
        <div className="flex h-11 items-center border-b border-border-subtle px-3">
          <DialogTitle id="login-waiting-title" className="text-[14px]">
            {t('sidebar.login')}
          </DialogTitle>
        </div>
        <div className="pb-3">
          <section className="ui-group bg-surface">
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{t('sidebar.loginMethodLabel')}</div>
              <div className="ui-form-value text-[13px]">{t('sidebar.loginMethodBrowser')}</div>
            </div>
            {desktopAuthStatus?.apiOrigin && (
              <div className="ui-form-row">
                <div className="ui-form-label items-center">{t('sidebar.loginAddressLabel')}</div>
                <div
                  className="ui-form-value truncate font-mono text-[12px] text-text-secondary"
                  title={desktopAuthStatus.apiOrigin}
                >
                  <span className="truncate">{desktopAuthStatus.apiOrigin}</span>
                </div>
              </div>
            )}
            <div className="ui-form-row">
              <div className="ui-form-label items-center">{t('sidebar.loginStatusLabel')}</div>
              <div className="ui-form-value">
                <span className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {t('sidebar.loginWaitingBrowser')}
                </span>
              </div>
            </div>
          </section>
        </div>
        <div className="grid h-11 grid-cols-2 border-t border-border-subtle text-[13px] font-medium">
          <button
            type="button"
            onClick={() => setLoginDialogHidden(true)}
            className="border-r border-border-subtle text-text-secondary transition-colors hover:bg-surface-hover"
          >
            {t('sidebar.loginHideDialog')}
          </button>
          <button
            type="button"
            onClick={() => void handleCancelLoginClick()}
            className="text-error transition-colors hover:bg-error/10"
          >
            {t('sidebar.cancelLogin')}
          </button>
        </div>
      </Dialog>
      {edgeHandle}
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

/** Cmd+N on macOS, Ctrl+N elsewhere; no Shift/Alt and no auto-repeat. */
export function isNewTaskShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>,
  isMac: boolean
): boolean {
  if (event.key.toLowerCase() !== 'n' || event.shiftKey || event.altKey || event.repeat)
    return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
