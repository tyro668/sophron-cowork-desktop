/**
 * Versioned metadata migration coverage:
 * - fresh databases get the ledger and full schema
 * - a pre-ledger fixture upgrades through every pending migration
 * - legacy cleanup runs once via the ledger, not on every boot
 * - a failed migration rolls back and is not recorded
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createDataPipelineStore,
  type DataPipelineStore,
} from '../src/main/data/data-pipeline-store';
import type { DatabaseInstance } from '../src/main/db/database';
import { LEGACY_DEMO_TASK_NAMES } from '../src/main/data/store/data-store-records';
import { LEGACY_DEFAULT_WORKFLOW_NODES } from '../src/main/data/store/workflow-model';
import {
  METADATA_MIGRATIONS,
  METADATA_MIGRATION_LEDGER,
  METADATA_SCHEMA_VERSION,
} from '../src/main/data/store/migrations';

const tempRoots: string[] = [];
const stores: DataPipelineStore[] = [];
const rawDbs: Database.Database[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-migrations-'));
  tempRoots.push(root);
  return root;
}

function openStore(dbPath: string, metadataDb?: Database.Database): DataPipelineStore {
  const store = createDataPipelineStore(
    dbPath,
    metadataDb ? { metadataDb: { raw: metadataDb } as unknown as DatabaseInstance } : undefined
  );
  stores.push(store);
  return store;
}

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((row) => row.name);
}

function ledgerRows(db: Database.Database): Array<{ version: number; name: string }> {
  return db
    .prepare(`SELECT version, name FROM ${METADATA_MIGRATION_LEDGER} ORDER BY version ASC`)
    .all() as Array<{ version: number; name: string }>;
}

/** Builds the pre-ledger schema: baseline tables minus newer columns/tables. */
function seedLegacyFixture(db: Database.Database): void {
  db.exec(`
    CREATE TABLE data_pipelines (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      node_count INTEGER NOT NULL,
      source_path VARCHAR,
      source_raw_table_id VARCHAR,
      result_table VARCHAR,
      row_count UBIGINT,
      column_count INTEGER,
      error VARCHAR,
      scheduled_for BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_run_at BIGINT
    );
    CREATE TABLE data_raw_tables (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      source_path VARCHAR NOT NULL,
      source_kind VARCHAR,
      config_json VARCHAR,
      table_name VARCHAR NOT NULL,
      row_count UBIGINT NOT NULL,
      column_count INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE TABLE data_workflow_nodes (
      id VARCHAR PRIMARY KEY,
      pipeline_id VARCHAR NOT NULL,
      node_key VARCHAR NOT NULL,
      operator_type VARCHAR,
      label VARCHAR NOT NULL,
      x DOUBLE,
      y DOUBLE,
      config_json VARCHAR,
      ordinal INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT
    );
    CREATE TABLE data_workflow_edges (
      id VARCHAR PRIMARY KEY,
      pipeline_id VARCHAR NOT NULL,
      source_node_id VARCHAR NOT NULL,
      target_node_id VARCHAR NOT NULL,
      source_handle VARCHAR,
      target_handle VARCHAR,
      created_at BIGINT NOT NULL
    );
  `);

  const insertPipeline = db.prepare(`
    INSERT INTO data_pipelines (
      id, name, status, node_count, source_path, source_raw_table_id, result_table,
      row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRawTable = db.prepare(`
    INSERT INTO data_raw_tables (
      id, name, source_path, source_kind, config_json, table_name,
      row_count, column_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNode = db.prepare(`
    INSERT INTO data_workflow_nodes (
      id, pipeline_id, node_key, operator_type, label, x, y, config_json,
      ordinal, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare(`
    INSERT INTO data_workflow_edges (
      id, pipeline_id, source_node_id, target_node_id, source_handle, target_handle, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Deletable legacy demo pipeline: all data columns NULL.
  insertPipeline.run(
    'demo-1',
    LEGACY_DEMO_TASK_NAMES[0],
    'draft',
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    100,
    100,
    null
  );
  // Same demo name but with real run data — must survive the cleanup predicate.
  insertPipeline.run(
    'demo-2',
    LEGACY_DEMO_TASK_NAMES[0],
    'completed',
    3,
    null,
    null,
    null,
    12,
    2,
    null,
    null,
    100,
    200,
    200
  );
  // Real pipeline carrying the legacy default workflow graph.
  insertPipeline.run(
    'pipeline-legacy',
    '我的任务',
    'completed',
    7,
    '/data/real.csv',
    null,
    'output_abc',
    42,
    4,
    null,
    null,
    100,
    200,
    200
  );
  // Pipeline with a custom workflow that must be preserved.
  insertPipeline.run(
    'pipeline-custom',
    '自定义任务',
    'completed',
    2,
    '/data/other.csv',
    null,
    'orphan_tbl',
    5,
    1,
    null,
    null,
    100,
    200,
    200
  );

  insertRawTable.run(
    'ds-sample',
    '示例数据',
    'local://samples/users.csv',
    'csv',
    null,
    'samples_users',
    10,
    2,
    100,
    100
  );
  insertRawTable.run(
    'ds-real',
    '真实数据',
    '/data/real.csv',
    'csv',
    null,
    'real_table',
    100,
    4,
    100,
    100
  );
  // Legacy explicit output row: converted by v4 (config_json backfilled).
  insertRawTable.run(
    'ds-legacy-out',
    '旧输出',
    'duckdb://outputs/output_abc',
    'output',
    null,
    'output_abc',
    42,
    4,
    100,
    100
  );
  // Orphan output-ish row matched only via pipeline result_table — not convertible, deleted by v4.
  insertRawTable.run(
    'ds-orphan',
    '孤儿行',
    '/tmp/orphan.csv',
    'csv',
    null,
    'orphan_tbl',
    3,
    1,
    100,
    100
  );
  // Already-modern output row: v4 must leave its config untouched.
  insertRawTable.run(
    'ds-modern-out',
    '现代输出',
    'duckdb://outputs/output_mod',
    'output',
    '{"kind":"result_table","sourceRawTableId":"ds-real"}',
    'output_mod',
    7,
    2,
    100,
    100
  );

  LEGACY_DEFAULT_WORKFLOW_NODES.forEach((node, index) => {
    insertNode.run(
      `legacy-${node.key}`,
      'pipeline-legacy',
      node.key,
      node.type,
      node.label,
      node.x,
      node.y,
      JSON.stringify(node.config),
      index + 1,
      100,
      100
    );
  });
  insertEdge.run('legacy-e1', 'pipeline-legacy', 'legacy-source', 'legacy-filter', null, null, 100);

  insertNode.run(
    'custom-1',
    'pipeline-custom',
    'src',
    'input_source',
    '输入',
    48,
    128,
    '{}',
    1,
    100,
    100
  );
  insertNode.run(
    'custom-2',
    'pipeline-custom',
    'out',
    'output',
    '输出',
    190,
    128,
    '{}',
    2,
    100,
    100
  );
  insertEdge.run('custom-e1', 'pipeline-custom', 'custom-1', 'custom-2', null, null, 100);
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (rawDbs.length > 0) {
    rawDbs.pop()?.close();
  }
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('metadata migrations', () => {
  it('declares strictly increasing unique versions', () => {
    const versions = METADATA_MIGRATIONS.map((migration) => migration.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(METADATA_SCHEMA_VERSION).toBe(versions[versions.length - 1]);
  });

  it('creates the ledger and records every migration on a fresh database', async () => {
    const tempRoot = makeTempRoot();
    const store = openStore(path.join(tempRoot, 'workspace.duckdb'));

    await store.getDashboard({});

    const internals = store as unknown as {
      ctx: {
        queryRows<T extends object>(sql: string): Promise<T[]>;
      };
    };
    const rows = await internals.ctx.queryRows<{ version: number | string; name: string }>(
      `SELECT version, name FROM ${METADATA_MIGRATION_LEDGER} ORDER BY version ASC`
    );
    expect(rows.map((row) => Number(row.version))).toEqual(
      METADATA_MIGRATIONS.map((migration) => migration.version)
    );
    expect(rows.map((row) => row.name)).toEqual(
      METADATA_MIGRATIONS.map((migration) => migration.name)
    );
  });

  it('migrates cloud Csv mirrors once without moving cache files or changing table identity', async () => {
    const root = makeTempRoot();
    const raw = new Database(path.join(root, 'meta.sqlite'));
    rawDbs.push(raw);
    seedLegacyFixture(raw);
    const mirror = {
      tableId: 'remote',
      spaceId: 's',
      projectId: 'p',
      contentHash: 'hash',
      automationSyncKey: 'sync',
    };
    const legacy = {
      sourceKind: 'csv',
      header: 'auto',
      delimiter: 'auto',
      encoding: 'auto',
      dataRegion: 'auto',
      cloudMirror: mirror,
      dataProcessing: { strategy: 'auto' },
    };
    raw
      .prepare(
        `INSERT INTO data_raw_tables (id, name, source_path, source_kind, config_json, table_name, row_count, column_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'cloud-input',
        'Cloud input',
        '/hidden/cache.csv',
        'csv',
        JSON.stringify(legacy),
        'cloud_input',
        2,
        1,
        10,
        20
      );
    const store = openStore(path.join(root, 'workspace.duckdb'), raw);
    const migrated = await store.getRawTableRecord('cloud-input');
    expect(migrated).toMatchObject({
      id: 'cloud-input',
      sourceKind: 'cloud',
      sourcePath: '/hidden/cache.csv',
      tableName: 'cloud_input',
      updatedAt: 20,
      inputConfig: {
        sourceKind: 'cloud',
        cloudMirror: mirror,
        dataProcessing: { strategy: 'auto' },
      },
    });
    expect(migrated?.inputConfig).not.toHaveProperty('delimiter');
    expect((await store.findRawTableByAutomationSyncKey('sync'))?.id).toBe('cloud-input');
    const firstStamp = raw
      .prepare('SELECT applied_at FROM data_schema_migrations WHERE version = 14')
      .get();
    await store.close();
    stores.pop();
    const reopened = openStore(path.join(root, 'workspace.duckdb'), raw);
    expect((await reopened.getRawTableRecord('cloud-input'))?.inputConfig).toEqual(
      migrated?.inputConfig
    );
    expect(
      raw.prepare('SELECT applied_at FROM data_schema_migrations WHERE version = 14').get()
    ).toEqual(firstStamp);
  });

  it('upgrades a legacy fixture through every pending migration', async () => {
    const tempRoot = makeTempRoot();
    const metaPath = path.join(tempRoot, 'meta.sqlite');
    const raw = new Database(metaPath);
    rawDbs.push(raw);
    seedLegacyFixture(raw);

    const store = openStore(path.join(tempRoot, 'workspace.duckdb'), raw);
    await store.getDashboard({});

    // Ledger records every migration in order.
    const ledger = ledgerRows(raw);
    expect(ledger.map((row) => row.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(ledger.map((row) => row.name)).toEqual([
      'baseline_schema',
      'drop_legacy_demo_rows',
      'drop_legacy_default_workflow_graphs',
      'normalize_result_table_metadata',
      'table_commit_journal',
      'node_run_stats_input_rows_by_handle',
      'workflow_node_cache_signature',
      'output_cloud_actions_to_automations',
      'restrict_output_automations_to_drive_files',
      'restrict_generated_automation_outputs',
      'merge_cloud_sync_action_types',
      'data_list_groups',
      'data_pipeline_runs',
      'cloud_raw_table_source',
      'strip_cached_operator_dsl',
    ]);

    // v12: group table + member columns exist.
    expect(tableNames(raw)).toContain('data_groups');
    expect(columnNames(raw, 'data_pipelines')).toContain('group_id');
    expect(columnNames(raw, 'data_raw_tables')).toContain('group_id');

    // v13: per-run history table.
    expect(tableNames(raw)).toContain('data_pipeline_runs');

    // Baseline adds the missing column and the newer tables.
    expect(columnNames(raw, 'data_raw_tables')).toContain('file_count');
    for (const table of [
      'data_pipeline_watermarks',
      'data_pipeline_node_run_stats',
      'data_workflow_node_caches',
      'data_output_commits',
      'data_table_commits',
      'data_raw_table_normalizer_artifacts',
      'data_raw_table_normalizer_artifact_versions',
      METADATA_MIGRATION_LEDGER,
    ]) {
      expect(tableNames(raw)).toContain(table);
    }

    // v2: deletable demo pipeline removed; demo-with-data and real pipelines kept.
    const pipelineIds = new Set(
      (raw.prepare('SELECT id FROM data_pipelines').all() as Array<{ id: string }>).map(
        (row) => row.id
      )
    );
    expect(pipelineIds).toEqual(new Set(['demo-2', 'pipeline-legacy', 'pipeline-custom']));

    // v2: sample rawTables removed, real rawTable kept.
    // v4: legacy output row converted, orphan row deleted, modern row untouched.
    const rawTables = raw
      .prepare('SELECT id, config_json, file_count FROM data_raw_tables')
      .all() as Array<{ id: string; config_json: string | null; file_count: number | null }>;
    const byId = new Map(rawTables.map((row) => [row.id, row]));
    expect(byId.has('ds-sample')).toBe(false);
    expect(byId.has('ds-orphan')).toBe(false);
    expect(byId.has('ds-real')).toBe(true);
    expect(byId.get('ds-legacy-out')?.config_json).toContain('"kind":"result_table"');
    expect(byId.get('ds-legacy-out')?.file_count).toBe(0);
    expect(byId.get('ds-modern-out')?.config_json).toBe(
      '{"kind":"result_table","sourceRawTableId":"ds-real"}'
    );

    // v3: legacy default graph deleted and node_count reset; custom graph intact.
    const remainingNodes = raw
      .prepare('SELECT pipeline_id FROM data_workflow_nodes')
      .all() as Array<{
      pipeline_id: string;
    }>;
    expect(new Set(remainingNodes.map((row) => row.pipeline_id))).toEqual(
      new Set(['pipeline-custom'])
    );
    const legacyPipeline = raw
      .prepare("SELECT node_count FROM data_pipelines WHERE id = 'pipeline-legacy'")
      .get() as { node_count: number };
    expect(legacyPipeline.node_count).toBe(0);
    const edgeCount = raw
      .prepare(
        "SELECT count(*) AS c FROM data_workflow_edges WHERE pipeline_id = 'pipeline-legacy'"
      )
      .get() as { c: number };
    expect(edgeCount.c).toBe(0);
  });

  it('does not re-run cleanup migrations on subsequent opens', async () => {
    const tempRoot = makeTempRoot();
    const metaPath = path.join(tempRoot, 'meta.sqlite');
    const raw = new Database(metaPath);
    rawDbs.push(raw);
    seedLegacyFixture(raw);

    const first = openStore(path.join(tempRoot, 'workspace.duckdb'), raw);
    await first.getDashboard({});
    first.close();
    stores.pop();

    // Insert a fresh deletable-shape demo pipeline AFTER the first open. If legacy
    // cleanup still ran on every boot, this row would be deleted on reopen.
    raw
      .prepare(
        `INSERT INTO data_pipelines (
        id, name, status, node_count, source_path, source_raw_table_id, result_table,
        row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
      ) VALUES ('demo-new', ?, 'draft', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 300, 300, NULL)`
      )
      .run(LEGACY_DEMO_TASK_NAMES[0]);

    const second = openStore(path.join(tempRoot, 'workspace.duckdb'), raw);
    await second.getDashboard({});

    expect(ledgerRows(raw).length).toBe(METADATA_MIGRATIONS.length);
    const preserved = raw.prepare("SELECT id FROM data_pipelines WHERE id = 'demo-new'").get() as
      { id: string } | undefined;
    expect(preserved?.id).toBe('demo-new');
  });

  it('rolls back a failed migration without recording it', async () => {
    const tempRoot = makeTempRoot();
    const metaPath = path.join(tempRoot, 'meta.sqlite');
    const raw = new Database(metaPath);
    rawDbs.push(raw);
    // Broken pre-existing table: the baseline backfill UPDATE references
    // `ordinal`, which this fixture lacks, so migration v1 must fail.
    raw.exec('CREATE TABLE data_workflow_nodes (id VARCHAR PRIMARY KEY)');

    const store = openStore(path.join(tempRoot, 'workspace.duckdb'), raw);
    await expect(store.getDashboard({})).rejects.toThrow(/v1 \(baseline_schema\)/);

    // The ledger table exists (created before the transaction) but the failed
    // migration was never recorded, and its ALTERs rolled back.
    expect(ledgerRows(raw)).toEqual([]);
    expect(columnNames(raw, 'data_workflow_nodes')).toEqual(['id']);
  });

  it('opens a newer-version metadata store read-only and refuses writes', async () => {
    const tempRoot = makeTempRoot();
    const metaPath = path.join(tempRoot, 'meta.sqlite');
    const raw = new Database(metaPath);
    rawDbs.push(raw);
    seedLegacyFixture(raw);

    const store = openStore(path.join(tempRoot, 'workspace.duckdb'), raw);
    await store.getDashboard({});

    // Simulate a future build having stamped a higher schema version.
    raw
      .prepare(
        `INSERT INTO ${METADATA_MIGRATION_LEDGER} (version, name, applied_at) VALUES (?, ?, ?)`
      )
      .run(METADATA_SCHEMA_VERSION + 100, 'future_migration', Date.now());
    store.close();
    stores.pop();

    const reopened = openStore(path.join(tempRoot, 'workspace2.duckdb'), raw);
    // Reads still work against a newer-version store.
    await reopened.getDashboard({});

    const internals = reopened as unknown as {
      ctx: {
        metadataReadOnly: boolean;
        metaRunSql(sql: string): Promise<void>;
      };
    };
    expect(internals.ctx.metadataReadOnly).toBe(true);
    await expect(
      internals.ctx.metaRunSql('INSERT INTO data_pipelines (id) VALUES (1)')
    ).rejects.toThrow(/newer than this build/);
  });
});
