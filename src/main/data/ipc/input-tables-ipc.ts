import { dialog } from 'electron';
import * as fs from 'fs';
import type {
  DataDeleteInputTableNormalizerVersionInput,
  DataExportTableInput,
  DataExportTableResult,
  DataGenerateInputTableNormalizerDraftInput,
  DataImportDatasetInput,
  DataListInputTableNormalizerVersionsInput,
  DataPreviewDatasetInput,
  DataPreviewInputTableInput,
  DataPreviewInputTableNormalizerVersionInput,
  DataPublishInputTableNormalizerVersionInput,
  DataSummarizeInputTableSourceInput,
  DataUpdateDatasetInput,
} from '../../../shared/contracts';
import { appContext } from '../../app/context';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerInputTablesIpc({
  requireDataTaskStore,
  requireDataCommandService,
  resolveModelRuntimeConfig,
  logError,
}: DataIpcContext): void {
  handleIpc('data.importDataset', async (_event, payload: DataImportDatasetInput) => {
    try {
      return await requireDataTaskStore().importDataset(payload);
    } catch (error) {
      logError('[Data] Error importing dataset:', error);
      throw error;
    }
  });

  handleIpc('data.getInputTable', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getInputTableRecord(id);
    } catch (error) {
      logError('[Data] Error getting input table:', error);
      throw error;
    }
  });

  handleIpc('data.updateDataset', async (_event, payload: DataUpdateDatasetInput) => {
    try {
      return await requireDataTaskStore().updateDataset(payload);
    } catch (error) {
      logError('[Data] Error updating dataset:', error);
      throw error;
    }
  });

  handleIpc('data.previewInputTable', async (_event, payload: DataPreviewInputTableInput) => {
    try {
      return await requireDataTaskStore().previewInputTable(payload);
    } catch (error) {
      logError('[Data] Error previewing input table:', error);
      throw error;
    }
  });

  handleIpc(
    'data.summarizeInputTableSource',
    async (_event, payload: DataSummarizeInputTableSourceInput) => {
      try {
        return await requireDataTaskStore().summarizeInputTableSource(payload);
      } catch (error) {
        logError('[Data] Error summarizing input table source:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.generateInputTableNormalizerDraft',
    async (event, payload: DataGenerateInputTableNormalizerDraftInput) => {
      try {
        const progressId = payload.progressId?.trim();
        const modelConfigSetId =
          typeof payload.modelConfigSetId === 'string' ? payload.modelConfigSetId.trim() : '';
        const runtimeConfig = modelConfigSetId
          ? ((await resolveModelRuntimeConfig(modelConfigSetId)) ?? undefined)
          : undefined;
        return await requireDataCommandService().generateInputTableNormalizerDraft({
          ...payload,
          runtimeConfig,
          onProgress: progressId
            ? (progress) => {
                if (typeof progress.text !== 'string' || progress.text.length === 0) return;
                event.sender.send('data.inputTableNormalizerDraftProgress', {
                  progressId,
                  ...progress,
                });
              }
            : undefined,
        });
      } catch (error) {
        logError('[Data] Error generating input table normalizer draft:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.previewInputTableNormalizerVersion',
    async (_event, payload: DataPreviewInputTableNormalizerVersionInput) => {
      try {
        return await requireDataCommandService().previewInputTableNormalizerVersion(payload);
      } catch (error) {
        logError('[Data] Error previewing input table normalizer version:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.publishInputTableNormalizerVersion',
    async (_event, payload: DataPublishInputTableNormalizerVersionInput) => {
      try {
        return await requireDataCommandService().publishInputTableNormalizerVersion(payload);
      } catch (error) {
        logError('[Data] Error publishing input table normalizer version:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.deleteInputTableNormalizerVersion',
    async (_event, payload: DataDeleteInputTableNormalizerVersionInput) => {
      try {
        return await requireDataCommandService().deleteInputTableNormalizerVersion(payload);
      } catch (error) {
        logError('[Data] Error deleting input table normalizer version:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.listInputTableNormalizerVersions',
    async (_event, payload: DataListInputTableNormalizerVersionsInput) => {
      try {
        return await requireDataCommandService().listInputTableNormalizerVersions(payload);
      } catch (error) {
        logError('[Data] Error listing input table normalizer versions:', error);
        throw error;
      }
    }
  );

  handleIpc('data.previewDataset', async (_event, payload: DataPreviewDatasetInput) => {
    try {
      return await requireDataTaskStore().previewDataset(payload);
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
        prepared = await requireDataTaskStore().buildTableExport(payload);
      } catch (error) {
        logError('[Data] Error building table export:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      const filters =
        payload.format === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : payload.format === 'xlsx'
            ? [{ name: 'Excel', extensions: ['xlsx'] }]
            : [{ name: 'HTML', extensions: ['html'] }];
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

  handleIpc('data.deleteDataset', async (_event, id: string) => {
    try {
      return { success: await requireDataTaskStore().deleteDataset(id) };
    } catch (error) {
      logError('[Data] Error deleting dataset:', error);
      throw error;
    }
  });
}
