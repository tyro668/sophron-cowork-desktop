import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import { compilePrepWorkflowToFlow, parsePrepDsl } from '../src/shared/prep-dsl';

const tempRoots: string[] = [];
const stores: DataTaskStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function makeStore(): { store: DataTaskStore; dbPath: string; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-etl-'));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, 'workspace.duckdb');
  const store = createDataTaskStore(dbPath, { now: () => 1_780_000_000_000 });
  stores.push(store);
  return { store, dbPath, tempRoot };
}

/** Close the store so its DuckDB writes are checkpointed, then reopen it. */
function reopenStore(dbPath: string): DataTaskStore {
  stores.pop()?.close();
  const store = createDataTaskStore(dbPath, { now: () => 1_780_000_000_000 });
  stores.push(store);
  return store;
}

function writeCsv(tempRoot: string, name: string, content: string): string {
  const csvPath = path.join(tempRoot, name);
  fs.writeFileSync(csvPath, content, 'utf8');
  return csvPath;
}

async function readRows(dbPath: string, sql: string): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function saveCompiledDsl(store: DataTaskStore, taskId: string, dsl: string) {
  const parsed = parsePrepDsl(dsl);
  expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  const compiled = compilePrepWorkflowToFlow(parsed.ast!);
  expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  await store.saveTaskWorkflow(taskId, { nodes: compiled.nodes, edges: compiled.edges });
}

