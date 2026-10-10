import { registerCloudAnalysisIpc } from './cloud-analysis-ipc';
import { registerDataGroupsIpc } from './data-groups-ipc';
import { registerDataPipelinesIpc } from './data-pipelines-ipc';
import { registerRawTablesIpc } from './raw-tables-ipc';
import { registerResultTablesIpc } from './result-tables-ipc';
import type { DataIpcContext } from './types';

export function registerDataIpcHandlers(context: DataIpcContext): void {
  registerDataPipelinesIpc(context);
  registerDataGroupsIpc(context);
  registerRawTablesIpc(context);
  registerResultTablesIpc(context);
  registerCloudAnalysisIpc(context);
}
