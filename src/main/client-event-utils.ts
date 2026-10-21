import type { ClientEvent } from '../shared/contracts';

export function eventRequiresSessionManager(event: ClientEvent): boolean {
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
    case 'permission.response':
      return true;
    default:
      return false;
  }
}
