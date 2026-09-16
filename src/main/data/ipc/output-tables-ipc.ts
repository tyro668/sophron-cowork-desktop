import type {
  DataCreateOutputTableInput,
  DataUpdateOutputTableInput,
} from '../../../shared/contracts';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerOutputTablesIpc({ requireDataTaskStore, logError }: DataIpcContext): void {
  handleIpc('data.getOutputTable', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getOutputTableRecord(id);
    } catch (error) {
      logError('[Data] Error getting output table:', error);
      throw error;
    }
  });

  handleIpc('data.createOutputTable', async (_event, payload?: DataCreateOutputTableInput) => {
    try {
      return await requireDataTaskStore().createOutputTable(payload ?? {});
    } catch (error) {
      logError('[Data] Error creating output table:', error);
      throw error;
    }
  });

  handleIpc('data.updateOutputTable', async (_event, payload: DataUpdateOutputTableInput) => {
    try {
      return await requireDataTaskStore().updateOutputTable(payload);
    } catch (error) {
      logError('[Data] Error updating output table:', error);
      throw error;
    }
  });
}
