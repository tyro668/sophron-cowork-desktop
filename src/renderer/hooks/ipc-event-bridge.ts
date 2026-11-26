import { NEW_TASK_EVENT } from '../utils/new-task';
import { useAppStore } from '../store';
import type { AppConfig, ServerEvent, TraceStep } from '../types';
import i18n from '../i18n/config';
import { normalizePermissionPolicy } from '../../shared/permission-policies';

export const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const ipcDebugEnabled = import.meta.env.DEV;

export function debugIpc(...args: unknown[]): void {
  if (ipcDebugEnabled) console.log(...args);
}

type TraceAction =
  | { kind: 'add'; sessionId: string; step: TraceStep }
  | { kind: 'update'; sessionId: string; stepId: string; updates: Partial<TraceStep> };

interface StreamBatchers {
  bufferPartial: (sessionId: string, delta: string) => void;
  bufferThinking: (sessionId: string, delta: string) => void;
  bufferTrace: (action: TraceAction) => void;
  clearSessionBuffers: (sessionId: string) => void;
  flushAndCancelAll: () => void;
}

function createStreamBatchers(): StreamBatchers {
  const pendingPartials: Record<string, string[]> = {};
  let partialRafId: number | null = null;

  const pendingThinking: Record<string, string[]> = {};
  let thinkingRafId: number | null = null;

  let pendingTraces: TraceAction[] = [];
  let traceRafId: number | null = null;

  const flushPartials = () => {
    partialRafId = null;
    const store = useAppStore.getState();
    for (const sessionId in pendingPartials) {
      const chunks = pendingPartials[sessionId];
      if (chunks.length > 0) {
        store.setPartialMessage(sessionId, chunks.join(''));
        pendingPartials[sessionId] = [];
      }
    }
  };

  const flushThinking = () => {
    thinkingRafId = null;
    const store = useAppStore.getState();
    for (const sessionId in pendingThinking) {
      const chunks = pendingThinking[sessionId];
      if (chunks.length > 0) {
        store.setPartialThinking(sessionId, chunks.join(''));
        pendingThinking[sessionId] = [];
      }
    }
  };

  const flushTraces = () => {
    traceRafId = null;
    const store = useAppStore.getState();
    for (const action of pendingTraces) {
      if (action.kind === 'add') {
        store.addTraceStep(action.sessionId, action.step);
      } else {
        store.updateTraceStep(action.sessionId, action.stepId, action.updates);
      }
    }
    pendingTraces = [];
  };

  return {
    bufferPartial(sessionId, delta) {
      if (!pendingPartials[sessionId]) pendingPartials[sessionId] = [];
      pendingPartials[sessionId].push(delta);
      if (partialRafId === null) {
        partialRafId = requestAnimationFrame(flushPartials);
      }
    },
    bufferThinking(sessionId, delta) {
      if (!pendingThinking[sessionId]) pendingThinking[sessionId] = [];
      pendingThinking[sessionId].push(delta);
      if (thinkingRafId === null) {
        thinkingRafId = requestAnimationFrame(flushThinking);
      }
    },
    bufferTrace(action) {
      pendingTraces.push(action);
      if (traceRafId === null) {
        traceRafId = requestAnimationFrame(flushTraces);
      }
    },
    clearSessionBuffers(sessionId) {
      delete pendingPartials[sessionId];
      delete pendingThinking[sessionId];
    },
    flushAndCancelAll() {
      if (partialRafId !== null) {
        cancelAnimationFrame(partialRafId);
        flushPartials();
      }
      if (thinkingRafId !== null) {
        cancelAnimationFrame(thinkingRafId);
        flushThinking();
      }
      if (traceRafId !== null) {
        cancelAnimationFrame(traceRafId);
        flushTraces();
      }
    },
  };
}

const applyConfigSnapshot = (config: AppConfig, isConfigured: boolean) => {
  const store = useAppStore.getState();
  const isInitialConfigStatus = !store.hasSeenInitialConfigStatus;
  store.setIsConfigured(isConfigured);
  store.setAppConfig(config);
  store.setSettings({
    theme: config.theme || 'light',
    accentTheme: config.accentTheme || 'lavender',
    logoVariant: config.logoVariant || 'mark',
    permissionPolicy: normalizePermissionPolicy(config.permissionPolicy),
  });
  if (isInitialConfigStatus) {
    store.markInitialConfigStatusSeen();
  }
};

