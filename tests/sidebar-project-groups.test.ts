import { describe, expect, it } from 'vitest';
import type { Session } from '../src/renderer/types';
import {
  buildProjectNameLookup,
  buildSessionProjectGroups,
  getProjectKeyForWorkspace,
  getProjectNameFromWorkspace,
  NO_WORKSPACE_PROJECT_KEY,
} from '../src/renderer/utils/sidebar-project-groups';

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? 'session',
    title: overrides.title ?? 'Untitled',
    status: overrides.status ?? 'idle',
    projectId: overrides.projectId,
    projectName: overrides.projectName,
    cwd: overrides.cwd,
    mountedPaths: overrides.mountedPaths ?? [],
    allowedTools: overrides.allowedTools ?? [],
    memoryEnabled: overrides.memoryEnabled ?? false,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? 1,
  };
}

describe('sidebar project grouping', () => {
  it('groups sessions by normalized working directory and names projects from the folder', () => {
    const groups = buildSessionProjectGroups(
      [
        makeSession({ id: 'older', title: 'Older task', cwd: '/work/sophron', updatedAt: 10 }),
        makeSession({ id: 'newer', title: 'Newer task', cwd: '/work/sophron/', updatedAt: 20 }),
        makeSession({ id: 'other', title: 'Other task', cwd: '/work/other', updatedAt: 30 }),
      ],
      { noWorkspaceLabel: 'No workspace' }
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('other');
    expect(groups[1].label).toBe('sophron');
    expect(groups[1].sessions.map((session) => session.id)).toEqual(['newer', 'older']);
  });

  it('keeps Windows paths case-insensitive when running on Windows', () => {
    const groups = buildSessionProjectGroups(
      [
        makeSession({ id: 'lower', cwd: 'C:\\Repo\\App', updatedAt: 10 }),
        makeSession({ id: 'upper', cwd: 'c:/repo/app/', updatedAt: 20 }),
      ],
      { noWorkspaceLabel: 'No workspace', platform: 'win32' }
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(getProjectKeyForWorkspace('C:\\Repo\\App', 'win32'));
    expect(groups[0].sessions.map((session) => session.id)).toEqual(['upper', 'lower']);
  });

  it('uses custom project names without changing the workspace key', () => {
    const key = getProjectKeyForWorkspace('/work/sophron');
    const groups = buildSessionProjectGroups(
      [makeSession({ id: 'task', cwd: '/work/sophron', updatedAt: 10 })],
      {
        noWorkspaceLabel: 'No workspace',
        projectNames: { [key]: 'Customer Ops' },
      }
    );

    expect(groups[0].key).toBe(key);
    expect(groups[0].defaultLabel).toBe('sophron');
    expect(groups[0].label).toBe('Customer Ops');
  });

  it('uses persisted project names for cwd groups after reload', () => {
    const projectNames = buildProjectNameLookup([
      {
        id: 'project-1',
        name: 'Customer Ops',
        cwd: '/Users/demo/Library/Application Support/sophron/DefaultWorkingDir',
      },
    ]);
    const groups = buildSessionProjectGroups(
      [
        makeSession({
          id: 'task',
          cwd: '/Users/demo/Library/Application Support/sophron/DefaultWorkingDir',
          updatedAt: 10,
        }),
      ],
      {
        noWorkspaceLabel: 'No workspace',
        projectNames,
      }
    );

    expect(groups[0].key).toBe(
      getProjectKeyForWorkspace('/Users/demo/Library/Application Support/sophron/DefaultWorkingDir')
    );
    expect(groups[0].label).toBe('Customer Ops');
  });

  it('groups sessions by persisted project id before falling back to cwd', () => {
    const groups = buildSessionProjectGroups(
      [
        makeSession({
          id: 'first',
          projectId: 'project-1',
          projectName: 'Customer Ops',
          cwd: '/old/workspace',
          updatedAt: 10,
        }),
        makeSession({
          id: 'second',
          projectId: 'project-1',
          projectName: 'Customer Ops',
          cwd: '/new/workspace',
          updatedAt: 20,
        }),
      ],
      { noWorkspaceLabel: 'No workspace' }
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('project:project-1');
    expect(groups[0].label).toBe('Customer Ops');
    expect(groups[0].sessions.map((session) => session.id)).toEqual(['second', 'first']);
  });

  it('lets project name or path search show all tasks in the matching project', () => {
    const groups = buildSessionProjectGroups(
      [
        makeSession({ id: 'plan', title: 'Planning', cwd: '/work/sophron', updatedAt: 20 }),
        makeSession({ id: 'build', title: 'Build UI', cwd: '/work/sophron', updatedAt: 10 }),
      ],
      { noWorkspaceLabel: 'No workspace', query: 'sophron' }
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((session) => session.id)).toEqual(['plan', 'build']);
  });

  it('falls back to task-title filtering when the project does not match', () => {
    const groups = buildSessionProjectGroups(
      [
        makeSession({ id: 'plan', title: 'Planning', cwd: '/work/sophron', updatedAt: 20 }),
        makeSession({ id: 'build', title: 'Build UI', cwd: '/work/sophron', updatedAt: 10 }),
      ],
      { noWorkspaceLabel: 'No workspace', query: 'build' }
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((session) => session.id)).toEqual(['build']);
  });

  it('groups sessions without cwd under a stable no-workspace project', () => {
    const groups = buildSessionProjectGroups([makeSession({ id: 'missing', cwd: undefined })], {
      noWorkspaceLabel: 'No workspace',
    });

    expect(groups[0].key).toBe(NO_WORKSPACE_PROJECT_KEY);
    expect(groups[0].label).toBe('No workspace');
    expect(getProjectNameFromWorkspace(undefined, 'No workspace')).toBe('No workspace');
  });

  it('uses the root path itself as the project name', () => {
    expect(getProjectNameFromWorkspace('/', 'No workspace')).toBe('/');
  });
});
