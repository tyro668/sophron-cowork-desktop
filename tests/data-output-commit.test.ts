import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';
import type { DataWorkflowSaveInput } from '../src/renderer/types';

const stores: DataTaskStore[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('validated task output commit', () => {
  it('restores the previous DuckDB output when the SQLite metadata transaction fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-output-commit-'));
    tempRoots.push(root);
    const oldSource = path.join(root, 'old.csv');
    const newSource = path.join(root, 'new.csv');
    fs.writeFileSync(oldSource, 'id,value\n1,old\n', 'utf8');
    fs.writeFileSync(newSource, 'id,value\n2,new\n', 'utf8');

    const store = createDataTaskStore(path.join(root, 'workspace.duckdb'));
    stores.push(store);
    const task = await store.createTask({ name: 'Atomic output', sourcePath: oldSource });
    const workflow: DataWorkflowSaveInput = {
      nodes: [
        { id: 'source', type: 'input_source', label: 'source', config: { source: 'task' } },
        { id: 'output', type: 'output', label: 'output', config: { table: 'atomic_output' } },
      ],
      edges: [{ id: 'edge', sourceNodeId: 'source', targetNodeId: 'output' }],
    };

    await store.runTask(task.id, { sourcePath: oldSource, workflow });
    const validated = await store.validateTaskWorkflow(task.id, {
      sourcePath: newSource,
      workflow,
    });
    const ctx = (
      store as unknown as {
        ctx: {
          metaRunSql: (
            sql: string,
            values?: Record<string, string | number | null>
          ) => Promise<void>;
        };
      }
    ).ctx;
    const originalMetaRunSql = ctx.metaRunSql.bind(ctx);
    ctx.metaRunSql = async (sql, values) => {
      if (sql.includes('UPDATE data_cleaning_tasks') && sql.includes("status = 'completed'")) {
        throw new Error('forced metadata failure');
      }
      await originalMetaRunSql(sql, values);
    };

    await expect(
      store.commitValidatedTaskOutput(task.id, validated.task, workflow)
    ).rejects.toThrow('forced metadata failure');
    stores.pop()?.close();

    const duckdb = await DuckDBInstance.create(path.join(root, 'workspace.duckdb'));
    const connection = await duckdb.connect();
    try {
      const reader = await connection.runAndReadAll('SELECT id, value FROM atomic_output');
      expect(reader.getRowObjectsJson()).toEqual([{ id: '1', value: 'old' }]);
    } finally {
      connection.closeSync();
      duckdb.closeSync();
    }
  });

  it('restores an interrupted data commit when the store is reopened', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-output-recovery-'));
    tempRoots.push(root);
    const dbPath = path.join(root, 'workspace.duckdb');
    const importPath = path.join(root, 'trigger.csv');
    fs.writeFileSync(importPath, 'id\n1\n', 'utf8');

    const initialStore = createDataTaskStore(dbPath);
    stores.push(initialStore);
    const task = await initialStore.createTask({ name: 'Recovery task' });
    stores.pop()?.close();

    const duckdb = await DuckDBInstance.create(dbPath);
    const connection = await duckdb.connect();
    await connection.run("CREATE TABLE recovery_target AS SELECT 'new' AS value");
    await connection.run("CREATE TABLE recovery_backup AS SELECT 'old' AS value");
    await connection.run("CREATE TABLE recovery_temp AS SELECT 'new' AS value");
    await connection.run(
      `INSERT INTO data_output_commits VALUES (
        'recovery-commit', $taskId, 'recovery_temp', 'recovery_target', 'recovery_backup',
        1, 'data_committed', '{}', NULL, 1, 1
      )`,
      { taskId: task.id }
    );
    connection.closeSync();
    duckdb.closeSync();

    const reopened = createDataTaskStore(dbPath);
    stores.push(reopened);
    await reopened.importDataset({ filePath: importPath, name: 'Recovery trigger' });
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