describe('ETL runtime contract', () => {
  it('mode merge by [key] upserts rows on business keys', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'orders.csv', 'order_id,amount\n1,10\n2,20\n3,30\n');
    const task = await store.createTask({ name: 'Merge orders', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | output table "orders_out" mode merge by [order_id]`
    );
    const first = await store.runTask(task.id);
    expect(first.status).toBe('completed');
    expect(first.rowCount).toBe(3);

    // mutate source: update order 2, add order 4
    fs.writeFileSync(csvPath, 'order_id,amount\n1,10\n2,99\n4,40\n', 'utf8');
    const second = await store.runTask(task.id);
    expect(second.status).toBe('completed');
    expect(second.rowCount).toBe(4);

    store = reopenStore(dbPath);
    const rows = await readRows(
      dbPath,
      'SELECT order_id, amount FROM orders_out ORDER BY order_id'
    );
    expect(rows).toEqual([
      { order_id: '1', amount: '10' },
      { order_id: '2', amount: '99' },
      { order_id: '3', amount: '30' },
      { order_id: '4', amount: '40' },
    ]);

    // merge is idempotent: replaying the same batch changes nothing
    const third = await store.runTask(task.id);
    expect(third.status).toBe('completed');
    expect(third.rowCount).toBe(4);
    store = reopenStore(dbPath);
    const rowsAfter = await readRows(
      dbPath,
      'SELECT order_id, amount FROM orders_out ORDER BY order_id'
    );
    expect(rowsAfter).toEqual(rows);
  });

  it('schema strict rejects drift, schema ignore drops new columns, extend adds them', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 's.csv', 'a,b\n1,x\n2,y\n');
    const task = await store.createTask({ name: 'Schema drift', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | output table "s_out" mode append`
    );
    await store.runTask(task.id);

    // strict: incoming has extra column -> fail before any write
    fs.writeFileSync(csvPath, 'a,b,c\n1,x,n1\n2,y,n2\n', 'utf8');
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | output table "s_out" mode append schema strict`
    );
    await expect(store.runTask(task.id)).rejects.toThrow(/schema drift|strict/i);
    store = reopenStore(dbPath);
    const afterStrict = await readRows(dbPath, 'SELECT * FROM s_out ORDER BY a');
    expect(afterStrict).toHaveLength(2);
    expect(Object.keys(afterStrict[0])).toEqual(['a', 'b']);

    // ignore: extra column dropped, rows still appended
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | output table "s_out" mode append schema ignore`
    );
    const ignored = await store.runTask(task.id);
    expect(ignored.rowCount).toBe(4);
    store = reopenStore(dbPath);
    const afterIgnore = await readRows(dbPath, 'SELECT * FROM s_out ORDER BY a');
    expect(afterIgnore).toEqual([
      { a: '1', b: 'x' },
      { a: '1', b: 'x' },
      { a: '2', b: 'y' },
      { a: '2', b: 'y' },
    ]);

    // extend: new column added, old rows null-filled
    fs.writeFileSync(csvPath, 'a,b,c\n5,p,q\n', 'utf8');
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | output table "s_out" mode append`
    );
    const extended = await store.runTask(task.id);
    expect(extended.rowCount).toBe(5);
    store = reopenStore(dbPath);
    const afterExtend = await readRows(dbPath, 'SELECT * FROM s_out ORDER BY a');
    expect(afterExtend[4]).toEqual({ a: '5', b: 'p', c: 'q' });
    expect(afterExtend[0].c).toBeNull();
  });

  it('expect fails the run on violations without reject stream', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'e.csv', 'id,amount\n1,10\n2,-5\n3,30\n');
    const task = await store.createTask({ name: 'Expect rows', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | expect [amount] > 0
        | output table "e_out" mode replace`
    );
    await expect(store.runTask(task.id)).rejects.toThrow(/expect|violat/i);
    // nothing committed
    const taskAfter = await store.getTask(task.id);
    expect(taskAfter?.status).toBe('failed');
  });

  it('expect ... reject to <stream> routes violating rows to a reject chain', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'r.csv', 'id,amount\n1,10\n2,-5\n3,-9\n4,40\n');
    const task = await store.createTask({ name: 'Reject stream', sourcePath: csvPath });
    // the reject stream feeds the only output sink; main stream stays dangling
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src

      step checked = src
        | expect [amount] > 0 reject to bad_rows

      step rejects = bad_rows
        | output table "rejects_out" mode replace`
    );
    const result = await store.runTaskWithDiagnostics(task.id);
    expect(result.task.status).toBe('completed');
    store = reopenStore(dbPath);
    const rejected = await readRows(dbPath, 'SELECT * FROM rejects_out ORDER BY id');
    expect(rejected).toEqual([
      { id: '2', amount: '-5' },
      { id: '3', amount: '-9' },
    ]);
    const expectStat = result.nodeStats?.find((stat) => stat.nodeType === 'expect');
    expect(expectStat).toBeTruthy();
    expect(expectStat?.inputRows).toBe(4);
    expect(expectStat?.outputRows).toBe(2);
    expect(expectStat?.rejectedRows).toBe(2);
    expect(expectStat?.sample?.length).toBeGreaterThan(0);
    expect(expectStat?.sample?.length).toBeLessThanOrEqual(5);
  });

  it('expect unique fails on duplicate keys and reports sample rows', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'u.csv', 'k,v\n1,a\n1,b\n2,c\n');
    const task = await store.createTask({ name: 'Unique keys', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | expect unique [k]
        | output table "u_out" mode replace`
    );
    await expect(store.runTask(task.id)).rejects.toThrow(/expect|violat|duplicate/i);
  });

  it('incremental by [col] reads only new rows and advances the watermark', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'w.csv', 'id,v\n1,a\n2,b\n');
    const task = await store.createTask({ name: 'Incremental', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task incremental by [id] as src
        | output table "w_out" mode append`
    );
    const first = await store.runTask(task.id);
    expect(first.rowCount).toBe(2);

    // close + reopen so a fresh DuckDB instance sees checkpointed writes
    store = store = reopenStore(dbPath);
    const wm1 = await readRows(
      dbPath,
      `SELECT watermark_value FROM data_task_watermarks WHERE task_id = '${task.id}'`
    );
    expect(wm1).toEqual([{ watermark_value: '2' }]);

    // new rows appended to the source file
    fs.writeFileSync(csvPath, 'id,v\n1,a\n2,b\n3,c\n4,d\n', 'utf8');
    const second = await store.runTaskWithDiagnostics(task.id);
    expect(second.task.rowCount).toBe(4);
    store = store = reopenStore(dbPath);
    const wm2 = await readRows(
      dbPath,
      `SELECT watermark_value FROM data_task_watermarks WHERE task_id = '${task.id}'`
    );
    expect(wm2).toEqual([{ watermark_value: '4' }]);

    // the input stat reflects the incremental filter: only 2 new rows read
    const inputStat = second.nodeStats?.find((stat) => stat.nodeType === 'input_source');
    expect(inputStat?.outputRows).toBe(2);

    // a third run with no new rows reads zero and still completes
    const third = await store.runTask(task.id);
    expect(third.status).toBe('completed');
    expect(third.rowCount).toBe(4);
  });

  it('does not advance the watermark when the run fails', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'wf.csv', 'id,amount\n1,10\n2,-5\n3,30\n');
    const task = await store.createTask({ name: 'Watermark rollback', sourcePath: csvPath });
    // first commit succeeds and advances the watermark to 3
    await saveCompiledDsl(
      store,
      task.id,
      `input source task incremental by [id] as src
        | output table "wf_out" mode append`
    );
    await store.runTask(task.id);
    // now the workflow gains a failing assertion; new rows appear but the run fails
    fs.writeFileSync(csvPath, 'id,amount\n1,10\n2,-5\n3,30\n4,-1\n', 'utf8');
    await saveCompiledDsl(
      store,
      task.id,
      `input source task incremental by [id] as src
        | expect [amount] > 0
        | output table "wf_out" mode append`
    );
    await expect(store.runTask(task.id)).rejects.toThrow(/expect|violat/i);
    store = reopenStore(dbPath);
    const wm = await readRows(
      dbPath,
      `SELECT watermark_value FROM data_task_watermarks WHERE task_id = '${task.id}'`
    );
    expect(wm).toEqual([{ watermark_value: '3' }]);
    // and the failed batch was not appended
    const rows = await readRows(dbPath, 'SELECT * FROM wf_out ORDER BY id');
    expect(rows).toHaveLength(3);
  });

  it('persists per-node stats including reject samples for later inspection', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 's2.csv', 'id,amount\n1,10\n2,-5\n3,30\n');
    const task = await store.createTask({ name: 'Stats persistence', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | expect [amount] > 0 reject to bad_rows
        | output table "s2_out" mode replace`
    );
    await store.runTask(task.id);
    const persisted = await store.getTaskNodeStats(task.id);
    const expectStat = persisted.find((stat) => stat.nodeType === 'expect');
    expect(expectStat?.rejectedRows).toBe(1);
    expect(expectStat?.sample?.[0]).toMatchObject({ id: '2' });
    // reopening the store still returns the latest run's stats
    store = reopenStore(dbPath);
    const reloaded = await store.getTaskNodeStats(task.id);
    expect(reloaded.find((stat) => stat.nodeType === 'expect')?.rejectedRows).toBe(1);
  });

  it('per-node stats report input/output/dropped rows on a filtering chain', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'n.csv', 'id,amount\n1,5\n2,50\n3,10\n4,60\n');
    const task = await store.createTask({ name: 'Node stats', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | filter [amount] > 20
        | deduplicate by [id]
        | output table "n_out" mode replace`
    );
    const result = await store.runTaskWithDiagnostics(task.id);
    expect(result.task.status).toBe('completed');
    const stats = result.nodeStats ?? [];
    const filterStat = stats.find((stat) => stat.nodeType === 'filter');
    expect(filterStat).toBeTruthy();
    expect(filterStat?.inputRows).toBe(4);
    expect(filterStat?.outputRows).toBe(2);
    expect(filterStat?.droppedRows).toBe(2);
    const dedupStat = stats.find((stat) => stat.nodeType === 'deduplicate');
    expect(dedupStat?.inputRows).toBe(2);
    expect(dedupStat?.outputRows).toBe(2);
    const outputStat = stats.find((stat) => stat.nodeType === 'output');
    expect(outputStat?.outputRows).toBe(2);
  });
});

describe('ETL runtime contract — review fixes', () => {
  it('expect expression routes NULL-evaluating rows to the reject stream', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    // row 2 has NULL amount: must land in rejects, not vanish from both streams
    const csvPath = writeCsv(tempRoot, 'nulls.csv', 'id,amount\n1,10\n2,\n3,-5\n4,20\n');
    const task = await store.createTask({ name: 'NULL expect', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | expect [amount] > 0 reject to bad
        | output table "nulls_out" mode replace
      step bad_out = bad
        | output table "nulls_bad" mode replace`
    );
    const run = await store.runTaskWithDiagnostics(task.id);
    expect(run.task.status).toBe('completed');
    store = reopenStore(dbPath);
    const good = await readRows(dbPath, 'SELECT id FROM nulls_out ORDER BY id');
    expect(good.map((r) => r.id)).toEqual(['1', '4']);
    const bad = await readRows(dbPath, 'SELECT id, amount FROM nulls_bad ORDER BY id');
    expect(bad.map((r) => r.id)).toEqual(['2', '3']);
    expect(bad[0]?.amount).toBeNull();
  });

  it('expect unique rejects repeated NULL keys', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'uniq.csv', 'k,v\n,a\n,b\n1,x\n1,y\n');
    const task = await store.createTask({ name: 'unique NULL', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | expect unique [k] reject to dup
        | output table "uniq_out" mode replace
      step dup_out = dup
        | output table "uniq_dup" mode replace`
    );
    await store.runTask(task.id);
    store = reopenStore(dbPath);
    const kept = await readRows(dbPath, 'SELECT count(*) AS n FROM uniq_out');
    // zero rows remain: every row violates (two NULL keys + two '1' keys)
    expect(Number(kept[0]?.n)).toBe(0);
    const rejected = await readRows(dbPath, 'SELECT count(*) AS n FROM uniq_dup');
    expect(Number(rejected[0]?.n)).toBe(4);
  });

  it('merge is idempotent for NULL business keys and dedupes duplicate keys per batch', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    // duplicate key 2 in the same batch: last row (200) must win
    const csvPath = writeCsv(tempRoot, 'mk.csv', 'k,v\n1,a\n,dup_null\n2,100\n2,200\n');
    const task = await store.createTask({ name: 'merge NULL keys', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | output table "mk_out" mode merge by [k]`
    );
    const first = await store.runTask(task.id);
    expect(first.status).toBe('completed');
    expect(first.rowCount).toBe(3);
    // rerun identical batch: NULL key must not duplicate
    const second = await store.runTask(task.id);
    expect(second.rowCount).toBe(3);
    store = reopenStore(dbPath);
    const rows = await readRows(dbPath, 'SELECT k, v FROM mk_out ORDER BY k NULLS LAST, v');
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.k === '2').map((r) => r.v)).toEqual(['200']);
    expect(rows.filter((r) => r.k === null)).toHaveLength(1);
  });

  it('switching incrementalBy ignores the watermark stored for a different column', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'wm.csv', 'id,updated\n1,100\n2,200\n');
    const task = await store.createTask({ name: 'wm column', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task incremental by [updated] as src
        | output table "wm_out" mode replace`
    );
    await store.runTask(task.id);
    // switch the watermark column: must not reuse the `updated` watermark for `id`
    await saveCompiledDsl(
      store,
      task.id,
      `input source task incremental by [id] as src
        | output table "wm_out" mode replace`
    );
    const run = await store.runTask(task.id);
    expect(run.status).toBe('completed');
    store = reopenStore(dbPath);
    const rows = await readRows(dbPath, 'SELECT count(*) AS n FROM wm_out');
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('writes every output sink in a multi-output workflow', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'multi.csv', 'id,amount\n1,10\n2,99\n');
    const task = await store.createTask({ name: 'multi sink', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
      step full = src
        | output table "multi_all" mode replace
      step big = src
        | filter [amount] > 50
        | output table "multi_big" mode replace`
    );
    const run = await store.runTask(task.id);
    expect(run.status).toBe('completed');
    store = reopenStore(dbPath);
    const all = await readRows(dbPath, 'SELECT count(*) AS n FROM multi_all');
    const big = await readRows(dbPath, 'SELECT id FROM multi_big');
    expect(Number(all[0]?.n)).toBe(2);
    expect(big.map((r) => r.id)).toEqual(['2']);
  });

  it('save rejects malformed operator configs via shared config diagnostics', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'cfg.csv', 'id,amount\n1,10\n');
    const task = await store.createTask({ name: 'bad config', sourcePath: csvPath });
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl(`input source task as src\n  | sort by [id]`).ast!
    );
    // corrupt the compiled sort config: direction must be asc|desc
    const sortNode = compiled.nodes.find((node) => node.type === 'sort')!;
    sortNode.config = { keys: [{ field: 'id', direction: 'sideways' }] };
    await expect(
      store.saveTaskWorkflow(task.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/direction|invalid|enum/i);
  });
});

