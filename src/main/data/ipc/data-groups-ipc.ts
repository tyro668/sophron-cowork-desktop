import type {
  DataAssignGroupInput,
  DataCreateGroupInput,
  DataGroupScope,
  DataRenameGroupInput,
} from '../../../shared/contracts';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerDataGroupsIpc({ requireDataTaskStore, logError }: DataIpcContext): void {
  handleIpc('data.listGroups', async (_event, scope: DataGroupScope) => {
    try {
      return await requireDataTaskStore().listGroups(scope);
    } catch (error) {
      logError('[Data] Error listing groups:', error);
      throw error;
    }
  });

  handleIpc('data.createGroup', async (_event, payload: DataCreateGroupInput) => {
    try {
      return await requireDataTaskStore().createGroup(payload);
    } catch (error) {
      logError('[Data] Error creating group:', error);
      throw error;
    }
  });

  handleIpc('data.renameGroup', async (_event, payload: DataRenameGroupInput) => {
    try {
      await requireDataTaskStore().renameGroup(payload);
      return { success: true };
    } catch (error) {
      logError('[Data] Error renaming group:', error);
      throw error;
    }
  });

  handleIpc('data.deleteGroup', async (_event, id: string) => {
    try {
      await requireDataTaskStore().deleteGroup(id);
      return { success: true };
    } catch (error) {
      logError('[Data] Error deleting group:', error);
      throw error;
    }
  });

  handleIpc('data.assignGroup', async (_event, payload: DataAssignGroupInput) => {
    try {
      await requireDataTaskStore().assignGroup(payload);
      return { success: true };
    } catch (error) {
      logError('[Data] Error assigning group:', error);
      throw error;
    }
  });
}
