import { notifyDataTaskCompleted } from '../../app/notifications';
import { resolveModelRuntimeConfigForAutomation } from '../../app/runtime-config';
import { registerDataIpcHandlers } from '../../data/ipc/register-data-ipc';
import { logError } from '../../utils/logger';
import { requireDataTaskStore, requireDataCommandService } from './service';

export function registerDataIpc(): void {
  registerDataIpcHandlers({
    requireDataTaskStore,
    requireDataCommandService,
    resolveModelRuntimeConfig: resolveModelRuntimeConfigForAutomation,
    notifyDataTaskCompleted,
    logError,
  });
}
