/** data_output_commits journal row access. */
import { DataStoreContext } from '../data-store-context';
import { DataOutputCommitRow } from '../data-store-records';

export class OutputCommitJournal {
  constructor(private readonly ctx: DataStoreContext) {}
  async insertPreparedCommit(row: {
    id: string;
    taskId: string;
    temporaryTable: string;
    targetTable: string;
    backupTable: string;
    targetExisted: boolean;
    intendedMetadataJson: string;
    at: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `INSERT INTO data_output_commits (
         id, task_id, temporary_table, target_table, backup_table, target_existed,
         state, intended_metadata_json, error, created_at, updated_at
       ) VALUES (
         $id, $taskId, $temporaryTable, $targetTable, $backupTable, $targetExisted,
         'prepared', $intendedMetadataJson, NULL, $createdAt, $updatedAt
       )`,
      {
        id: row.id,
        taskId: row.taskId,
        temporaryTable: row.temporaryTable,
        targetTable: row.targetTable,
        backupTable: row.backupTable,
        targetExisted: row.targetExisted ? 1 : 0,
        intendedMetadataJson: row.intendedMetadataJson,
        createdAt: row.at,
        updatedAt: row.at,
      }
    );
  }
  async listPendingCommits(): Promise<DataOutputCommitRow[]> {
    return this.ctx.metaQueryRows<DataOutputCommitRow>(
      `SELECT * FROM data_output_commits WHERE state NOT IN ('completed', 'failed')`
    );
  }
  async updateOutputCommitState(id: string, state: string, error: string | null = null) {
    await this.ctx.metaRunSql(
      `UPDATE data_output_commits
       SET state = $state, error = $error, updated_at = $updatedAt
       WHERE id = $id`,
      { id, state, error, updatedAt: this.ctx.now() }
    );
  }
}