describe('ETL runtime contract — commit safety fixes', () => {
  it('rejects two output sinks that resolve to the same target', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'dup_sink.csv', 'id,v\n1,a\n2,b\n');
    const task = await store.createTask({ name: 'dup sinks', sourcePath: csvPath });
    // both sinks write the same table name -> must be rejected at save time
    await expect(
      saveCompiledDsl(
        store,
        task.id,
        `input source task as src
        step a = src
          | output table "same_table" mode replace
        step b = src
          | output table "same_table" mode replace`
      )
    ).rejects.toThrow(/same table|duplicate|target/i);
  });

  it('rejects an invalid output mode at save time', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'mode.csv', 'id\n1\n');
    const task = await store.createTask({ name: 'bad mode', sourcePath: csvPath });
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl('input source task as src\n  | output table "m_out" mode replace').ast!
    );
    const outputNode = compiled.nodes.find((node) => node.type === 'output')!;
    outputNode.config = { ...outputNode.config, mode: 'upsert_everything' };
    await expect(
      store.saveTaskWorkflow(task.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/mode/i);
  });

  it('failed expect runs persist rejectedRows and the violating sample', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'fail_expect.csv', 'id,amount\n1,10\n2,-5\n3,-9\n');
    const task = await store.createTask({ name: 'failing expect', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      task.id,
      `input source task as src
        | expect [amount] > 0
        | output table "fe_out" mode replace`
    );
    const run = await store.runTaskWithDiagnostics(task.id).catch((error: Error) => error);
    expect(run).toBeInstanceOf(Error);
    const stats = await store.getTaskNodeStats(task.id);
    const expectStat = stats.find((stat) => stat.nodeType === 'expect');
    expect(expectStat?.rejectedRows).toBe(2);
    expect(expectStat?.sample?.length).toBe(2);
    expect(expectStat?.sample?.[0]).toMatchObject({ id: '2' });
  });
});

