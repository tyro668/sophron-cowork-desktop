import { rawTableIssue } from '../store/csv-encoding';
import { cancelledError } from '../../../shared/cancel';
import { cancelAiRun, startAiRun } from '../../agent/ai-runs';
import { dialog } from 'electron';
import * as fs from 'fs';
import type {
  DataDeleteRawTableNormalizerVersionInput,
  DataExportTableInput,
  DataExportTableResult,
  DataGenerateRawTableNormalizerDraftInput,
  DataImportRawTableInput,
  DataListRawTableNormalizerVersionsInput,
  DataPreviewRawTableSourceInput,
  DataPreviewRawTableInput,
  DataPreviewRawTableNormalizerVersionInput,
  DataPublishRawTableNormalizerVersionInput,
  DataSummarizeRawTableSourceInput,
  DataUpdateRawTableInput,
} from '../../../shared/contracts';
import { appContext } from '../../app/context';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';
import { sanitizeRawTableForIpc } from '../store/input-source';

export function registerRawTablesIpc({
  requireDataPipelineStore,
  requireDataCommandService,
  resolveModelRuntimeConfig,
  logError,
}: DataIpcContext): void {
  handleIpc('data.importRawTable', async (_event, payload: DataImportRawTableInput) => {
    try {
      const table = await requireDataPipelineStore().importRawTable(payload);
      return sanitizeRawTableForIpc(table);
    } catch (error) {
      logError('[Data] Error importing rawTable:', error);
      const issue = rawTableIssue(error);
      if (issue) return issue;
      throw error;
    }
  });

  handleIpc('data.getRawTable', async (_event, id: string) => {
    try {
      const table = await requireDataPipelineStore().getRawTableRecord(id);
      return table ? sanitizeRawTableForIpc(table) : table;
    } catch (error) {
      logError('[Data] Error getting input table:', error);
      throw error;
    }
  });

  handleIpc('data.updateRawTable', async (_event, payload: DataUpdateRawTableInput) => {
    try {
      const table = await requireDataPipelineStore().updateRawTable(payload);
      return sanitizeRawTableForIpc(table);
    } catch (error) {
      logError('[Data] Error updating rawTable:', error);
      const issue = rawTableIssue(error);
      if (issue) return issue;
      throw error;
    }
  });

  handleIpc(
    'data.previewRawTableSource',
    async (_event, payload: DataPreviewRawTableSourceInput) => {
      try {
        return await requireDataPipelineStore().previewRawTableSource(payload);
      } catch (error) {
        logError('[Data] Error previewing input table:', error);
        const issue = rawTableIssue(error);
        if (issue) return issue;
        throw error;
      }
    }
  );

  handleIpc(
    'data.summarizeRawTableSource',
    async (_event, payload: DataSummarizeRawTableSourceInput) => {
      try {
        return await requireDataPipelineStore().summarizeRawTableSource(payload);
      } catch (error) {
        logError('[Data] Error summarizing input table source:', error);
        throw error;
      }
    }
  );

  handleIpc('data.cancelRawTableNormalizerDraft', (_event, progressId: string) => {
    return { cancelled: cancelAiRun(`normalizer:${progressId}`) };
  });

  handleIpc(
    'data.generateRawTableNormalizerDraft',
    async (event, payload: DataGenerateRawTableNormalizerDraftInput) => {
      const progressId = payload.progressId?.trim();
      // Tracked even without a progressId: closing the window or quitting aborts the run.
      const run = startAiRun(`normalizer:${progressId || `anon:${Date.now()}`}`, event.sender);
      try {
        const modelConfigSetId =
          typeof payload.modelConfigSetId === 'string' ? payload.modelConfigSetId.trim() : '';
        const runtimeConfig = modelConfigSetId
          ? ((await resolveModelRuntimeConfig(modelConfigSetId)) ?? undefined)
          : undefined;
        return await requireDataCommandService().generateRawTableNormalizerDraft({
          ...payload,
          runtimeConfig,
          signal: run.signal,
          onProgress: progressId
            ? (progress) => {
                if (typeof progress.text !== 'string' || progress.text.length === 0) return;
                event.sender.send('data.rawTableNormalizerDraftProgress', {
                  progressId,
                  ...progress,
                });
              }
            : undefined,
        });
      } catch (error) {
        if (run.signal.aborted) throw cancelledError();
        logError('[Data] Error generating input table normalizer draft:', error);
        throw error;
      } finally {
        run.release();
      }
    }
  );

  handleIpc(
    'data.previewRawTableNormalizerVersion',
    async (_event, payload: DataPreviewRawTableNormalizerVersionInput) => {
      try {
        return await requireDataCommandService().previewRawTableNormalizerVersion(payload);
      } catch (error) {
        logError('[Data] Error previewing input table normalizer version:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.publishRawTableNormalizerVersion',
    async (_event, payload: DataPublishRawTableNormalizerVersionInput) => {
      try {
        return await requireDataCommandService().publishRawTableNormalizerVersion(payload);
      } catch (error) {
        logError('[Data] Error publishing input table normalizer version:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.deleteRawTableNormalizerVersion',
    async (_event, payload: DataDeleteRawTableNormalizerVersionInput) => {
      try {
        return await requireDataCommandService().deleteRawTableNormalizerVersion(payload);
      } catch (error) {
        logError('[Data] Error deleting input table normalizer version:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.listRawTableNormalizerVersions',
    async (_event, payload: DataListRawTableNormalizerVersionsInput) => {
      try {
        return await requireDataCommandService().listRawTableNormalizerVersions(payload);
      } catch (error) {
        logError('[Data] Error listing input table normalizer versions:', error);
        throw error;
      }
    }
  );

  handleIpc('data.previewRawTable', async (_event, payload: DataPreviewRawTableInput) => {
    try {
      return await requireDataPipelineStore().previewRawTable(payload);
    } catch (error) {
      logError('[Data] Error previewing stored input table:', error);
      throw error;
    }
  });

  handleIpc(
    'data.exportTable',
    async (_event, payload: DataExportTableInput): Promise<DataExportTableResult> => {
      let prepared: { fileName: string; content: string | Buffer };
      try {
        prepared = await requireDataPipelineStore().buildTableExport(payload);
      } catch (error) {
        logError('[Data] Error building table export:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      const filters =
        payload.format === 'csv'
          ? [{ name: 'Csv', extensions: ['csv'] }]
          : [{ name: 'Excel', extensions: ['xlsx'] }];
      const mainWindow = appContext.mainWindow;
      if (!mainWindow) {
        return { success: false, error: 'Main window is not available' };
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: prepared.fileName,
        filters,
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' };
      }
      try {
        await fs.promises.writeFile(result.filePath, prepared.content);
        return { success: true, path: result.filePath };
      } catch (error) {
        logError('[Data] Error writing table export:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  handleIpc('data.listRawTableNormalizers', () =>
    requireDataPipelineStore().listRawTableNormalizerArtifacts()
  );
  handleIpc('data.deleteRawTableNormalizer', (_event, artifactId: string) =>
    requireDataPipelineStore().deleteRawTableNormalizerArtifact(artifactId)
  );

  handleIpc('data.deleteRawTable', async (_event, id: string) => {
    try {
      return { success: await requireDataPipelineStore().deleteRawTable(id) };
    } catch (error) {
      logError('[Data] Error deleting rawTable:', error);
      throw error;
    }
  });
}
