import { desktopClient } from '../features/desktop/api/desktop-client';
import { useTitlebarBrandSlot } from '../hooks/use-titlebar-brand-slot';
import { formatIpcError } from '../utils/ipc-error';
import { authClient } from '../features/auth/api/auth-client';
import { automationClient } from '../features/automation/api/automation-client';
import { updateClient } from '../features/update/api/update-client';
import { SidebarAuthAccountMenu, SidebarAuthAvatar } from './sidebar/SidebarAuthAvatarAndMenu';
import { SidebarBatchSelectBar } from './sidebar/SidebarBatchSelectBar';
import { SidebarCollapsedRail } from './sidebar/SidebarCollapsedRail';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { SidebarLoginDialog } from './sidebar/SidebarLoginDialog';
import { SidebarRenameDialog } from './sidebar/SidebarRenameDialog';
import {
  readStoredPinnedSessions,
  readStoredProjectExpansion,
  writeStoredPinnedSessions,
  writeStoredProjectExpansion,
} from './sidebar/sidebar-storage';
import { createPortal } from 'react-dom';
import { confirmLeave } from '../utils/leave-guard';
import { NEW_TASK_EVENT } from '../utils/new-task';
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
  ArrowLeftToLine,
  ArrowRightFromLine,
  X,
  Pin,
  PinOff,
  Copy,
  Wand2,
} from 'lucide-react';
import { useConfirmDialog } from './ConfirmDialog';
import type { AppUpdateState } from '../types';
import { GlassDropdownMenu, GlassMenuItem } from './GlassDropdownMenu';
import { Button } from './ui';
import { BrandMark } from './BrandMark';
import {
  buildSessionProjectGroups,
  buildProjectNameLookup,
  type SessionProjectGroup,
} from '../utils/sidebar-project-groups';

