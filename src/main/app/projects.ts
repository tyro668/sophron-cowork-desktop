import type { Project } from '../../shared/contracts';
import type { ProjectRow } from '../db/database';
import { appContext } from './context';
import { sendToRenderer } from './events';

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name || null,
    cwd: row.cwd,
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
