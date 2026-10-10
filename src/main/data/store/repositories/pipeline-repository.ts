/** data_pipelines row access. */
import type { DataPipeline, DataPipelineStatus } from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import { DataPipelineRow, mapPipelineRow } from '../data-store-records';

export class PipelineRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async getPipeline(id: string): Promise<DataPipeline | null> {
    const rows = await this.ctx.metaQueryRows<DataPipelineRow>(
      'SELECT * FROM data_pipelines WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapPipelineRow(rows[0]) : null;
  }
  async requirePipeline(id: string): Promise<DataPipeline> {
    const pipeline = await this.getPipeline(id);
    if (!pipeline) {
      throw new Error(`Data cleaning pipeline not found: ${id}`);
    }
    return pipeline;
  }

  async insertPipeline(row: {
    id: string;
    name: string;
    status: DataPipelineStatus;
    sourcePath: string | null;
    sourceRawTableId: string | null;
    resultTable: string | null;
    createdAt: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_pipelines (
            id, name, status, node_count, source_path, source_raw_table_id, result_table,
            row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
          )
          VALUES (
            $id, $name, $status, $nodeCount, $sourcePath, $sourceRawTableId, $resultTable,
            NULL, NULL, NULL, NULL, $createdAt, $updatedAt, NULL
          )
        `,
      {
        id: row.id,
        name: row.name,
        status: row.status,
        nodeCount: 0,
        sourcePath: row.sourcePath,
        sourceRawTableId: row.sourceRawTableId,
        resultTable: row.resultTable,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    );
  }

  async renamePipeline(id: string, name: string, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_pipelines
          SET name = $name,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      { id, name, updatedAt }
    );
  }

  async markPipelineRunning(
    id: string,
    sourcePath: string | null,
    updatedAt: number
  ): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_pipelines
          SET status = 'running',
              source_path = $sourcePath,
              error = NULL,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      { id, sourcePath, updatedAt }
    );
  }

  async markPipelineFailed(id: string, error: string, at: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_pipelines
          SET status = 'failed',
              error = $error,
              updated_at = $updatedAt,
              last_run_at = $lastRunAt
          WHERE id = $id
        `,
      { id, error, updatedAt: at, lastRunAt: at }
    );
  }

  async markPipelineCompleted(
    id: string,
    row: {
      nodeCount: number;
      sourcePath: string | null;
      sourceRawTableId: string | null;
      resultTable: string;
      rowCount: number;
      columnCount: number;
      at: number;
    }
  ): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_pipelines
          SET status = 'completed',
              node_count = $nodeCount,
              source_path = $sourcePath,
              source_raw_table_id = $sourceRawTableId,
              result_table = $resultTable,
              row_count = $rowCount,
              column_count = $columnCount,
              last_run_at = $lastRunAt,
              updated_at = $updatedAt,
              error = NULL
          WHERE id = $id
        `,
      {
        id,
        nodeCount: row.nodeCount,
        sourcePath: row.sourcePath,
        sourceRawTableId: row.sourceRawTableId,
        resultTable: row.resultTable,
        rowCount: row.rowCount,
        columnCount: row.columnCount,
        lastRunAt: row.at,
        updatedAt: row.at,
      }
    );
  }

  async setPipelineNodeCount(id: string, nodeCount: number, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_pipelines
          SET node_count = $nodeCount,
              updated_at = $updatedAt
          WHERE id = $pipelineId
        `,
      { pipelineId: id, nodeCount, updatedAt }
    );
  }

  async deletePipelineRow(id: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_pipelines WHERE id = $id', { id });
  }
}
