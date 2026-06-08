import type { Session } from '../types';

export const NO_WORKSPACE_PROJECT_KEY = 'project:no-workspace';

export interface SessionProjectGroup {
  key: string;
  projectId?: string;
  label: string;
  defaultLabel: string;
  path: string | null;
  sessions: Session[];
  latestActivity: number;
}

interface BuildSessionProjectGroupsOptions {
  noWorkspaceLabel: string;
  platform?: string;
  projectNames?: Record<string, string | undefined>;
  query?: string;
}

interface ProjectNameSource {
  id: string;
  name: string | null;
  cwd: string;
}

export function normalizeWorkspacePath(
  cwd: string | null | undefined,
  platform?: string
): string | null {
  const trimmed = cwd?.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/\\/g, '/');
  if (/^\/+$/.test(normalized)) {
    return '/';
  }

  normalized = normalized.replace(/\/+$/g, '');
  if (!normalized) return null;

  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function getProjectKeyForWorkspace(
  cwd: string | null | undefined,
  platform?: string
): string {
  const normalized = normalizeWorkspacePath(cwd, platform);
  return normalized ? `cwd:${normalized}` : NO_WORKSPACE_PROJECT_KEY;
}

export function buildProjectNameLookup(
  projects: ProjectNameSource[],
  platform?: string
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const project of projects) {
    const name = project.name?.trim();
    if (!name) continue;
    names[`project:${project.id}`] = name;
    names[getProjectKeyForWorkspace(project.cwd, platform)] = name;
  }
  return names;
}

export function getProjectNameFromWorkspace(
  cwd: string | null | undefined,
  noWorkspaceLabel: string
): string {
  const trimmed = cwd?.trim();
  if (!trimmed) return noWorkspaceLabel;
  if (/^[\\/]+$/.test(trimmed)) return trimmed.replace(/\\/g, '/');

  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/g, '');
  const folderName = normalized.split('/').filter(Boolean).pop();
  return folderName || normalized || noWorkspaceLabel;
}

export function buildSessionProjectGroups(
  sessions: Session[],
  options: BuildSessionProjectGroupsOptions
): SessionProjectGroup[] {
  const groups = new Map<string, SessionProjectGroup>();
  const sortedSessions = [...sessions].sort(
    (a, b) => getSessionActivity(b) - getSessionActivity(a)
  );

  for (const session of sortedSessions) {
    const key = session.projectId
      ? `project:${session.projectId}`
      : getProjectKeyForWorkspace(session.cwd, options.platform);
    const path = session.cwd?.trim() || null;
    const defaultLabel = getProjectNameFromWorkspace(path, options.noWorkspaceLabel);
    const label = options.projectNames?.[key]?.trim() || session.projectName?.trim() || defaultLabel;
    const latestActivity = getSessionActivity(session);
    const existing = groups.get(key);

    if (existing) {
      existing.sessions.push(session);
      existing.latestActivity = Math.max(existing.latestActivity, latestActivity);
      if (!existing.path && path) {
        existing.path = path;
      }
    } else {
      groups.set(key, {
        key,
        projectId: session.projectId,
        label,
        defaultLabel,
        path,
        sessions: [session],
        latestActivity,
      });
    }
  }

  const query = options.query?.trim().toLowerCase() || '';
  const visibleGroups = Array.from(groups.values())
    .map((group) => {
      if (!query) return group;

      const projectMatches =
        group.label.toLowerCase().includes(query) ||
        group.defaultLabel.toLowerCase().includes(query) ||
        Boolean(group.path?.toLowerCase().includes(query));

      if (projectMatches) return group;

      return {
        ...group,
        sessions: group.sessions.filter((session) => session.title.toLowerCase().includes(query)),
      };
    })
    .filter((group) => group.sessions.length > 0);

  return visibleGroups.sort((a, b) => b.latestActivity - a.latestActivity);
}

function getSessionActivity(session: Session): number {
  return session.updatedAt || session.createdAt || 0;
}
