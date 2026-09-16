import type { IpcMain } from 'electron';
import type { AgentRuntimeConfig } from '../../../shared/contracts';
import type { DataCommandService } from '../data-command-service';
import type { DataTaskStore } from '../data-task-store';

export interface DataIpcContext {
  ipcMain: IpcMain;
  requireDataTaskStore: () => DataTaskStore;
  requireDataCommandService: () => DataCommandService;
  resolveModelRuntimeConfig: (configSetId: string) => AgentRuntimeConfig | null;
  notifyDataTaskCompleted: (task: import('../../../shared/contracts').DataCleaningTask) => void;
  logError: (...args: unknown[]) => void;
}
