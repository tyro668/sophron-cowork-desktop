import { create } from 'zustand';
import { DEFAULT_PERMISSION_POLICY } from '../../shared/permission-policies';
import type { DataResourceTarget } from '../../shared/data-resource-link';
import type {
  Session,
  Message,
  TraceStep,
  Project,
  PermissionRequest,
  SudoPasswordRequest,
  Settings,
  AppConfig,
  SandboxSetupProgress,
  SandboxSyncStatus,
  SkillsStorageChangeEvent,
  DesktopAuthStatus,
  CloudTableChatAttachment,
} from '../types';
import { applySessionUpdate } from '../utils/session-update';

export type GlobalNoticeType = 'info' | 'warning' | 'error' | 'success';
export type GlobalNoticeAction = 'open_api_settings';
export type MainView = 'chat' | 'data' | 'cloud-data' | 'skills' | 'automation';
export type DataWorkspaceTab = 'pipelines' | 'raw_tables' | 'result_tables' | 'cloud_analysis';

export interface PendingDataNavigation extends DataResourceTarget {
  nonce: number;
}

export interface PendingDataTabNavigation {
  tab: DataWorkspaceTab;
  nonce: number;
}

export interface PendingCloudAutomationTemplateNavigation {
  rawTemplate: string;
  nonce: number;
}

/** Cloud table prefill for a cloud.sync input node when navigating to the automation editor. */
export interface PendingCloudInputSource {
  spaceId: string;
  projectId: string;
  tableId: string;
  tableKind: 'analysis' | 'base';
  tableName?: string;
  spaceName?: string;
  projectName?: string;
}

export interface GlobalNotice {
  id: string;
  message: string;
  messageKey?: string;
  messageValues?: Record<string, string | number>;
  type: GlobalNoticeType;
  actionLabel?: string;
  action?: GlobalNoticeAction;
  onAction?: () => void;
}

export interface SessionExecutionClock {
  startAt: number | null;
  endAt: number | null;
}

export interface LiveToolOutput {
  text: string;
  truncated: boolean;
  updatedAt: number;
}

// Unified per-session state that replaces 8 parallel xxxBySession Maps
export interface SessionState {
  messages: Message[];
  partialMessage: string;
  partialThinking: string;
  pendingTurns: string[];
  activeTurn: { stepId: string; userMessageId: string } | null;
  executionClock: SessionExecutionClock;
  traceSteps: TraceStep[];
  liveToolOutputs: Record<string, LiveToolOutput>;
  lastActivityAt: number | null;
  contextWindow: number;
}

const DEFAULT_SESSION_STATE: SessionState = {
  messages: [],
  partialMessage: '',
  partialThinking: '',
  pendingTurns: [],
  activeTurn: null,
  executionClock: { startAt: null, endAt: null },
  traceSteps: [],
  liveToolOutputs: {},
  lastActivityAt: null,
  contextWindow: 0,
};

// Helper to immutably update a single session's state within the record
function patchSession(
  states: Record<string, SessionState>,
  sessionId: string,
  updates: Partial<SessionState>
): Record<string, SessionState> {
  const current = states[sessionId] ?? DEFAULT_SESSION_STATE;
  return {
    ...states,
    [sessionId]: { ...current, ...updates },
  };
}

// Helper to get a session's state with safe defaults
function getSession(states: Record<string, SessionState>, sessionId: string): SessionState {
  return states[sessionId] ?? DEFAULT_SESSION_STATE;
}

interface AppState {
  // Sessions
  sessions: Session[];
  projects: Project[];
  activeSessionId: string | null;

  // Per-session state (messages, partials, turns, traces, etc.)
  sessionStates: Record<string, SessionState>;

  // UI state
  isLoading: boolean;
  mainView: MainView;
  sidebarCollapsed: boolean;
  contextPanelCollapsed: boolean;
  showSettings: boolean;
  settingsTab: string | null;
  desktopAuthStatus: DesktopAuthStatus;

  // Permission
  pendingPermission: PermissionRequest | null;
  pendingPermissionQueue: PermissionRequest[];

  // Sudo password
  pendingSudoPassword: SudoPasswordRequest | null;

  // Settings
  settings: Settings;

