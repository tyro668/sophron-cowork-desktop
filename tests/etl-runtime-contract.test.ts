import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import { compileTestJflow, parseTestJflow } from './helpers/jflow-test-workflow';
import type { DataWorkflowEdgeInput, DataWorkflowNodeInput } from '../src/shared/contracts';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function makeStore(): { store: DataPipelineStore; dbPath: string; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-etl-'));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, 'workspace.duckdb');
  const store = createDataPipelineStore(dbPath, { now: () => 1_780_000_000_000 });
  stores.push(store);
  return { store, dbPath, tempRoot };
}

/** Close the store so its DuckDB writes are checkpointed, then reopen it. */
function reopenStore(dbPath: string): DataPipelineStore {
  stores.pop()?.close();
  const store = createDataPipelineStore(dbPath, { now: () => 1_780_000_000_000 });
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

type TestGraph = { nodes: DataWorkflowNodeInput[]; edges: DataWorkflowEdgeInput[] };

/** Saves jflow text, or an operator graph for runtime features jflow R1 cannot express yet. */
async function saveCompiledDsl(
  store: DataPipelineStore,
  pipelineId: string,
  dsl: string | TestGraph
) {
  if (typeof dsl !== 'string') {
    await store.savePipelineWorkflow(pipelineId, dsl);
    return;
  }
  const parsed = parseTestJflow(dsl);
  expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  const compiled = compileTestJflow(parsed.ast!);
  expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  await store.savePipelineWorkflow(pipelineId, { nodes: compiled.nodes, edges: compiled.edges });
}

describe('ETL runtime contract', () => {
  it('mode merge by [key] upserts rows on business keys', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'orders.csv', 'order_id,amount\n1,10\n2,20\n3,30\n');
    const pipeline = await store.createPipeline({ name: 'Merge orders', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | write @new('orders_out') mode: merge keys: [order_id]
    `
    );
    const first = await store.runPipeline(pipeline.id);
    expect(first.status).toBe('completed');
    expect(first.rowCount).toBe(3);

    // mutate source: update order 2, add order 4
    fs.writeFileSync(csvPath, 'order_id,amount\n1,10\n2,99\n4,40\n', 'utf8');
    const second = await store.runPipeline(pipeline.id);
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
    const third = await store.runPipeline(pipeline.id);
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
    const pipeline = await store.createPipeline({ name: 'Schema drift', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | write @new('s_out') mode: append
    `
    );
    await store.runPipeline(pipeline.id);

    // strict: incoming has extra column -> fail before any write
    fs.writeFileSync(csvPath, 'a,b,c\n1,x,n1\n2,y,n2\n', 'utf8');
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | write @new('s_out') mode: append schema: strict
    `
    );
    await expect(store.runPipeline(pipeline.id)).rejects.toThrow(/schema drift|strict/i);
    store = reopenStore(dbPath);
    const afterStrict = await readRows(dbPath, 'SELECT * FROM s_out ORDER BY a');
    expect(afterStrict).toHaveLength(2);
    expect(Object.keys(afterStrict[0])).toEqual(['a', 'b']);

    // ignore: extra column dropped, rows still appended
    await saveCompiledDsl(
      store,
      pipeline.id,
      /* input pipeline as src… — not expressible in jflow R1 */ {
        nodes: [
          {
            id: 'source_src',
            type: 'input',
            label: 'input',
            x: 64,
            y: 72,
            config: { source: 'pipeline', alias: 'src' },
          },
          {
            id: 'output_main',
            type: 'output',
            label: 'output',
            x: 264,
            y: 72,
            config: {
              destination: 'duckdb_table',
              table: 's_out',
              mode: 'append',
              schemaPolicy: 'ignore',
            },
          },
        ],
        edges: [
          {
            id: 'edge_source_src_output_main_input',
            sourceNodeId: 'source_src',
            targetNodeId: 'output_main',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
        ],
      }
    );
    const ignored = await store.runPipeline(pipeline.id);
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
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | write @new('s_out') mode: append
    `
    );
    const extended = await store.runPipeline(pipeline.id);
    expect(extended.rowCount).toBe(5);
    store = reopenStore(dbPath);
    const afterExtend = await readRows(dbPath, 'SELECT * FROM s_out ORDER BY a');
    expect(afterExtend[4]).toEqual({ a: '5', b: 'p', c: 'q' });
    expect(afterExtend[0].c).toBeNull();
  });

  it('expect fails the run on violations without reject stream', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'e.csv', 'id,amount\n1,10\n2,-5\n3,30\n');
    const pipeline = await store.createPipeline({ name: 'Expect rows', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | check [amount] > 0
        | write @new('e_out')
    `
    );
    await expect(store.runPipeline(pipeline.id)).rejects.toThrow(/expect|violat/i);
    // nothing committed
    const pipelineAfter = await store.getPipeline(pipeline.id);
    expect(pipelineAfter?.status).toBe('failed');
  });

  it('temporary expect failure returns structured stats and violation samples', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'et.csv', 'id,amount\n1,10\n2,-5\n3,-9\n4,40\n');
    const pipeline = await store.createPipeline({ name: 'Temporary expect', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | check [amount] > 0
        | write @new('et_out')
    `
    );
    // Temporary runs never persist stats — the failed run comes back as a
    // structured result carrying the stats/samples collected so far.
    const result = await store.runPipelineWithDiagnostics(pipeline.id, { outputMode: 'temporary' });
    expect(result.failure?.message).toMatch(/expect/i);
    const expectStat = result.nodeStats?.find((stat) => stat.nodeType === 'expect');
    expect(expectStat?.rejectedRows).toBe(2);
    expect(expectStat?.sample?.length).toBeGreaterThan(0);
    // runPipeline keeps the throwing contract for non-diagnostics callers.
    await expect(store.runPipeline(pipeline.id, { outputMode: 'temporary' })).rejects.toThrow(
      /expect/i
    );
  });

  it('expect ... reject to <stream> routes violating rows to a reject chain', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'r.csv', 'id,amount\n1,10\n2,-5\n3,-9\n4,40\n');
    const pipeline = await store.createPipeline({ name: 'Reject stream', sourcePath: csvPath });
    // the reject stream feeds the only output sink; main stream stays dangling
    await saveCompiledDsl(
      store,
      pipeline.id,
      /* input pipeline as src… — not expressible in jflow R1 */ {
        nodes: [
          {
            id: 'source_src',
            type: 'input',
            label: 'input',
            x: 64,
            y: 72,
            config: { source: 'pipeline', alias: 'src' },
          },
          {
            id: 'checked_1',
            type: 'expect',
            label: 'expect',
            x: 264,
            y: 72,
            config: {
              kind: 'expression',
              expression: '[amount] > 0',
              rejectStream: 'bad_rows',
              stepName: 'checked',
            },
          },
          {
            id: 'output_rejects',
            type: 'output',
            label: 'output',
            x: 464,
            y: 72,
            config: { destination: 'duckdb_table', table: 'rejects_out', mode: 'replace' },
          },
        ],
        edges: [
          {
            id: 'edge_source_src_checked_1_input',
            sourceNodeId: 'source_src',
            targetNodeId: 'checked_1',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
          {
            id: 'edge_checked_1_reject_output_rejects_input',
            sourceNodeId: 'checked_1',
            targetNodeId: 'output_rejects',
            sourceHandle: 'reject',
            targetHandle: 'input',
          },
        ],
      }
    );
    const result = await store.runPipelineWithDiagnostics(pipeline.id);
    expect(result.pipeline.status).toBe('completed');
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
    const pipeline = await store.createPipeline({ name: 'Unique keys', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | check unique [k]
        | write @new('u_out')
    `
    );
    await expect(store.runPipeline(pipeline.id)).rejects.toThrow(/expect|violat|duplicate/i);
  });

  it('incremental by [col] reads only new rows and advances the watermark', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'w.csv', 'id,v\n1,a\n2,b\n');
    const pipeline = await store.createPipeline({ name: 'Incremental', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self') incremental: [id]

      src
        | write @new('w_out') mode: append
    `
    );
    const first = await store.runPipeline(pipeline.id);
    expect(first.rowCount).toBe(2);

    // close + reopen so a fresh DuckDB instance sees checkpointed writes
    store = store = reopenStore(dbPath);
    const wm1 = await readRows(
      dbPath,
      `SELECT watermark_value FROM data_pipeline_watermarks WHERE pipeline_id = '${pipeline.id}'`
    );
    expect(wm1).toEqual([{ watermark_value: '2' }]);

    // new rows appended to the source file
    fs.writeFileSync(csvPath, 'id,v\n1,a\n2,b\n3,c\n4,d\n', 'utf8');
    const second = await store.runPipelineWithDiagnostics(pipeline.id);
    expect(second.pipeline.rowCount).toBe(4);
    store = store = reopenStore(dbPath);
    const wm2 = await readRows(
      dbPath,
      `SELECT watermark_value FROM data_pipeline_watermarks WHERE pipeline_id = '${pipeline.id}'`
    );
    expect(wm2).toEqual([{ watermark_value: '4' }]);

    // the input stat reflects the incremental filter: only 2 new rows read
    const inputStat = second.nodeStats?.find((stat) => stat.nodeType === 'input');
    expect(inputStat?.outputRows).toBe(2);

    // a third run with no new rows reads zero and still completes
    const third = await store.runPipeline(pipeline.id);
    expect(third.status).toBe('completed');
    expect(third.rowCount).toBe(4);
  });

  it('incremental on a bound input table appends only new rows across file updates', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const v1 = writeCsv(
      tempRoot,
      'att-v1.csv',
      'day,emp,status\n2026-09-01,E1,ok\n2026-09-02,E1,absent\n'
    );
    const v2 = writeCsv(
      tempRoot,
      'att-v2.csv',
      'day,emp,status\n2026-09-01,E1,ok\n2026-09-02,E1,absent\n2026-10-08,E1,absent\n2026-10-08,E2,ok\n'
    );
    const rawTable = await store.importRawTable({ filePath: v1 });
    const pipeline = await store.createPipeline({ name: 'Raw incremental' });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:raw/${rawTable.id}') incremental: [day]

      src
        | write @new('raw_incr_out') mode: append
    `
    );
    const workflow = await store.getPipelineWorkflow(pipeline.id);
    expect(workflow.nodes.find((n) => n.type === 'input')?.config.incrementalBy).toBe('day');

    const first = await store.runPipeline(pipeline.id);
    expect(first.rowCount).toBe(2);
    // re-running without new data must not re-append
    const rerun = await store.runPipelineWithDiagnostics(pipeline.id);
    expect(rerun.nodeStats?.find((stat) => stat.nodeType === 'input')?.outputRows).toBe(0);
    expect(rerun.pipeline.rowCount).toBe(2);

    await store.updateRawTable({ id: rawTable.id, filePath: v2 });
    const second = await store.runPipelineWithDiagnostics(pipeline.id);
    expect(second.nodeStats?.find((stat) => stat.nodeType === 'input')?.outputRows).toBe(2);
    expect(second.pipeline.rowCount).toBe(4);

    store = reopenStore(dbPath);
    const rows = await readRows(dbPath, 'SELECT count(*) AS n FROM raw_incr_out');
    expect(Number(rows[0].n)).toBe(4);
    const watermarks = await readRows(
      dbPath,
      `SELECT watermark_value, source_fingerprint FROM data_pipeline_watermarks WHERE pipeline_id = '${pipeline.id}'`
    );
    expect(watermarks).toHaveLength(1);
    expect(String(watermarks[0].watermark_value)).toContain('2026-10-08');
    expect(String(watermarks[0].source_fingerprint)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects incremental on a bound input table with replace output or an unknown column', async () => {
    const { store, tempRoot } = makeStore();
    const csv = writeCsv(tempRoot, 'r.csv', 'id,v\n1,a\n');
    const rawTable = await store.importRawTable({ filePath: csv });
    const parsed = parseTestJflow(`
      source src = @id('local:raw/${rawTable.id}') incremental: [id]

      src
        | write @new('raw_incr_replace') mode: replace
    `);
    let codes: string[] = [];
    try {
      codes = compileTestJflow(parsed.ast!).diagnostics.map((d) => d.code);
    } catch (error) {
      codes = [String((error as { code?: string }).code ?? error)];
    }
    expect(codes.join(',')).toMatch(/E_INCR_REPLACE/);
    expect(codes).not.toContain('W_INCR_IGNORED');

    const pipeline = await store.createPipeline({ name: 'Raw incremental invalid' });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:raw/${rawTable.id}')

      src
        | write @new('raw_incr_missing') mode: append
    `
    );
    const workflow = await store.getPipelineWorkflow(pipeline.id);
    await expect(
      store.savePipelineWorkflow(pipeline.id, {
        nodes: workflow.nodes.map((node) =>
          node.type === 'input'
            ? { ...node, config: { ...node.config, incrementalBy: 'missing_col' } }
            : node
        ),
        edges: workflow.edges,
      })
    ).rejects.toThrow(/missing_col/);
  });

  it('refuses replace output with an incremental bound input table at save and at run', async () => {
    const { store, tempRoot } = makeStore();
    const csv = writeCsv(tempRoot, 'r.csv', 'id,v\n1,a\n2,b\n');
    const rawTable = await store.importRawTable({ filePath: csv });
    const pipeline = await store.createPipeline({ name: 'Raw incremental replace' });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:raw/${rawTable.id}') incremental: [id]

      src
        | write @new('raw_incr_rep') mode: append
    `
    );
    const first = await store.runPipeline(pipeline.id);
    expect(first.rowCount).toBe(2);
    const workflow = await store.getPipelineWorkflow(pipeline.id);
    const replaced = workflow.nodes.map((node) =>
      node.type === 'output' ? { ...node, config: { ...node.config, mode: 'replace' } } : node
    );
    await expect(
      store.savePipelineWorkflow(pipeline.id, { nodes: replaced, edges: workflow.edges })
    ).rejects.toThrow(/E_INCR_REPLACE/);
    // A run handed the same graph directly (e.g. an unsaved draft) is refused too, and the
    // existing result table keeps its rows.
    await expect(
      store.runPipeline(pipeline.id, { workflow: { nodes: replaced, edges: workflow.edges } })
    ).rejects.toThrow(/E_INCR_REPLACE/);
    const after = await store.getPipeline(pipeline.id);
    expect(after?.rowCount).toBe(2);
  });

  it('does not advance the watermark when the run fails', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'wf.csv', 'id,amount\n1,10\n2,-5\n3,30\n');
    const pipeline = await store.createPipeline({
      name: 'Watermark rollback',
      sourcePath: csvPath,
    });
    // first commit succeeds and advances the watermark to 3
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self') incremental: [id]

      src
        | write @new('wf_out') mode: append
    `
    );
    await store.runPipeline(pipeline.id);
    // now the workflow gains a failing assertion; new rows appear but the run fails
    fs.writeFileSync(csvPath, 'id,amount\n1,10\n2,-5\n3,30\n4,-1\n', 'utf8');
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self') incremental: [id]

      src
        | check [amount] > 0
        | write @new('wf_out') mode: append
    `
    );
    await expect(store.runPipeline(pipeline.id)).rejects.toThrow(/expect|violat/i);
    store = reopenStore(dbPath);
    const wm = await readRows(
      dbPath,
      `SELECT watermark_value FROM data_pipeline_watermarks WHERE pipeline_id = '${pipeline.id}'`
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
    const pipeline = await store.createPipeline({ name: 'Stats persistence', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      /* input pipeline as src… — not expressible in jflow R1 */ {
        nodes: [
          {
            id: 'source_src',
            type: 'input',
            label: 'input',
            x: 64,
            y: 72,
            config: { source: 'pipeline', alias: 'src' },
          },
          {
            id: 'main_1',
            type: 'expect',
            label: 'expect',
            x: 264,
            y: 72,
            config: { kind: 'expression', expression: '[amount] > 0', rejectStream: 'bad_rows' },
          },
          {
            id: 'output_main',
            type: 'output',
            label: 'output',
            x: 464,
            y: 72,
            config: { destination: 'duckdb_table', table: 's2_out', mode: 'replace' },
          },
        ],
        edges: [
          {
            id: 'edge_source_src_main_1_input',
            sourceNodeId: 'source_src',
            targetNodeId: 'main_1',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
          {
            id: 'edge_main_1_output_main_input',
            sourceNodeId: 'main_1',
            targetNodeId: 'output_main',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
        ],
      }
    );
    await store.runPipeline(pipeline.id);
    const persisted = await store.getPipelineNodeStats(pipeline.id);
    const expectStat = persisted.find((stat) => stat.nodeType === 'expect');
    expect(expectStat?.rejectedRows).toBe(1);
    expect(expectStat?.sample?.[0]).toMatchObject({ id: '2' });
    // reopening the store still returns the latest run's stats
    store = reopenStore(dbPath);
    const reloaded = await store.getPipelineNodeStats(pipeline.id);
    expect(reloaded.find((stat) => stat.nodeType === 'expect')?.rejectedRows).toBe(1);
  });

  it('per-node stats report input/output/dropped rows on a filtering chain', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'n.csv', 'id,amount\n1,5\n2,50\n3,10\n4,60\n');
    const pipeline = await store.createPipeline({ name: 'Node stats', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | where [amount] > 20
        | distinct by: [id]
        | write @new('n_out')
    `
    );
    const result = await store.runPipelineWithDiagnostics(pipeline.id);
    expect(result.pipeline.status).toBe('completed');
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
    const pipeline = await store.createPipeline({ name: 'NULL expect', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      /* input pipeline as src… — not expressible in jflow R1 */ {
        nodes: [
          {
            id: 'source_src',
            type: 'input',
            label: 'input',
            x: 64,
            y: 72,
            config: { source: 'pipeline', alias: 'src' },
          },
          {
            id: 'main_1',
            type: 'expect',
            label: 'expect',
            x: 264,
            y: 72,
            config: { kind: 'expression', expression: '[amount] > 0', rejectStream: 'bad' },
          },
          {
            id: 'output_main',
            type: 'output',
            label: 'output',
            x: 464,
            y: 72,
            config: { destination: 'duckdb_table', table: 'nulls_out', mode: 'replace' },
          },
          {
            id: 'output_bad_out',
            type: 'output',
            label: 'output',
            x: 664,
            y: 72,
            config: { destination: 'duckdb_table', table: 'nulls_bad', mode: 'replace' },
          },
        ],
        edges: [
          {
            id: 'edge_source_src_main_1_input',
            sourceNodeId: 'source_src',
            targetNodeId: 'main_1',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
          {
            id: 'edge_main_1_output_main_input',
            sourceNodeId: 'main_1',
            targetNodeId: 'output_main',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
          {
            id: 'edge_main_1_reject_output_bad_out_input',
            sourceNodeId: 'main_1',
            targetNodeId: 'output_bad_out',
            sourceHandle: 'reject',
            targetHandle: 'input',
          },
        ],
      }
    );
    const run = await store.runPipelineWithDiagnostics(pipeline.id);
    expect(run.pipeline.status).toBe('completed');
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
    const pipeline = await store.createPipeline({ name: 'unique NULL', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      /* input pipeline as src… — not expressible in jflow R1 */ {
        nodes: [
          {
            id: 'source_src',
            type: 'input',
            label: 'input',
            x: 64,
            y: 72,
            config: { source: 'pipeline', alias: 'src' },
          },
          {
            id: 'main_1',
            type: 'expect',
            label: 'expect',
            x: 264,
            y: 72,
            config: { kind: 'unique', fields: ['k'], rejectStream: 'dup' },
          },
          {
            id: 'output_main',
            type: 'output',
            label: 'output',
            x: 464,
            y: 72,
            config: { destination: 'duckdb_table', table: 'uniq_out', mode: 'replace' },
          },
          {
            id: 'output_dup_out',
            type: 'output',
            label: 'output',
            x: 664,
            y: 72,
            config: { destination: 'duckdb_table', table: 'uniq_dup', mode: 'replace' },
          },
        ],
        edges: [
          {
            id: 'edge_source_src_main_1_input',
            sourceNodeId: 'source_src',
            targetNodeId: 'main_1',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
          {
            id: 'edge_main_1_output_main_input',
            sourceNodeId: 'main_1',
            targetNodeId: 'output_main',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
          {
            id: 'edge_main_1_reject_output_dup_out_input',
            sourceNodeId: 'main_1',
            targetNodeId: 'output_dup_out',
            sourceHandle: 'reject',
            targetHandle: 'input',
          },
        ],
      }
    );
    await store.runPipeline(pipeline.id);
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
    const pipeline = await store.createPipeline({ name: 'merge NULL keys', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | write @new('mk_out') mode: merge keys: [k]
    `
    );
    const first = await store.runPipeline(pipeline.id);
    expect(first.status).toBe('completed');
    expect(first.rowCount).toBe(3);
    // rerun identical batch: NULL key must not duplicate
    const second = await store.runPipeline(pipeline.id);
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
    const pipeline = await store.createPipeline({ name: 'wm column', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self') incremental: [updated]

      src
        | write @new('wm_out') mode: append
    `
    );
    await store.runPipeline(pipeline.id);
    // switch the watermark column: must not reuse the `updated` watermark for `id`
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self') incremental: [id]

      src
        | write @new('wm_out') mode: append
    `
    );
    const run = await store.runPipeline(pipeline.id);
    expect(run.status).toBe('completed');
    store = reopenStore(dbPath);
    const rows = await readRows(dbPath, 'SELECT count(*) AS n FROM wm_out');
    // append: both rows are read again under the new column (a reused watermark would add 0)
    expect(Number(rows[0]?.n)).toBe(4);
  });

  it('writes every output sink in a multi-output workflow', async () => {
    const { store: initialStore, dbPath, tempRoot } = makeStore();
    let store = initialStore;
    const csvPath = writeCsv(tempRoot, 'multi.csv', 'id,amount\n1,10\n2,99\n');
    const pipeline = await store.createPipeline({ name: 'multi sink', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | write @new('multi_all')

      src
        | where [amount] > 50
        | write @new('multi_big')
    `
    );
    const run = await store.runPipeline(pipeline.id);
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
    const pipeline = await store.createPipeline({ name: 'bad config', sourcePath: csvPath });
    const compiled = compileTestJflow(
      parseTestJflow(`
      source src = @id('local:pipeline/self')

      src
        | sort [id]
    `).ast!
    );
    // corrupt the compiled sort config: direction must be asc|desc
    const sortNode = compiled.nodes.find((node) => node.type === 'sort')!;
    sortNode.config = { orderBy: [{ field: 'id', direction: 'sideways' }] };
    await expect(
      store.savePipelineWorkflow(pipeline.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/direction|invalid|enum/i);
  });
});

describe('ETL runtime contract — commit safety fixes', () => {
  it('rejects two output sinks that resolve to the same target', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'dup_sink.csv', 'id,v\n1,a\n2,b\n');
    const pipeline = await store.createPipeline({ name: 'dup sinks', sourcePath: csvPath });
    // both sinks write the same table name -> must be rejected at save time
    await expect(
      saveCompiledDsl(
        store,
        pipeline.id,
        `
      source src = @id('local:pipeline/self')

      src
        | write @new('same_table')

      src
        | write @new('same_table')
    `
      )
    ).rejects.toThrow(/same table|duplicate|target/i);
  });

  it('rejects an invalid output mode at save time', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'mode.csv', 'id\n1\n');
    const pipeline = await store.createPipeline({ name: 'bad mode', sourcePath: csvPath });
    const compiled = compileTestJflow(
      parseTestJflow(`
      source src = @id('local:pipeline/self')

      src
        | write @new('m_out')
    `).ast!
    );
    const outputNode = compiled.nodes.find((node) => node.type === 'output')!;
    outputNode.config = { ...outputNode.config, mode: 'upsert_everything' };
    await expect(
      store.savePipelineWorkflow(pipeline.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/mode/i);
  });

  it('failed expect runs persist rejectedRows and the violating sample', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'fail_expect.csv', 'id,amount\n1,10\n2,-5\n3,-9\n');
    const pipeline = await store.createPipeline({ name: 'failing expect', sourcePath: csvPath });
    await saveCompiledDsl(
      store,
      pipeline.id,
      `
      source src = @id('local:pipeline/self')

      src
        | check [amount] > 0
        | write @new('fe_out')
    `
    );
    const run = await store.runPipelineWithDiagnostics(pipeline.id).catch((error: Error) => error);
    expect(run).toBeInstanceOf(Error);
    const stats = await store.getPipelineNodeStats(pipeline.id);
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
    const pipeline = await store.createPipeline({ name: 'rows reject', sourcePath: csvPath });
    const compiled = compileTestJflow(
      parseTestJflow(
        "source src = @id('local:pipeline/self')\nsrc\n  | check rows >= 1\n  | write @new('x')\n"
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
      store.savePipelineWorkflow(pipeline.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/reject/i);
  });

  it('rejects output rawTable/file destinations and mergeKeys without merge at save', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'dest.csv', 'id\n1\n');
    const pipeline = await store.createPipeline({ name: 'bad dest', sourcePath: csvPath });
    const compiled = compileTestJflow(
      parseTestJflow(`
      source src = @id('local:pipeline/self')

      src
        | write @new('d_out')
    `).ast!
    );
    const outputNode = compiled.nodes.find((node) => node.type === 'output')!;
    outputNode.config = { ...outputNode.config, destination: 'rawTable' };
    await expect(
      store.savePipelineWorkflow(pipeline.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/destination/i);
    outputNode.config = { table: 'd_out', mergeKeys: ['id'] };
    await expect(
      store.savePipelineWorkflow(pipeline.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/merge/i);
  });

  it('catches duplicate targets across mixed binding styles (fallback vs rawTableId)', async () => {
    const { store, tempRoot } = makeStore();
    const csvPath = writeCsv(tempRoot, 'mix.csv', 'id\n1\n');
    const resultTable = await store.createResultTable({ name: 'bound_out' });
    // pipeline bound to the output table: the unnamed first sink falls back to it
    const pipeline = await store.createPipeline({
      name: 'mixed sinks',
      sourcePath: csvPath,
      resultTableId: resultTable.id,
    });
    const compiled = compileTestJflow(
      parseTestJflow(
        `
      source src = @id('local:pipeline/self')

      src
        | write @new('task_out')

      src
        | write @new('other_out')
    `
      ).ast!
    );
    const outA = compiled.nodes.find((n) => n.type === 'output' && n.config?.table === 'task_out')!;
    // strip the name so sink A resolves to the pipeline's bound output table...
    outA.config = { ...outA.config };
    delete outA.config.table;
    // ...and point sink B at the same physical table via outputResultTableId
    const outB = compiled.nodes.find(
      (n) => n.type === 'output' && n.config?.table === 'other_out'
    )!;
    outB.config = { ...outB.config, outputResultTableId: resultTable.id };
    delete outB.config.table;
    await expect(
      store.savePipelineWorkflow(pipeline.id, { nodes: compiled.nodes, edges: compiled.edges })
    ).rejects.toThrow(/same target|duplicate/i);
  });
});
