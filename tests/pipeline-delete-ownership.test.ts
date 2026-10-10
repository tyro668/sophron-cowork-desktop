import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import type { DataWorkflowSaveInput } from '../src/renderer/types';

const stores: DataPipelineStore[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-pipeline-delete-'));
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
      config: { source: 'pipeline' },
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

describe('pipeline deletion resource ownership', () => {
  it('keeps a user output table bound to the pipeline via resultTableId', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const csvPath = path.join(root, 'source.csv');
    fs.writeFileSync(csvPath, 'id,value\n1,keep\n', 'utf8');

    const store = createDataPipelineStore(dbPath);
    stores.push(store);
    const source = await store.importRawTable({ filePath: csvPath });
    const resultTable = await store.createResultTable({ name: 'User table' });
    // Materialize user data into the bound table.
    await store.updateResultTable({ id: resultTable.id, sourceRawTableId: source.id });

    // Binding copies the physical table name into the pipeline — but the pipeline
    // only REFERENCES the table; it never owned it.
    const pipeline = await store.createPipeline({
      name: 'Bound pipeline',
      resultTableId: resultTable.id,
    });
    expect(pipeline.resultTable).toBe(resultTable.tableName);

    expect(await store.deletePipeline(pipeline.id)).toBe(true);
    stores.pop()?.close();

    // The user's output table — metadata row AND physical data — survives.
    const surviving = createDataPipelineStore(dbPath);
    stores.push(surviving);
    const record = await surviving.getResultTableRecord(resultTable.id);
    expect(record).not.toBeNull();
    const preview = await surviving.previewRawTable({ id: resultTable.id });
    expect(preview.rows.map((row) => String(row.value))).toEqual(['keep']);
    expect(await tableExists(dbPath, resultTable.tableName)).toBe(true);
  });

  it('still removes pipeline-owned output tables and their rows', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const csvPath = path.join(root, 'source.csv');
    fs.writeFileSync(csvPath, 'id,value\n1,gone\n', 'utf8');

    const store = createDataPipelineStore(dbPath);
    stores.push(store);
    const pipeline = await store.createPipeline({ name: 'Owned output', sourcePath: csvPath });
    await store.runPipeline(pipeline.id, {
      sourcePath: csvPath,
      workflow: passthroughWorkflow('owned_task_output'),
    });
    stores.pop()?.close();

    expect(await tableExists(dbPath, 'owned_task_output')).toBe(true);

    const reopened = createDataPipelineStore(dbPath);
    stores.push(reopened);
    expect(await reopened.deletePipeline(pipeline.id)).toBe(true);
    expect(await reopened.getPipelineRecord(pipeline.id)).toBeNull();
    stores.pop()?.close();

    expect(await tableExists(dbPath, 'owned_task_output')).toBe(false);
  });
});