  // App Config (API settings)
  appConfig: AppConfig | null;
  isConfigured: boolean;
  showConfigModal: boolean;
  hasSeenInitialConfigStatus: boolean;
  globalNotice: GlobalNotice | null;
  pendingDataNavigation: PendingDataNavigation | null;
  pendingDataTabNavigation: PendingDataTabNavigation | null;
  pendingCloudAutomationTemplateNavigation: PendingCloudAutomationTemplateNavigation | null;
  pendingTableAutomationNavigation: {
    automationId?: string;
    resultTable?: { id: string; name: string };
    rawTable?: { id: string; name: string };
    newRawTableName?: string;
    cloudSource?: PendingCloudInputSource;
    returnTarget?: DataResourceTarget;
  } | null;
  navigateToTableAutomation: (target: {
    automationId?: string;
    resultTable?: { id: string; name: string };
    rawTable?: { id: string; name: string };
    newRawTableName?: string;
    cloudSource?: PendingCloudInputSource;
    returnTarget?: DataResourceTarget;
  }) => void;
  clearTableAutomationNavigation: () => void;
  welcomeCloudTableChatDrafts: CloudTableChatAttachment[];
  cloudTableChatDraftsBySession: Record<string, CloudTableChatAttachment[]>;

  // Working directory
  workingDir: string | null;

  // Sandbox setup
  sandboxSetupProgress: SandboxSetupProgress | null;
  isSandboxSetupComplete: boolean;

  // Sandbox sync (per-session)
  sandboxSyncStatus: SandboxSyncStatus | null;
  skillsStorageChangedAt: number;
  skillsStorageChangeEvent: SkillsStorageChangeEvent | null;

  // System theme (from OS native theme)
  systemDarkMode: boolean;

  // Actions
  setSessions: (sessions: Session[]) => void;
  setProjects: (projects: Project[]) => void;
  upsertProject: (project: Project) => void;
  removeProject: (projectId: string) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  removeSessions: (sessionIds: string[]) => void;
  setActiveSession: (sessionId: string | null) => void;

  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  startExecutionClock: (sessionId: string, startAt: number) => void;
  finishExecutionClock: (sessionId: string, endAt?: number) => void;
  clearExecutionClock: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  setPartialMessage: (sessionId: string, partial: string) => void;
  clearPartialMessage: (sessionId: string) => void;
  setPartialThinking: (sessionId: string, delta: string) => void;
  clearPartialThinking: (sessionId: string) => void;
  activateNextTurn: (sessionId: string, stepId: string) => void;
  updateActiveTurnStep: (sessionId: string, stepId: string) => void;
  clearActiveTurn: (sessionId: string, stepId?: string) => void;
  clearPendingTurns: (sessionId: string) => void;
  clearQueuedMessages: (sessionId: string) => void;
  cancelQueuedMessages: (sessionId: string) => void;

  addTraceStep: (sessionId: string, step: TraceStep) => void;
  updateTraceStep: (sessionId: string, stepId: string, updates: Partial<TraceStep>) => void;
  setTraceSteps: (sessionId: string, steps: TraceStep[]) => void;
  setLiveToolOutput: (sessionId: string, toolCallId: string, output: LiveToolOutput) => void;
  clearLiveToolOutput: (sessionId: string, toolCallId?: string) => void;

