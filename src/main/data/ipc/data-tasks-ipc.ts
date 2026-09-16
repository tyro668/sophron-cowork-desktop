import { ZodError } from 'zod';
import type {
  DataCreateTaskInput,
  DataDashboardQuery,
  DataGenerateTaskFromRequirementInput,
  DataPreviewWorkflowNodeInput,
  DataRunTaskInput,
  DataUpdateTaskInput,
  DataWorkflowSaveInput,
} from '../../../renderer/types';
import type { DataIpcContext } from './types';
import { DataCommandError } from '../data-command-types';

export function registerDataTasksIpc({
  ipcMain,
  requireDataTaskStore,
  requireDataCommandService,
  resolveModelRuntimeConfig,
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

  ipcMain.handle(
    'data.analyzeTaskRequirement',
    async (_event, payload: DataGenerateTaskFromRequirementInput) => {
      try {
        const modelConfigSetId =
          typeof payload.modelConfigSetId === 'string' ? payload.modelConfigSetId.trim() : '';
        const runtimeConfig = modelConfigSetId
          ? (resolveModelRuntimeConfig(modelConfigSetId) ?? undefined)
          : undefined;
        return await requireDataCommandService().analyzeTaskRequirement({
          ...payload,
          runtimeConfig,
        });
      } catch (error) {
        logError('[Data] Error analyzing task requirement:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    'data.generateTaskFromRequirement',
    async (_event, payload: DataGenerateTaskFromRequirementInput) => {
      try {
        if (typeof payload.analysisId !== 'string' || !payload.analysisId.trim()) {
          throw new DataCommandError(
            'ANALYSIS_REQUIRED',
            'Analyze and confirm the data-task requirement before generation.'
          );
        }
        const modelConfigSetId =
          typeof payload.modelConfigSetId === 'string' ? payload.modelConfigSetId.trim() : '';
        const runtimeConfig = modelConfigSetId
          ? (resolveModelRuntimeConfig(modelConfigSetId) ?? undefined)
          : undefined;
        return await requireDataCommandService().generateTaskFromRequirement({
          ...payload,
          runtimeConfig,
        });
      } catch (error) {
        logError('[Data] Error generating task from requirement:', error);
        throw error;
      }
    }
  );

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

  ipcMain.handle(
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

  ipcMain.handle('data.getTaskNodeStats', async (_event, id: string) => {
    try {
      return await requireDataTaskStore().getTaskNodeStats(id);
    } catch (error) {
      logError('[Data] Error getting task node stats:', error);
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
