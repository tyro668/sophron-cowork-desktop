/** data_pipeline_runs row access: one recorded execution per run, newest first. */
import type {
  DataPipelineRun,
  DataPipelineRunStatus,
  DataPipelineRunTrigger,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';

export interface PipelineRunRecordInput {
  id: string;
  pipelineId: string;
  seq: number;
  trigger: DataPipelineRunTrigger;
  workflowSignature: string | null;
  startedAt: number;
}

export interface PipelineRunFinishInput {
  status: Exclude<DataPipelineRunStatus, 'running'>;
  inputRows: number | null;
  outputRows: number | null;
  error: string | null;
  failedNodeId: string | null;
  finishedAt: number;
}

interface PipelineRunRow {
  id: string;
  pipeline_id: string;
  seq: number;
  trigger: string;
  status: string;
  workflow_signature: string | null;
  input_rows: number | null;
  output_rows: number | null;
  error: string | null;
  failed_node_id: string | null;
  started_at: number;
  finished_at: number | null;
}

function mapPipelineRunRow(row: PipelineRunRow): DataPipelineRun {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    seq: Number(row.seq),
    trigger: row.trigger as DataPipelineRunTrigger,
    status: row.status as DataPipelineRunStatus,
    workflowSignature: row.workflow_signature,
    inputRows: row.input_rows === null ? null : Number(row.input_rows),
    outputRows: row.output_rows === null ? null : Number(row.output_rows),
    error: row.error,
    failedNodeId: row.failed_node_id,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

export class PipelineRunsRepository {
  constructor(private readonly ctx: DataStoreContext) {}

  async nextSeq(pipelineId: string): Promise<number> {
    const rows = await this.ctx.metaQueryRows<{ next: number }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM data_pipeline_runs WHERE pipeline_id = $pipelineId`,
      { pipelineId }
    );
    return Number(rows[0]?.next ?? 1);
  }

  async insertRun(input: PipelineRunRecordInput): Promise<void> {
    await this.ctx.metaRunSql(
      `INSERT INTO data_pipeline_runs
         (id, pipeline_id, seq, trigger, status, workflow_signature, started_at, created_at)
       VALUES ($id, $pipelineId, $seq, $trigger, 'running', $signature, $startedAt, $startedAt)`,
      {
        id: input.id,
        pipelineId: input.pipelineId,
        seq: input.seq,
        trigger: input.trigger,
        signature: input.workflowSignature,
        startedAt: input.startedAt,
      }
    );
  }

  async finishRun(id: string, input: PipelineRunFinishInput): Promise<void> {
    await this.ctx.metaRunSql(
      `UPDATE data_pipeline_runs
       SET status = $status, input_rows = $inputRows, output_rows = $outputRows,
           error = $error, failed_node_id = $failedNodeId, finished_at = $finishedAt
       WHERE id = $id`,
      {
        id,
        status: input.status,
        inputRows: input.inputRows,
        outputRows: input.outputRows,
        error: input.error,
        failedNodeId: input.failedNodeId,
        finishedAt: input.finishedAt,
      }
    );
  }

  /** Runs newest first (highest seq first). */
  async listPipelineRuns(pipelineId: string, limit = 20): Promise<DataPipelineRun[]> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<PipelineRunRow>(
      `SELECT id, pipeline_id, seq, trigger, status, workflow_signature,
              input_rows, output_rows, error, failed_node_id, started_at, finished_at
       FROM data_pipeline_runs WHERE pipeline_id = $pipelineId
       ORDER BY seq DESC LIMIT $limit`,
      { pipelineId, limit }
    );
    return rows.map(mapPipelineRunRow);
  }

  /** Latest run of a trigger kind — used to resolve "canvas" stats. */
  async getLatestPipelineRun(
    pipelineId: string,
    trigger?: DataPipelineRunTrigger
  ): Promise<DataPipelineRun | null> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<PipelineRunRow>(
      `SELECT id, pipeline_id, seq, trigger, status, workflow_signature,
              input_rows, output_rows, error, failed_node_id, started_at, finished_at
       FROM data_pipeline_runs
       WHERE pipeline_id = $pipelineId ${trigger ? 'AND trigger = $trigger' : ''}
       ORDER BY seq DESC LIMIT 1`,
      trigger ? { pipelineId, trigger } : { pipelineId }
    );
    return rows[0] ? mapPipelineRunRow(rows[0]) : null;
  }

  /**
   * Drops runs beyond the newest `keep` per pipeline; returns the removed run
   * ids so the caller can delete their node stats in the same section.
   */
  async prunePipelineRuns(pipelineId: string, keep = 20): Promise<string[]> {
    const rows = await this.ctx.metaQueryRows<{ id: string }>(
      `SELECT id FROM data_pipeline_runs WHERE pipeline_id = $pipelineId
         AND id NOT IN (
           SELECT id FROM data_pipeline_runs WHERE pipeline_id = $pipelineId
           ORDER BY seq DESC LIMIT $keep
         )`,
      { pipelineId, keep }
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    const placeholders = ids.map((_, i) => `$id${i}`).join(', ');
    const params = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
    await this.ctx.metaRunSql(
      `DELETE FROM data_pipeline_runs WHERE pipeline_id = $pipelineId AND id IN (${placeholders})`,
      { pipelineId, ...params }
    );
    return ids;
  }
}
