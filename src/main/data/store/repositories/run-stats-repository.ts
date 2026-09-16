/** data_task_node_run_stats row access (latest run per task). */
import type { WorkflowNodeRunStat } from '../../data-command-types';
import { DataStoreContext } from '../data-store-context';

export class RunStatsRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  /** Keeps only the newest run's per-node stats per task; prior runs are pruned. */
  async persistTaskNodeStats(
    taskId: string,
    runId: string,
    stats: WorkflowNodeRunStat[]
  ): Promise<void> {
    await this.ctx.metaRunSql(`DELETE FROM data_task_node_run_stats WHERE task_id = $taskId`, {
      taskId,
    });
    for (const stat of stats) {
      await this.ctx.metaRunSql(
        `INSERT INTO data_task_node_run_stats
           (task_id, run_id, node_id, node_type, input_rows, output_rows, dropped_rows, rejected_rows, sample_json, created_at)
         VALUES ($taskId, $runId, $nodeId, $nodeType, $inputRows, $outputRows, $droppedRows, $rejectedRows, $sampleJson, $createdAt)`,
        {
          taskId,
          runId,
          nodeId: stat.nodeId,
          nodeType: stat.nodeType,
          inputRows: stat.inputRows,
          outputRows: stat.outputRows,
          droppedRows: stat.droppedRows ?? 0,
          rejectedRows: stat.rejectedRows ?? 0,
          sampleJson: stat.sample && stat.sample.length > 0 ? JSON.stringify(stat.sample) : null,
          createdAt: this.ctx.now(),
        }
      );
    }
  }
  /** Latest persisted run's per-node stats for a task (newest run only). */
  async getTaskNodeStats(taskId: string): Promise<WorkflowNodeRunStat[]> {
    await this.ctx.ensureMetadataReady();
    const rows = await this.ctx.metaQueryRows<{
      node_id: string;
      node_type: string;
      input_rows: number | null;
      output_rows: number;
      dropped_rows: number;
      rejected_rows: number;
      sample_json: string | null;
    }>(
      `SELECT node_id, node_type, input_rows, output_rows, dropped_rows, rejected_rows, sample_json
       FROM data_task_node_run_stats WHERE task_id = $taskId ORDER BY node_id`,
      { taskId }
    );
    return rows.map((row) => ({
      nodeId: row.node_id,
      nodeType: row.node_type,
      inputRows: row.input_rows === null ? null : Number(row.input_rows),
      outputRows: Number(row.output_rows),
      droppedRows: Number(row.dropped_rows) || undefined,
      rejectedRows: Number(row.rejected_rows) || undefined,
      sample: row.sample_json
        ? (JSON.parse(row.sample_json) as Record<string, unknown>[])
        : undefined,
    }));
  }
}
