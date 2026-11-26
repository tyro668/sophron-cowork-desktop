import * as fs from 'fs';
import type { Project } from '../../shared/contracts';
import type { DatabaseInstance } from '../db/database';
import { configStore } from '../config/config-store';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { log } from '../utils/logger';
import { getUnsupportedWorkspacePathReason } from '../workspace-path-constraints';
import { appContext } from './context';
import { sendToRenderer } from './events';
import { mapProjectRow } from './projects';

export const DEFAULT_WORKING_DIR_NAME = 'DefaultWorkingDir';
export const LEGACY_DEFAULT_WORKING_DIR_NAME = 'default_working_dir';

export function isInternalDefaultWorkingDir(workspacePath?: string | null): boolean {
  const trimmed = workspacePath?.trim();
  if (!trimmed) return false;
  const folderName = trimmed.split(/[/\\]/).filter(Boolean).pop();
  return Boolean(
    folderName &&
    (folderName === DEFAULT_WORKING_DIR_NAME || folderName === LEGACY_DEFAULT_WORKING_DIR_NAME)
  );
}

/**
 * Pick the most recently updated existing user project directory, or null when
 * no user project has been added yet.
 */
export function resolveMostRecentProjectCwd(db?: DatabaseInstance | null): string | null {
  const projects = db?.projects?.getAll() ?? [];
  const sorted = [...projects].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  for (const project of sorted) {
    const cwd = project.cwd?.trim();
    if (!cwd || isInternalDefaultWorkingDir(cwd)) continue;
    if (fs.existsSync(cwd)) {
      return cwd;
    }
  }
  return null;
}

/**
 * Initialize the active working directory from the most recent user project.
 * Leaves it null when no project exists yet so the user is prompted to add one.
 */
export function initializeWorkingDir(db?: DatabaseInstance | null): string | null {
  appContext.currentWorkingDir = resolveMostRecentProjectCwd(db);
  log('[App] Initial working directory:', appContext.currentWorkingDir || '(none)');
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
 * Create (or update) a named project for one or more local folders and activate
 * its primary folder as the current working directory.
 */
export async function createProjectWorkspace(
  folders: string[],
  name?: string | null
): Promise<{ success: boolean; project?: Project; error?: string }> {
  const normalizedFolders: string[] = [];
  const seen = new Set<string>();
  for (const candidate of folders) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const key =
      process.platform === 'win32'
        ? trimmed.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        : trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedFolders.push(trimmed);
  }

  if (normalizedFolders.length === 0) {
    return { success: false, error: 'Project directory cannot be empty' };
  }

  for (const folder of normalizedFolders) {
    const unsupportedReason = getWorkspacePathUnsupportedReason(folder);
    if (unsupportedReason) {
      return { success: false, error: unsupportedReason };
    }

    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      return { success: false, error: `Directory does not exist: ${folder}` };
    }
  }

  const db = appContext.appDatabase;
  if (!db?.projects) {
    return { success: false, error: 'Project store not initialized' };
  }

  const primaryCwd = normalizedFolders[0];
  const normalizedName = name?.trim() || null;
  const ensured = db.projects.ensureForCwd(primaryCwd, normalizedName, normalizedFolders);
  const updated =
    db.projects.update(ensured.id, {
      cwd: primaryCwd,
      folders_json: JSON.stringify(normalizedFolders),
      ...(normalizedName !== null ? { name: normalizedName } : {}),
    }) ?? ensured;
  const project = mapProjectRow(updated);

  appContext.currentWorkingDir = project.cwd;
  sendToRenderer({ type: 'project.update', payload: { project } });
  sendToRenderer({ type: 'workdir.changed', payload: { path: project.cwd } });

  log('[App] Created/activated project workspace:', project.id, normalizedFolders);
  return { success: true, project };
}

/**
 * Set working directory
 * - If sessionId is provided: move that session to the project for the selected directory
 * - If no sessionId: persist/activate a project for the WelcomeView's next session
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
    // Update only this session's cwd
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    appContext.sessionManager.updateSessionCwd(sessionId, newDir);

    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('../sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  } else {
    appContext.currentWorkingDir = newDir;
    if (appContext.appDatabase?.projects) {
      const project = appContext.appDatabase.projects.ensureForCwd(newDir);
      sendToRenderer({
        type: 'project.update',
        payload: { project: mapProjectRow(project) },
      });
    }
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
