import type {
  DataCreateOutputTableInput,
  DataUpdateOutputTableInput,
} from '../../../renderer/types';
import type { DataIpcContext } from './types';

export function registerOutputTablesIpc({
  ipcMain,
  requireDataTaskStore,
  logError,
}: DataIpcContext): void {
  ipcMain.handle('data.getOutputTable', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getOutputTableRecord(id);
    } catch (error) {
      logError('[Data] Error getting output table:', error);
      throw error;
    }
  });

  ipcMain.handle('data.createOutputTable', async (_event, payload?: DataCreateOutputTableInput) => {
    try {
      return await requireDataTaskStore().createOutputTable(payload ?? {});
    } catch (error) {
      logError('[Data] Error creating output table:', error);
      throw error;
    }
  });

  ipcMain.handle('data.updateOutputTable', async (_event, payload: DataUpdateOutputTableInput) => {
    try {
      return await requireDataTaskStore().updateOutputTable(payload);
    } catch (error) {
      logError('[Data] Error updating output table:', error);
      throw error;
    }
  });
}
