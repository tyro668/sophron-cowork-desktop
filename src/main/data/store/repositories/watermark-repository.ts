/** data_pipeline_watermarks row access. Watermarks are keyed by source fingerprint too. */
import { DataStoreContext } from '../data-store-context';

export interface WatermarkUpdate {
  nodeId: string;
  column: string;
  value: string;
  /** Source fingerprint the watermark was read under (see source-fingerprint.ts). */
  fingerprint: string;
}

export interface WatermarkLookup {
  value: string | null;
  /** A watermark existed but for another source fingerprint (or column): it was ignored. */
  reset: boolean;
}

export class WatermarkRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async getPipelineWatermark(
    pipelineId: string,
    nodeId: string,
    column: string,
    fingerprint: string
  ): Promise<WatermarkLookup> {
    const rows = await this.ctx.metaQueryRows<{
      watermark_value: string | null;
      column_name: string;
      source_fingerprint: string | null;
    }>(
      `SELECT watermark_value, column_name, source_fingerprint FROM data_pipeline_watermarks
       WHERE pipeline_id = $pipelineId AND node_id = $nodeId`,
      { pipelineId, nodeId }
    );
    const row = rows[0];
    if (!row) return { value: null, reset: false };
    if (row.column_name !== column || (row.source_fingerprint ?? '') !== fingerprint) {
      return { value: null, reset: true };
    }
    const value = row.watermark_value;
    return { value: value === null || value === undefined ? null : String(value), reset: false };
  }
  async upsertPipelineWatermark(pipelineId: string, updates: WatermarkUpdate[]): Promise<void> {
    for (const update of updates) {
      await this.ctx.metaRunSql(
        `DELETE FROM data_pipeline_watermarks WHERE pipeline_id = $pipelineId AND node_id = $nodeId`,
        { pipelineId, nodeId: update.nodeId }
      );
      await this.ctx.metaRunSql(
        `INSERT INTO data_pipeline_watermarks
           (pipeline_id, node_id, column_name, watermark_value, updated_at, source_fingerprint)
         VALUES ($pipelineId, $nodeId, $column, $value, $updatedAt, $fingerprint)`,
        {
          pipelineId,
          nodeId: update.nodeId,
          column: update.column,
          value: update.value,
          updatedAt: this.ctx.now(),
          fingerprint: update.fingerprint,
        }
      );
    }
  }
}
