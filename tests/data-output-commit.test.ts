import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import { app } from 'electron';
import { closeDatabase, initDatabase } from '../src/main/db/database';
import { DataStoreContext } from '../src/main/data/store/data-store-context';
import type { DataWorkflowSaveInput } from '../src/shared/contracts';

const stores: DataPipelineStore[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  closeDatabase();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function workflowForOutput(outputResultTableId: string): DataWorkflowSaveInput {
  return {
    nodes: [
      {
        id: 'source',
        type: 'input',
        label: 'source',
        x: 0,
        y: 0,
        config: { source: 'pipeline' },
      },
      {
        id: 'output',
        type: 'output',
        label: 'output',
        x: 0,
        y: 0,
        config: { outputResultTableId },
      },
    ],
    edges: [{ id: 'edge', sourceNodeId: 'source', targetNodeId: 'output' }],
  };
}

describe('validated pipeline output commit', () => {
  it('rolls back ETL metadata and DuckDB output while preserving a concurrent chat message', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-output-commit-'));
    tempRoots.push(root);
    const oldSource = path.join(root, 'old.csv');
    const newSource = path.join(root, 'new.csv');
    fs.writeFileSync(oldSource, 'id,value\n1,old\n', 'utf8');
    fs.writeFileSync(newSource, 'id,value\n2,new\n3,another\n', 'utf8');

    vi.spyOn(app, 'getPath').mockReturnValue(root);
    const db = initDatabase();
    db.exec(
      "INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('chat', 'Chat', 1, 1)"
    );
    const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'), { metadataDb: db });
    stores.push(store);
    const committedOutputs: string[][] = [];
    store.setOutputCommitListener((ids) => committedOutputs.push(ids));
    const output = await store.createResultTable({ name: 'Atomic output' });
    const pipeline = await store.createPipeline({ name: 'Atomic output', sourcePath: oldSource });
    const workflow = workflowForOutput(output.id);

    await store.runPipeline(pipeline.id, { sourcePath: oldSource, workflow });
    expect(committedOutputs).toHaveLength(1);
    expect(committedOutputs[0]).toHaveLength(1);
    committedOutputs.length = 0;
    const validated = await store.validatePipelineWorkflow(pipeline.id, {
      sourcePath: newSource,
      workflow,
    });
    db.exec(`
      CREATE TEMP TRIGGER fail_metadata_commit BEFORE UPDATE OF state ON data_output_commits
      WHEN NEW.state = 'metadata_committed'
      BEGIN SELECT RAISE(ABORT, 'forced metadata failure'); END
    `);
    // Let the chat writer run while ETL is waiting for the final DuckDB column count.
    const ctx = (store as unknown as { ctx: DataStoreContext }).ctx;
    const readColumns = ctx.getTableColumns.bind(ctx);
    let startChatWrite!: () => void;
    const chatWrite = new Promise<void>((resolve) => {
      startChatWrite = resolve;
    }).then(() => {
      db.messages.create({
        id: 'message',
        session_id: 'chat',
        role: 'user',
        content: '[]',
        timestamp: 2,
        token_usage: null,
        execution_time_ms: null,
      });
    });
    vi.spyOn(ctx, 'getTableColumns').mockImplementationOnce(async (name) => {
      startChatWrite();
      await chatWrite;
      return readColumns(name);
    });
    await expect(
      store.commitValidatedPipelineOutput(
        pipeline.id,
        validated.pipeline,
        workflow,
        [{ nodeId: 'source', column: 'id', value: '3', fingerprint: 'new' }],
        validated.nodeStats,
        validated.stagedSinks,
        'failed-run'
      )
    ).rejects.toThrow('forced metadata failure');

    expect(db.messages.getBySessionId('chat').map((message) => message.id)).toEqual(['message']);
    expect((await store.getResultTableRecord(output.id))?.rowCount).toBe(1);
    expect((await store.getPipelineRecord(pipeline.id))?.rowCount).toBe(1);
    expect(db.prepare('SELECT * FROM data_pipeline_watermarks').all()).toEqual([]);
    expect(await store.getPipelineRunNodeStats(pipeline.id, 'failed-run')).toEqual([]);
    expect(committedOutputs).toEqual([]);
    stores.pop()?.close();

    const duckdb = await DuckDBInstance.create(path.join(root, 'workspace.duckdb'));
    const connection = await duckdb.connect();
    try {
      const reader = await connection.runAndReadAll(`SELECT id, value FROM "${output.tableName}"`);
      expect(reader.getRowObjectsJson()).toEqual([{ id: '1', value: 'old' }]);
    } finally {
      connection.closeSync();
      duckdb.closeSync();
    }
  });

  it.each(['pipeline output', 'raw reimport', 'result rebind'] as const)(
    'queues a %s commit listener after the outer writer and earlier queued writes',
    async (operation) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-commit-listener-'));
      tempRoots.push(root);
      const source = path.join(root, 'input.csv');
      fs.writeFileSync(source, 'id\n1\n');
      const store = createDataPipelineStore(path.join(root, 'workspace.duckdb'));
      stores.push(store);
      const raw = await store.importRawTable({ filePath: source });
      const output = await store.createResultTable({ name: 'out' });
      const ctx = (store as unknown as { ctx: DataStoreContext }).ctx;
      const order: string[] = [];
      let listenerWrite: Promise<void> | undefined;
      const listener = () => {
        order.push('notification');
        listenerWrite = ctx.runExclusive(async () => {
          order.push('listener write');
        });
      };
      store.setOutputCommitListener(listener);
      store.setTableCommitListener(listener);
      const outer = ctx.runExclusive(async () => {
        if (operation === 'pipeline output') {
          const pipeline = await store.createPipeline({ name: 'p', sourcePath: source });
          await store.runPipeline(pipeline.id, { workflow: workflowForOutput(output.id) });
        } else if (operation === 'raw reimport') {
          await store.updateRawTable({ id: raw.id, filePath: source });
        } else {
          await store.updateResultTable({ id: output.id, sourceRawTableId: raw.id });
        }
        order.push('outer finished');
      });
      const earlierWrite = ctx.runExclusive(async () => {
        order.push('earlier write');
      });
      await Promise.all([outer, earlierWrite]);
      await listenerWrite;
      expect(order).toEqual(['outer finished', 'notification', 'earlier write', 'listener write']);
    }
  );

  it('queues delayed work that inherited a released writer scope', async () => {
    const ctx = new DataStoreContext(':memory:');
    const order: string[] = [];
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let delayed!: Promise<void>;
    await ctx.runExclusive(async () => {
      delayed = paused.then(() =>
        ctx.runExclusive(async () => {
          order.push('delayed writer');
        })
      );
    });
    await ctx.runExclusive(async () => {
      resume();
      await Promise.resolve();
      order.push('current writer');
    });
    await delayed;
    expect(order).toEqual(['current writer', 'delayed writer']);
  });

  it('restores an interrupted data commit when the store is reopened', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-output-recovery-'));
    tempRoots.push(root);
    const dbPath = path.join(root, 'workspace.duckdb');
    const importPath = path.join(root, 'trigger.csv');
    fs.writeFileSync(importPath, 'id\n1\n', 'utf8');

    const initialStore = createDataPipelineStore(dbPath);
    stores.push(initialStore);
    const pipeline = await initialStore.createPipeline({ name: 'Recovery pipeline' });
    stores.pop()?.close();

    const duckdb = await DuckDBInstance.create(dbPath);
    const connection = await duckdb.connect();
    await connection.run("CREATE TABLE recovery_target AS SELECT 'new' AS value");
    await connection.run("CREATE TABLE recovery_backup AS SELECT 'old' AS value");
    await connection.run("CREATE TABLE recovery_temp AS SELECT 'new' AS value");
    await connection.run(
      `INSERT INTO data_output_commits VALUES (
        'recovery-commit', $pipelineId, 'recovery_temp', 'recovery_target', 'recovery_backup',
        1, 'data_committed', '{}', NULL, 1, 1
      )`,
      { pipelineId: pipeline.id }
    );
    connection.closeSync();
    duckdb.closeSync();

    const reopened = createDataPipelineStore(dbPath);
    stores.push(reopened);
    await reopened.importRawTable({ filePath: importPath, name: 'Recovery trigger' });
    stores.pop()?.close();

    const verified = await DuckDBInstance.create(dbPath);
    const verifiedConnection = await verified.connect();
    try {
      const values = await verifiedConnection.runAndReadAll('SELECT value FROM recovery_target');
      expect(values.getRowObjectsJson()).toEqual([{ value: 'old' }]);
      const journal = await verifiedConnection.runAndReadAll(
        "SELECT state FROM data_output_commits WHERE id = 'recovery-commit'"
      );
      expect(journal.getRowObjectsJson()).toEqual([{ state: 'failed' }]);
    } finally {
      verifiedConnection.closeSync();
      verified.closeSync();
    }
  });
});
