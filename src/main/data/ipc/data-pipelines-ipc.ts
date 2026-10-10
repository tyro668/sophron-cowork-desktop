import { ZodError } from 'zod';
import type {
  DataCreatePipelineInput,
  DataDashboardQuery,
  DataPreviewWorkflowNodeInput,
  DataRunPipelineInput,
  DataUpdatePipelineInput,
  DataWorkflowSaveInput,
} from '../../../shared/contracts';
import type { DataIpcContext } from './types';
import { handleIpc } from '../../ipc-handle';

export function registerDataPipelinesIpc({
  requireDataPipelineStore,
  notifyDataPipelineCompleted,
  logError,
}: DataIpcContext): void {
  handleIpc('data.getDashboard', async (_event, payload?: DataDashboardQuery) => {
    try {
      return await requireDataPipelineStore().getDashboard(payload ?? {});
    } catch (error) {
      logError('[Data] Error getting dashboard:', error);
      throw error;
    }
  });

  handleIpc('data.getPipeline', async (_event, id: string) => {
    try {
      return await requireDataPipelineStore().getPipelineRecord(id);
    } catch (error) {
      logError('[Data] Error getting pipeline:', error);
      throw error;
    }
  });

  handleIpc('data.createPipeline', async (_event, payload: DataCreatePipelineInput) => {
    try {
      return await requireDataPipelineStore().createPipeline(payload);
    } catch (error) {
      logError('[Data] Error creating pipeline:', error);
      throw error;
    }
  });

  handleIpc('data.updatePipeline', async (_event, payload: DataUpdatePipelineInput) => {
    try {
      return await requireDataPipelineStore().updatePipeline(payload);
    } catch (error) {
      logError('[Data] Error updating pipeline:', error);
      throw error;
    }
  });

  handleIpc('data.runPipeline', async (_event, id: string, payload?: DataRunPipelineInput) => {
    try {
      const pipeline = await requireDataPipelineStore().runPipeline(id, payload ?? {});
      if (payload?.outputMode !== 'temporary') {
        notifyDataPipelineCompleted(pipeline);
      }
      return pipeline;
    } catch (error) {
      logError('[Data] Error running pipeline:', error);
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
    'data.runPipelineWithDiagnostics',
    async (_event, id: string, payload?: DataRunPipelineInput) => {
      try {
        const result = await requireDataPipelineStore().runPipelineWithDiagnostics(
          id,
          payload ?? {}
        );
        if (payload?.outputMode !== 'temporary') {
          notifyDataPipelineCompleted(result.pipeline);
        }
        return result;
      } catch (error) {
        logError('[Data] Error running pipeline:', error);
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

  handleIpc('data.getPipelineNodeStats', async (_event, id: string) => {
    try {
      return await requireDataPipelineStore().getPipelineNodeStats(id);
    } catch (error) {
      logError('[Data] Error getting pipeline node stats:', error);
      throw error;
    }
  });

  handleIpc('data.listPipelineRuns', async (_event, id: string, limit?: number) => {
    try {
      return await requireDataPipelineStore().listPipelineRuns(id, limit);
    } catch (error) {
      logError('[Data] Error listing pipeline runs:', error);
      throw error;
    }
  });

  handleIpc('data.getPipelineRunNodeStats', async (_event, id: string, runId: string) => {
    try {
      return await requireDataPipelineStore().getPipelineRunNodeStats(id, runId);
    } catch (error) {
      logError('[Data] Error getting pipeline run node stats:', error);
      throw error;
    }
  });

  handleIpc('data.getPipelineWorkflow', async (_event, id: string) => {
    try {
      return await requireDataPipelineStore().getPipelineWorkflow(id);
    } catch (error) {
      logError('[Data] Error getting pipeline workflow:', error);
      throw error;
    }
  });

  handleIpc(
    'data.savePipelineWorkflow',
    async (_event, id: string, payload: DataWorkflowSaveInput) => {
      try {
        return await requireDataPipelineStore().savePipelineWorkflow(id, payload);
      } catch (error) {
        logError('[Data] Error saving pipeline workflow:', error);
        throw error;
      }
    }
  );

  handleIpc(
    'data.validatePipelineWorkflowPlan',
    async (_event, id: string, payload: DataWorkflowSaveInput) => {
      try {
        return await requireDataPipelineStore().validateWorkflowPlanForPipeline(id, payload);
      } catch (error) {
        logError('[Data] Error validating pipeline workflow plan:', error);
        throw error;
      }
    }
  );

  handleIpc('data.previewWorkflowNode', async (_event, payload: DataPreviewWorkflowNodeInput) => {
    try {
      return await requireDataPipelineStore().previewWorkflowNode(payload);
    } catch (error) {
      logError('[Data] Error previewing workflow node cache:', error);
      throw error;
    }
  });

  handleIpc(
    'data.getWorkflowNodeColumns',
    async (_event, payload: DataPreviewWorkflowNodeInput) => {
      try {
        return await requireDataPipelineStore().getWorkflowNodeColumns(payload);
      } catch (error) {
        logError('[Data] Error reading workflow node cache columns:', error);
        throw error;
      }
    }
  );

  handleIpc('data.deletePipeline', async (_event, id: string) => {
    try {
      return { success: await requireDataPipelineStore().deletePipeline(id) };
    } catch (error) {
      logError('[Data] Error deleting pipeline:', error);
      throw error;
    }
  });

  handleIpc(
    'data.getWorkflowNodeColumnTypes',
    async (_event, payload: DataPreviewWorkflowNodeInput) => {
      try {
        return await requireDataPipelineStore().getWorkflowNodeColumnTypes(payload);
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
        return await requireDataPipelineStore().getWorkflowNodeColumnValues(payload);
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
        return await requireDataPipelineStore().getWorkflowNodeRowCount(payload);
      } catch (error) {
        logError('[Data] Error reading workflow node row count:', error);
        throw error;
      }
    }
  );
}
