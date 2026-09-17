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

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-task-delete-'));
  tempRoots.push(root);
  return root;
}

async function tableExists(dbPath: string, tableName: string): Promise<boolean> {
  const duckdb = await DuckDBInstance.create(dbPath);
  const connection = await duckdb.connect();
  try {
    const reader = await connection.runAndReadAll(
      `SELECT table_name FROM information_schema.tables WHERE table_name = $name`,
      { name: tableName }
    );
    return reader.getRowObjectsJson().length > 0;
  } finally {
    connection.closeSync();
    duckdb.closeSync();
  }
}

const passthroughWorkflow = (table: string): DataWorkflowSaveInput => ({
  nodes: [
    {
      id: 'source',
      type: 'input_source',
      label: 'source',
      x: 0,
      y: 0,
      config: { source: 'task' },
    },
    {
      id: 'output',
      type: 'output',
      label: 'output',
      x: 0,
      y: 0,
      config: { table },
    },
  ],
  edges: [{ id: 'edge', sourceNodeId: 'source', targetNodeId: 'output' }],
});

describe('task deletion resource ownership', () => {
  it('keeps a user output table bound to the task via outputTableId', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const csvPath = path.join(root, 'source.csv');
    fs.writeFileSync(csvPath, 'id,value\n1,keep\n', 'utf8');

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const source = await store.importDataset({ filePath: csvPath });
    const outputTable = await store.createOutputTable({ name: 'User table' });
    // Materialize user data into the bound table.
    await store.updateOutputTable({ id: outputTable.id, sourceDatasetId: source.id });

    // Binding copies the physical table name into the task — but the task
    // only REFERENCES the table; it never owned it.
    const task = await store.createTask({
      name: 'Bound task',
      outputTableId: outputTable.id,
    });
    expect(task.outputTable).toBe(outputTable.tableName);

    expect(await store.deleteTask(task.id)).toBe(true);
    stores.pop()?.close();

    // The user's output table — metadata row AND physical data — survives.
    const surviving = createDataTaskStore(dbPath);
    stores.push(surviving);
    const record = await surviving.getOutputTableRecord(outputTable.id);
    expect(record).not.toBeNull();
    const preview = await surviving.previewDataset({ id: outputTable.id });
    expect(preview.rows.map((row) => String(row.value))).toEqual(['keep']);
    expect(await tableExists(dbPath, outputTable.tableName)).toBe(true);
  });

  it('still removes task-owned output tables and their rows', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const csvPath = path.join(root, 'source.csv');
    fs.writeFileSync(csvPath, 'id,value\n1,gone\n', 'utf8');

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const task = await store.createTask({ name: 'Owned output', sourcePath: csvPath });
    await store.runTask(task.id, {
      sourcePath: csvPath,
      workflow: passthroughWorkflow('owned_task_output'),
    });
    stores.pop()?.close();

    expect(await tableExists(dbPath, 'owned_task_output')).toBe(true);

    const reopened = createDataTaskStore(dbPath);
    stores.push(reopened);
    expect(await reopened.deleteTask(task.id)).toBe(true);
    expect(await reopened.getTaskRecord(task.id)).toBeNull();
    stores.pop()?.close();

    expect(await tableExists(dbPath, 'owned_task_output')).toBe(false);
  });
});
