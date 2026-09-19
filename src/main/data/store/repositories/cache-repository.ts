/** data_workflow_node_caches row access + cached table naming. */
import type { DataWorkflowNode } from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import { DataWorkflowNodeCacheRow, WorkflowCacheScope } from '../workflow-model';

export class CacheRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  getWorkflowNodeCacheTableName(
    taskId: string,
    node: DataWorkflowNode,
    cacheScope: WorkflowCacheScope,
    cacheRunId: string
  ): string {
    const baseId =
      cacheScope === 'permanent' ? `${taskId}_${node.id}` : `${taskId}_${node.id}_${cacheRunId}`;
    return tableNameFromId(`workflow_cache_${cacheScope}_${node.type}`, baseId);
  }
  async registerWorkflowNodeCache(
    node: DataWorkflowNode,
    tableName: string,
    cacheScope: WorkflowCacheScope,
    expiresAt: number | null,
    workflowSignature: string | null = null
  ): Promise<void> {
    const timestamp = this.ctx.now();
    const id = tableNameFromId('cache', `${node.taskId}_${node.id}_${tableName}`);
    await this.ctx.metaRunSql(
      `
          DELETE FROM data_workflow_node_caches
          WHERE task_id = $taskId
            AND node_id = $nodeId
            AND table_name = $tableName
        `,
      { taskId: node.taskId, nodeId: node.id, tableName }
    );
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_workflow_node_caches (
            id, task_id, node_id, node_type, table_name, cache_scope,
            workflow_signature, expires_at, created_at, updated_at
          )
          VALUES (
            $id, $taskId, $nodeId, $nodeType, $tableName, $cacheScope,
            $workflowSignature, $expiresAt, $createdAt, $updatedAt
          )
        `,
      {
        id,
        taskId: node.taskId,
        nodeId: node.id,
        nodeType: node.type,
        tableName,
        cacheScope,
        workflowSignature,
        expiresAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    );
  }
  /** Newest live cache row for the node — metadata rides along so callers can
   *  tell WHEN and under WHICH upstream config the table was materialized. */
  async findWorkflowNodeCache(
    taskId: string,
    nodeId: string
  ): Promise<{ tableName: string; generatedAt: number; workflowSignature: string | null } | null> {
    const rows = await this.ctx.metaQueryRows<DataWorkflowNodeCacheRow>(
      `
          SELECT *
          FROM data_workflow_node_caches
          WHERE task_id = $taskId
            AND node_id = $nodeId
            AND (expires_at IS NULL OR expires_at > $now)
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 8
        `,
      { taskId, nodeId, now: this.ctx.now() }
    );
    for (const row of rows) {
      const tableName = String(row.table_name);
      if (await this.ctx.physicalTableExists(tableName)) {
        return {
          tableName,
          generatedAt: Number(row.created_at),
          workflowSignature:
            typeof row.workflow_signature === 'string' ? row.workflow_signature : null,
        };
      }
      await this.ctx.metaRunSql('DELETE FROM data_workflow_node_caches WHERE id = $id', {
        id: String(row.id),
      });
    }
    return null;
  }
  async findWorkflowNodeCacheTable(taskId: string, nodeId: string): Promise<string | null> {
    return (await this.findWorkflowNodeCache(taskId, nodeId))?.tableName ?? null;
  }
  async cleanupExpiredWorkflowNodeCaches(): Promise<void> {
    const rows = await this.ctx.metaQueryRows<DataWorkflowNodeCacheRow>(
      `
          SELECT *
          FROM data_workflow_node_caches
          WHERE expires_at IS NOT NULL
            AND expires_at <= $now
        `,
      { now: this.ctx.now() }
    );
    for (const row of rows) {
      await this.ctx.dropTableIfExists(String(row.table_name)).catch(() => undefined);
      await this.ctx.metaRunSql('DELETE FROM data_workflow_node_caches WHERE id = $id', {
        id: String(row.id),
      });
    }
  }
  async deleteWorkflowNodeCachesForTask(
    taskId: string,
    preservedTables: ReadonlySet<string> = new Set()
  ): Promise<void> {
    const rows = await this.ctx.metaQueryRows<DataWorkflowNodeCacheRow>(
      'SELECT * FROM data_workflow_node_caches WHERE task_id = $taskId',
      { taskId }
    );
    for (const row of rows) {
      const tableName = String(row.table_name);
      if (!preservedTables.has(tableName)) {
        await this.ctx.dropTableIfExists(tableName).catch(() => undefined);
      }
    }
    await this.ctx.metaRunSql('DELETE FROM data_workflow_node_caches WHERE task_id = $taskId', {
      taskId,
    });
  }
  async listTemporaryCacheTableNames(taskId: string): Promise<string[]> {
    const rows = await this.ctx.metaQueryRows<DataWorkflowNodeCacheRow>(
      `
          SELECT *
          FROM data_workflow_node_caches
          WHERE task_id = $taskId
            AND cache_scope = 'temporary'
        `,
      { taskId }
    );
    return [...new Set(rows.map((row) => String(row.table_name)))];
  }
  async deleteTemporaryCacheRows(taskId: string): Promise<void> {
    await this.ctx.metaRunSql(
      `
          DELETE FROM data_workflow_node_caches
          WHERE task_id = $taskId
            AND cache_scope = 'temporary'
        `,
      { taskId }
    );
  }
}
