import type {
  DataCreateTaskInput,
  DataDashboardQuery,
  DataPreviewWorkflowNodeInput,
  DataRunTaskInput,
  DataUpdateTaskInput,
  DataWorkflowSaveInput,
} from '../../../renderer/types';
import type { DataIpcContext } from './types';

export function registerDataTasksIpc({
  ipcMain,
  requireDataTaskStore,
  notifyDataTaskCompleted,
  logError,
}: DataIpcContext): void {
  ipcMain.handle('data.getDashboard', async (_event, payload?: DataDashboardQuery) => {
    try {
      return await requireDataTaskStore().getDashboard(payload ?? {});
    } catch (error) {
      logError('[Data] Error getting dashboard:', error);
      throw error;
    }
  });

  ipcMain.handle('data.getTask', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getTaskRecord(id);
    } catch (error) {
      logError('[Data] Error getting task:', error);
      throw error;
    }
  });

  ipcMain.handle('data.createTask', async (_event, payload: DataCreateTaskInput) => {
    try {
      return await requireDataTaskStore().createTask(payload);
    } catch (error) {
      logError('[Data] Error creating task:', error);
      throw error;
    }
  });

  ipcMain.handle('data.updateTask', async (_event, payload: DataUpdateTaskInput) => {
    try {
      return await requireDataTaskStore().updateTask(payload);
    } catch (error) {
      logError('[Data] Error updating task:', error);
      throw error;
    }
  });

  ipcMain.handle('data.runTask', async (_event, id: string, payload?: DataRunTaskInput) => {
    try {
      const task = await requireDataTaskStore().runTask(id, payload ?? {});
      notifyDataTaskCompleted(task);
      return task;
    } catch (error) {
      logError('[Data] Error running task:', error);
      throw error;
    }
  });

  ipcMain.handle('data.getTaskWorkflow', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getTaskWorkflow(id);
    } catch (error) {
      logError('[Data] Error getting task workflow:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'data.saveTaskWorkflow',
    async (_event, id: string, payload: DataWorkflowSaveInput) => {
      try {
        return await requireDataTaskStore().saveTaskWorkflow(id, payload);
      } catch (error) {
        logError('[Data] Error saving task workflow:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    'data.previewWorkflowNode',
    async (_event, payload: DataPreviewWorkflowNodeInput) => {
      try {
        return await requireDataTaskStore().previewWorkflowNode(payload);
      } catch (error) {
        logError('[Data] Error previewing workflow node cache:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    'data.getWorkflowNodeColumns',
    async (_event, payload: DataPreviewWorkflowNodeInput) => {
      try {
        return await requireDataTaskStore().getWorkflowNodeColumns(payload);
      } catch (error) {
        logError('[Data] Error reading workflow node cache columns:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('data.deleteTask', async (_event, id: string) => {
    try {
      return { success: await requireDataTaskStore().deleteTask(id) };
    } catch (error) {
      logError('[Data] Error deleting task:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'data.getWorkflowNodeColumnTypes',
    async (_event, payload: DataPreviewWorkflowNodeInput) => {
      try {
        return await requireDataTaskStore().getWorkflowNodeColumnTypes(payload);
      } catch (error) {
        logError('[Data] Error reading workflow node column types:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    'data.getWorkflowNodeColumnValues',
    async (_event, payload: DataPreviewWorkflowNodeInput & { column: string }) => {
      try {
        return await requireDataTaskStore().getWorkflowNodeColumnValues(payload);
      } catch (error) {
        logError('[Data] Error reading workflow node column values:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    'data.getWorkflowNodeRowCount',
    async (_event, payload: DataPreviewWorkflowNodeInput) => {
      try {
        return await requireDataTaskStore().getWorkflowNodeRowCount(payload);
      } catch (error) {
        logError('[Data] Error reading workflow node row count:', error);
        throw error;
      }
    }
  );
}