const SIDEBAR_EDGE_DRAG_THRESHOLD = 56;

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
  const openChatScriptDialog = useAppStore((s) => s.openChatScriptDialog);
  /** 转成脚本 in 任务操作: anchor of the latest qualifying turn per session (null = none). */
  const [scriptTurnBySession, setScriptTurnBySession] = useState<Record<string, string | null>>({});
  const loadScriptTurn = useCallback((sessionId: string) => {
    if (!automationClient.isAvailable()) return;
    void automationClient.scripts
      .chatTurns(sessionId)
      .then((turns) => turns[turns.length - 1]?.anchorId ?? null)
      .catch(() => null)
      .then((anchor) => setScriptTurnBySession((current) => ({ ...current, [sessionId]: anchor })));
  }, []);
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
  const rendererPlatform = desktopClient.platform();
  const isMac = rendererPlatform === 'darwin';
  const titlebarBrandSlot = useTitlebarBrandSlot();

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
    if (!isElectron || !authClient.isAvailable() || !isLoginBusy) return;

    setAuthBusyMode(null);
    try {
      const status = await authClient.cancelLogin();
      setDesktopAuthStatus(status);
    } catch (error) {
      setGlobalNotice({
        id: `desktop-auth-cancel-${Date.now()}`,
        type: 'warning',
        message: formatIpcError(error, t('sidebar.loginFailed')),
      });
    }
  }, [isElectron, isLoginBusy, setDesktopAuthStatus, setGlobalNotice, t]);

  const handleLoginEntryClick = useCallback(async () => {
    if (!isElectron || !authClient.isAvailable() || desktopAuthStatus.authenticated) {
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
      const status = await authClient.login();
      setDesktopAuthStatus(status);
    } catch (error) {
      const isCancelled = error instanceof Error && error.message === 'Login cancelled';
      setGlobalNotice({
        id: `desktop-auth-login-${Date.now()}`,
        type: isCancelled ? 'info' : 'error',
        message: isCancelled
          ? t('sidebar.loginCancelled')
          : formatIpcError(error, t('sidebar.loginFailed')),
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
    if (!isElectron || !authClient.isAvailable() || isAuthBusy) return;

    setAuthBusyMode('logout');
    try {
      const status = await authClient.logout();
      setDesktopAuthStatus(status);
      setAuthMenuOpen(false);
    } catch (error) {
      setGlobalNotice({
        id: `desktop-auth-logout-${Date.now()}`,
        type: 'error',
        message: formatIpcError(error, t('sidebar.logoutFailed')),
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
    if (!updateClient.isAvailable()) return;
    let cancelled = false;
    updateClient
      .getState()
      .then((state) => {
        if (!cancelled && state) {
          setUpdateState(state);
        }
      })
      .catch(() => undefined);
    const cleanup = updateClient.onState((state) => {
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

  const handleDataPage = useCallback(async () => {
    if (!(await confirmLeave())) return;
    exitSelectMode();
    setMainView('data');
    setShowSettings(false);
  }, [exitSelectMode, setMainView, setShowSettings]);

  const handleSkillsPage = useCallback(async () => {
    if (!(await confirmLeave())) return;
    exitSelectMode();
    setMainView('skills');
    setShowSettings(false);
  }, [exitSelectMode, setMainView, setShowSettings]);

  const handleAutomationPage = useCallback(async () => {
    if (!(await confirmLeave())) return;
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
      if (!(await confirmLeave())) return;
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

  const handleNewSession = async () => {
    if (!(await confirmLeave())) return;
    // Default the welcome picker to the previous conversation's project:
    // the session being viewed, or the most recently updated one.
    const previousCwd =
      sessions.find((session) => session.id === activeSessionId)?.cwd ??
      [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.cwd;
    exitSelectMode();
    // One store update: chat view, no active session, settings closed, a fresh welcome input.
    // The previous conversation is left as it was; the next message starts a new session.
    useAppStore.getState().openNewTask();
    if (previousCwd && previousCwd !== useAppStore.getState().workingDir) {
      void setWorkingDirPath(previousCwd);
    }
  };

  const handleUpdateBadgeClick = useCallback(async () => {
    if (!updateClient.isAvailable()) return;
    try {
      const state = await updateClient.checkAndInstall();
      if (state) {
        setUpdateState(state);
      }
    } catch (error) {
      console.error('[Sidebar] Failed to start update:', error);
    }
  }, []);

  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() =>
    readStoredPinnedSessions()
  );
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');
  const { confirmDelete } = useConfirmDialog();

  const togglePinSession = useCallback((sessionId: string) => {
    setPinnedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      writeStoredPinnedSessions(next);
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
    const onNewTask = () => newSessionRef.current();
    window.addEventListener('keydown', onKey);
    window.addEventListener(NEW_TASK_EVENT, onNewTask);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(NEW_TASK_EVENT, onNewTask);
    };
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
        className={`group relative mx-2.5 flex h-[31px] cursor-pointer items-center pl-[18px] pr-1.5 transition-colors ${
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
              onOpenChange={(open) => {
                if (open) loadScriptTurn(session.id);
              }}
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
                icon={<Wand2 className="h-3.5 w-3.5" />}
                disabled={!scriptTurnBySession[session.id]}
                onSelect={() => {
                  const anchor = scriptTurnBySession[session.id];
                  if (!anchor) return;
                  void handleSessionClick(session.id);
                  openChatScriptDialog({ sessionId: session.id, messageId: anchor });
                }}
              >
                {t('chatScript.convert')}
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
  const renderAuthAvatar = (containerClassName: string, iconClassName: string) => (
    <SidebarAuthAvatar
      authenticated={desktopAuthStatus.authenticated}
      isAuthBusy={isAuthBusy}
      canUseAuthAvatar={canUseAuthAvatar}
      authAvatarUrl={authAvatarUrl}
      containerClassName={containerClassName}
      iconClassName={iconClassName}
      onAvatarError={handleAuthAvatarError}
    />
  );
  const authAccountMenu = (
    <SidebarAuthAccountMenu
      authenticated={desktopAuthStatus.authenticated}
      isDisconnected={desktopAuthStatus.connectionStatus === 'disconnected'}
      isAuthBusy={isAuthBusy}
      isLogoutBusy={isLogoutBusy}
      canUseAuthAvatar={canUseAuthAvatar}
      authAvatarUrl={authAvatarUrl}
      authDisplayName={authDisplayName}
      authSecondaryText={authSecondaryText}
      authCreditsLabel={authCreditsLabel}
      authCreditsText={authCreditsText}
      onAvatarError={handleAuthAvatarError}
      onLogout={() => void handleLogoutClick()}
    />
  );

  const navItemShape = 'mx-2.5 h-9 px-2.5';

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
      <SidebarCollapsedRail
        isMac={isMac}
        forceCollapsed={forceCollapsed}
        titlebarBrandSlot={titlebarBrandSlot}
        renderBrand={renderBrand}
        isDataPageActive={isDataPageActive}
        isSkillsPageActive={isSkillsPageActive}
        isAutomationPageActive={isAutomationPageActive}
        authenticated={desktopAuthStatus.authenticated}
        authMenuOpen={authMenuOpen}
        isAuthBusy={isAuthBusy}
        isLoginBusy={isLoginBusy}
        isLogoutBusy={isLogoutBusy}
        isConfigured={isConfigured}
        themeIcon={themeIcon}
        authAccountMenu={authAccountMenu}
        edgeHandle={edgeHandle}
        renderAuthAvatar={renderAuthAvatar}
        onNewSession={() => void handleNewSession()}
        onDataPage={() => void handleDataPage()}
        onSkillsPage={() => void handleSkillsPage()}
        onAutomationPage={() => void handleAutomationPage()}
        onToggleSidebar={toggleSidebar}
        onAuthMenuOpenChange={handleAuthMenuOpenChange}
        onLoginEntryClick={() => void handleLoginEntryClick()}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setShowSettings(true)}
      />
    );
  }

  return (
    <aside className="relative flex h-full w-[19rem] shrink-0 flex-col border-r border-border-subtle bg-background-secondary">
      <SidebarRenameDialog
        open={renameDialog !== null}
        title={renameDialog?.title ?? ''}
        onTitleChange={(title) => setRenameDialog((cur) => (cur ? { ...cur, title } : cur))}
        onClose={() => setRenameDialog(null)}
        onSubmit={submitRenameDialog}
      />
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
        <div className={'mx-2.5 mt-2.5 flex h-[34px] items-stretch'}>
          <Button
            variant="primary"
            onClick={handleNewSession}
            className={'h-full min-w-0 flex-1 justify-start gap-2 rounded-none px-2.5'}
            title={`${t('sidebar.newTask')} (${isMac ? '⌘N' : 'Ctrl+N'})`}
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span className="text-[13px]">{t('sidebar.newTask')}</span>
          </Button>
          <span
            aria-hidden="true"
            data-testid="new-task-shortcut-cell"
            className="flex w-12 flex-shrink-0 items-center justify-center bg-accent text-[11px] font-semibold text-accent-foreground shadow-[inset_0_0_0_999px_rgba(0,0,0,0.12)]"
          >
            {isMac ? '⌘N' : 'Ctrl+N'}
          </span>
        </div>

        {sessions.length > 0 && (
          <div className={'mx-2.5 mt-2 flex h-[30px] items-stretch bg-surface-active/60'}>
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search')}
                className={`w-full h-full rounded-none border-0 bg-transparent pl-8 pr-2.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-surface-hover focus:ring-2 focus:ring-accent/20 transition-colors`}
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
            className={`group flex items-center gap-2 text-left text-[13px] font-medium transition-colors ${navItemShape} ${
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
            className={`group flex items-center gap-2 text-left text-[13px] font-medium transition-colors ${navItemShape} ${
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
            className={`group flex items-center gap-2 text-left text-[13px] font-medium transition-colors ${navItemShape} ${
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
        <SidebarBatchSelectBar
          showDeleteConfirm={showDeleteConfirm}
          selectedCount={selectedIds.size}
          allVisibleSelected={allVisibleSelected}
          someVisibleSelected={someVisibleSelected}
          onCancelDeleteConfirm={() => setShowDeleteConfirm(false)}
          onRequestDeleteConfirm={() => setShowDeleteConfirm(true)}
          onConfirmBatchDelete={handleBatchDelete}
          onToggleSelectAll={toggleSelectAll}
          onExitSelectMode={exitSelectMode}
        />
      ) : (
        <SidebarFooter
          authenticated={desktopAuthStatus.authenticated}
          isDisconnected={desktopAuthStatus.connectionStatus === 'disconnected'}
          authMenuOpen={authMenuOpen}
          isAuthBusy={isAuthBusy}
          isLoginBusy={isLoginBusy}
          isLogoutBusy={isLogoutBusy}
          authDisplayName={authDisplayName}
          authSecondaryText={authSecondaryText}
          authAccountMenu={authAccountMenu}
          theme={settings.theme}
          isConfigured={isConfigured}
          renderAuthAvatar={renderAuthAvatar}
          onAuthMenuOpenChange={handleAuthMenuOpenChange}
          onLoginEntryClick={() => void handleLoginEntryClick()}
          onSelectTheme={(theme) => updateSettings({ theme })}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
      <SidebarLoginDialog
        open={isLoginBusy && !loginDialogHidden}
        apiOrigin={desktopAuthStatus?.apiOrigin}
        onHide={() => setLoginDialogHidden(true)}
        onCancelLogin={() => void handleCancelLoginClick()}
      />
      {edgeHandle}
    </aside>
  );
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
