import { registerCloudAnalysisIpc } from './cloud-analysis-ipc';
import { registerDataTasksIpc } from './data-tasks-ipc';
import { registerInputTablesIpc } from './input-tables-ipc';
import { registerOutputTablesIpc } from './output-tables-ipc';
import type { DataIpcContext } from './types';

export function registerDataIpcHandlers(context: DataIpcContext): void {
  registerDataTasksIpc(context);
  registerInputTablesIpc(context);
  registerOutputTablesIpc(context);
  registerCloudAnalysisIpc(context);
}
