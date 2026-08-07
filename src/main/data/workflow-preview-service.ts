import type { DataTaskStore } from './data-task-store';
import type {
  DataCleaningTask,
  DataInputTablePreview,
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowNode,
} from '../../renderer/types';
import type { WorkflowSaveShape } from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import { logDataCommandFallback, previewLimit, previewOffset } from './data-command-utils';

export class WorkflowPreviewService {
  constructor(
    private readonly store: DataTaskStore,
    private readonly resources: DataCommandResources
  ) {}

  async toWorkflowPreview(taskId: string, workflow: WorkflowSaveShape): Promise<DataTaskWorkflow> {
    const task = await this.resources.requireTask(taskId);
    return {
      task,
      nodes: workflow.nodes.map(
        (node): DataWorkflowNode => ({
          id: node.id,
          taskId,
          type: node.type,
          label: node.label,
          x: node.x,
          y: node.y,
          config: node.config ?? {},
          createdAt: 0,
          updatedAt: 0,
        })
      ),
      edges: workflow.edges.map(
        (edge): DataWorkflowEdge => ({
          id: edge.id,
          taskId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle ?? 'output',
          targetHandle: edge.targetHandle ?? 'input',
          createdAt: 0,
        })
      ),
    };
  }

  async previewTaskOutput(
    taskId: string,
    task: DataCleaningTask,
    previewRows?: number,
    runtimeWorkflow?: WorkflowSaveShape,
    offset?: number
  ): Promise<DataInputTablePreview | undefined> {
    const limit = previewLimit(previewRows);
    const runtimeOutputNode = runtimeWorkflow?.nodes.find((node) => node.type === 'output');
    if (runtimeOutputNode) {
      try {
        return await this.store.previewWorkflowNode({
          taskId,
          nodeId: runtimeOutputNode.id,
          nodeType: runtimeOutputNode.type,
          nodeConfig: runtimeOutputNode.config,
          limit,
          offset,
        });
      } catch (error) {
        logDataCommandFallback('Runtime output preview failed; trying saved output', error, {
          taskId,
          nodeId: runtimeOutputNode.id,
        });
      }
    }

    try {
      const workflow = await this.store.getTaskWorkflow(taskId);
      const outputNode = workflow.nodes.find((node) => node.type === 'output');
      if (outputNode) {
        return await this.store.previewWorkflowNode({
          taskId,
          nodeId: outputNode.id,
          nodeType: outputNode.type,
          nodeConfig: outputNode.config,
          limit,
          offset,
        });
      }
    } catch (error) {
      logDataCommandFallback('Saved output preview failed; trying source dataset', error, {
        taskId,
      });
    }

    if (task.sourceDatasetId) {
      try {
        return await this.previewDataset(task.sourceDatasetId, limit, offset);
      } catch (error) {
        logDataCommandFallback('Source dataset preview fallback failed', error, {
          taskId,
          sourceDatasetId: task.sourceDatasetId,
        });
      }
    }
    return undefined;
  }

  async previewDataset(
    id: string,
    limit?: number,
    offset?: number
  ): Promise<DataInputTablePreview> {
    return this.store.previewDataset({
      id,
      limit: previewLimit(limit),
      offset: previewOffset(offset),
    });
  }
}
