import enTranslations from '../../../shared/i18n/locales/en.json';
import { ipcMain, dialog } from 'electron';
import { isAbsolute } from 'path';
import type { ClientEvent } from '../../../shared/contracts';
import { parseClientEvent } from '../../../shared/contracts/ipc/validate';
import {
  getPermissionRulesForPolicy,
  isPermissionPolicy,
} from '../../../shared/permission-policies';
import type { AppContext } from '../../app/context';
import { sendToRenderer } from '../../app/events';
import { mapProjectRow, listProjectsForRenderer } from '../../app/projects';
import {
  DARK_BG,
  LIGHT_BG,
  resolveEffectiveTheme,
  applyNativeThemePreference,
} from '../../app/theme';
import {
  createProjectWorkspace,
  getWorkingDir,
  getWorkspacePathUnsupportedReason,
  resolveMostRecentProjectCwd,
  setWorkingDir,
} from '../../app/workdir';
import { eventRequiresSessionManager } from '../../client-event-utils';
import {
  configStore,
  type AppTheme,
  type AppAccentTheme,
  type AppLogoVariant,
} from '../../config/config-store';
import { applyRuntimeLogo } from '../../app/brand-icons';
import { setPermissionRules } from '../../config/permission-rules-store';
import { handleIpc } from '../../ipc-handle';
import { logWarn, logError } from '../../utils/logger';

type SessionIpcContext = Pick<
  AppContext,
  'sessionManager' | 'mainWindow' | 'currentWorkingDir' | 'appDatabase'
>;

