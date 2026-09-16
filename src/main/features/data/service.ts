import { app } from 'electron';
import { join } from 'path';
import { appContext, desktopAuthService } from '../../app/context';
import { notifyDataTaskCompleted } from '../../app/notifications';
import { resolveAppConfigForAuth } from '../../app/runtime-config';
import { configStore } from '../../config/config-store';
import { DataCommandService } from '../../data/data-command-service';
import { createDataTaskStore, type DataTaskStore } from '../../data/data-task-store';
import { createLlmInputTableNormalizerProjectGenerator } from '../../data/input-table-normalizer-generator';
import { initDatabase } from '../../db/database';

export function requireDataTaskStore(): DataTaskStore {
  if (!appContext.dataTaskStore) {
    appContext.dataTaskStore = createDataTaskStore(
      join(app.getPath('userData'), 'data', 'workspace.duckdb'),
      {
        metadataDb: initDatabase(),
      }
    );
  }
  return appContext.dataTaskStore;
}

export function requireDataCommandService(): DataCommandService {
  if (!appContext.dataCommandService) {
    appContext.dataCommandService = new DataCommandService(
      requireDataTaskStore(),
      createLlmInputTableNormalizerProjectGenerator(() =>
        resolveAppConfigForAuth(configStore.getAll())
      ),
      () => configStore.get('personalAnalysis'),
      {
        onTaskCompleted: notifyDataTaskCompleted,
        getPersonalAnalysisConnection: () => desktopAuthService.getPersonalAnalysisConnection(),
        recordLlmUsage: (event) => appContext.recordDataTaskLlmUsage?.(event),
      }
    );
  }
  return appContext.dataCommandService;
}
