import type { DataPipelineStore } from './data-pipeline-store';
import type {
  DataPipeline,
  DataRawTablePreview,
  DataPipelineWorkflow,
  DataWorkflowEdge,
  DataWorkflowNode,
} from '../../shared/contracts';
import type { WorkflowSaveShape } from './data-command-types';
import { DataCommandResources } from './data-command-resources';
import { logDataCommandFallback, previewLimit, previewOffset } from './data-command-utils';

export class WorkflowPreviewService {
  constructor(
    private readonly store: DataPipelineStore,
    private readonly resources: DataCommandResources
  ) {}

  async toWorkflowPreview(
    pipelineId: string,
    workflow: WorkflowSaveShape
  ): Promise<DataPipelineWorkflow> {
    const pipeline = await this.resources.requirePipeline(pipelineId);
    return {
      pipeline,
      nodes: workflow.nodes.map((node): DataWorkflowNode => ({
        id: node.id,
        pipelineId,
        type: node.type,
        label: node.label,
        x: node.x,
        y: node.y,
        config: node.config ?? {},
        createdAt: 0,
        updatedAt: 0,
      })),
      edges: workflow.edges.map((edge): DataWorkflowEdge => ({
        id: edge.id,
        pipelineId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? 'output',
        targetHandle: edge.targetHandle ?? 'input',
        createdAt: 0,
      })),
    };
  }

  async previewPipelineOutput(
    pipelineId: string,
    pipeline: DataPipeline,
    previewRows?: number,
    runtimeWorkflow?: WorkflowSaveShape,
    offset?: number
  ): Promise<DataRawTablePreview | undefined> {
    const limit = previewLimit(previewRows);
    const runtimeOutputNode = runtimeWorkflow?.nodes.find((node) => node.type === 'output');
    if (runtimeOutputNode) {
      try {
        return await this.store.previewWorkflowNode({
          pipelineId,
          nodeId: runtimeOutputNode.id,
          nodeType: runtimeOutputNode.type,
          nodeConfig: runtimeOutputNode.config,
          limit,
          offset,
        });
      } catch (error) {
        logDataCommandFallback('Runtime output preview failed; trying saved output', error, {
          pipelineId,
          nodeId: runtimeOutputNode.id,
        });
      }
    }

    try {
      const workflow = await this.store.getPipelineWorkflow(pipelineId);
      const outputNode = workflow.nodes.find((node) => node.type === 'output');
      if (outputNode) {
        return await this.store.previewWorkflowNode({
          pipelineId,
          nodeId: outputNode.id,
          nodeType: outputNode.type,
          nodeConfig: outputNode.config,
          limit,
          offset,
        });
      }
    } catch (error) {
      logDataCommandFallback('Saved output preview failed; trying source rawTable', error, {
        pipelineId,
      });
    }

    if (pipeline.sourceRawTableId) {
      try {
        return await this.previewRawTable(pipeline.sourceRawTableId, limit, offset);
      } catch (error) {
        logDataCommandFallback('Source rawTable preview fallback failed', error, {
          pipelineId,
          sourceRawTableId: pipeline.sourceRawTableId,
        });
      }
    }
    return undefined;
  }

  async previewRawTable(id: string, limit?: number, offset?: number): Promise<DataRawTablePreview> {
    return this.store.previewRawTable({
      id,
      limit: previewLimit(limit),
      offset: previewOffset(offset),
    });
  }
}
