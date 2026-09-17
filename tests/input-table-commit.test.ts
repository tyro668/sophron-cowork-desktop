import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuckDBInstance } from '@duckdb/node-api';
import { createDataTaskStore, type DataTaskStore } from '../src/main/data/data-task-store';

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-table-commit-'));
  tempRoots.push(root);
  return root;
}

type StoreInternals = {
  ctx: {
    metaRunSql: (sql: string, values?: Record<string, string | number | null>) => Promise<void>;
  };
};

function ctxOf(store: DataTaskStore) {
  return (store as unknown as StoreInternals).ctx;
}

/** Fails the dataset-row metadata write inside the metadata transaction. */
function injectMetadataFailure(store: DataTaskStore): () => void {
  const ctx = ctxOf(store);
  const original = ctx.metaRunSql.bind(ctx);
  ctx.metaRunSql = async (sql, values) => {
    if (sql.includes('UPDATE data_datasets')) {
      throw new Error('forced metadata failure');
    }
    await original(sql, values);
  };
  return () => {
    ctx.metaRunSql = original;
  };
}

async function readTable(dbPath: string, tableName: string) {
  const duckdb = await DuckDBInstance.create(dbPath);
  const connection = await duckdb.connect();
  try {
    const reader = await connection.runAndReadAll(`SELECT * FROM "${tableName}"`);
    return reader.getRowObjectsJson();
  } finally {
    connection.closeSync();
    duckdb.closeSync();
  }
}

async function listJournalRows(dbPath: string) {
  const duckdb = await DuckDBInstance.create(dbPath);
  const connection = await duckdb.connect();
  try {
    const reader = await connection.runAndReadAll(
      `SELECT id, operation, state, staging_table, target_table, backup_table
       FROM data_table_commits ORDER BY created_at`
    );
    return reader.getRowObjectsJson() as Array<Record<string, unknown>>;
  } finally {
    connection.closeSync();
    duckdb.closeSync();
  }
}

async function listPhysicalTables(dbPath: string) {
  const duckdb = await DuckDBInstance.create(dbPath);
  const connection = await duckdb.connect();
  try {
    const reader = await connection.runAndReadAll(
      `SELECT table_name FROM information_schema.tables ORDER BY table_name`
    );
    return reader.getRowObjectsJson().map((row) => String(row.table_name));
  } finally {
    connection.closeSync();
    duckdb.closeSync();
  }
}