function handleServerEvent(event: ServerEvent, batchers: StreamBatchers): void {
  const store = useAppStore.getState();
  debugIpc('[useIPC] Received event:', event.type);

  switch (event.type) {
    case 'session.list':
      store.setSessions(event.payload.sessions);
      if (event.payload.projects) {
        store.setProjects(event.payload.projects);
      }
      break;

    case 'project.list':
      store.setProjects(event.payload.projects);
      break;

    case 'project.update':
      store.upsertProject(event.payload.project);
      break;

    case 'project.delete':
      store.removeProject(event.payload.projectId);
      break;

    case 'session.status':
      store.updateSession(event.payload.sessionId, {
        status: event.payload.status,
      });
      if (event.payload.status !== 'running') {
        store.finishExecutionClock(event.payload.sessionId);
        store.clearLiveToolOutput(event.payload.sessionId);
        store.setLoading(false);
        store.clearActiveTurn(event.payload.sessionId);
        store.clearPendingTurns(event.payload.sessionId);
        store.clearQueuedMessages(event.payload.sessionId);
      }
      break;

    case 'session.update':
      store.updateSession(event.payload.sessionId, event.payload.updates);
      break;

    case 'stream.message':
      debugIpc(
        '[useIPC] stream.message received:',
        event.payload.message.role,
        'content:',
        JSON.stringify(event.payload.message.content)
      );
      batchers.clearSessionBuffers(event.payload.sessionId);
      store.addMessage(event.payload.sessionId, event.payload.message);
      break;

    case 'stream.partial':
      batchers.bufferPartial(event.payload.sessionId, event.payload.delta);
      break;

    case 'stream.reset':
      batchers.clearSessionBuffers(event.payload.sessionId);
      store.clearPartialMessage(event.payload.sessionId);
      store.clearPartialThinking(event.payload.sessionId);
      break;

    case 'stream.thinking':
      batchers.bufferThinking(event.payload.sessionId, event.payload.delta);
      break;

    case 'stream.toolOutput':
      store.setLiveToolOutput(event.payload.sessionId, event.payload.toolCallId, {
        text: event.payload.text,
        truncated: event.payload.truncated,
        updatedAt: event.payload.timestamp,
      });
      break;

    case 'trace.step': {
      if (event.payload.step.type === 'thinking' && event.payload.step.status === 'running') {
        const currentState = useAppStore.getState();
        const ss = currentState.sessionStates[event.payload.sessionId];
        const pending = ss?.pendingTurns || [];
        const activeTurn = ss?.activeTurn;
        if (pending.length > 0) {
          store.activateNextTurn(event.payload.sessionId, event.payload.step.id);
        } else if (activeTurn) {
          // 绑定真实 stepId，避免 mock stepId 导致无法清理
          store.updateActiveTurnStep(event.payload.sessionId, event.payload.step.id);
        }
      }
      batchers.bufferTrace({
        kind: 'add',
        sessionId: event.payload.sessionId,
        step: event.payload.step,
      });
      break;
    }

    case 'trace.update':
      if (
        event.payload.updates.status &&
        (event.payload.updates.status === 'completed' || event.payload.updates.status === 'error')
      ) {
        store.clearLiveToolOutput(event.payload.sessionId, event.payload.stepId);
        store.clearActiveTurn(event.payload.sessionId, event.payload.stepId);
      }
      batchers.bufferTrace({
        kind: 'update',
        sessionId: event.payload.sessionId,
        stepId: event.payload.stepId,
        updates: event.payload.updates,
      });
      break;

    case 'permission.request':
      store.setPendingPermission(event.payload);
      break;

    case 'permission.dismiss':
      store.dismissPermission(event.payload.toolUseId);
      break;

    case 'stream.executionTime':
      store.updateMessage(event.payload.sessionId, event.payload.messageId, {
        executionTimeMs: event.payload.executionTimeMs,
      });
      break;

    case 'sudo.password.request':
      store.setPendingSudoPassword(event.payload);
      break;

    case 'sudo.password.dismiss': {
      const currentSudo = useAppStore.getState().pendingSudoPassword;
      if (currentSudo?.toolUseId === event.payload.toolUseId) {
        store.setPendingSudoPassword(null);
      }
      break;
    }

    case 'config.status':
      debugIpc('[useIPC] config.status received:', event.payload.isConfigured);
      applyConfigSnapshot(event.payload.config, event.payload.isConfigured);
      break;

    case 'sandbox.progress':
      debugIpc('[useIPC] sandbox.progress received:', event.payload.phase, event.payload.message);
      store.setSandboxSetupProgress(event.payload);
      break;

    case 'sandbox.sync':
      debugIpc('[useIPC] sandbox.sync received:', event.payload.phase, event.payload.message);
      store.setSandboxSyncStatus(event.payload);
      break;

    case 'skills.storageChanged':
      debugIpc(
        '[useIPC] skills.storageChanged received:',
        event.payload.path,
        event.payload.reason
      );
      store.setSkillsStorageChangeEvent(event.payload);
      store.setSkillsStorageChangedAt(Date.now());
      break;

    case 'workdir.changed':
      debugIpc('[useIPC] workdir.changed received:', event.payload.path);
      store.setWorkingDir(event.payload.path || null);
      break;

    case 'session.contextInfo':
      store.setSessionContextWindow(event.payload.sessionId, event.payload.contextWindow);
      break;

    case 'error':
      console.error('[useIPC] Server error:', event.payload.message);
      store.setLoading(false);
      if (event.payload.code === 'CONFIG_REQUIRED_ACTIVE_SET') {
        store.setGlobalNotice({
          id: `notice-config-required-${Date.now()}`,
          type: 'warning',
          message: i18n.t('api.configRequiredActiveSet'),
          messageKey: 'api.configRequiredActiveSet',
          action: event.payload.action === 'open_api_settings' ? 'open_api_settings' : undefined,
        });
      } else {
        store.setGlobalNotice({
          id: `notice-error-${Date.now()}`,
          type: 'error',
          message: event.payload.message,
        });
      }
      break;

    case 'native-theme.changed':
      store.setSystemDarkMode(event.payload.shouldUseDarkColors);
      break;

    case 'new-session':
      // Tray / dock 新建任务: same path as the sidebar button (leave guard, chat view).
      window.dispatchEvent(new Event(NEW_TASK_EVENT));
      break;

    case 'navigate':
      if (event.payload === 'settings') {
        store.setShowSettings(true);
      }
      break;

    default:
      debugIpc('[useIPC] Unknown server event:', event);
  }
}

