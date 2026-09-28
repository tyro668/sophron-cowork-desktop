/** data_task_node_run_stats row access (stats keyed by run, pruned with run retention). */
import type { WorkflowNodeRunStat } from '../../data-command-types';
import { DataStoreContext } from '../data-store-context';

const STATS_SELECT = `SELECT node_id, node_type, input_rows, input_rows_by_handle_json,
       output_rows, dropped_rows, rejected_rows, sample_json, run_id
  FROM data_task_node_run_stats`;

interface StatRow {
  node_id: string;
  node_type: string;
  input_rows: number | null;
  input_rows_by_handle_json: string | null;
  output_rows: number;
  dropped_rows: number;
  rejected_rows: number;
  sample_json: string | null;
  run_id: string;
}

function mapStatRow(row: StatRow): WorkflowNodeRunStat {
  return {
    nodeId: row.node_id,
    nodeType: row.node_type,
    inputRows: row.input_rows === null ? null : Number(row.input_rows),
    inputRowsByHandle: row.input_rows_by_handle_json
      ? (JSON.parse(row.input_rows_by_handle_json) as Record<string, number>)
      : undefined,
    outputRows: Number(row.output_rows),
    droppedRows: Number(row.dropped_rows) || undefined,
    rejectedRows: Number(row.rejected_rows) || undefined,
    sample: row.sample_json
      ? (JSON.parse(row.sample_json) as Record<string, unknown>[])
      : undefined,
    runId: row.run_id,
  };
}

export class RunStatsRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  /**
   * Inserts stats under their run id. Pruning is the caller's job
   * (data_task_runs retention sweeps the stats of removed runs).
   */
  async persistTaskNodeStats(
    taskId: string,
    runId: string,
    stats: WorkflowNodeRunStat[]
  ): Promise<void> {
    for (const stat of stats) {
      await this.ctx.metaRunSql(
        `INSERT OR REPLACE INTO data_task_node_run_stats
           (task_id, run_id, node_id, node_type, input_rows, input_rows_by_handle_json, output_rows, dropped_rows, rejected_rows, sample_json, created_at)
         VALUES ($taskId, $runId, $nodeId, $nodeType, $inputRows, $inputRowsByHandleJson, $outputRows, $droppedRows, $rejectedRows, $sampleJson, $createdAt)`,
        {
          taskId,
          runId,
          nodeId: stat.nodeId,
          nodeType: stat.nodeType,
          inputRows: stat.inputRows,
          inputRowsByHandleJson: stat.inputRowsByHandle
            ? JSON.stringify(stat.inputRowsByHandle)
            : null,
          outputRows: stat.outputRows,
          droppedRows: stat.droppedRows ?? 0,
          rejectedRows: stat.rejectedRows ?? 0,
          sampleJson: stat.sample && stat.sample.length > 0 ? JSON.stringify(stat.sample) : null,
          createdAt: this.ctx.now(),
        }
      );
    }
  }
  /** Stats of one specific run. */
  async getTaskRunStats(taskId: string, runId: string): Promise<WorkflowNodeRunStat[]> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<StatRow>(
      `${STATS_SELECT} WHERE task_id = $taskId AND run_id = $runId ORDER BY node_id`,
      { taskId, runId }
    );
    return rows.map(mapStatRow);
  }
  /**
   * Stats of the newest persisted batch — legacy fallback for tasks whose
   * stats predate the run table (their run ids have no data_task_runs row).
   */
  async getLatestTaskNodeStats(taskId: string): Promise<WorkflowNodeRunStat[]> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<StatRow>(
      `${STATS_SELECT} WHERE task_id = $taskId AND run_id = (
         SELECT run_id FROM data_task_node_run_stats
         WHERE task_id = $taskId ORDER BY created_at DESC LIMIT 1
       ) ORDER BY node_id`,
      { taskId }
    );
    return rows.map(mapStatRow);
  }
  async deleteStatsForRuns(taskId: string, runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    const placeholders = runIds.map((_, i) => `$id${i}`).join(', ');
    const params = Object.fromEntries(runIds.map((id, i) => [`id${i}`, id]));
    await this.ctx.metaRunSql(
      `DELETE FROM data_task_node_run_stats WHERE task_id = $taskId AND run_id IN (${placeholders})`,
      { taskId, ...params }
    );
  }
  /** Removes stats whose run no longer exists (orphans + legacy batches). */
  async deleteOrphanStats(taskId: string): Promise<void> {
    await this.ctx.metaRunSql(
      `DELETE FROM data_task_node_run_stats WHERE task_id = $taskId AND run_id NOT IN (
         SELECT id FROM data_task_runs WHERE task_id = $taskId
       )`,
      { taskId }
    );
  }
}
