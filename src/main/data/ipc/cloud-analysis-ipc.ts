import type {
  ImportCloudTableInput,
  ListCloudProjectsInput,
  ListCloudSpacesInput,
  ListCloudTablesInput,
  PreviewCloudTableInput,
  UploadDataTableToCloudInput,
} from '../../../renderer/types';
import type { DataIpcContext } from './types';

export function registerCloudAnalysisIpc({
  ipcMain,
  requireDataCommandService,
  logError,
}: DataIpcContext): void {
  ipcMain.handle('data.listCloudSpaces', async (_event, payload?: ListCloudSpacesInput) => {
    try {
      return await requireDataCommandService().listCloudSpaces(payload ?? {});
    } catch (error) {
      logError('[Data] Error listing cloud spaces:', error);
      throw error;
    }
  });

  ipcMain.handle('data.listCloudProjects', async (_event, payload: ListCloudProjectsInput) => {
    try {
      return await requireDataCommandService().listCloudProjects(payload);
    } catch (error) {
      logError('[Data] Error listing cloud projects:', error);
      throw error;
    }
  });

  ipcMain.handle('data.listCloudTables', async (_event, payload: ListCloudTablesInput) => {
    try {
      return await requireDataCommandService().listCloudTables(payload);
    } catch (error) {
      logError('[Data] Error listing cloud tables:', error);
      throw error;
    }
  });

  ipcMain.handle('data.previewCloudTable', async (_event, payload: PreviewCloudTableInput) => {
    try {
      return await requireDataCommandService().previewCloudTable(payload);
    } catch (error) {
      logError('[Data] Error previewing cloud table:', error);
      throw error;
    }
  });

  ipcMain.handle('data.importCloudTable', async (_event, payload: ImportCloudTableInput) => {
    try {
      return await requireDataCommandService().importCloudTable(payload);
    } catch (error) {
      logError('[Data] Error importing cloud table:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'data.uploadDataTableToCloud',
    async (_event, payload: UploadDataTableToCloudInput) => {
      try {
        return await requireDataCommandService().uploadDataTableToCloud(payload);
      } catch (error) {
        logError('[Data] Error uploading data table to cloud:', error);
        throw error;
      }
    }
  );
}
