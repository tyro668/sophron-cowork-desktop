import type { Project } from '../../shared/contracts';
import type { ProjectRow } from '../db/database';
import { appContext } from './context';
import { sendToRenderer } from './events';

export function parseProjectFolders(
  foldersJson: string | null | undefined,
  primaryCwd: string
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (candidate?: string | null) => {
    const trimmed = candidate?.trim();
    if (!trimmed) return;
    const key =
      process.platform === 'win32'
        ? trimmed.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        : trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };
  add(primaryCwd);
  if (foldersJson) {
    try {
      const parsed = JSON.parse(foldersJson);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') add(item);
        }
      }
    } catch {
      // Ignore malformed legacy folders_json and fall back to primaryCwd.
    }
  }
  return result;
}

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name || null,
    cwd: row.cwd,
    folders: parseProjectFolders(row.folders_json, row.cwd),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjectsForRenderer(): Project[] {
  return appContext.appDatabase?.projects?.getAll().map(mapProjectRow) ?? [];
}

export function ensureProjectIdForLegacyCwd(cwd?: string | null): string | null {
  const trimmedCwd = cwd?.trim();
  if (!trimmedCwd || !appContext.appDatabase?.projects) return null;
  const project = appContext.appDatabase.projects.ensureForCwd(trimmedCwd);
  sendToRenderer({
    type: 'project.update',
    payload: { project: mapProjectRow(project) },
  });
  return project.id;
}

export function resolveAutomationProjectCwd(projectId?: string | null): string {
  if (!projectId) return '';
  return appContext.appDatabase?.projects?.get(projectId)?.cwd ?? '';
}
