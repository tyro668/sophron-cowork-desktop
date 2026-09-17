/** data_table_commits journal row access. */
import { DataStoreContext } from '../data-store-context';
import { DataTableCommitRow } from '../data-store-records';

export class TableCommitJournal {
  constructor(private readonly ctx: DataStoreContext) {}
  async insertPreparedCommit(row: {
    id: string;
    datasetId: string;
    operation: string;
    stagingTable: string;
    targetTable: string;
    backupTable: string | null;
    targetExisted: boolean;
    at: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `INSERT INTO data_table_commits (
         id, dataset_id, operation, staging_table, target_table, backup_table,
         target_existed, state, error, created_at, updated_at
       ) VALUES (
         $id, $datasetId, $operation, $stagingTable, $targetTable, $backupTable,
         $targetExisted, 'prepared', NULL, $createdAt, $updatedAt
       )`,
      {
        id: row.id,
        datasetId: row.datasetId,
        operation: row.operation,
        stagingTable: row.stagingTable,
        targetTable: row.targetTable,
        backupTable: row.backupTable,
        targetExisted: row.targetExisted ? 1 : 0,
        createdAt: row.at,
        updatedAt: row.at,
      }
    );
  }
  async listPendingCommits(): Promise<DataTableCommitRow[]> {
    return this.ctx.metaQueryRows<DataTableCommitRow>(
      `SELECT * FROM data_table_commits WHERE state NOT IN ('completed', 'failed')`
    );
  }
  async updateCommitState(id: string, state: string, error: string | null = null) {
    await this.ctx.metaRunSql(
      `UPDATE data_table_commits
       SET state = $state, error = $error, updated_at = $updatedAt
       WHERE id = $id`,
      { id, state, error, updatedAt: this.ctx.now() }
    );
  }
}
