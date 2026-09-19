/**
 * Versioned metadata schema migrations.
 *
 * Replaces the historical boot-time schema block that re-ran CREATE/ALTER
 * statements and legacy row deletions on every launch. Migrations are
 * recorded in `data_schema_migrations`, execute once in ascending version
 * order, and each runs inside a single transaction so a failure leaves the
 * metadata store untouched and the version unmarked.
 *
 * Rules for future migrations:
 * - Append a new entry to METADATA_MIGRATIONS with the next version.
 *   Versions are permanent: never edit or renumber an applied migration.
 * - A migration runs exactly once per database — write it assuming a
 *   clean target at the previous version, not defensively idempotent.
 * - Never call ctx.ensureMetadataReady() inside a migration; it would
 *   deadlock on the in-flight initialization promise.
 */
import { log, logWarn } from '../../utils/logger';
import {
  LEGACY_DEMO_TASK_NAMES,
  OUTPUT_TABLE_CONFIG_KIND,
  isLegacyExplicitOutputTableRow,
  outputTableConfigJson,
  parseOutputTableConfig,
  storedDatasetSourceKindSql,
  type DataDatasetRow,
} from './data-store-records';
import { isLegacyDefaultWorkflow, type DataWorkflowNodeRow } from './workflow-model';
import type { DataStoreContext } from './data-store-context';

export interface MetadataMigration {
  readonly version: number;
  readonly name: string;
  up(ctx: DataStoreContext): Promise<void>;
}

export const METADATA_MIGRATION_LEDGER = 'data_schema_migrations';

