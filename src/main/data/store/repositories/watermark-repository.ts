/** data_pipeline_watermarks row access. */
import { DataStoreContext } from '../data-store-context';

export class WatermarkRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async getPipelineWatermark(
    pipelineId: string,
    nodeId: string,
    column: string
  ): Promise<string | null> {
    const rows = await this.ctx.metaQueryRows<{ watermark_value: string | null }>(
      `SELECT watermark_value FROM data_pipeline_watermarks
       WHERE pipeline_id = $pipelineId AND node_id = $nodeId AND column_name = $column`,
      { pipelineId, nodeId, column }
    );
    const value = rows[0]?.watermark_value;
    return value === null || value === undefined ? null : String(value);
  }
  async upsertPipelineWatermark(
    pipelineId: string,
    updates: Array<{ nodeId: string; column: string; value: string }>
  ): Promise<void> {
    for (const update of updates) {
      await this.ctx.metaRunSql(
        `DELETE FROM data_pipeline_watermarks WHERE pipeline_id = $pipelineId AND node_id = $nodeId`,
        { pipelineId, nodeId: update.nodeId }
      );
      await this.ctx.metaRunSql(
        `INSERT INTO data_pipeline_watermarks (pipeline_id, node_id, column_name, watermark_value, updated_at)
         VALUES ($pipelineId, $nodeId, $column, $value, $updatedAt)`,
        {
          pipelineId,
          nodeId: update.nodeId,
          column: update.column,
          value: update.value,
          updatedAt: this.ctx.now(),
        }
      );
    }
  }
}
