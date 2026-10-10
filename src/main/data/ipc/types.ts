import type { AgentRuntimeConfig } from '../../../shared/contracts';
import type { DataCommandService } from '../data-command-service';
import type { DataPipelineStore } from '../data-pipeline-store';

export interface DataIpcContext {
  requireDataPipelineStore: () => DataPipelineStore;
  requireDataCommandService: () => DataCommandService;
  resolveModelRuntimeConfig: (
    configSetId: string
  ) => AgentRuntimeConfig | null | Promise<AgentRuntimeConfig | null>;
  notifyDataPipelineCompleted: (pipeline: import('../../../shared/contracts').DataPipeline) => void;
  logError: (...args: unknown[]) => void;
}