describe('ETL runtime contract — validation consistency', () => {
  it('rejects expect rows ... reject to (row counts have no rows to route)', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'rows_reject.csv', 'id\n1\n');
    const task = await store.createTask({ name: 'rows reject', sourcePath: csvPath });
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl(
        'input source task as src\n  | expect rows >= 1 reject to bad\n  | output table "x" mode replace'
      ).ast!
    );
    const expectNode = compiled.nodes.find((node) => node.type === 'expect')!;
    expectNode.config = {
      ...expectNode.config,
      kind: 'row_count',
      operator: '>=',
      value: 1,
      rejectStream: 'bad',
    };
    await expect(
      store.saveTaskWorkflow(task.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/reject/i);
  });

  it('rejects output dataset/file destinations and mergeKeys without merge at save', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'dest.csv', 'id\n1\n');
    const task = await store.createTask({ name: 'bad dest', sourcePath: csvPath });
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl('input source task as src\n  | output table "d_out" mode replace').ast!
    );
    const outputNode = compiled.nodes.find((node) => node.type === 'output')!;
    outputNode.config = { ...outputNode.config, destination: 'dataset' };
    await expect(
      store.saveTaskWorkflow(task.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/destination/i);
    outputNode.config = { table: 'd_out', mergeKeys: ['id'] };
    await expect(
      store.saveTaskWorkflow(task.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/merge/i);
  });

  it('catches duplicate targets across mixed binding styles (fallback vs datasetId)', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'mix.csv', 'id\n1\n');
    const outputTable = await store.createOutputTable({ name: 'bound_out' });
    // task bound to the output table: the unnamed first sink falls back to it
    const task = await store.createTask({
      name: 'mixed sinks',
      sourcePath: csvPath,
      outputTableId: outputTable.id,
    });
    const compiled = compilePrepWorkflowToFlow(
      parsePrepDsl(
        `input source task as src
        step a = src
          | output table "task_out" mode replace
        step b = src
          | output table "other_out" mode replace`
      ).ast!
    );
    const outA = compiled.nodes.find((n) => n.type === 'output' && n.config.table === 'task_out')!;
    // strip the name so sink A resolves to the task's bound output table...
    outA.config = { ...outA.config };
    delete outA.config.table;
    // ...and point sink B at the same physical table via outputDatasetId
    const outB = compiled.nodes.find((n) => n.type === 'output' && n.config.table === 'other_out')!;
    outB.config = { ...outB.config, outputDatasetId: outputTable.id };
    delete outB.config.table;
    await expect(
      store.saveTaskWorkflow(task.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/same target|duplicate/i);
  });
});