async function createBaselineSchema(ctx: DataStoreContext): Promise<void> {
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_cleaning_tasks (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      status VARCHAR NOT NULL,
      node_count INTEGER NOT NULL,
      source_path VARCHAR,
      source_dataset_id VARCHAR,
      output_table VARCHAR,
      row_count UBIGINT,
      column_count INTEGER,
      error VARCHAR,
      scheduled_for BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_run_at BIGINT
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_datasets (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      source_path VARCHAR NOT NULL,
      table_name VARCHAR NOT NULL,
      row_count UBIGINT NOT NULL,
      column_count INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await ctx.ensureMetadataColumn('data_datasets', 'source_kind', 'VARCHAR');
  await ctx.ensureMetadataColumn('data_datasets', 'config_json', 'VARCHAR');
  await ctx.ensureMetadataColumn('data_datasets', 'file_count', 'INTEGER');
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_input_table_normalizer_artifacts (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      description VARCHAR,
      source_kind VARCHAR NOT NULL,
      primary_language VARCHAR NOT NULL,
      active_version_id VARCHAR,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_input_table_normalizer_artifact_versions (
      id VARCHAR PRIMARY KEY,
      artifact_id VARCHAR NOT NULL,
      version INTEGER NOT NULL,
      status VARCHAR NOT NULL,
      files_json VARCHAR NOT NULL,
      file_tree_hash VARCHAR NOT NULL,
      rule_prompt VARCHAR NOT NULL,
      source_summary_hash VARCHAR,
      entrypoint_json VARCHAR NOT NULL,
      dependency_prepare_json VARCHAR,
      runtime_json VARCHAR NOT NULL,
      dependencies_json VARCHAR,
      dependency_lock_hash VARCHAR,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      published_at BIGINT
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_workflow_nodes (
      id VARCHAR PRIMARY KEY,
      task_id VARCHAR NOT NULL,
      node_key VARCHAR NOT NULL,
      label VARCHAR NOT NULL,
      ordinal INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  await ctx.ensureMetadataColumn('data_workflow_nodes', 'operator_type', 'VARCHAR');
  await ctx.ensureMetadataColumn('data_workflow_nodes', 'x', 'DOUBLE');
  await ctx.ensureMetadataColumn('data_workflow_nodes', 'y', 'DOUBLE');
  await ctx.ensureMetadataColumn('data_workflow_nodes', 'config_json', 'VARCHAR');
  await ctx.ensureMetadataColumn('data_workflow_nodes', 'updated_at', 'BIGINT');
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_workflow_edges (
      id VARCHAR PRIMARY KEY,
      task_id VARCHAR NOT NULL,
      source_node_id VARCHAR NOT NULL,
      target_node_id VARCHAR NOT NULL,
      source_handle VARCHAR,
      target_handle VARCHAR,
      created_at BIGINT NOT NULL
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_task_watermarks (
      task_id VARCHAR NOT NULL,
      node_id VARCHAR NOT NULL,
      column_name VARCHAR NOT NULL,
      watermark_value VARCHAR,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (task_id, node_id)
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_task_node_run_stats (
      task_id VARCHAR NOT NULL,
      run_id VARCHAR NOT NULL,
      node_id VARCHAR NOT NULL,
      node_type VARCHAR NOT NULL,
      input_rows BIGINT,
      output_rows BIGINT NOT NULL,
      dropped_rows BIGINT NOT NULL,
      rejected_rows BIGINT NOT NULL,
      sample_json VARCHAR,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (task_id, run_id, node_id)
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_workflow_node_caches (
      id VARCHAR PRIMARY KEY,
      task_id VARCHAR NOT NULL,
      node_id VARCHAR NOT NULL,
      node_type VARCHAR NOT NULL,
      table_name VARCHAR NOT NULL,
      cache_scope VARCHAR NOT NULL,
      expires_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_output_commits (
      id VARCHAR PRIMARY KEY,
      task_id VARCHAR NOT NULL,
      temporary_table VARCHAR NOT NULL,
      target_table VARCHAR NOT NULL,
      backup_table VARCHAR NOT NULL,
      target_existed INTEGER NOT NULL,
      state VARCHAR NOT NULL,
      intended_metadata_json VARCHAR NOT NULL,
      error VARCHAR,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_data_cleaning_tasks_updated_at ON data_cleaning_tasks(updated_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_cleaning_tasks_source_dataset_id ON data_cleaning_tasks(source_dataset_id)',
    'CREATE INDEX IF NOT EXISTS idx_data_cleaning_tasks_source_path ON data_cleaning_tasks(source_path)',
    'CREATE INDEX IF NOT EXISTS idx_data_datasets_updated_at ON data_datasets(updated_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_datasets_source_kind ON data_datasets(source_kind)',
    'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_artifacts_updated_at ON data_input_table_normalizer_artifacts(updated_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_artifacts_source_kind ON data_input_table_normalizer_artifacts(source_kind)',
    'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_versions_artifact ON data_input_table_normalizer_artifact_versions(artifact_id, version)',
    'CREATE INDEX IF NOT EXISTS idx_input_table_normalizer_versions_status ON data_input_table_normalizer_artifact_versions(status, updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_workflow_nodes_task_id ON data_workflow_nodes(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_data_workflow_edges_task_id ON data_workflow_edges(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_data_workflow_node_caches_task_node ON data_workflow_node_caches(task_id, node_id, updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_workflow_node_caches_expires_at ON data_workflow_node_caches(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_output_commits_state ON data_output_commits(state, updated_at)',
  ];
  for (const statement of indexStatements) {
    await ctx.metaRunSql(statement);
  }

  await ctx.metaRunSql(`
    UPDATE data_workflow_nodes
    SET operator_type = coalesce(operator_type, node_key),
        x = coalesce(x, 48 + (ordinal - 1) * 142),
        y = coalesce(y, 128),
        config_json = coalesce(config_json, '{}'),
        updated_at = coalesce(updated_at, created_at)
  `);
}

async function dropLegacyDemoRows(ctx: DataStoreContext): Promise<void> {
  const placeholders = LEGACY_DEMO_TASK_NAMES.map((_, index) => `$name${index}`).join(', ');
  const values = Object.fromEntries(
    LEGACY_DEMO_TASK_NAMES.map((name, index) => [`name${index}`, name])
  );
  const demoTaskRows = await ctx.metaQueryRows<{ id: string }>(
    `
      SELECT id
      FROM data_cleaning_tasks
      WHERE name IN (${placeholders})
        AND source_path IS NULL
        AND source_dataset_id IS NULL
        AND output_table IS NULL
        AND row_count IS NULL
        AND column_count IS NULL
        AND error IS NULL
        AND last_run_at IS NULL
    `,
    values
  );
  if (demoTaskRows.length > 0) {
    await ctx.metaRunSql(
      `
        DELETE FROM data_workflow_edges
        WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
      `,
      Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
    );
    await ctx.metaRunSql(
      `
        DELETE FROM data_workflow_nodes
        WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
      `,
      Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
    );
    await ctx.metaRunSql(
      `
        DELETE FROM data_cleaning_tasks
        WHERE id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
      `,
      Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
    );
  }
  await ctx.metaRunSql("DELETE FROM data_datasets WHERE source_path LIKE 'local://samples/%'");
}

async function dropLegacyDefaultWorkflowGraphs(ctx: DataStoreContext): Promise<void> {
  const workflowRows = await ctx.metaQueryRows<DataWorkflowNodeRow>(
    `
      SELECT *
      FROM data_workflow_nodes
      ORDER BY task_id ASC, ordinal ASC, created_at ASC
    `
  );
  const rowsByTask = new Map<string, DataWorkflowNodeRow[]>();
  for (const row of workflowRows) {
    const taskId = String(row.task_id);
    rowsByTask.set(taskId, [...(rowsByTask.get(taskId) ?? []), row]);
  }
  const taskIds = Array.from(rowsByTask.entries()).flatMap(([taskId, rows]) =>
    isLegacyDefaultWorkflow(rows) ? [taskId] : []
  );
  if (taskIds.length === 0) {
    return;
  }
  const placeholders = taskIds.map((_, index) => `$id${index}`).join(', ');
  const values = Object.fromEntries(taskIds.map((taskId, index) => [`id${index}`, taskId]));
  await ctx.metaRunSql(
    `
      DELETE FROM data_workflow_edges
      WHERE task_id IN (${placeholders})
    `,
    values
  );
  await ctx.metaRunSql(
    `
      DELETE FROM data_workflow_nodes
      WHERE task_id IN (${placeholders})
    `,
    values
  );
  await ctx.metaRunSql(
    `
      UPDATE data_cleaning_tasks
      SET node_count = 0
      WHERE id IN (${placeholders})
    `,
    values
  );
}

/**
 * Converts pre-`config_json` output-table dataset rows into the current
 * output-table config shape and deletes rows that cannot be converted.
 * Previously ran on every boot and on every output-table read; now runs
 * exactly once per database, recorded in the migration ledger.
 */
async function normalizeOutputTableMetadata(ctx: DataStoreContext): Promise<void> {
  const rows = await ctx.metaQueryRows<DataDatasetRow>(
    `
      SELECT d.*
      FROM data_datasets d
      WHERE ${storedDatasetSourceKindSql('d')} = 'output'
        OR d.table_name IN (
          SELECT output_table
          FROM data_cleaning_tasks
          WHERE output_table IS NOT NULL
        )
    `
  );
  for (const row of rows) {
    const id = String(row.id);
    const config = parseOutputTableConfig(row.config_json);
    if (config.kind === OUTPUT_TABLE_CONFIG_KIND) {
      continue;
    }
    if (isLegacyExplicitOutputTableRow(row)) {
      await ctx.metaRunSql(
        `
          UPDATE data_datasets
          SET config_json = $configJson,
              file_count = coalesce(file_count, 0)
          WHERE id = $id
        `,
        {
          id,
          configJson: outputTableConfigJson(config.sourceDatasetId),
        }
      );
      continue;
    }
    await ctx.metaRunSql('DELETE FROM data_datasets WHERE id = $id', { id });
  }
}

/**
 * Journal for input-table reimports and output-table rebinds. Each commit
 * stages the new physical table under a staging name, keeps the old target
 * under a backup name until metadata commits, and leaves a recoverable row
 * when a crash interrupts the swap.
 */
async function createTableCommitJournal(ctx: DataStoreContext): Promise<void> {
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_table_commits (
      id VARCHAR PRIMARY KEY,
      dataset_id VARCHAR NOT NULL,
      operation VARCHAR NOT NULL,
      staging_table VARCHAR NOT NULL,
      target_table VARCHAR NOT NULL,
      backup_table VARCHAR,
      target_existed INTEGER NOT NULL,
      state VARCHAR NOT NULL,
      error VARCHAR,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await ctx.metaRunSql(
    'CREATE INDEX IF NOT EXISTS idx_data_table_commits_state ON data_table_commits(state, updated_at)'
  );
}

export const METADATA_MIGRATIONS: readonly MetadataMigration[] = [
  {
    version: 1,
    name: 'baseline_schema',
    up: (ctx) => createBaselineSchema(ctx),
  },
  {
    version: 2,
    name: 'drop_legacy_demo_rows',
    up: (ctx) => dropLegacyDemoRows(ctx),
  },
  {
    version: 3,
    name: 'drop_legacy_default_workflow_graphs',
    up: (ctx) => dropLegacyDefaultWorkflowGraphs(ctx),
  },
  {
    version: 4,
    name: 'normalize_output_table_metadata',
    up: (ctx) => normalizeOutputTableMetadata(ctx),
  },
  {
    version: 5,
    name: 'table_commit_journal',
    up: (ctx) => createTableCommitJournal(ctx),
  },
  {
    version: 6,
    name: 'node_run_stats_input_rows_by_handle',
    up: async (ctx) => {
      // PRAGMA table_info works on both metadata engines (SQLite + DuckDB);
      // the column may already exist when a current DB lost its ledger.
      const columns = await ctx.metaQueryRows<{ name: string }>(
        'PRAGMA table_info(data_task_node_run_stats)'
      );
      if (!columns.some((column) => column.name === 'input_rows_by_handle_json')) {
        await ctx.metaRunSql(
          'ALTER TABLE data_task_node_run_stats ADD COLUMN input_rows_by_handle_json VARCHAR'
        );
      }
    },
  },
  {
    version: 7,
    name: 'workflow_node_cache_signature',
    up: async (ctx) => {
      const columns = await ctx.metaQueryRows<{ name: string }>(
        'PRAGMA table_info(data_workflow_node_caches)'
      );
      if (!columns.some((column) => column.name === 'workflow_signature')) {
        await ctx.metaRunSql(
          'ALTER TABLE data_workflow_node_caches ADD COLUMN workflow_signature VARCHAR'
        );
      }
    },
  },
];

export const METADATA_SCHEMA_VERSION = METADATA_MIGRATIONS[METADATA_MIGRATIONS.length - 1].version;

/**
 * Applies every pending migration in version order, each inside its own
 * transaction. A failed migration is rolled back and never recorded in the
 * ledger, so the next launch retries it cleanly.
 */
export async function migrateMetadataSchema(ctx: DataStoreContext): Promise<void> {
  // Detect a newer-version database before writing anything — even creating
  // the ledger is a write, so the existence check must be a pure read.
  const ledgerExists = ctx.metadataDb
    ? (
        await ctx.metaQueryRows<{ found: number }>(
          `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = $name LIMIT 1`,
          { name: METADATA_MIGRATION_LEDGER }
        )
      ).length > 0
    : (
        await ctx.metaQueryRows<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_name = $name LIMIT 1`,
          { name: METADATA_MIGRATION_LEDGER }
        )
      ).length > 0;

  if (ledgerExists) {
    const appliedRows = await ctx.metaQueryRows<{ version: number | string }>(
      `SELECT version FROM ${METADATA_MIGRATION_LEDGER} ORDER BY version ASC`
    );
    const maxApplied = Math.max(0, ...appliedRows.map((row) => Number(row.version)));
    if (maxApplied > METADATA_SCHEMA_VERSION) {
      ctx.metadataReadOnly = true;
      ctx.metadataReadOnlyReason =
        `Data task metadata schema v${maxApplied} is newer than this build ` +
        `(supports v${METADATA_SCHEMA_VERSION}); writes are disabled`;
      logWarn(`[DataTaskStore] ${ctx.metadataReadOnlyReason}`);
      return;
    }
  }

  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS ${METADATA_MIGRATION_LEDGER} (
      version INTEGER PRIMARY KEY,
      name VARCHAR NOT NULL,
      applied_at BIGINT NOT NULL
    )
  `);
  const appliedRows = await ctx.metaQueryRows<{ version: number | string }>(
    `SELECT version FROM ${METADATA_MIGRATION_LEDGER} ORDER BY version ASC`
  );
  const applied = new Set(appliedRows.map((row) => Number(row.version)));

  for (const migration of METADATA_MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    await ctx.metaRunSql('BEGIN TRANSACTION');
    try {
      await migration.up(ctx);
      await ctx.metaRunSql(
        `INSERT INTO ${METADATA_MIGRATION_LEDGER} (version, name, applied_at) VALUES ($version, $name, $appliedAt)`,
        { version: migration.version, name: migration.name, appliedAt: ctx.now() }
      );
      await ctx.metaRunSql('COMMIT');
    } catch (error) {
      await ctx.metaRunSql('ROLLBACK').catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Metadata migration v${migration.version} (${migration.name}) failed: ${message}`
      );
    }
    applied.add(migration.version);
    log('[DataTaskStore] Applied metadata migration', {
      version: migration.version,
      name: migration.name,
    });
  }
}