  setLoading: (loading: boolean) => void;
  setMainView: (view: MainView) => void;
  toggleSidebar: () => void;
  toggleContextPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setContextPanelCollapsed: (collapsed: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setSettingsTab: (tab: string | null) => void;
  setDesktopAuthStatus: (status: DesktopAuthStatus) => void;

  setPendingPermission: (permission: PermissionRequest | null) => void;
  dismissPermission: (toolUseId: string) => void;

  setPendingSudoPassword: (request: SudoPasswordRequest | null) => void;

  setSettings: (updates: Partial<Settings>) => void;
  updateSettings: (updates: Partial<Settings>) => void;

  // Config actions
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
  markInitialConfigStatusSeen: () => void;
  setGlobalNotice: (notice: GlobalNotice | null) => void;
  clearGlobalNotice: () => void;
  navigateToDataElement: (target: DataResourceTarget) => void;
  navigateToDataTab: (tab: DataWorkspaceTab) => void;
  navigateToCloudData: () => void;
  navigateToCloudAutomationTemplate: (rawTemplate: string) => void;
  clearDataNavigation: (nonce?: number) => void;
  clearDataTabNavigation: (nonce?: number) => void;
  clearCloudAutomationTemplateNavigation: (nonce?: number) => void;
  addCloudTablesToWelcomeChat: (attachments: CloudTableChatAttachment[]) => void;
  removeCloudTableFromWelcomeChat: (attachmentId: string) => void;
  clearCloudTablesFromWelcomeChat: () => void;
  addCloudTablesToChat: (sessionId: string, attachments: CloudTableChatAttachment[]) => void;
  removeCloudTableFromChat: (sessionId: string, attachmentId: string) => void;
  clearCloudTablesFromChat: (sessionId: string) => void;

  // Working directory actions
  setWorkingDir: (path: string | null) => void;

  // Sandbox setup actions
  setSandboxSetupProgress: (progress: SandboxSetupProgress | null) => void;
  setSandboxSetupComplete: (complete: boolean) => void;

  // Sandbox sync actions
  setSandboxSyncStatus: (status: SandboxSyncStatus | null) => void;
  setSkillsStorageChangedAt: (timestamp: number) => void;
  setSkillsStorageChangeEvent: (event: SkillsStorageChangeEvent | null) => void;

  // Context window actions
  setSessionContextWindow: (sessionId: string, contextWindow: number) => void;

  // System theme actions
  setSystemDarkMode: (dark: boolean) => void;
}

const defaultSettings: Settings = {
  theme: 'light',
  accentTheme: 'mint',
  logoVariant: 'mark',
  defaultTools: [
    'askuserquestion',
    'todowrite',
    'todoread',
    'webfetch',
    'websearch',
    'read',
    'write',
    'edit',
    'list_directory',
    'glob',
    'grep',
  ],
  permissionPolicy: DEFAULT_PERMISSION_POLICY,
  globalSkillsPath: '',
  memoryStrategy: 'auto',
  maxContextTokens: 180000,
};

let dataNavigationSeq = 0;
let dataTabNavigationSeq = 0;
let cloudAutomationTemplateNavigationSeq = 0;
export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  sessions: [],
  projects: [],
  activeSessionId: null,
  sessionStates: {},
  isLoading: false,
  mainView: 'chat',
  sidebarCollapsed: false,
  contextPanelCollapsed: false,
  showSettings: false,
  settingsTab: null,
  desktopAuthStatus: { authenticated: false, updatedAt: 0 },
  pendingPermission: null,
  pendingPermissionQueue: [],
  pendingSudoPassword: null,
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  showConfigModal: false,
  hasSeenInitialConfigStatus: false,
  globalNotice: null,
  pendingDataNavigation: null,
  pendingDataTabNavigation: null,
  pendingCloudAutomationTemplateNavigation: null,
  pendingTableAutomationNavigation: null,
  navigateToTableAutomation: (target) =>
    set({
      mainView: 'automation',
      activeSessionId: null,
      showSettings: false,
      pendingTableAutomationNavigation: target,
    }),
  clearTableAutomationNavigation: () => set({ pendingTableAutomationNavigation: null }),
  welcomeCloudTableChatDrafts: [],
  cloudTableChatDraftsBySession: {},
  workingDir: null,
  sandboxSetupProgress: null,
  isSandboxSetupComplete: false,
  sandboxSyncStatus: null,
  skillsStorageChangedAt: 0,
  skillsStorageChangeEvent: null,
  systemDarkMode: false,

  // Session actions
  setSessions: (sessions) => set({ sessions }),

  setProjects: (projects) => set({ projects }),

  upsertProject: (project) =>
    set((state) => {
      const exists = state.projects.some((item) => item.id === project.id);
      const projects = exists
        ? state.projects.map((item) => (item.id === project.id ? project : item))
        : [project, ...state.projects];
      return {
        projects,
        sessions: state.sessions.map((session) =>
          session.projectId === project.id
            ? {
                ...session,
                projectName: project.name || undefined,
                cwd: project.cwd,
                mountedPaths: project.cwd
                  ? [{ virtual: '/mnt/workspace', real: project.cwd }]
                  : session.mountedPaths,
              }
            : session
        ),
      };
    }),