// Module-level singleton guard because preload's `on()` is a single-slot bridge.
let ipcListenerInstalled = false;

/**
 * Install the singleton IPC event listener and bootstrap initial config/theme.
 * Returns a cleanup callback only when this call actually installed the listener.
 */
export function installIPCBridge(): (() => void) | undefined {
  if (!isElectron) {
    debugIpc('[useIPC] Not in Electron, skipping IPC setup');
    return undefined;
  }

  if (ipcListenerInstalled) {
    return undefined;
  }
  ipcListenerInstalled = true;
  debugIpc('[useIPC] Setting up IPC listener (once)');

  const batchers = createStreamBatchers();
  const cleanup = window.electronAPI.on((event: ServerEvent) => {
    try {
      handleServerEvent(event, batchers);
    } catch (err) {
      console.error('[useIPC] Error handling server event:', event.type, err);
    }
  });

  let disposed = false;
  void (async () => {
    try {
      const [config, isConfigured, systemTheme] = await Promise.all([
        window.electronAPI.config.get(),
        window.electronAPI.config.isConfigured(),
        window.electronAPI.getSystemTheme(),
      ]);
      if (disposed) return;
      const store = useAppStore.getState();
      store.setSystemDarkMode(Boolean(systemTheme?.shouldUseDarkColors));
      applyConfigSnapshot(config, Boolean(isConfigured));
    } catch (error) {
      console.error('[useIPC] Failed to bootstrap config/theme state:', error);
    }
  })();

  return () => {
    disposed = true;
    debugIpc('[useIPC] Cleaning up IPC listener');
    batchers.flushAndCancelAll();
    cleanup?.();
    ipcListenerInstalled = false;
  };
}