export function registerSessionIpc(context: SessionIpcContext): void {
  function openFolderDialog(options: Electron.OpenDialogOptions) {
    return context.mainWindow
      ? dialog.showOpenDialog(context.mainWindow, options)
      : dialog.showOpenDialog(options);
  }
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
    if (event.type === 'session.start') {
      const requestedModelConfigSetId = event.payload.modelConfigSetId?.trim();
      const hasUsableCredentials = requestedModelConfigSetId
        ? configStore.hasUsableCredentialsForConfigSetId(requestedModelConfigSetId)
        : configStore.hasUsableCredentialsForActiveSet();
      if (!hasUsableCredentials) {
        sendToRenderer({
          type: 'error',
          payload: {
            message: enTranslations.api.configRequiredActiveSet,
            code: 'CONFIG_REQUIRED_ACTIVE_SET',
            action: 'open_api_settings',
          },
        });
        return null;
      }
    }

    if (eventRequiresSessionManager(event)) {
      const sessionManager = context.sessionManager;
      if (!sessionManager) throw new Error('Session manager not initialized');
      switch (event.type) {
        case 'session.start': {
          if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
            sendToRenderer({
              type: 'error',
              payload: {
                message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
              },
            });
            return null;
          }
          const { session } = await sessionManager.startSession(
            event.payload.title,
            event.payload.prompt,
            event.payload.cwd,
            event.payload.allowedTools,
            event.payload.content,
            event.payload.memoryEnabled,
            undefined,
            {
              selectedSkillNames: event.payload.selectedSkillNames,
              modelConfigSetId: event.payload.modelConfigSetId?.trim() || undefined,
              permissionPolicy:
                event.payload.permissionPolicy ?? configStore.get('permissionPolicy'),
              permissionRules: getPermissionRulesForPolicy(
                event.payload.permissionPolicy ?? configStore.get('permissionPolicy')
              ),
            }
          );
          return session;
        }

        case 'session.continue':
          await sessionManager.continueSession(
            event.payload.sessionId,
            event.payload.prompt,
            event.payload.content,
            {
              selectedSkillNames: event.payload.selectedSkillNames,
              modelConfigSetId: event.payload.modelConfigSetId?.trim() || undefined,
              permissionPolicy:
                event.payload.permissionPolicy ?? configStore.get('permissionPolicy'),
              permissionRules: getPermissionRulesForPolicy(
                event.payload.permissionPolicy ?? configStore.get('permissionPolicy')
              ),
            }
          );
          return;

        case 'session.stop':
          return sessionManager.stopSession(event.payload.sessionId);

        case 'session.delete':
          return sessionManager.deleteSession(event.payload.sessionId);

        case 'session.rename':
          return sessionManager.renameSession(event.payload.sessionId, event.payload.title);

        case 'session.duplicate': {
          const newId = sessionManager.duplicateSession(
            event.payload.sessionId,
            event.payload.titleSuffix
          );
          sendToRenderer({
            type: 'session.list',
            payload: {
              sessions: sessionManager.listSessions(),
              projects: listProjectsForRenderer(),
            },
          });
          return newId;
        }

        case 'session.batchDelete':
          return sessionManager.batchDeleteSessions(event.payload.sessionIds);

        case 'session.list': {
          const sessions = sessionManager.listSessions();
          sendToRenderer({
            type: 'session.list',
            payload: { sessions, projects: listProjectsForRenderer() },
          });
          return sessions;
        }

        case 'session.getMessages':
          return sessionManager.getMessages(event.payload.sessionId);

        case 'session.getTraceSteps':
          return sessionManager.getTraceSteps(event.payload.sessionId);

        case 'permission.response':
          return sessionManager.handlePermissionResponse(
            event.payload.toolUseId,
            event.payload.result
          );

        case 'sudo.password.response':
          return sessionManager.handleSudoPasswordResponse(
            event.payload.toolUseId,
            event.payload.password
          );
      }
    }

    switch (event.type) {
      case 'project.create':
        return createProjectWorkspace(event.payload.folders, event.payload.name);

      case 'project.rename': {
        const db = context.appDatabase;
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
        const db = context.appDatabase;
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
        const db = context.appDatabase;
        if (!db?.projects) {
          throw new Error('Project store not initialized');
        }
        const existing = db.projects.get(event.payload.projectId);
        db.projects.delete(event.payload.projectId);
        sendToRenderer({ type: 'project.delete', payload: { projectId: event.payload.projectId } });
        if (existing && context.currentWorkingDir === existing.cwd) {
          const nextCwd = resolveMostRecentProjectCwd(db);
          context.currentWorkingDir = nextCwd;
          sendToRenderer({ type: 'workdir.changed', payload: { path: nextCwd || '' } });
        }
        return { success: true };
      }

      case 'folder.select': {
        const folderResult = await openFolderDialog({
          properties: ['openDirectory', 'createDirectory'],
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

      case 'folders.select': {
        const folderResult = await openFolderDialog({
          properties: ['openDirectory', 'multiSelections', 'createDirectory'],
        });
        if (!folderResult.canceled && folderResult.filePaths.length > 0) {
          return folderResult.filePaths;
        }
        return [];
      }

      case 'workdir.get':
        return getWorkingDir();

      case 'workdir.set':
        return setWorkingDir(event.payload.path, event.payload.sessionId);

      case 'workdir.select': {
        const dialogDefaultPath =
          event.payload.currentPath && isAbsolute(event.payload.currentPath)
            ? event.payload.currentPath
            : context.currentWorkingDir || undefined;
        const workdirResult = await openFolderDialog({
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
        const nextAccentTheme = (['mint', 'lake', 'lavender', 'orange', 'rose'] as const).includes(
          event.payload.accentTheme as AppAccentTheme
        )
          ? (event.payload.accentTheme as AppAccentTheme)
          : undefined;
        const nextPolicy = isPermissionPolicy(event.payload.permissionPolicy)
          ? event.payload.permissionPolicy
          : undefined;
        const nextLogoVariant =
          event.payload.logoVariant === 'mark' || event.payload.logoVariant === 'fold'
            ? (event.payload.logoVariant as AppLogoVariant)
            : undefined;

        if (nextTheme || nextAccentTheme || nextPolicy || nextLogoVariant) {
          const previousLogo = {
            logoVariant: configStore.get('logoVariant'),
            accentTheme: configStore.get('accentTheme'),
          };
          configStore.update({
            theme: nextTheme,
            accentTheme: nextAccentTheme,
            permissionPolicy: nextPolicy,
            logoVariant: nextLogoVariant,
          });
          const config = configStore.getAll();
          applyRuntimeLogo(config, previousLogo);
          if (nextTheme) {
            applyNativeThemePreference(nextTheme);
            if (context.mainWindow && !context.mainWindow.isDestroyed()) {
              const effectiveTheme = resolveEffectiveTheme(nextTheme);
              context.mainWindow.setBackgroundColor(effectiveTheme === 'dark' ? DARK_BG : LIGHT_BG);
            }
          }
          if (nextPolicy) {
            setPermissionRules(getPermissionRulesForPolicy(nextPolicy), nextPolicy);
          }
          sendToRenderer({
            type: 'config.status',
            payload: {
              isConfigured: configStore.isConfigured(),
              config,
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
