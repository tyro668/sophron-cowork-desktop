/** data_task_runs row access: one recorded execution per run, newest first. */
import type {
  DataTaskRun,
  DataTaskRunStatus,
  DataTaskRunTrigger,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';

export interface TaskRunRecordInput {
  id: string;
  taskId: string;
  seq: number;
  trigger: DataTaskRunTrigger;
  workflowSignature: string | null;
  startedAt: number;
}

export interface TaskRunFinishInput {
  status: Exclude<DataTaskRunStatus, 'running'>;
  inputRows: number | null;
  outputRows: number | null;
  error: string | null;
  failedNodeId: string | null;
  finishedAt: number;
}

interface TaskRunRow {
  id: string;
  task_id: string;
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

function mapTaskRunRow(row: TaskRunRow): DataTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: Number(row.seq),
    trigger: row.trigger as DataTaskRunTrigger,
    status: row.status as DataTaskRunStatus,
    workflowSignature: row.workflow_signature,
    inputRows: row.input_rows === null ? null : Number(row.input_rows),
    outputRows: row.output_rows === null ? null : Number(row.output_rows),
    error: row.error,
    failedNodeId: row.failed_node_id,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

export class TaskRunsRepository {
  constructor(private readonly ctx: DataStoreContext) {}

  async nextSeq(taskId: string): Promise<number> {
    const rows = await this.ctx.metaQueryRows<{ next: number }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM data_task_runs WHERE task_id = $taskId`,
      { taskId }
    );
    return Number(rows[0]?.next ?? 1);
  }

  async insertRun(input: TaskRunRecordInput): Promise<void> {
    await this.ctx.metaRunSql(
      `INSERT INTO data_task_runs
         (id, task_id, seq, trigger, status, workflow_signature, started_at, created_at)
       VALUES ($id, $taskId, $seq, $trigger, 'running', $signature, $startedAt, $startedAt)`,
      {
        id: input.id,
        taskId: input.taskId,
        seq: input.seq,
        trigger: input.trigger,
        signature: input.workflowSignature,
        startedAt: input.startedAt,
      }
    );
  }

  async finishRun(id: string, input: TaskRunFinishInput): Promise<void> {
    await this.ctx.metaRunSql(
      `UPDATE data_task_runs
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
  async listTaskRuns(taskId: string, limit = 20): Promise<DataTaskRun[]> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<TaskRunRow>(
      `SELECT id, task_id, seq, trigger, status, workflow_signature,
              input_rows, output_rows, error, failed_node_id, started_at, finished_at
       FROM data_task_runs WHERE task_id = $taskId
       ORDER BY seq DESC LIMIT $limit`,
      { taskId, limit }
    );
    return rows.map(mapTaskRunRow);
  }

  /** Latest run of a trigger kind — used to resolve "canvas" stats. */
  async getLatestTaskRun(
    taskId: string,
    trigger?: DataTaskRunTrigger
  ): Promise<DataTaskRun | null> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<TaskRunRow>(
      `SELECT id, task_id, seq, trigger, status, workflow_signature,
              input_rows, output_rows, error, failed_node_id, started_at, finished_at
       FROM data_task_runs
       WHERE task_id = $taskId ${trigger ? 'AND trigger = $trigger' : ''}
       ORDER BY seq DESC LIMIT 1`,
      trigger ? { taskId, trigger } : { taskId }
    );
    return rows[0] ? mapTaskRunRow(rows[0]) : null;
  }

  /**
   * Drops runs beyond the newest `keep` per task; returns the removed run
   * ids so the caller can delete their node stats in the same section.
   */
  async pruneTaskRuns(taskId: string, keep = 20): Promise<string[]> {
    const rows = await this.ctx.metaQueryRows<{ id: string }>(
      `SELECT id FROM data_task_runs WHERE task_id = $taskId
         AND id NOT IN (
           SELECT id FROM data_task_runs WHERE task_id = $taskId
           ORDER BY seq DESC LIMIT $keep
         )`,
      { taskId, keep }
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    const placeholders = ids.map((_, i) => `$id${i}`).join(', ');
    const params = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
    await this.ctx.metaRunSql(
      `DELETE FROM data_task_runs WHERE task_id = $taskId AND id IN (${placeholders})`,
      { taskId, ...params }
    );
    return ids;
  }
}
