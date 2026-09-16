/** data_task_watermarks row access. */
import { DataStoreContext } from '../data-store-context';

export class WatermarkRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async getTaskWatermark(taskId: string, nodeId: string, column: string): Promise<string | null> {
    const rows = await this.ctx.metaQueryRows<{ watermark_value: string | null }>(
      `SELECT watermark_value FROM data_task_watermarks
       WHERE task_id = $taskId AND node_id = $nodeId AND column_name = $column`,
      { taskId, nodeId, column }
    );
    const value = rows[0]?.watermark_value;
    return value === null || value === undefined ? null : String(value);
  }
  async upsertTaskWatermark(
    taskId: string,
    updates: Array<{ nodeId: string; column: string; value: string }>
  ): Promise<void> {
    for (const update of updates) {
      await this.ctx.metaRunSql(
        `DELETE FROM data_task_watermarks WHERE task_id = $taskId AND node_id = $nodeId`,
        { taskId, nodeId: update.nodeId }
      );
      await this.ctx.metaRunSql(
        `INSERT INTO data_task_watermarks (task_id, node_id, column_name, watermark_value, updated_at)
         VALUES ($taskId, $nodeId, $column, $value, $updatedAt)`,
        {
          taskId,
          nodeId: update.nodeId,
          column: update.column,
          value: update.value,
          updatedAt: this.ctx.now(),
        }
      );
    }
  }
}
