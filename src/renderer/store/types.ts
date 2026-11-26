import type { StateCreator } from 'zustand';
import type { DataResourceTarget } from '../../shared/data-resource-link';
import type { ChatScriptLaunch } from '../../shared/chat-to-script';
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

/** In-flight / failed 对话转脚本 generations, keyed by the turn's anchor message id. */
export interface ChatScriptJob {
  status: 'running' | 'failed';
  sessionId: string;
  packageId?: string;
  error?: string;
}

export interface ScriptAutomationPrefill {
  id: string;
  name: string;
  /** Daily time "HH:MM". */
  time: string;
}

export type GlobalNoticeType = 'info' | 'warning' | 'error' | 'success';
export type GlobalNoticeAction = 'open_api_settings';

export interface ScriptEditorTarget {
  /** Existing package; omitted for 「新建脚本包」. */
  packageId?: string;
  /** Version to open (defaults to the newest draft, else the published one). */
  version?: number;
  step?: 'rules' | 'review';
  /** 对话「转成脚本」: generate from these confirmed key points as soon as the editor opens. */
  chat?: ChatScriptLaunch;
  /** 新建脚本包 from an automation's 执行脚本 node: bind the package once it is created. */
  onCreated?: (packageId: string) => void;
  /** The package was deleted from the editor: unbind it. */
  onDeleted?: (packageId: string) => void;
  /** Bumped on every open so the same target can be reopened. */
  nonce: number;
}

export type MainView = 'chat' | 'data' | 'cloud-data' | 'skills' | 'automation';
export type DataWorkspaceTab =
  'pipelines' | 'raw_tables' | 'result_tables' | 'cloud_analysis' | 'cloud_connection';

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

export interface PendingTableAutomationNavigation {
  automationId?: string;
  resultTable?: { id: string; name: string };
  rawTable?: { id: string; name: string };
  newRawTableName?: string;
  cloudSource?: PendingCloudInputSource;
  returnTarget?: DataResourceTarget;
  /** 创建自动化 from the script editor: 执行脚本 with this package, daily at `time`. */
  scriptPackage?: ScriptAutomationPrefill;
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

/** Unified per-session state that replaces parallel xxxBySession maps. */
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

export interface SessionSlice {
  sessions: Session[];
  projects: Project[];
  activeSessionId: string | null;
  sessionStates: Record<string, SessionState>;

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
  setSessionContextWindow: (sessionId: string, contextWindow: number) => void;
}

export interface NavigationSlice {
  mainView: MainView;
  newTaskNonce: number;
  scriptEditor: ScriptEditorTarget | null;
  chatScriptDialog: { sessionId: string; messageId?: string; scheduleTime?: string } | null;
  chatScriptJobs: Record<string, ChatScriptJob>;
  pendingDataNavigation: PendingDataNavigation | null;
  pendingDataTabNavigation: PendingDataTabNavigation | null;
  pendingCloudAutomationTemplateNavigation: PendingCloudAutomationTemplateNavigation | null;
  pendingTableAutomationNavigation: PendingTableAutomationNavigation | null;
  welcomeCloudTableChatDrafts: CloudTableChatAttachment[];
  cloudTableChatDraftsBySession: Record<string, CloudTableChatAttachment[]>;
  pendingSkillMention: string | null;

  setMainView: (view: MainView) => void;
  openNewTask: () => void;
  openScriptEditor: (target: Omit<ScriptEditorTarget, 'nonce'>) => void;
  closeScriptEditor: () => void;
  openChatScriptDialog: (target: {
    sessionId: string;
    messageId?: string;
    scheduleTime?: string;
  }) => void;
  closeChatScriptDialog: () => void;
  setChatScriptJob: (anchorId: string, job: ChatScriptJob | null) => void;
  navigateToDataElement: (target: DataResourceTarget) => void;
  navigateToDataTab: (tab: DataWorkspaceTab) => void;
  navigateToCloudData: () => void;
  navigateToCloudAutomationTemplate: (rawTemplate: string) => void;
  navigateToTableAutomation: (target: PendingTableAutomationNavigation) => void;
  clearDataNavigation: (nonce?: number) => void;
  clearDataTabNavigation: (nonce?: number) => void;
  clearCloudAutomationTemplateNavigation: (nonce?: number) => void;
  clearTableAutomationNavigation: () => void;
  addCloudTablesToWelcomeChat: (attachments: CloudTableChatAttachment[]) => void;
  removeCloudTableFromWelcomeChat: (attachmentId: string) => void;
  clearCloudTablesFromWelcomeChat: () => void;
  addCloudTablesToChat: (sessionId: string, attachments: CloudTableChatAttachment[]) => void;
  removeCloudTableFromChat: (sessionId: string, attachmentId: string) => void;
  clearCloudTablesFromChat: (sessionId: string) => void;
  setPendingSkillMention: (name: string | null) => void;
}

export interface ConfigSlice {
  settings: Settings;
  appConfig: AppConfig | null;
  isConfigured: boolean;
  showConfigModal: boolean;
  hasSeenInitialConfigStatus: boolean;
  desktopAuthStatus: DesktopAuthStatus;
  workingDir: string | null;
  systemDarkMode: boolean;

  setSettings: (updates: Partial<Settings>) => void;
  updateSettings: (updates: Partial<Settings>) => void;
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
  markInitialConfigStatusSeen: () => void;
  setDesktopAuthStatus: (status: DesktopAuthStatus) => void;
  setWorkingDir: (path: string | null) => void;
  setSystemDarkMode: (dark: boolean) => void;
}

export interface RuntimeSlice {
  isLoading: boolean;
  sidebarCollapsed: boolean;
  contextPanelCollapsed: boolean;
  showSettings: boolean;
  settingsTab: string | null;
  pendingPermission: PermissionRequest | null;
  pendingPermissionQueue: PermissionRequest[];
  pendingSudoPassword: SudoPasswordRequest | null;
  globalNotice: GlobalNotice | null;
  sandboxSetupProgress: SandboxSetupProgress | null;
  isSandboxSetupComplete: boolean;
  sandboxSyncStatus: SandboxSyncStatus | null;
  skillsStorageChangedAt: number;
  skillsStorageChangeEvent: SkillsStorageChangeEvent | null;

  setLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  toggleContextPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setContextPanelCollapsed: (collapsed: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setSettingsTab: (tab: string | null) => void;
  setPendingPermission: (permission: PermissionRequest | null) => void;
  dismissPermission: (toolUseId: string) => void;
  setPendingSudoPassword: (request: SudoPasswordRequest | null) => void;
  setGlobalNotice: (notice: GlobalNotice | null) => void;
  clearGlobalNotice: () => void;
  setSandboxSetupProgress: (progress: SandboxSetupProgress | null) => void;
  setSandboxSetupComplete: (complete: boolean) => void;
  setSandboxSyncStatus: (status: SandboxSyncStatus | null) => void;
  setSkillsStorageChangedAt: (timestamp: number) => void;
  setSkillsStorageChangeEvent: (event: SkillsStorageChangeEvent | null) => void;
}

export type AppState = SessionSlice & NavigationSlice & ConfigSlice & RuntimeSlice;

export type AppSliceCreator<TSlice> = StateCreator<AppState, [], [], TSlice>;
