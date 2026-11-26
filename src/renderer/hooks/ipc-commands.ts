import { useAppStore } from '../store';
import type {
  ClientEvent,
  ContentBlock,
  Message,
  PermissionResult,
  Project,
  Session,
  TraceStep,
} from '../types';
import i18n from '../i18n/config';
import { debugIpc, isElectron } from './ipc-event-bridge';

export interface SessionSendOptions {
  selectedSkillNames?: string[];
}

function send(event: ClientEvent): void {
  if (!isElectron) {
    debugIpc('[useIPC] Browser mode - would send:', event.type);
    return;
  }
  debugIpc('[useIPC] Sending:', event.type);
  window.electronAPI.send(event);
}

async function invoke<T>(event: ClientEvent): Promise<T> {
  if (!isElectron) {
    debugIpc('[useIPC] Browser mode - would invoke:', event.type);
    return null as T;
  }
  debugIpc('[useIPC] Invoking:', event.type);
  return window.electronAPI.invoke<T>(event);
}

async function startSession(
  title: string,
  promptOrContent: string | ContentBlock[],
  cwd?: string,
  options?: SessionSendOptions
): Promise<Session | null> {
  const store = useAppStore.getState();
  store.setLoading(true);
  debugIpc('[useIPC] Starting session:', title);

  const content: ContentBlock[] =
    typeof promptOrContent === 'string'
      ? [{ type: 'text', text: promptOrContent }]
      : promptOrContent;

  const textContent = content.find((block) => block.type === 'text');
  const prompt = textContent && 'text' in textContent ? textContent.text : '';

  if (!isElectron) {
    const sessionId = `mock-session-${Date.now()}`;
    const session: Session = {
      id: sessionId,
      title: title || 'New Session',
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cwd: cwd || '',
      mountedPaths: [],
      allowedTools: [
        'webfetch',
        'websearch',
        'read',
        'write',
        'edit',
        'list_directory',
        'glob',
        'grep',
      ],
      memoryEnabled: true,
    };

    store.addSession(session);
    useAppStore.getState().setActiveSession(sessionId);

    const userMessage: Message = {
      id: `msg-user-${Date.now()}`,
      sessionId,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    store.addMessage(sessionId, userMessage);
    store.startExecutionClock(sessionId, userMessage.timestamp);
    const mockStepId = `mock-step-${Date.now()}`;
    store.activateNextTurn(sessionId, mockStepId);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const assistantMessage: Message = {
      id: `msg-assistant-${Date.now()}`,
      sessionId,
      role: 'assistant',
      content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
      timestamp: Date.now(),
    };
    store.addMessage(sessionId, assistantMessage);

    store.updateSession(sessionId, { status: 'idle' });
    store.clearActiveTurn(sessionId, mockStepId);
    store.setLoading(false);

    return session;
  }

  try {
    const session = await invoke<Session>({
      type: 'session.start',
      payload: {
        title,
        prompt,
        cwd,
        permissionPolicy: useAppStore.getState().settings.permissionPolicy,
        content,
        selectedSkillNames: options?.selectedSkillNames,
      },
    });
    if (session) {
      store.addSession(session);
      useAppStore.getState().setActiveSession(session.id);

      const userMessage: Message = {
        id: `msg-user-${Date.now()}`,
        sessionId: session.id,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      store.addMessage(session.id, userMessage);
      store.startExecutionClock(session.id, userMessage.timestamp);

      const mockStepId = `pending-step-${Date.now()}`;
      store.activateNextTurn(session.id, mockStepId);
    }
    return session;
  } catch (e) {
    store.setLoading(false);
    useAppStore.getState().setGlobalNotice({
      id: `notice-session-start-${Date.now()}`,
      type: 'error',
      message: e instanceof Error ? e.message : i18n.t('chat.startFailed'),
      messageKey: e instanceof Error ? undefined : 'chat.startFailed',
    });
    return null;
  }
}

async function continueSession(
  sessionId: string,
  promptOrContent: string | ContentBlock[],
  options?: SessionSendOptions
): Promise<void> {
  const store = useAppStore.getState();
  store.setLoading(true);
  debugIpc('[useIPC] Continuing session:', sessionId);

  const content: ContentBlock[] =
    typeof promptOrContent === 'string'
      ? [{ type: 'text', text: promptOrContent }]
      : promptOrContent;

  const textContent = content.find((block) => block.type === 'text');
  const prompt = textContent && 'text' in textContent ? textContent.text : '';

  const isSessionRunning =
    store.sessions.find((session) => session.id === sessionId)?.status === 'running';
  const ss = store.sessionStates[sessionId];
  const hasActiveTurn = Boolean(ss?.activeTurn);
  const hasPending = (ss?.pendingTurns?.length ?? 0) > 0;
  const shouldQueue = isSessionRunning || hasActiveTurn || hasPending;
  const userMessage: Message = {
    id: `msg-user-${Date.now()}`,
    sessionId,
    role: 'user',
    content,
    timestamp: Date.now(),
    localStatus: shouldQueue ? 'queued' : undefined,
  };
  store.addMessage(sessionId, userMessage);
  store.startExecutionClock(sessionId, userMessage.timestamp);

  if (!isElectron) {
    store.updateSession(sessionId, { status: 'running' });
    const mockStepId = `mock-step-${Date.now()}`;
    store.activateNextTurn(sessionId, mockStepId);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const assistantMessage: Message = {
      id: `msg-assistant-${Date.now()}`,
      sessionId,
      role: 'assistant',
      content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
      timestamp: Date.now(),
    };
    store.addMessage(sessionId, assistantMessage);

    store.updateSession(sessionId, { status: 'idle' });
    store.clearActiveTurn(sessionId, mockStepId);
    store.clearPendingTurns(sessionId);
    store.setLoading(false);
    return;
  }

  if (!shouldQueue) {
    const mockStepId = `pending-step-${Date.now()}`;
    store.activateNextTurn(sessionId, mockStepId);
  }

  try {
    send({
      type: 'session.continue',
      payload: {
        sessionId,
        prompt,
        permissionPolicy: store.settings.permissionPolicy,
        content,
        selectedSkillNames: options?.selectedSkillNames,
      },
    });
  } catch (e) {
    store.setLoading(false);
    useAppStore.getState().setGlobalNotice({
      id: `notice-session-continue-${Date.now()}`,
      type: 'error',
      message: e instanceof Error ? e.message : i18n.t('chat.startFailed'),
      messageKey: e instanceof Error ? undefined : 'chat.startFailed',
    });
  }
}

function stopSession(sessionId: string): void {
  const store = useAppStore.getState();
  store.cancelQueuedMessages(sessionId);
  store.clearPendingTurns(sessionId);
  store.clearActiveTurn(sessionId);
  store.clearLiveToolOutput(sessionId);
  store.finishExecutionClock(sessionId);
  if (!isElectron) {
    store.updateSession(sessionId, { status: 'idle' });
    store.setLoading(false);
    return;
  }
  send({ type: 'session.stop', payload: { sessionId } });
  store.setLoading(false);
}

function deleteSession(sessionId: string): void {
  useAppStore.getState().removeSession(sessionId);
  if (isElectron) {
    send({ type: 'session.delete', payload: { sessionId } });
  }
}

function renameSession(sessionId: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  useAppStore.getState().updateSession(sessionId, { title: trimmed });
  if (isElectron) {
    send({ type: 'session.rename', payload: { sessionId, title: trimmed } });
  }
}

function duplicateSession(sessionId: string, titleSuffix?: string): void {
  if (isElectron) {
    send({ type: 'session.duplicate', payload: { sessionId, titleSuffix } });
  }
}

function batchDeleteSessions(sessionIds: string[]): void {
  useAppStore.getState().removeSessions(sessionIds);
  if (isElectron) {
    send({ type: 'session.batchDelete', payload: { sessionIds } });
  }
}

function listSessions(): void {
  if (!isElectron) return;
  send({ type: 'session.list', payload: {} });
}

async function renameProject(
  projectLocator: string | { projectId?: string; cwd?: string },
  name: string | null
): Promise<Project | null> {
  const normalizedName = name?.trim() || null;
  const projectId = typeof projectLocator === 'string' ? projectLocator : projectLocator.projectId;
  const cwd = typeof projectLocator === 'string' ? undefined : projectLocator.cwd?.trim();
  if (!isElectron) {
    const project: Project = {
      id: projectId || `project-${Date.now()}`,
      name: normalizedName,
      cwd: cwd || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    useAppStore.getState().upsertProject(project);
    return project;
  }

  if (!projectId && cwd) {
    const project = await invoke<Project | null>({
      type: 'project.renameByCwd',
      payload: { cwd, name: normalizedName },
    });
    if (project) {
      useAppStore.getState().upsertProject(project);
    }
    return project;
  }

  if (!projectId) {
    return null;
  }

  const project = await invoke<Project | null>({
    type: 'project.rename',
    payload: { projectId, name: normalizedName },
  });
  if (project) {
    useAppStore.getState().upsertProject(project);
  }
  return project;
}

async function deleteProject(projectId: string): Promise<void> {
  useAppStore.getState().removeProject(projectId);
  if (isElectron) {
    await invoke<{ success: boolean }>({
      type: 'project.delete',
      payload: { projectId },
    });
  }
}

async function getSessionMessages(sessionId: string): Promise<Message[]> {
  if (!isElectron) {
    debugIpc('[useIPC] Browser mode - no persistent messages');
    return [];
  }
  debugIpc('[useIPC] Getting messages for session:', sessionId);
  const messages = await invoke<Message[]>({
    type: 'session.getMessages',
    payload: { sessionId },
  });
  return messages || [];
}

async function getSessionTraceSteps(sessionId: string): Promise<TraceStep[]> {
  if (!isElectron) {
    debugIpc('[useIPC] Browser mode - no persistent trace steps');
    return [];
  }
  return (
    (await invoke<TraceStep[]>({ type: 'session.getTraceSteps', payload: { sessionId } })) || []
  );
}

function respondToPermission(toolUseId: string, result: PermissionResult): void {
  send({
    type: 'permission.response',
    payload: { toolUseId, result },
  });
  useAppStore.getState().dismissPermission(toolUseId);
}

function respondToSudoPassword(toolUseId: string, password: string | null): void {
  send({
    type: 'sudo.password.response',
    payload: { toolUseId, password },
  });
  useAppStore.getState().setPendingSudoPassword(null);
}

async function selectFolder(): Promise<string | null> {
  if (!isElectron) {
    return '/mock/folder/path';
  }
  return invoke<string | null>({ type: 'folder.select', payload: {} });
}

async function getWorkingDir(): Promise<string | null> {
  if (!isElectron) {
    return '/mock/working/dir';
  }
  return invoke<string | null>({ type: 'workdir.get', payload: {} });
}

async function changeWorkingDir(
  sessionId?: string,
  currentPath?: string
): Promise<{ success: boolean; path: string; error?: string }> {
  if (!isElectron) {
    return { success: true, path: '/mock/working/dir' };
  }
  return invoke<{ success: boolean; path: string; error?: string }>({
    type: 'workdir.select',
    payload: { sessionId, currentPath },
  });
}

async function setWorkingDirPath(
  path: string
): Promise<{ success: boolean; path: string; error?: string }> {
  if (!isElectron) {
    useAppStore.getState().setWorkingDir(path);
    return { success: true, path };
  }
  return invoke<{ success: boolean; path: string; error?: string }>({
    type: 'workdir.set',
    payload: { path },
  });
}

async function getMCPServers() {
  if (!isElectron) {
    return [];
  }
  return window.electronAPI.mcp.getServerStatus();
}

/** Stable command API — safe to import or return from hooks without re-allocating closures. */
export const ipcCommands = {
  send,
  invoke,
  startSession,
  continueSession,
  stopSession,
  deleteSession,
  renameSession,
  duplicateSession,
  batchDeleteSessions,
  renameProject,
  deleteProject,
  listSessions,
  getSessionMessages,
  getSessionTraceSteps,
  respondToPermission,
  respondToSudoPassword,
  selectFolder,
  getWorkingDir,
  changeWorkingDir,
  setWorkingDirPath,
  getMCPServers,
  isElectron,
};
