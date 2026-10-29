import { markPersonalAnalysisKeyDisconnected } from './cloud-connection-state';
import { app } from 'electron';
import { join } from 'path';
import { appContext, desktopAuthService } from '../../app/context';
import { notifyDataPipelineCompleted } from '../../app/notifications';
import { resolveAppConfigForAuth } from '../../app/runtime-config';
import { configStore } from '../../config/config-store';
import { DataCommandService } from '../../data/data-command-service';
import { createDataPipelineStore, type DataPipelineStore } from '../../data/data-pipeline-store';
import { createLlmRawTableNormalizerProjectGenerator } from '../../data/raw-table-normalizer-generator';
import { initDatabase } from '../../db/database';

export function requireDataPipelineStore(): DataPipelineStore {
  if (!appContext.dataPipelineStore) {
    appContext.dataPipelineStore = createDataPipelineStore(
      join(app.getPath('userData'), 'data', 'workspace.duckdb'),
      {
        metadataDb: initDatabase(),
        normalizersRoot: join(app.getPath('userData'), 'normalizers'),
      }
    );
  }
  return appContext.dataPipelineStore;
}

export function requireDataCommandService(): DataCommandService {
  if (!appContext.dataCommandService) {
    appContext.dataCommandService = new DataCommandService(
      requireDataPipelineStore(),
      createLlmRawTableNormalizerProjectGenerator(() =>
        resolveAppConfigForAuth(configStore.getAll())
      ),
      () => configStore.get('personalAnalysis'),
      {
        onPipelineCompleted: notifyDataPipelineCompleted,
        onPersonalAnalysisKeyRejected: markPersonalAnalysisKeyDisconnected,
        getPersonalAnalysisConnection: (rejectedToken) =>
          desktopAuthService.getPersonalAnalysisConnection(rejectedToken),
        recordLlmUsage: (event) => appContext.recordDataPipelineLlmUsage?.(event),
      }
    );
  }
  return appContext.dataCommandService;
}
