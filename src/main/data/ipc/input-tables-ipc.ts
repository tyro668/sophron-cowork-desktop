import type {
  DataDeleteInputTableNormalizerVersionInput,
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
          ? (resolveModelRuntimeConfig(modelConfigSetId) ?? undefined)
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

  handleIpc('data.deleteDataset', async (_event, id: string) => {
    try {
      return { success: await requireDataTaskStore().deleteDataset(id) };
    } catch (error) {
      logError('[Data] Error deleting dataset:', error);
      throw error;
    }
  });
}
