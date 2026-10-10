import type {
  DataCreateResultTableInput,
  DataUpdateResultTableInput,
} from '../../../shared/contracts';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerResultTablesIpc({
  requireDataPipelineStore,
  logError,
}: DataIpcContext): void {
  handleIpc('data.getResultTable', async (_event, id: string) => {
    try {
      return await requireDataPipelineStore().getResultTableRecord(id);
    } catch (error) {
      logError('[Data] Error getting output table:', error);
      throw error;
    }
  });

  handleIpc('data.createResultTable', async (_event, payload?: DataCreateResultTableInput) => {
    try {
      return await requireDataPipelineStore().createResultTable(payload ?? {});
    } catch (error) {
      logError('[Data] Error creating output table:', error);
      throw error;
    }
  });

  handleIpc('data.updateResultTable', async (_event, payload: DataUpdateResultTableInput) => {
    try {
      return await requireDataPipelineStore().updateResultTable(payload);
    } catch (error) {
      logError('[Data] Error updating output table:', error);
      throw error;
    }
  });
}
