import { ipcMain, dialog } from 'electron';
import { isAbsolute } from 'path';
import type { ClientEvent } from '../../../shared/contracts';
import { parseClientEvent } from '../../../shared/contracts/ipc/validate';
import {
  getPermissionRulesForPolicy,
  isPermissionPolicy,
} from '../../../shared/permission-policies';
import { appContext } from '../../app/context';
import { sendToRenderer } from '../../app/events';
import { mapProjectRow, listProjectsForRenderer } from '../../app/projects';
import {
  DARK_BG,
  LIGHT_BG,
  resolveEffectiveTheme,
  applyNativeThemePreference,
} from '../../app/theme';
import { getWorkingDir, getWorkspacePathUnsupportedReason, setWorkingDir } from '../../app/workdir';
import { eventRequiresSessionManager } from '../../client-event-utils';
import { configStore, type AppTheme } from '../../config/config-store';
import { setPermissionRules } from '../../config/permission-rules-store';
import { handleIpc } from '../../ipc-handle';
import { logWarn, logError } from '../../utils/logger';

export function registerSessionIpc(): void {
  // IPC Handlers
  ipcMain.on('client-event', async (_event, raw: unknown) => {
    let data: ClientEvent;
    try {
      data = parseClientEvent('client-event', raw);
    } catch (error) {
      logError('[IPC] Rejected malformed client-event:', error);
      sendToRenderer({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : 'Invalid client event' },
      });
      return;
    }
    try {
      await handleClientEvent(data);
    } catch (error) {
      logError('Error handling client event:', error);
      sendToRenderer({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  });

  handleIpc('client-invoke', async (_event, data: ClientEvent) => {
    return handleClientEvent(data);
  });

  async function handleClientEvent(event: ClientEvent): Promise<unknown> {
    // Check if configured before starting sessions
    if (event.type === 'session.start' && !configStore.hasUsableCredentialsForActiveSet()) {
      sendToRenderer({
        type: 'error',
        payload: {
          message: '当前方案未配置可用凭证，请先在 API 设置中完成配置',
          code: 'CONFIG_REQUIRED_ACTIVE_SET',
          action: 'open_api_settings',
        },
      });
      return null;
    }

    if (eventRequiresSessionManager(event) && !appContext.sessionManager) {
      throw new Error('Session manager not initialized');
    }
    // After the guard above, appContext.sessionManager is guaranteed non-null for session.* events.
    // Use a local alias to satisfy TypeScript's control-flow narrowing.
    const sm = appContext.sessionManager!;

    switch (event.type) {
      case 'session.start':
        if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
          sendToRenderer({
            type: 'error',
            payload: {
              message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
            },
          });
          return null;
        }
        return sm.startSession(
          event.payload.title,
          event.payload.prompt,
          event.payload.cwd,
          event.payload.allowedTools,
          event.payload.content,
          event.payload.memoryEnabled,
          undefined,
          {
            selectedSkillNames: event.payload.selectedSkillNames,
            permissionPolicy: event.payload.permissionPolicy ?? configStore.get('permissionPolicy'),
            permissionRules: getPermissionRulesForPolicy(
              event.payload.permissionPolicy ?? configStore.get('permissionPolicy')
            ),
          }
        );

      case 'session.continue':
        return sm.continueSession(
          event.payload.sessionId,
          event.payload.prompt,
          event.payload.content,
          {
            selectedSkillNames: event.payload.selectedSkillNames,
            permissionPolicy: event.payload.permissionPolicy ?? configStore.get('permissionPolicy'),
            permissionRules: getPermissionRulesForPolicy(
              event.payload.permissionPolicy ?? configStore.get('permissionPolicy')
            ),
          }
        );

      case 'session.stop':
        return sm.stopSession(event.payload.sessionId);

      case 'session.delete':
        return sm.deleteSession(event.payload.sessionId);

      case 'session.batchDelete':
        return sm.batchDeleteSessions(event.payload.sessionIds);

      case 'session.list': {
        const sessions = sm.listSessions();
        sendToRenderer({
          type: 'session.list',
          payload: { sessions, projects: listProjectsForRenderer() },
        });
        return sessions;
      }

      case 'project.rename': {
        const db = appContext.appDatabase;
        if (!db?.projects) {
          throw new Error('Project store not initialized');
        }
        const updated = db.projects.update(event.payload.projectId, {
          name: event.payload.name?.trim() || null,
        });
        if (!updated) {
          return null;
        }
        const project = mapProjectRow(updated);
        sendToRenderer({ type: 'project.update', payload: { project } });
        return project;
      }

      case 'project.renameByCwd': {
        const db = appContext.appDatabase;
        if (!db?.projects) {
          throw new Error('Project store not initialized');
        }
        const cwd = event.payload.cwd?.trim();
        if (!cwd) {
          throw new Error('Project cwd cannot be empty');
        }
        const normalizedName = event.payload.name?.trim() || null;
        const ensured = db.projects.ensureForCwd(cwd);
        const updated = db.projects.update(ensured.id, { name: normalizedName }) ?? ensured;
        const project = mapProjectRow(updated);
        sendToRenderer({ type: 'project.update', payload: { project } });
        return project;
      }

      case 'project.delete': {
        const db = appContext.appDatabase;
        if (!db?.projects) {
          throw new Error('Project store not initialized');
        }
        db.projects.delete(event.payload.projectId);
        sendToRenderer({ type: 'project.delete', payload: { projectId: event.payload.projectId } });
        return { success: true };
      }

      case 'session.getMessages':
        return sm.getMessages(event.payload.sessionId);

      case 'session.getTraceSteps':
        return sm.getTraceSteps(event.payload.sessionId);

      case 'permission.response':
        return sm.handlePermissionResponse(event.payload.toolUseId, event.payload.result);

      case 'sudo.password.response':
        return sm.handleSudoPasswordResponse(event.payload.toolUseId, event.payload.password);

      case 'folder.select': {
        const folderResult = await dialog.showOpenDialog(appContext.mainWindow!, {
          properties: ['openDirectory'],
        });
        if (!folderResult.canceled && folderResult.filePaths.length > 0) {
          sendToRenderer({
            type: 'folder.selected',
            payload: { path: folderResult.filePaths[0] },
          });
          return folderResult.filePaths[0];
        }
        return null;
      }

      case 'workdir.get':
        return getWorkingDir();

      case 'workdir.set':
        return setWorkingDir(event.payload.path, event.payload.sessionId);

      case 'workdir.select': {
        const dialogDefaultPath =
          event.payload.currentPath && isAbsolute(event.payload.currentPath)
            ? event.payload.currentPath
            : appContext.currentWorkingDir || undefined;
        const workdirResult = await dialog.showOpenDialog(appContext.mainWindow!, {
          properties: ['openDirectory'],
          title: 'Select Working Directory',
          defaultPath: dialogDefaultPath,
        });
        if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
          const selectedPath = workdirResult.filePaths[0];
          return setWorkingDir(selectedPath, event.payload.sessionId);
        }
        return { success: false, path: '', error: 'User cancelled' };
      }

      case 'settings.update': {
        const nextTheme =
          event.payload.theme === 'dark' ||
          event.payload.theme === 'light' ||
          event.payload.theme === 'system'
            ? (event.payload.theme as AppTheme)
            : undefined;
        const nextPolicy = isPermissionPolicy(event.payload.permissionPolicy)
          ? event.payload.permissionPolicy
          : undefined;

        if (nextTheme || nextPolicy) {
          configStore.update({ theme: nextTheme, permissionPolicy: nextPolicy });
          if (nextTheme) {
            applyNativeThemePreference(nextTheme);
            if (appContext.mainWindow && !appContext.mainWindow.isDestroyed()) {
              const effectiveTheme = resolveEffectiveTheme(nextTheme);
              appContext.mainWindow.setBackgroundColor(
                effectiveTheme === 'dark' ? DARK_BG : LIGHT_BG
              );
            }
          }
          if (nextPolicy) {
            setPermissionRules(getPermissionRulesForPolicy(nextPolicy), nextPolicy);
          }
          sendToRenderer({
            type: 'config.status',
            payload: {
              isConfigured: configStore.isConfigured(),
              config: configStore.getAll(),
            },
          });
        }
        return null;
      }

      default:
        logWarn('Unknown event type:', event);
        return null;
    }
  }
}
