import { dialog } from 'electron';
import * as fs from 'fs';
import type {
  DataResolveRawSourceRenamesInput,
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
  DataCreateRawSourceInput,
  DataRebuildRawSourceInput,
  DataScanRawSourceInput,
} from '../../../shared/contracts';
import { appContext } from '../../app/context';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerRawTablesIpc({
  requireDataPipelineStore,
  requireDataCommandService,
  resolveModelRuntimeConfig,
  logError,
}: DataIpcContext): void {
  handleIpc('data.importRawTable', async (_event, payload: DataImportRawTableInput) => {
    try {
      return await requireDataPipelineStore().importRawTable(payload);
    } catch (error) {
      logError('[Data] Error importing rawTable:', error);
      throw error;
    }
  });

  const sourceChannel = <A extends unknown[], R>(
    channel: string,
    label: string,
    run: (...args: A) => Promise<R>
  ) =>
    handleIpc(channel, async (_event, ...args: never[]) => {
      try {
        return await run(...(args as unknown as A));
      } catch (error) {
        logError(`[Data] Error ${label}:`, error);
        throw error;
      }
    });
  sourceChannel('data.listRawSources', 'listing raw sources', () =>
    requireDataPipelineStore().listRawSources()
  );
  sourceChannel('data.scanRawSource', 'scanning raw source', (payload: DataScanRawSourceInput) =>
    requireDataPipelineStore().scanRawSource(payload)
  );
  sourceChannel(
    'data.createRawSource',
    'creating raw source',
    (payload: DataCreateRawSourceInput) => requireDataPipelineStore().createRawSource(payload)
  );
  sourceChannel(
    'data.resolveRawSourceRenames',
    'resolving raw source renames',
    (input: DataResolveRawSourceRenamesInput) =>
      requireDataPipelineStore().resolveRawSourceRenames(input)
  );
  sourceChannel(
    'data.setRawSourceAutoInclude',
    'updating raw source',
    (id: string, autoInclude: boolean) =>
      requireDataPipelineStore().setRawSourceAutoInclude(id, autoInclude)
  );
  sourceChannel('data.refreshRawSource', 'refreshing raw source', (id: string) =>
    requireDataPipelineStore().refreshRawSource(id)
  );
  sourceChannel('data.getRawSourceRebuildImpact', 'reading rebuild impact', (id: string) =>
    requireDataPipelineStore().getRawSourceRebuildImpact(id)
  );
  sourceChannel(
    'data.rebuildRawSource',
    'rebuilding raw source',
    (payload: DataRebuildRawSourceInput) => requireDataPipelineStore().rebuildRawSource(payload)
  );
  sourceChannel('data.deleteRawSource', 'deleting raw source', (id: string) =>
    requireDataPipelineStore().deleteRawSource(id)
  );

  handleIpc('data.getRawTable', async (_event, id: string) => {
    try {
      return await requireDataPipelineStore().getRawTableRecord(id);
    } catch (error) {
      logError('[Data] Error getting input table:', error);
      throw error;
    }
  });

  handleIpc('data.updateRawTable', async (_event, payload: DataUpdateRawTableInput) => {
    try {
      return await requireDataPipelineStore().updateRawTable(payload);
    } catch (error) {
      logError('[Data] Error updating rawTable:', error);
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

  handleIpc(
    'data.generateRawTableNormalizerDraft',
    async (event, payload: DataGenerateRawTableNormalizerDraftInput) => {
      try {
        const progressId = payload.progressId?.trim();
        const modelConfigSetId =
          typeof payload.modelConfigSetId === 'string' ? payload.modelConfigSetId.trim() : '';
        const runtimeConfig = modelConfigSetId
          ? ((await resolveModelRuntimeConfig(modelConfigSetId)) ?? undefined)
          : undefined;
        return await requireDataCommandService().generateRawTableNormalizerDraft({
          ...payload,
          runtimeConfig,
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
        logError('[Data] Error generating input table normalizer draft:', error);
        throw error;
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

  handleIpc('data.deleteRawTable', async (_event, id: string) => {
    try {
      return { success: await requireDataPipelineStore().deleteRawTable(id) };
    } catch (error) {
      logError('[Data] Error deleting rawTable:', error);
      throw error;
    }
  });
}
