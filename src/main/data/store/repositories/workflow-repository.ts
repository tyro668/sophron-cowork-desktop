/** data_workflow_nodes / data_workflow_edges row access. */
import type {
  DataWorkflowEdge,
  DataWorkflowEdgeInput,
  DataWorkflowNode,
  DataWorkflowNodeInput,
} from '../../../../shared/contracts';
import { toNumber } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import {
  DataWorkflowNodeRow,
  DataWorkflowEdgeRow,
  RuntimeWorkflow,
  mapWorkflowEdgeRow,
  mapWorkflowNodeRow,
} from '../workflow-model';

export class WorkflowRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async getWorkflowNodes(taskId: string): Promise<DataWorkflowNode[]> {
    const rows = await this.ctx.metaQueryRows<DataWorkflowNodeRow>(
      `
          SELECT *
          FROM data_workflow_nodes
          WHERE task_id = $taskId
          ORDER BY ordinal ASC, created_at ASC
        `,
      { taskId }
    );
    return rows.map(mapWorkflowNodeRow);
  }
  async getWorkflowEdges(taskId: string): Promise<DataWorkflowEdge[]> {
    const rows = await this.ctx.metaQueryRows<DataWorkflowEdgeRow>(
      `
          SELECT *
          FROM data_workflow_edges
          WHERE task_id = $taskId
          ORDER BY created_at ASC
        `,
      { taskId }
    );
    return rows.map(mapWorkflowEdgeRow);
  }
  async getRuntimeWorkflow(taskId: string): Promise<RuntimeWorkflow> {
    const nodes = await this.getWorkflowNodes(taskId);
    const edges = nodes.length > 0 ? await this.getWorkflowEdges(taskId) : [];
    return { nodes, edges };
  }
  async countWorkflowNodes(taskId: string): Promise<number> {
    const rows = await this.ctx.metaQueryRows<{ count: number | string }>(
      'SELECT count(*) AS count FROM data_workflow_nodes WHERE task_id = $taskId',
      { taskId }
    );
    return toNumber(rows[0]?.count);
  }

  async deleteTaskGraph(taskId: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_workflow_edges WHERE task_id = $taskId', {
      taskId,
    });
    await this.ctx.metaRunSql('DELETE FROM data_workflow_nodes WHERE task_id = $taskId', {
      taskId,
    });
  }

  async insertWorkflowNode(
    taskId: string,
    node: DataWorkflowNodeInput,
    ordinal: number,
    at: number
  ): Promise<void> {
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_workflow_nodes (
            id, task_id, node_key, label, ordinal, operator_type, x, y,
            config_json, created_at, updated_at
          )
          VALUES (
            $id, $taskId, $nodeKey, $label, $ordinal, $operatorType, $x, $y,
            $configJson, $createdAt, $updatedAt
          )
        `,
      {
        id: node.id,
        taskId,
        nodeKey: node.id,
        label: node.label,
        ordinal,
        operatorType: node.type,
        x: node.x,
        y: node.y,
        configJson: JSON.stringify(node.config ?? {}),
        createdAt: at,
        updatedAt: at,
      }
    );
  }

  async insertWorkflowEdge(taskId: string, edge: DataWorkflowEdgeInput, at: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_workflow_edges (
            id, task_id, source_node_id, target_node_id, source_handle, target_handle, created_at
          )
          VALUES (
            $id, $taskId, $sourceNodeId, $targetNodeId, $sourceHandle, $targetHandle, $createdAt
          )
        `,
      {
        id: edge.id,
        taskId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        createdAt: at,
      }
    );
  }
}