  removeProject: (projectId) =>
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== projectId),
      sessions: state.sessions.map((session) =>
        session.projectId === projectId
          ? { ...session, projectId: undefined, projectName: undefined }
          : session
      ),
    })),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
      sessionStates: {
        ...state.sessionStates,
        [session.id]: { ...DEFAULT_SESSION_STATE },
      },
    })),

  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: applySessionUpdate(state.sessions, sessionId, updates),
    })),

  removeSession: (sessionId) => get().removeSessions([sessionId]),

  removeSessions: (sessionIds) =>
    set((state) => {
      const idSet = new Set(sessionIds);
      const newSessionStates: Record<string, SessionState> = {};
      const newCloudTableChatDrafts: AppState['cloudTableChatDraftsBySession'] = {};
      for (const key of Object.keys(state.sessionStates)) {
        if (!idSet.has(key)) newSessionStates[key] = state.sessionStates[key];
      }
      for (const key of Object.keys(state.cloudTableChatDraftsBySession)) {
        if (!idSet.has(key)) {
          newCloudTableChatDrafts[key] = state.cloudTableChatDraftsBySession[key];
        }
      }

      return {
        sessions: state.sessions.filter((s) => !idSet.has(s.id)),
        sessionStates: newSessionStates,
        cloudTableChatDraftsBySession: newCloudTableChatDrafts,
        activeSessionId:
          state.activeSessionId && idSet.has(state.activeSessionId) ? null : state.activeSessionId,
      };
    }),

  setActiveSession: (sessionId) =>
    set({
      activeSessionId: sessionId,
      ...(sessionId ? { mainView: 'chat' as const } : {}),
    }),

  // Message actions
  addMessage: (sessionId, message) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const messages = ss.messages;
      let updatedMessages = messages;
      let updatedPendingTurns = ss.pendingTurns;

      if (message.role === 'user') {
        updatedMessages = [...messages, message];
        updatedPendingTurns = [...ss.pendingTurns, message.id];
      } else {
        const activeTurn = ss.activeTurn;
        if (activeTurn?.userMessageId) {
          const anchorIndex = messages.findIndex((item) => item.id === activeTurn.userMessageId);
          if (anchorIndex >= 0) {
            let insertIndex = anchorIndex + 1;
            while (insertIndex < messages.length) {
              if (messages[insertIndex].role === 'user') break;
              insertIndex += 1;
            }
            updatedMessages = [
              ...messages.slice(0, insertIndex),
              message,
              ...messages.slice(insertIndex),
            ];
          } else {
            updatedMessages = [...messages, message];
          }
        } else {
          updatedMessages = [...messages, message];
        }
      }

      const shouldClearPartial = message.role === 'assistant';
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: updatedPendingTurns,
          lastActivityAt:
            message.role === 'user' && ss.activeTurn ? ss.lastActivityAt : message.timestamp,
          ...(shouldClearPartial ? { partialMessage: '', partialThinking: '' } : {}),
        }),
      };
    }),

  updateMessage: (sessionId, messageId, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const idx = ss.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return {};
      const updatedMessages = ss.messages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m
      );
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, { messages: updatedMessages }),
      };
    }),

  startExecutionClock: (sessionId, startAt) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      // A queued prompt must not replace the running turn's activity or output.
      if (ss.activeTurn) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          executionClock: { startAt, endAt: null },
          lastActivityAt: startAt,
        }),
      };
    }),

  finishExecutionClock: (sessionId, endAt) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.executionClock.startAt === null) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          executionClock: {
            startAt: ss.executionClock.startAt,
            endAt: endAt ?? Date.now(),
          },
        }),
      };
    }),

  clearExecutionClock: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        executionClock: { startAt: null, endAt: null },
      }),
    })),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { messages }),
    })),

  setPartialMessage: (sessionId, partial) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          partialMessage: ss.partialMessage + partial,
          lastActivityAt: Date.now(),
        }),
      };
    }),

  clearPartialMessage: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { partialMessage: '' }),
    })),

  setPartialThinking: (sessionId, delta) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          partialThinking: ss.partialThinking + delta,
          lastActivityAt: Date.now(),
        }),
      };
    }),

  clearPartialThinking: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { partialThinking: '' }),
    })),

  activateNextTurn: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.pendingTurns.length === 0) {
        return {
          sessionStates: patchSession(state.sessionStates, sessionId, {
            activeTurn: null,
          }),
        };
      }

      const [nextMessageId, ...rest] = ss.pendingTurns;
      const updatedMessages = ss.messages.map((message) =>
        message.id === nextMessageId ? { ...message, localStatus: undefined } : message
      );

      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: rest,
          activeTurn: { stepId, userMessageId: nextMessageId },
          executionClock: { startAt: Date.now(), endAt: null },
          liveToolOutputs: {},
          lastActivityAt: Date.now(),
        }),
      };
    }),

  updateActiveTurnStep: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (!ss.activeTurn || ss.activeTurn.stepId === stepId) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          activeTurn: { ...ss.activeTurn, stepId },
        }),
      };
    }),

  clearActiveTurn: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (!ss.activeTurn) return {};
      if (stepId && ss.activeTurn.stepId !== stepId) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          activeTurn: null,
          liveToolOutputs: {},
        }),
      };
    }),

  clearPendingTurns: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { pendingTurns: [] }),
    })),

  clearQueuedMessages: (sessionId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      let hasQueued = false;
      const updatedMessages = ss.messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: undefined };
        }
        return message;
      });
      // Also remove any queued message IDs from pendingTurns
      const queuedIds = new Set(
        ss.messages.filter((m) => m.localStatus === 'queued').map((m) => m.id)
      );
      const updatedPendingTurns = ss.pendingTurns.filter((id) => !queuedIds.has(id));
      if (!hasQueued) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: updatedPendingTurns,
        }),
      };
    }),

  cancelQueuedMessages: (sessionId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      let hasQueued = false;
      const updatedMessages = ss.messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: 'cancelled' as const };
        }
        return message;
      });
      if (!hasQueued) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
        }),
      };
    }),

  // Trace actions
  addTraceStep: (sessionId, step) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          traceSteps: [...ss.traceSteps, step],
          lastActivityAt: Date.now(),
        }),
      };
    }),

  updateTraceStep: (sessionId, stepId, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const hasExistingStep = ss.traceSteps.some((step) => step.id === stepId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          traceSteps: hasExistingStep
            ? ss.traceSteps.map((step) => (step.id === stepId ? { ...step, ...updates } : step))
            : [
                ...ss.traceSteps,
                {
                  id: stepId,
                  type: updates.type ?? 'tool_call',
                  status: updates.status ?? 'running',
                  title: updates.title ?? updates.toolName ?? 'Trace step',
                  timestamp: updates.timestamp ?? Date.now(),
                  ...updates,
                },
              ],
          lastActivityAt: Date.now(),
        }),
      };
    }),

  setTraceSteps: (sessionId, steps) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { traceSteps: steps }),
    })),

  setLiveToolOutput: (sessionId, toolCallId, output) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          liveToolOutputs: { ...ss.liveToolOutputs, [toolCallId]: output },
          lastActivityAt: output.updatedAt,
        }),
      };
    }),

  clearLiveToolOutput: (sessionId, toolCallId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (!toolCallId) {
        if (Object.keys(ss.liveToolOutputs).length === 0) return {};
        return {
          sessionStates: patchSession(state.sessionStates, sessionId, { liveToolOutputs: {} }),
        };
      }
      if (!(toolCallId in ss.liveToolOutputs)) return {};
      const liveToolOutputs = { ...ss.liveToolOutputs };
      delete liveToolOutputs[toolCallId];
      return { sessionStates: patchSession(state.sessionStates, sessionId, { liveToolOutputs }) };
    }),

  // UI actions
  setLoading: (loading) => set({ isLoading: loading }),
  setMainView: (view) => set({ mainView: view }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleContextPanel: () =>
    set((state) => ({ contextPanelCollapsed: !state.contextPanelCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setContextPanelCollapsed: (collapsed) => set({ contextPanelCollapsed: collapsed }),
  setShowSettings: (show) => set({ showSettings: show }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setDesktopAuthStatus: (status) => set({ desktopAuthStatus: status }),

  // Permission actions
  setPendingPermission: (permission) =>
    set((state) => {
      const pending = state.pendingPermission
        ? [state.pendingPermission, ...state.pendingPermissionQueue]
        : state.pendingPermissionQueue;
      const next = permission
        ? pending.some((item) => item.toolUseId === permission.toolUseId)
          ? pending.map((item) => (item.toolUseId === permission.toolUseId ? permission : item))
          : [...pending, permission]
        : pending.slice(1);
      return { pendingPermission: next[0] ?? null, pendingPermissionQueue: next.slice(1) };
    }),
  dismissPermission: (toolUseId) =>
    set((state) => {
      const next = [state.pendingPermission, ...state.pendingPermissionQueue].filter(
        (item): item is PermissionRequest => item !== null && item.toolUseId !== toolUseId
      );
      return { pendingPermission: next[0] ?? null, pendingPermissionQueue: next.slice(1) };
    }),

  // Sudo password actions
  setPendingSudoPassword: (request) => set({ pendingSudoPassword: request }),

  // Settings actions
  setSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
  updateSettings: (updates) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send({
        type: 'settings.update',
        payload: updates as Record<string, unknown>,
      });
    }
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
  },

  // Config actions
  setAppConfig: (config) => set({ appConfig: config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
  markInitialConfigStatusSeen: () => set({ hasSeenInitialConfigStatus: true }),
  setGlobalNotice: (notice) => set({ globalNotice: notice }),
  clearGlobalNotice: () => set({ globalNotice: null }),
  navigateToDataElement: (target) =>
    set({
      mainView: 'data',
      showSettings: false,
      pendingDataNavigation: { ...target, nonce: ++dataNavigationSeq },
    }),
  navigateToDataTab: (tab) =>
    set({
      mainView: 'data',
      activeSessionId: null,
      showSettings: false,
      pendingDataTabNavigation: { tab, nonce: ++dataTabNavigationSeq },
    }),
  navigateToCloudData: () =>
    set({
      mainView: 'data',
      activeSessionId: null,
      showSettings: false,
      pendingDataTabNavigation: { tab: 'cloud_analysis', nonce: ++dataTabNavigationSeq },
    }),
  navigateToCloudAutomationTemplate: (rawTemplate) =>
    set({
      mainView: 'automation',
      activeSessionId: null,
      showSettings: false,
      pendingCloudAutomationTemplateNavigation: {
        rawTemplate,
        nonce: ++cloudAutomationTemplateNavigationSeq,
      },
    }),
  clearDataNavigation: (nonce) =>
    set((state) => {
      if (nonce !== undefined && state.pendingDataNavigation?.nonce !== nonce) {
        return {};
      }
      return { pendingDataNavigation: null };
    }),
  clearDataTabNavigation: (nonce) =>
    set((state) => {
      if (nonce !== undefined && state.pendingDataTabNavigation?.nonce !== nonce) {
        return {};
      }
      return { pendingDataTabNavigation: null };
    }),
  clearCloudAutomationTemplateNavigation: (nonce) =>
    set((state) => {
      if (nonce !== undefined && state.pendingCloudAutomationTemplateNavigation?.nonce !== nonce) {
        return {};
      }
      return { pendingCloudAutomationTemplateNavigation: null };
    }),
  addCloudTablesToWelcomeChat: (attachments) => {
    if (attachments.length === 0) return;
    set((state) => {
      const byId = new Map(state.welcomeCloudTableChatDrafts.map((item) => [item.id, item]));
      attachments.forEach((item) => {
        byId.set(item.id, item);
      });
      return {
        mainView: 'chat',
        activeSessionId: null,
        showSettings: false,
        welcomeCloudTableChatDrafts: Array.from(byId.values()),
      };
    });
  },
  removeCloudTableFromWelcomeChat: (attachmentId) =>
    set((state) => {
      const next = state.welcomeCloudTableChatDrafts.filter((item) => item.id !== attachmentId);
      if (next.length === state.welcomeCloudTableChatDrafts.length) return {};
      return { welcomeCloudTableChatDrafts: next };
    }),
  clearCloudTablesFromWelcomeChat: () =>
    set((state) => {
      if (state.welcomeCloudTableChatDrafts.length === 0) return {};
      return { welcomeCloudTableChatDrafts: [] };
    }),
  addCloudTablesToChat: (sessionId, attachments) => {
    if (attachments.length === 0) return;
    set((state) => {
      const byId = new Map(
        (state.cloudTableChatDraftsBySession[sessionId] ?? []).map((item) => [item.id, item])
      );
      attachments.forEach((item) => {
        byId.set(item.id, item);
      });
      return {
        mainView: 'chat',
        activeSessionId: sessionId,
        showSettings: false,
        cloudTableChatDraftsBySession: {
          ...state.cloudTableChatDraftsBySession,
          [sessionId]: Array.from(byId.values()),
        },
      };
    });
  },
  removeCloudTableFromChat: (sessionId, attachmentId) =>
    set((state) => {
      const current = state.cloudTableChatDraftsBySession[sessionId] ?? [];
      const nextDraft = current.filter((item) => item.id !== attachmentId);
      if (nextDraft.length === current.length) return {};
      const next = { ...state.cloudTableChatDraftsBySession };
      if (nextDraft.length > 0) {
        next[sessionId] = nextDraft;
      } else {
        delete next[sessionId];
      }
      return { cloudTableChatDraftsBySession: next };
    }),
  clearCloudTablesFromChat: (sessionId) =>
    set((state) => {
      if (!state.cloudTableChatDraftsBySession[sessionId]) return {};
      const next = { ...state.cloudTableChatDraftsBySession };
      delete next[sessionId];
      return { cloudTableChatDraftsBySession: next };
    }),

  // Working directory actions
  setWorkingDir: (path) => set({ workingDir: path }),

  // Sandbox setup actions
  setSandboxSetupProgress: (progress) => set({ sandboxSetupProgress: progress }),
  setSandboxSetupComplete: (complete) => set({ isSandboxSetupComplete: complete }),

  // Sandbox sync actions
  setSandboxSyncStatus: (status) => set({ sandboxSyncStatus: status }),
  setSkillsStorageChangedAt: (timestamp) => set({ skillsStorageChangedAt: timestamp }),
  setSkillsStorageChangeEvent: (event) => set({ skillsStorageChangeEvent: event }),

  // Context window actions
  setSessionContextWindow: (sessionId, contextWindow) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { contextWindow }),
    })),

  // System theme actions
  setSystemDarkMode: (dark) => set({ systemDarkMode: dark }),
}));

