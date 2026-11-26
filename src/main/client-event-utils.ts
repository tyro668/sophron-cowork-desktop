import type { ClientEvent } from '../shared/contracts';

type SessionEvent = Extract<
  ClientEvent,
  { type: `session.${string}` | 'permission.response' | 'sudo.password.response' }
>;

export function eventRequiresSessionManager(event: ClientEvent): event is SessionEvent {
  switch (event.type) {
    case 'session.start':
    case 'session.continue':
    case 'session.stop':
    case 'session.delete':
    case 'session.rename':
    case 'session.duplicate':
    case 'session.batchDelete':
    case 'session.list':
    case 'session.getMessages':
    case 'session.getTraceSteps':
    case 'sudo.password.response':
    case 'permission.response':
      return true;
    default:
      return false;
  }
}