describe('input/output table commits', () => {
  it('reimports a dataset with the new rows and completes the journal', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const oldCsv = path.join(root, 'old.csv');
    const newCsv = path.join(root, 'new.csv');
    fs.writeFileSync(oldCsv, 'id,value\n1,old\n', 'utf8');
    fs.writeFileSync(newCsv, 'id,value\n2,new\n3,newer\n', 'utf8');

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const imported = await store.importDataset({ filePath: oldCsv });

    const updated = await store.updateDataset({ id: imported.id, filePath: newCsv });
    expect(updated.rowCount).toBe(2);

    const preview = await store.previewDataset({ id: imported.id });
    expect(preview.rows.map((row) => String(row.value))).toEqual(['new', 'newer']);

    const journal = await listJournalRows(dbPath);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ operation: 'reimport', state: 'completed' });

    // No leftover staging/backup tables after a clean commit.
    const tables = await listPhysicalTables(dbPath);
    expect(tables.filter((name) => /table_backup_|dataset_update_/.test(name))).toEqual([]);
  });

  it('restores the old table when the metadata write fails after the physical swap', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const oldCsv = path.join(root, 'old.csv');
    const newCsv = path.join(root, 'new.csv');
    fs.writeFileSync(oldCsv, 'id,value\n1,old\n', 'utf8');
    fs.writeFileSync(newCsv, 'id,value\n2,new\n', 'utf8');

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const imported = await store.importDataset({ filePath: oldCsv });
    const restore = injectMetadataFailure(store);

    await expect(store.updateDataset({ id: imported.id, filePath: newCsv })).rejects.toThrow(
      'forced metadata failure'
    );
    restore();

    // Metadata row still describes the old import.
    const dataset = await store.getInputTableRecord(imported.id);
    expect(dataset?.rowCount).toBe(1);

    // Physical table restored to the old contents — the pre-fix code left the
    // NEW rows here while metadata still said row_count=1.
    const preview = await store.previewDataset({ id: imported.id });
    expect(preview.rows.map((row) => String(row.value))).toEqual(['old']);

    const journal = await listJournalRows(dbPath);
    expect(journal[0]).toMatchObject({ operation: 'reimport', state: 'failed' });

    const tables = await listPhysicalTables(dbPath);
    expect(tables.filter((name) => /table_backup_|dataset_update_/.test(name))).toEqual([]);
  });

  it('recovers a mid-swap crash on the next store open', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const oldCsv = path.join(root, 'old.csv');
    const triggerCsv = path.join(root, 'trigger.csv');
    fs.writeFileSync(oldCsv, 'id,value\n1,old\n', 'utf8');
    fs.writeFileSync(triggerCsv, 'id\n1\n', 'utf8');

    const initial = createDataTaskStore(dbPath);
    stores.push(initial);
    const imported = await initial.importDataset({ filePath: oldCsv });
    stores.pop()?.close();

    // Simulate a crash after the physical commit but before metadata write:
    // target already holds new rows, old table survives under the backup name.
    const duckdb = await DuckDBInstance.create(dbPath);
    const connection = await duckdb.connect();
    await connection.run(`CREATE TABLE crash_staging AS SELECT 2 AS id, 'new' AS value`);
    await connection.run('BEGIN TRANSACTION');
    await connection.run(`ALTER TABLE "${imported.tableName}" RENAME TO crash_backup`);
    await connection.run(`ALTER TABLE crash_staging RENAME TO "${imported.tableName}"`);
    await connection.run('COMMIT');
    await connection.run(
      `INSERT INTO data_table_commits (
         id, dataset_id, operation, staging_table, target_table, backup_table,
         target_existed, state, error, created_at, updated_at
       ) VALUES (
         'crash-commit', $datasetId, 'reimport', 'crash_staging', $targetTable,
         'crash_backup', 1, 'data_committed', NULL, 1, 1
       )`,
      { datasetId: imported.id, targetTable: imported.tableName }
    );
    connection.closeSync();
    duckdb.closeSync();

    const reopened = createDataTaskStore(dbPath);
    stores.push(reopened);
    // ensureReady (inside importDataset) runs the post-ready recovery hook.
    await reopened.importDataset({ filePath: triggerCsv, name: 'trigger' });
    stores.pop()?.close();

    const rows = await readTable(dbPath, imported.tableName);
    expect(rows).toEqual([{ id: '1', value: 'old' }]);

    const journal = await listJournalRows(dbPath);
    const recovered = journal.find((row) => row.id === 'crash-commit');
    expect(recovered?.state).toBe('failed');

    const tables = await listPhysicalTables(dbPath);
    expect(tables.filter((name) => /crash_backup|crash_staging/.test(name))).toEqual([]);
  });

  it('rebinds an output table through the journaled swap', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const csvA = path.join(root, 'a.csv');
    const csvB = path.join(root, 'b.csv');
    fs.writeFileSync(csvA, 'id\n1\n', 'utf8');
    fs.writeFileSync(csvB, 'id\n7\n8\n', 'utf8');

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const sourceA = await store.importDataset({ filePath: csvA });
    const sourceB = await store.importDataset({ filePath: csvB });
    const outputTable = await store.createOutputTable({ name: 'Out' });

    await store.updateOutputTable({ id: outputTable.id, sourceDatasetId: sourceA.id });
    let preview = await store.previewDataset({ id: outputTable.id });
    expect(preview.rows.map((row) => String(row.id))).toEqual(['1']);

    // Rebind to a different source — replaces the physical table via journal.
    await store.updateOutputTable({ id: outputTable.id, sourceDatasetId: sourceB.id });
    preview = await store.previewDataset({ id: outputTable.id });
    expect(preview.rows.map((row) => String(row.id))).toEqual(['7', '8']);

    const journal = await listJournalRows(dbPath);
    expect(journal.map((row) => row.state)).toEqual(['completed', 'completed']);
    expect(journal.every((row) => row.operation === 'rebind_output')).toBe(true);
  });

  it('restores the output table when rebind metadata fails mid-commit', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const csvA = path.join(root, 'a.csv');
    const csvB = path.join(root, 'b.csv');
    fs.writeFileSync(csvA, 'id\n1\n', 'utf8');
    fs.writeFileSync(csvB, 'id\n9\n', 'utf8');

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const sourceA = await store.importDataset({ filePath: csvA });
    const sourceB = await store.importDataset({ filePath: csvB });
    const outputTable = await store.createOutputTable({ name: 'Out' });
    await store.updateOutputTable({ id: outputTable.id, sourceDatasetId: sourceA.id });

    const restore = injectMetadataFailure(store);
    await expect(
      store.updateOutputTable({ id: outputTable.id, sourceDatasetId: sourceB.id })
    ).rejects.toThrow('forced metadata failure');
    restore();

    // Old physical table restored; metadata untouched.
    const preview = await store.previewDataset({ id: outputTable.id });
    expect(preview.rows.map((row) => String(row.id))).toEqual(['1']);
    const record = await store.getOutputTableRecord(outputTable.id);
    expect(record?.sourceDatasetId).toBe(sourceA.id);

    const journal = await listJournalRows(dbPath);
    const failed = journal.filter((row) => row.state === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.operation).toBe('rebind_output');
  });

  it('serializes concurrent updateOutputTable calls under runExclusive', async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, 'workspace.duckdb');
    const csvA = path.join(root, 'a.csv');
    const csvB = path.join(root, 'b.csv');
    fs.writeFileSync(csvA, 'id\n1\n', 'utf8');
    fs.writeFileSync(csvB, 'id\n2\n', 'utf8');

    const store = createDataTaskStore(dbPath);
    stores.push(store);
    const sourceA = await store.importDataset({ filePath: csvA });
    const sourceB = await store.importDataset({ filePath: csvB });
    const outputTable = await store.createOutputTable({ name: 'Out' });

    // Both calls race the same physical target; serialization means no
    // interleaved DDL on one DuckDB connection.
    await Promise.all([
      store.updateOutputTable({ id: outputTable.id, sourceDatasetId: sourceA.id }),
      store.updateOutputTable({ id: outputTable.id, sourceDatasetId: sourceB.id }),
    ]);

    const preview = await store.previewDataset({ id: outputTable.id });
    expect(preview.totalRows).toBe(1);
    const record = await store.getOutputTableRecord(outputTable.id);
    // Last writer wins — and physical + metadata agree on which writer that was.
    const lastId = record?.sourceDatasetId;
    expect(lastId === sourceA.id || lastId === sourceB.id).toBe(true);
    const expectedRow = lastId === sourceA.id ? '1' : '2';
    expect(preview.rows.map((row) => String(row.id))).toEqual([expectedRow]);
  });
});
