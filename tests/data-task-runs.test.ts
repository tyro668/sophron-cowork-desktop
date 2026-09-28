/**
 * Run-history coverage: every execution (committed + trial + failed) records
 * a data_task_runs row with seq/status/times/row totals/signature, node stats
 * stay keyed to their run, and retention prunes old runs with their stats.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import type { DataWorkflowSaveInput } from '../src/renderer/types';

const stores: DataTaskStore[] = [];
const tempRoots: string[] = [];

function openStore(): { store: DataTaskStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-task-runs-'));
  tempRoots.push(root);
  const store = createDataTaskStore(path.join(root, 'workspace.duckdb'));
  stores.push(store);
  return { store, root };
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeCsv(root: string, name: string): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, 'id,name\n1,a\n2,b\n');
  return file;
}

async function runnableSetup(root: string, store: DataTaskStore, sql?: string) {
  const sourcePath = writeCsv(root, 'input.csv');
  const output = await store.createOutputTable({ name: `out_${Date.now()}` });
  const task = await store.createTask({ name: 'run-log task', sourcePath });
  const nodes: DataWorkflowSaveInput['nodes'] = [
    { id: 'source', type: 'input_source', label: 'source', x: 0, y: 0, config: { source: 'task' } },
  ];
  if (sql) {
    nodes.push({ id: 'sql', type: 'sql_query', label: 'sql', x: 0, y: 0, config: { sql } });
  }
  nodes.push({
    id: 'output',
    type: 'output',
    label: 'output',
    x: 0,
    y: 0,
    config: { outputDatasetId: output.id },
  });
  const edges = sql
    ? [
        { id: 'e1', sourceNodeId: 'source', targetNodeId: 'sql' },
        { id: 'e2', sourceNodeId: 'sql', targetNodeId: 'output' },
      ]
    : [{ id: 'e1', sourceNodeId: 'source', targetNodeId: 'output' }];
  return { task, output, sourcePath, workflow: { nodes, edges } };
}

describe('task run history', () => {
  it('records a completed run with seq, times, rows, and signature', async () => {
    const { store, root } = openStore();
    const { task, sourcePath, workflow } = await runnableSetup(root, store);

    await store.runTask(task.id, { sourcePath, workflow });

    const runs = await store.listTaskRuns(task.id);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.seq).toBe(1);
    expect(run.trigger).toBe('run');
    expect(run.status).toBe('completed');
    expect(run.inputRows).toBe(2);
    expect(run.outputRows).toBe(2);
    expect(run.workflowSignature).toBeTruthy();
    expect(run.startedAt).toBeGreaterThan(0);
    expect(run.finishedAt).toBeGreaterThanOrEqual(run.startedAt);
    expect(run.error).toBeNull();

    const stats = await store.getTaskRunNodeStats(task.id, run.id);
    expect(stats.length).toBeGreaterThanOrEqual(2);
    expect(stats.every((stat) => stat.runId === run.id)).toBe(true);
    // Canvas stats resolve to the latest committed run.
    expect((await store.getTaskNodeStats(task.id)).every((s) => s.runId === run.id)).toBe(true);
  });

  it('records trial runs without displacing canvas stats', async () => {
    const { store, root } = openStore();
    const { task, sourcePath, workflow } = await runnableSetup(root, store);

    await store.runTask(task.id, { sourcePath, workflow });
    const result = await store.runTaskWithDiagnostics(task.id, {
      sourcePath,
      workflow,
      outputMode: 'temporary',
    });
    expect(result.failure).toBeUndefined();

    const runs = await store.listTaskRuns(task.id);
    expect(runs).toHaveLength(2);
    expect(runs[0].seq).toBe(2);
    expect(runs[0].trigger).toBe('trial');
    expect(runs[0].status).toBe('completed');
    expect(runs[1].trigger).toBe('run');

    // Trial stats are persisted under their own run id…
    const trialStats = await store.getTaskRunNodeStats(task.id, runs[0].id);
    expect(trialStats.length).toBeGreaterThanOrEqual(2);
    // …but the canvas still reflects the latest committed run.
    const canvasStats = await store.getTaskNodeStats(task.id);
    expect(canvasStats.every((stat) => stat.runId === runs[1].id)).toBe(true);
  });

  it('records a failed trial run with error and finished_at', async () => {
    const { store, root } = openStore();
    const { task, sourcePath, workflow } = await runnableSetup(
      root,
      store,
      'SELECT missing_col FROM input'
    );

    const result = await store.runTaskWithDiagnostics(task.id, {
      sourcePath,
      workflow,
      outputMode: 'temporary',
    });
    expect(result.failure).toBeTruthy();

    const runs = await store.listTaskRuns(task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].trigger).toBe('trial');
    expect(runs[0].error).toBeTruthy();
    expect(runs[0].finishedAt).not.toBeNull();
  });

  it('increments seq per task and prunes beyond the retention window', async () => {
    const { store, root } = openStore();
    const { task, sourcePath, workflow } = await runnableSetup(root, store);

    // Seed 25 historical run rows directly — cheaper than 25 real executions.
    const ctx = (
      store as unknown as {
        ctx: { metaRunSql: (sql: string, v?: Record<string, unknown>) => Promise<void> };
      }
    ).ctx;
    for (let seq = 1; seq <= 25; seq++) {
      await ctx.metaRunSql(
        `INSERT INTO data_task_runs
           (id, task_id, seq, trigger, status, workflow_signature, started_at, finished_at, created_at)
         VALUES ($id, $taskId, $seq, 'run', 'completed', 'sig', 1, 2, 1)`,
        { id: `old_${seq}`, taskId: task.id, seq }
      );
    }

    await store.runTask(task.id, { sourcePath, workflow });

    const runs = await store.listTaskRuns(task.id, 50);
    expect(runs.length).toBe(20);
    // Newest first: the real run got seq 26 and leads the list.
    expect(runs[0].seq).toBe(26);
    expect(runs[0].trigger).toBe('run');
    expect(runs.map((run) => run.seq)).toEqual(Array.from({ length: 20 }, (_, i) => 26 - i));
    // Orphan stats sweep: stats for pruned runs are gone.
    const stats = await store.getTaskRunNodeStats(task.id, 'old_1');
    expect(stats).toEqual([]);
  });
});
