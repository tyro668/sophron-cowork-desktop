import type { ClientEvent } from '../shared/contracts';

export const ALLOWED_CLIENT_EVENT_TYPES = [
  'session.start',
  'session.continue',
  'session.stop',
  'session.delete',
  'session.rename',
  'session.batchDelete',
  'session.list',
  'session.getMessages',
  'session.getTraceSteps',
  'project.rename',
  'project.renameByCwd',
  'project.delete',
  'permission.response',
  'sudo.password.response',
  'settings.update',
  'folder.select',
  'workdir.get',
  'workdir.set',
  'workdir.select',
] as const satisfies readonly ClientEvent['type'][];

const ALLOWED_CLIENT_EVENT_SET: ReadonlySet<string> = new Set(ALLOWED_CLIENT_EVENT_TYPES);

export function isAllowedClientEventType(type: string): type is ClientEvent['type'] {
  return ALLOWED_CLIENT_EVENT_SET.has(type);
}
