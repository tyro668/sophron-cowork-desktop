import { app } from 'electron';
import * as fs from 'fs';
import { join } from 'path';
import { configStore } from '../config/config-store';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { log } from '../utils/logger';
import { getUnsupportedWorkspacePathReason } from '../workspace-path-constraints';
import { appContext } from './context';
import { sendToRenderer } from './events';
import { mapProjectRow } from './projects';

export const DEFAULT_WORKING_DIR_NAME = 'DefaultWorkingDir';
export const LEGACY_DEFAULT_WORKING_DIR_NAME = 'default_working_dir';

/**
 * Initialize default working directory
 * This is always the app's DefaultWorkingDir in userData - it never changes
 * User-selected workspace directories are persisted as projects and sessions
 * reference those projects.
 */
export function initializeDefaultWorkingDir(): string {
  // Create default working directory in user data path (this is the permanent global default)
  const userDataPath = app.getPath('userData');
  const defaultDir = join(userDataPath, DEFAULT_WORKING_DIR_NAME);

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log('[App] Created default working directory:', defaultDir);
  }

  appContext.currentWorkingDir = defaultDir;

  log('[App] Global default working directory:', appContext.currentWorkingDir);
  return appContext.currentWorkingDir;
}

/**
 * Get current working directory
 */
export function getWorkingDir(): string | null {
  return appContext.currentWorkingDir;
}

export function getWorkspacePathUnsupportedReason(workspacePath?: string): string | null {
  return getUnsupportedWorkspacePathReason({
    platform: process.platform,
    sandboxEnabled: configStore.get('sandboxEnabled') !== false,
    workspacePath,
  });
}

/**
 * Set working directory
 * - If sessionId is provided: move that session to the project for the selected directory
 * - If no sessionId: persist/activate a project for the WelcomeView's next session
 *
 * Note: The global default (appContext.currentWorkingDir) is NEVER changed after initialization.
 * It is always app.getPath('userData')/DefaultWorkingDir
 */
export async function setWorkingDir(
  newDir: string,
  sessionId?: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const unsupportedReason = getWorkspacePathUnsupportedReason(newDir);
  if (unsupportedReason) {
    return { success: false, path: newDir, error: unsupportedReason };
  }

  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }

  if (sessionId && appContext.sessionManager) {
    // Update only this session's cwd - don't change the global default
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    appContext.sessionManager.updateSessionCwd(sessionId, newDir);

    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('../sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  } else if (appContext.appDatabase?.projects) {
    const project = appContext.appDatabase.projects.ensureForCwd(newDir);
    sendToRenderer({
      type: 'project.update',
      payload: { project: mapProjectRow(project) },
    });
  }

  // Notify renderer of workdir change (for UI display)
  // This updates what the user sees, and will be passed to startSession for new sessions
  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });

  log(
    '[App] Working directory for UI updated:',
    newDir,
    sessionId ? `(session: ${sessionId})` : '(pending new session)'
  );

  return { success: true, path: newDir };
}
