import type {
  ImportCloudTableInput,
  ListCloudDriveFilesInput,
  ListCloudProjectsInput,
  ListCloudSpacesInput,
  ListCloudTablesInput,
  PreviewCloudDriveFileInput,
  PreviewCloudTableInput,
  SearchCloudTablesInput,
  UploadDataTableToCloudInput,
} from '../../../shared/contracts';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerCloudAnalysisIpc({
  requireDataCommandService,
  logError,
}: DataIpcContext): void {
  handleIpc('data.listCloudSpaces', async (_event, payload?: ListCloudSpacesInput) => {
    try {
      return await requireDataCommandService().listCloudSpaces(payload ?? {});
    } catch (error) {
      logError('[Data] Error listing cloud spaces:', error);
      throw error;
    }
  });

  handleIpc('data.listCloudProjects', async (_event, payload: ListCloudProjectsInput) => {
    try {
      return await requireDataCommandService().listCloudProjects(payload);
    } catch (error) {
      logError('[Data] Error listing cloud projects:', error);
      throw error;
    }
  });

  handleIpc('data.listCloudTables', async (_event, payload: ListCloudTablesInput) => {
    try {
      return await requireDataCommandService().listCloudTables(payload);
    } catch (error) {
      logError('[Data] Error listing cloud tables:', error);
      throw error;
    }
  });

  handleIpc('data.searchCloudTables', async (_event, payload: SearchCloudTablesInput) => {
    try {
      return await requireDataCommandService().searchCloudTables(payload);
    } catch (error) {
      logError('[Data] Error searching cloud tables:', error);
      throw error;
    }
  });

  handleIpc('data.previewCloudTable', async (_event, payload: PreviewCloudTableInput) => {
    try {
      return await requireDataCommandService().previewCloudTable(payload);
    } catch (error) {
      logError('[Data] Error previewing cloud table:', error);
      throw error;
    }
  });

  handleIpc('data.importCloudTable', async (_event, payload: ImportCloudTableInput) => {
    try {
      return await requireDataCommandService().importCloudTable(payload);
    } catch (error) {
      logError('[Data] Error importing cloud table:', error);
      throw error;
    }
  });

  handleIpc('data.uploadDataTableToCloud', async (_event, payload: UploadDataTableToCloudInput) => {
    try {
      return await requireDataCommandService().uploadDataTableToCloud(payload);
    } catch (error) {
      logError('[Data] Error uploading data table to cloud:', error);
      throw error;
    }
  });

  handleIpc('data.listCloudDriveFiles', async (_event, payload: ListCloudDriveFilesInput) => {
    try {
      return await requireDataCommandService().listCloudDriveFiles(payload);
    } catch (error) {
      logError('[Data] Error listing cloud drive files:', error);
      throw error;
    }
  });

  handleIpc('data.previewCloudDriveFile', async (_event, payload: PreviewCloudDriveFileInput) => {
    try {
      return await requireDataCommandService().previewCloudDriveFile(payload);
    } catch (error) {
      logError('[Data] Error previewing cloud drive file:', error);
      throw error;
    }
  });
}
