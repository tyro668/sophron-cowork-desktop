/** data_cleaning_tasks row access. */
import type { DataCleaningTask, DataTaskStatus } from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import { DataTaskRow, mapTaskRow } from '../data-store-records';

export class TaskRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  async getTask(id: string): Promise<DataCleaningTask | null> {
    const rows = await this.ctx.metaQueryRows<DataTaskRow>(
      'SELECT * FROM data_cleaning_tasks WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }
  async requireTask(id: string): Promise<DataCleaningTask> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Data cleaning task not found: ${id}`);
    }
    return task;
  }

  async insertTask(row: {
    id: string;
    name: string;
    status: DataTaskStatus;
    sourcePath: string | null;
    sourceDatasetId: string | null;
    outputTable: string | null;
    createdAt: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_cleaning_tasks (
            id, name, status, node_count, source_path, source_dataset_id, output_table,
            row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
          )
          VALUES (
            $id, $name, $status, $nodeCount, $sourcePath, $sourceDatasetId, $outputTable,
            NULL, NULL, NULL, NULL, $createdAt, $updatedAt, NULL
          )
        `,
      {
        id: row.id,
        name: row.name,
        status: row.status,
        nodeCount: 0,
        sourcePath: row.sourcePath,
        sourceDatasetId: row.sourceDatasetId,
        outputTable: row.outputTable,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    );
  }

  async renameTask(id: string, name: string, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_cleaning_tasks
          SET name = $name,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      { id, name, updatedAt }
    );
  }

  async markTaskRunning(id: string, sourcePath: string | null, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_cleaning_tasks
          SET status = 'running',
              source_path = $sourcePath,
              error = NULL,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      { id, sourcePath, updatedAt }
    );
  }

  async markTaskFailed(id: string, error: string, at: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_cleaning_tasks
          SET status = 'failed',
              error = $error,
              updated_at = $updatedAt,
              last_run_at = $lastRunAt
          WHERE id = $id
        `,
      { id, error, updatedAt: at, lastRunAt: at }
    );
  }

  async markTaskCompleted(
    id: string,
    row: {
      nodeCount: number;
      sourcePath: string | null;
      sourceDatasetId: string | null;
      outputTable: string;
      rowCount: number;
      columnCount: number;
      at: number;
    }
  ): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_cleaning_tasks
          SET status = 'completed',
              node_count = $nodeCount,
              source_path = $sourcePath,
              source_dataset_id = $sourceDatasetId,
              output_table = $outputTable,
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
        sourceDatasetId: row.sourceDatasetId,
        outputTable: row.outputTable,
        rowCount: row.rowCount,
        columnCount: row.columnCount,
        lastRunAt: row.at,
        updatedAt: row.at,
      }
    );
  }

  async setTaskNodeCount(id: string, nodeCount: number, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_cleaning_tasks
          SET node_count = $nodeCount,
              updated_at = $updatedAt
          WHERE id = $taskId
        `,
      { taskId: id, nodeCount, updatedAt }
    );
  }

  async deleteTaskRow(id: string): Promise<void> {
    await this.ctx.metaRunSql('DELETE FROM data_cleaning_tasks WHERE id = $id', { id });
  }
}
