/** data_output_commits journal row access. */
import { DataStoreContext } from '../data-store-context';
import { DataOutputCommitRow } from '../data-store-records';

export class OutputCommitJournal {
  constructor(private readonly ctx: DataStoreContext) {}
  async insertPreparedCommit(row: {
    id: string;
    pipelineId: string;
    temporaryTable: string;
    targetTable: string;
    backupTable: string;
    targetExisted: boolean;
    intendedMetadataJson: string;
    at: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `INSERT INTO data_output_commits (
         id, pipeline_id, temporary_table, target_table, backup_table, target_existed,
         state, intended_metadata_json, error, created_at, updated_at
       ) VALUES (
         $id, $pipelineId, $temporaryTable, $targetTable, $backupTable, $targetExisted,
         'prepared', $intendedMetadataJson, NULL, $createdAt, $updatedAt
       )`,
      {
        id: row.id,
        pipelineId: row.pipelineId,
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
  /** Latest commit that actually wrote the target table — its metadata JSON
   *  carries the upstream signature the output was generated under. */
  async findLatestCommittedForTarget(
    pipelineId: string,
    targetTable: string
  ): Promise<{ generatedAt: number; workflowSignature: string | null } | null> {
    const rows = await this.ctx.metaQueryRows<DataOutputCommitRow>(
      `SELECT * FROM data_output_commits
       WHERE pipeline_id = $pipelineId
         AND target_table = $targetTable
         AND state NOT IN ('prepared', 'failed')
       ORDER BY created_at DESC
       LIMIT 1`,
      { pipelineId, targetTable }
    );
    const row = rows[0];
    if (!row) return null;
    let workflowSignature: string | null = null;
    try {
      const metadata = JSON.parse(String(row.intended_metadata_json)) as {
        workflowSignature?: unknown;
      };
      workflowSignature =
        typeof metadata.workflowSignature === 'string' ? metadata.workflowSignature : null;
    } catch {
      workflowSignature = null;
    }
    return { generatedAt: Number(row.created_at), workflowSignature };
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