// Expose helpers for nav-server (CLI-driven UI navigation via executeJavaScript)
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;

  w.__getNavStatus = () => {
    const s = useAppStore.getState();
    return {
      showSettings: !!s.showSettings,
      mainView: s.mainView,
      activeSessionId: s.activeSessionId || null,
      sessionCount: (s.sessions || []).length,
    };
  };

  w.__navigate = (page: string, tab?: string, sessionId?: string) => {
    const store = useAppStore.getState();
    if (page === 'welcome') {
      store.setShowSettings(false);
      store.setMainView('chat');
      store.setActiveSession(null);
    } else if (page === 'data') {
      store.setShowSettings(false);
      store.setMainView('data');
      store.setActiveSession(null);
    } else if (page === 'cloud-data') {
      store.navigateToCloudData();
    } else if (page === 'skills') {
      store.setShowSettings(false);
      store.setMainView('skills');
      store.setActiveSession(null);
    } else if (page === 'automation') {
      store.setShowSettings(false);
      store.setMainView('automation');
      store.setActiveSession(null);
    } else if (page === 'settings') {
      store.setSettingsTab(tab || 'api');
      store.setShowSettings(true);
    } else if (page === 'session') {
      if (!sessionId || typeof sessionId !== 'string') return false;
      const exists = store.sessions.some((s) => s.id === sessionId);
      if (!exists) return false;
      store.setShowSettings(false);
      store.setMainView('chat');
      store.setActiveSession(sessionId);
    }
    return true;
  };
}
