import { notifyDataPipelineCompleted } from '../../app/notifications';
import { resolveModelRuntimeConfigForAutomation } from '../../app/runtime-config';
import { registerDataIpcHandlers } from '../../data/ipc/register-data-ipc';
import { logError } from '../../utils/logger';
import { requireDataPipelineStore, requireDataCommandService } from './service';

export function registerDataIpc(): void {
  registerDataIpcHandlers({
    requireDataPipelineStore,
    requireDataCommandService,
    resolveModelRuntimeConfig: resolveModelRuntimeConfigForAutomation,
    notifyDataPipelineCompleted,
    logError,
  });
}
