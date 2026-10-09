import { ZodError } from 'zod';
import type {
  DataCreateTaskInput,
  DataDashboardQuery,
  DataPreviewWorkflowNodeInput,
  DataRunTaskInput,
  DataUpdateTaskInput,
  DataWorkflowSaveInput,
} from '../../../shared/contracts';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerDataTasksIpc({
  requireDataTaskStore,
  notifyDataTaskCompleted,
  logError,
}: DataIpcContext): void {
  handleIpc('data.getDashboard', async (_event, payload?: DataDashboardQuery) => {
    try {
      return await requireDataTaskStore().getDashboard(payload ?? {});
    } catch (error) {
      logError('[Data] Error getting dashboard:', error);
      throw error;
    }
  });

  handleIpc('data.getTask', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getTaskRecord(id);
    } catch (error) {
      logError('[Data] Error getting task:', error);
      throw error;
    }
  });

  handleIpc('data.createTask', async (_event, payload: DataCreateTaskInput) => {
    try {
      return await requireDataTaskStore().createTask(payload);
    } catch (error) {
      logError('[Data] Error creating task:', error);
      throw error;
    }
  });

  handleIpc('data.updateTask', async (_event, payload: DataUpdateTaskInput) => {
    try {
      return await requireDataTaskStore().updateTask(payload);
    } catch (error) {
      logError('[Data] Error updating task:', error);
      throw error;
    }
  });

  handleIpc('data.runTask', async (_event, id: string, payload?: DataRunTaskInput) => {
    try {
      const task = await requireDataTaskStore().runTask(id, payload ?? {});
      if (payload?.outputMode !== 'temporary') {
        notifyDataTaskCompleted(task);
      }
      return task;
    } catch (error) {
      logError('[Data] Error running task:', error);
      if (error instanceof ZodError) {
        throw new Error(
          error.issues
            .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
            .join('; ')
        );
      }
      throw error;
    }
  });

  handleIpc(
    'data.runTaskWithDiagnostics',
    async (_event, id: string, payload?: DataRunTaskInput) => {
      try {
        const result = await requireDataTaskStore().runTaskWithDiagnostics(id, payload ?? {});
        if (payload?.outputMode !== 'temporary') {
          notifyDataTaskCompleted(result.task);
        }
        return result;
      } catch (error) {
        logError('[Data] Error running task:', error);
        if (error instanceof ZodError) {
          throw new Error(
            error.issues
              .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
              .join('; ')
          );
        }
        throw error;
      }
    }
  );

  handleIpc('data.getTaskNodeStats', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getTaskNodeStats(id);
    } catch (error) {
      logError('[Data] Error getting task node stats:', error);
      throw error;
    }
  });

  handleIpc('data.listTaskRuns', async (_event, id: string, limit?: number) => {
    try {
      return await requireDataTaskStore().listTaskRuns(id, limit);
    } catch (error) {
      logError('[Data] Error listing task runs:', error);
      throw error;
    }
  });

  handleIpc('data.getTaskRunNodeStats', async (_event, id: string, runId: string) => {
    try {
      return await requireDataTaskStore().getTaskRunNodeStats(id, runId);
    } catch (error) {
      logError('[Data] Error getting task run node stats:', error);
      throw error;
    }
  });

  handleIpc('data.getTaskWorkflow', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getTaskWorkflow(id);
    } catch (error) {
      logError('[Data] Error getting task workflow:', error);
      throw error;
    }
  });

  handleIpc('data.saveTaskWorkflow', async (_event, id: string, payload: DataWorkflowSaveInput) => {
    try {
      return await requireDataTaskStore().saveTaskWorkflow(id, payload);
    } catch (error) {
      logError('[Data] Error saving task workflow:', error);
      throw error;
    }
  });

  handleIpc(
    'data.validateTaskWorkflowPlan',
    async (_event, id: string, payload: DataWorkflowSaveInput) => {
      try {
        return await requireDataTaskStore().validateWorkflowPlanForTask(id, payload);
      } catch (error) {
        logError('[Data] Error validating task workflow plan:', error);
        throw error;
      }
    }
  );

  handleIpc('data.previewWorkflowNode', async (_event, payload: DataPreviewWorkflowNodeInput) => {
    try {
      return await requireDataTaskStore().previewWorkflowNode(payload);
    } catch (error) {
      logError('[Data] Error previewing workflow node cache:', error);
      throw error;
    }
  });

  handleIpc(
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

  handleIpc('data.deleteTask', async (_event, id: string) => {
    try {
      return { success: await requireDataTaskStore().deleteTask(id) };
    } catch (error) {
      logError('[Data] Error deleting task:', error);
      throw error;
    }
  });

  handleIpc(
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

  handleIpc(
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

  handleIpc(
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
