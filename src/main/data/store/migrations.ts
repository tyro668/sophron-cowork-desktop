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
import { migrateConfigToV3Naming } from './v3-config-naming';
import { computeNextAutomationRunAt } from '../../automation/automation-trigger';
import type { AutomationTrigger } from '../../../shared/automation/types';
import { log, logWarn } from '../../utils/logger';
import {
  LEGACY_DEMO_TASK_NAMES,
  RESULT_TABLE_CONFIG_KIND,
  isLegacyExplicitResultTableRow,
  resultTableConfigJson,
  parseResultTableConfig,
  storedRawTableSourceKindSql,
  type DataRawTableRow,
} from './data-store-records';
import { formatOperator } from '../../../shared/prep-dsl/operators/formatter';
import { parsePrepOperatorDsl } from '../../../shared/prep-dsl/operators/parser';
import type { PrepOperatorType } from '../../../shared/prep-dsl/ast';
import { isLegacyDefaultWorkflow, type DataWorkflowNodeRow } from './workflow-model';
import type { DataStoreContext } from './data-store-context';
import { tokenizeExpression } from '../../../shared/expression-tokenizer';

export interface MetadataMigration {
  readonly version: number;
  readonly name: string;
  up(ctx: DataStoreContext): Promise<void>;
}

export const METADATA_MIGRATION_LEDGER = 'data_schema_migrations';

/** Rewrites every workflow node config through `transform` (null = unchanged). */
/** Operator types before v19 → unified names (type = DSL keyword = UI concept). */
const LEGACY_OPERATOR_TYPES: Record<string, string> = {
  input_source: 'input',
  field_select: 'select',
  type_convert: 'cast',
  calculate_field: 'derive',
  field_mapping: 'rename',
  sql_query: 'sql',
};

async function renameLegacyOperatorTypes(ctx: DataStoreContext): Promise<void> {
  for (const [from, to] of Object.entries(LEGACY_OPERATOR_TYPES)) {
    await ctx.metaRunSql(
      'UPDATE data_workflow_nodes SET operator_type = $to WHERE operator_type = $from',
      { from, to }
    );
    await ctx.metaRunSql(
      'UPDATE data_pipeline_node_run_stats SET node_type = $to WHERE node_type = $from',
      { from, to }
    );
  }
}

async function migrateWorkflowNodeConfigs(
  ctx: DataStoreContext,
  transform: (type: string, config: Record<string, unknown>) => Record<string, unknown> | null
): Promise<void> {
  const rows = await ctx.metaQueryRows<{ id: string; operator_type: string; config_json: string }>(
    'SELECT id, operator_type, config_json FROM data_workflow_nodes'
  );
  for (const row of rows) {
    let config: unknown;
    try {
      config = JSON.parse(row.config_json || '{}');
    } catch {
      continue;
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
    const type = LEGACY_OPERATOR_TYPES[row.operator_type] ?? row.operator_type;
    const next = transform(type, config as Record<string, unknown>);
    if (!next) continue;
    await ctx.metaRunSql('UPDATE data_workflow_nodes SET config_json = $config WHERE id = $id', {
      id: row.id,
      config: JSON.stringify(next),
    });
  }
}

const EXPRESSION_CONFIG_KEYS = new Set(['condition', 'expression', 'having', 'predicate']);

/** Rewrites double-quoted string literals ("x") to SQL text literals ('x'). Before v17 a
 *  double-quoted token in an expression was always text; from v17 it names a field. */
export function rewriteDoubleQuotedLiterals(expression: string): string {
  let tokens;
  try {
    tokens = tokenizeExpression(expression);
  } catch {
    return expression;
  }
  let out = '';
  let cursor = 0;
  for (const token of tokens) {
    if (token.type !== 'StringLiteral' || !token.value.startsWith('"')) continue;
    let text: string;
    try {
      text = JSON.parse(token.value) as string;
    } catch {
      text = token.value.slice(1, -1).replace(/\\"/g, '"');
    }
    out += expression.slice(cursor, token.start) + `'${text.replace(/'/g, "''")}'`;
    cursor = token.end;
  }
  return cursor === 0 ? expression : out + expression.slice(cursor);
}

function rewriteQuotedValue(value: unknown, key?: string): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    if (!key || !EXPRESSION_CONFIG_KEYS.has(key) || !value.includes('"')) {
      return { value, changed: false };
    }
    const next = rewriteDoubleQuotedLiterals(value);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = rewriteQuotedValue(item, key);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      const result = rewriteQuotedValue(child, childKey);
      changed ||= result.changed;
      next[childKey] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

export function migrateConfigQuoteSemantics(
  _type: string,
  config: Record<string, unknown>
): Record<string, unknown> | null {
  const result = rewriteQuotedValue(config);
  return result.changed ? (result.value as Record<string, unknown>) : null;
}

/** One-time: structured config becomes the single source of truth. Nodes that
 *  only carried DSL text are parsed into structure; the cached text is dropped. */
export function stripCachedOperatorDsl(
  type: string,
  config: Record<string, unknown>
): Record<string, unknown> | null {
  if (!('dsl' in config)) return null;
  const { dsl, ...rest } = config;
  const unstructured =
    type === 'input'
      ? !['source', 'rawTableId', 'filePath', 'name'].some((key) => typeof rest[key] === 'string')
      : !formatOperator({ id: '', type: type as PrepOperatorType, config: rest });
  if (typeof dsl === 'string' && dsl.trim() && unstructured) {
    const parsed = parsePrepOperatorDsl(dsl, type as PrepOperatorType);
    if (parsed.operator?.type === type) return { ...parsed.operator.config, ...rest };
  }
  return rest;
}

async function createBaselineSchema(ctx: DataStoreContext): Promise<void> {
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_pipelines (
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
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_raw_tables (
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
  await ctx.ensureMetadataColumn('data_raw_tables', 'source_kind', 'VARCHAR');
  await ctx.ensureMetadataColumn('data_raw_tables', 'config_json', 'VARCHAR');
  await ctx.ensureMetadataColumn('data_raw_tables', 'file_count', 'INTEGER');
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_raw_table_normalizer_artifacts (
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
    CREATE TABLE IF NOT EXISTS data_raw_table_normalizer_artifact_versions (
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
      pipeline_id VARCHAR NOT NULL,
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
      pipeline_id VARCHAR NOT NULL,
      source_node_id VARCHAR NOT NULL,
      target_node_id VARCHAR NOT NULL,
      source_handle VARCHAR,
      target_handle VARCHAR,
      created_at BIGINT NOT NULL
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_pipeline_watermarks (
      pipeline_id VARCHAR NOT NULL,
      node_id VARCHAR NOT NULL,
      column_name VARCHAR NOT NULL,
      watermark_value VARCHAR,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (pipeline_id, node_id)
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_pipeline_node_run_stats (
      pipeline_id VARCHAR NOT NULL,
      run_id VARCHAR NOT NULL,
      node_id VARCHAR NOT NULL,
      node_type VARCHAR NOT NULL,
      input_rows BIGINT,
      output_rows BIGINT NOT NULL,
      dropped_rows BIGINT NOT NULL,
      rejected_rows BIGINT NOT NULL,
      sample_json VARCHAR,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (pipeline_id, run_id, node_id)
    )
  `);
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_workflow_node_caches (
      id VARCHAR PRIMARY KEY,
      pipeline_id VARCHAR NOT NULL,
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
      pipeline_id VARCHAR NOT NULL,
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
    'CREATE INDEX IF NOT EXISTS idx_data_pipelines_updated_at ON data_pipelines(updated_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_pipelines_source_raw_table_id ON data_pipelines(source_raw_table_id)',
    'CREATE INDEX IF NOT EXISTS idx_data_pipelines_source_path ON data_pipelines(source_path)',
    'CREATE INDEX IF NOT EXISTS idx_data_raw_tables_updated_at ON data_raw_tables(updated_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_raw_tables_source_kind ON data_raw_tables(source_kind)',
    'CREATE INDEX IF NOT EXISTS idx_raw_table_normalizer_artifacts_updated_at ON data_raw_table_normalizer_artifacts(updated_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_raw_table_normalizer_artifacts_source_kind ON data_raw_table_normalizer_artifacts(source_kind)',
    'CREATE INDEX IF NOT EXISTS idx_raw_table_normalizer_versions_artifact ON data_raw_table_normalizer_artifact_versions(artifact_id, version)',
    'CREATE INDEX IF NOT EXISTS idx_raw_table_normalizer_versions_status ON data_raw_table_normalizer_artifact_versions(status, updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_data_workflow_nodes_pipeline_id ON data_workflow_nodes(pipeline_id)',
    'CREATE INDEX IF NOT EXISTS idx_data_workflow_edges_pipeline_id ON data_workflow_edges(pipeline_id)',
    'CREATE INDEX IF NOT EXISTS idx_data_workflow_node_caches_pipeline_node ON data_workflow_node_caches(pipeline_id, node_id, updated_at)',
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
  const demoPipelineRows = await ctx.metaQueryRows<{ id: string }>(
    `
      SELECT id
      FROM data_pipelines
      WHERE name IN (${placeholders})
        AND source_path IS NULL
        AND source_raw_table_id IS NULL
        AND result_table IS NULL
        AND row_count IS NULL
        AND column_count IS NULL
        AND error IS NULL
        AND last_run_at IS NULL
    `,
    values
  );
  if (demoPipelineRows.length > 0) {
    await ctx.metaRunSql(
      `
        DELETE FROM data_workflow_edges
        WHERE pipeline_id IN (${demoPipelineRows.map((_, index) => `$id${index}`).join(', ')})
      `,
      Object.fromEntries(demoPipelineRows.map((row, index) => [`id${index}`, row.id]))
    );
    await ctx.metaRunSql(
      `
        DELETE FROM data_workflow_nodes
        WHERE pipeline_id IN (${demoPipelineRows.map((_, index) => `$id${index}`).join(', ')})
      `,
      Object.fromEntries(demoPipelineRows.map((row, index) => [`id${index}`, row.id]))
    );
    await ctx.metaRunSql(
      `
        DELETE FROM data_pipelines
        WHERE id IN (${demoPipelineRows.map((_, index) => `$id${index}`).join(', ')})
      `,
      Object.fromEntries(demoPipelineRows.map((row, index) => [`id${index}`, row.id]))
    );
  }
  await ctx.metaRunSql("DELETE FROM data_raw_tables WHERE source_path LIKE 'local://samples/%'");
}

async function dropLegacyDefaultWorkflowGraphs(ctx: DataStoreContext): Promise<void> {
  const workflowRows = await ctx.metaQueryRows<DataWorkflowNodeRow>(
    `
      SELECT *
      FROM data_workflow_nodes
      ORDER BY pipeline_id ASC, ordinal ASC, created_at ASC
    `
  );
  const rowsByPipeline = new Map<string, DataWorkflowNodeRow[]>();
  for (const row of workflowRows) {
    const pipelineId = String(row.pipeline_id);
    rowsByPipeline.set(pipelineId, [...(rowsByPipeline.get(pipelineId) ?? []), row]);
  }
  const pipelineIds = Array.from(rowsByPipeline.entries()).flatMap(([pipelineId, rows]) =>
    isLegacyDefaultWorkflow(rows) ? [pipelineId] : []
  );
  if (pipelineIds.length === 0) {
    return;
  }
  const placeholders = pipelineIds.map((_, index) => `$id${index}`).join(', ');
  const values = Object.fromEntries(
    pipelineIds.map((pipelineId, index) => [`id${index}`, pipelineId])
  );
  await ctx.metaRunSql(
    `
      DELETE FROM data_workflow_edges
      WHERE pipeline_id IN (${placeholders})
    `,
    values
  );
  await ctx.metaRunSql(
    `
      DELETE FROM data_workflow_nodes
      WHERE pipeline_id IN (${placeholders})
    `,
    values
  );
  await ctx.metaRunSql(
    `
      UPDATE data_pipelines
      SET node_count = 0
      WHERE id IN (${placeholders})
    `,
    values
  );
}

/**
 * Converts pre-`config_json` result-table rawTable rows into the current
 * result-table config shape and deletes rows that cannot be converted.
 * Previously ran on every boot and on every result-table read; now runs
 * exactly once per database, recorded in the migration ledger.
 */
async function normalizeResultTableMetadata(ctx: DataStoreContext): Promise<void> {
  const rows = await ctx.metaQueryRows<DataRawTableRow>(
    `
      SELECT d.*
      FROM data_raw_tables d
      WHERE ${storedRawTableSourceKindSql('d')} = 'output'
        OR d.table_name IN (
          SELECT result_table
          FROM data_pipelines
          WHERE result_table IS NOT NULL
        )
    `
  );
  for (const row of rows) {
    const id = String(row.id);
    const config = parseResultTableConfig(row.config_json);
    if (config.kind === RESULT_TABLE_CONFIG_KIND) {
      continue;
    }
    if (isLegacyExplicitResultTableRow(row)) {
      await ctx.metaRunSql(
        `
          UPDATE data_raw_tables
          SET config_json = $configJson,
              file_count = coalesce(file_count, 0)
          WHERE id = $id
        `,
        {
          id,
          configJson: resultTableConfigJson(config.sourceRawTableId),
        }
      );
      continue;
    }
    await ctx.metaRunSql('DELETE FROM data_raw_tables WHERE id = $id', { id });
  }
}

/**
 * Journal for raw-table reimports and result-table rebinds. Each commit
 * stages the new physical table under a staging name, keeps the old target
 * under a backup name until metadata commits, and leaves a recoverable row
 * when a crash interrupts the swap.
 */
async function createTableCommitJournal(ctx: DataStoreContext): Promise<void> {
  await ctx.metaRunSql(`
    CREATE TABLE IF NOT EXISTS data_table_commits (
      id VARCHAR PRIMARY KEY,
      raw_table_id VARCHAR NOT NULL,
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
    name: 'normalize_result_table_metadata',
    up: (ctx) => normalizeResultTableMetadata(ctx),
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
        'PRAGMA table_info(data_pipeline_node_run_stats)'
      );
      if (!columns.some((column) => column.name === 'input_rows_by_handle_json')) {
        await ctx.metaRunSql(
          'ALTER TABLE data_pipeline_node_run_stats ADD COLUMN input_rows_by_handle_json VARCHAR'
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
  {
    version: 8,
    name: 'output_cloud_actions_to_automations',
    up: async (ctx) => {
      // Standalone DuckDB stores have no automation service. Preserve their
      // legacy metadata in those standalone stores.
      if (!ctx.metadataDb) return;
      const tables = await ctx.metaQueryRows<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automations'"
      );
      if (!tables.length) return;
      const rows = await ctx.metaQueryRows<{
        id: string;
        name: string;
        config_json: string | null;
      }>('SELECT id, name, config_json FROM data_raw_tables WHERE config_json IS NOT NULL');
      for (const row of rows) {
        const config = parseResultTableConfig(row.config_json);
        const action = config.cloudAction;
        if (!action || config.kind !== RESULT_TABLE_CONFIG_KIND) continue;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const trigger: AutomationTrigger =
          action.trigger === 'schedule' && action.schedule
            ? { ...action.schedule, timezone }
            : { kind: 'manual', timezone };
        const { lastRunAt, lastError } = action;
        const target = {
          type: action.type,
          spaceId: action.spaceId,
          projectId: action.projectId,
          tableId: action.tableId,
          tableName: action.tableName,
          fileId: action.fileId,
          fileName: action.fileName,
          version: action.version,
          syncKey: `cowork-output-${row.id}`,
        };
        const now = ctx.now();
        await ctx.metaRunSql(
          `INSERT INTO automations (
          id, name, enabled, status, trigger_json, action_graph_json,
          failure_policy_json, concurrency_json, next_run_at, last_run_at,
          last_error, created_at, updated_at, output_bindings_json
        ) VALUES ($id, $name, 1, 'enabled', $trigger, $graph, $failure,
          $concurrency, $nextRunAt, $lastRunAt, $lastError, $now, $now, $bindings)`,
          {
            id: `output-cloud-${row.id}`,
            name: row.name,
            trigger: JSON.stringify(trigger),
            graph: JSON.stringify({
              version: 1,
              edges: [],
              nodes: [
                {
                  id: 'cloud-sync',
                  type: 'cloud.output.sync',
                  enabled: true,
                  config: { ...target, resultTableId: row.id },
                },
              ],
            }),
            failure: JSON.stringify({
              disableOnFailure: false,
              retry: { enabled: false, maxAttempts: 0, backoffMs: 1000 },
              notifyOnFailure: true,
            }),
            concurrency: JSON.stringify({ overlapPolicy: 'skip' }),
            nextRunAt: computeNextAutomationRunAt(trigger, now),
            lastRunAt: lastRunAt ?? null,
            lastError: lastError ?? null,
            now,
            bindings: JSON.stringify([
              { resultTableId: row.id, runOnChange: action.trigger === 'on_change' },
            ]),
          }
        );
        await ctx.metaRunSql(
          "UPDATE data_raw_tables SET config_json = $config, source_kind = 'output' WHERE id = $id",
          {
            id: row.id,
            config: resultTableConfigJson(config.sourceRawTableId),
          }
        );
      }
    },
  },
  {
    version: 9,
    name: 'restrict_output_automations_to_drive_files',
    up: async (ctx) => {
      if (!ctx.metadataDb) return;
      const tables = await ctx.metaQueryRows<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automations'"
      );
      if (!tables.length) return;
      const rows = await ctx.metaQueryRows<{ id: string; action_graph_json: string }>(
        'SELECT id, action_graph_json FROM automations'
      );
      for (const row of rows) {
        const graph = JSON.parse(row.action_graph_json) as {
          nodes?: Array<{ type: string; config?: { type?: string } }>;
        };
        if (
          !graph.nodes?.some(
            (node) => node.type === 'cloud.output.sync' && node.config?.type === 'cloud_table'
          )
        )
          continue;
        // Preserve the old destination for review; never silently redirect data.
        await ctx.metaRunSql(
          "UPDATE automations SET status = 'paused', next_run_at = NULL, last_error = $error WHERE id = $id",
          { id: row.id, error: 'schedule.cloudSync.legacyTarget' }
        );
      }
    },
  },
  {
    version: 10,
    name: 'restrict_generated_automation_outputs',
    up: async (ctx) => {
      if (!ctx.metadataDb) return;
      const tables = await ctx.metaQueryRows<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automations'"
      );
      if (!tables.length) return;
      const rows = await ctx.metaQueryRows<{ id: string; action_graph_json: string }>(
        'SELECT id, action_graph_json FROM automations'
      );
      for (const row of rows) {
        const graph = JSON.parse(row.action_graph_json) as {
          nodes?: Array<{
            type: string;
            config?: {
              output?: { location?: string };
              cloudAutomation?: { output?: { location?: string } };
            };
          }>;
        };
        if (
          !graph.nodes?.some(
            (node) =>
              (node.type === 'cloud.table.process' && node.config?.output?.location === 'cloud') ||
              node.config?.cloudAutomation?.output?.location === 'cloud'
          )
        )
          continue;
        await ctx.metaRunSql(
          "UPDATE automations SET status = 'paused', next_run_at = NULL, last_error = $error WHERE id = $id",
          { id: row.id, error: 'schedule.cloudSync.useOutputAction' }
        );
      }
    },
  },
  {
    version: 11,
    name: 'merge_cloud_sync_action_types',
    up: async (ctx) => {
      if (!ctx.metadataDb) return;
      const tables = await ctx.metaQueryRows<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automations'"
      );
      if (!tables.length) return;
      const rows = await ctx.metaQueryRows<{ id: string; action_graph_json: string }>(
        'SELECT id, action_graph_json FROM automations'
      );
      for (const row of rows) {
        const graph = JSON.parse(row.action_graph_json) as {
          nodes?: Array<{ type: string; config?: Record<string, unknown> }>;
        };
        let changed = false;
        for (const node of graph.nodes ?? []) {
          const direction =
            node.type === 'cloud.input.sync'
              ? 'input'
              : node.type === 'cloud.output.sync'
                ? 'output'
                : '';
          if (!direction) continue;
          node.type = 'cloud.sync';
          node.config = { direction, ...node.config };
          changed = true;
        }
        if (changed)
          await ctx.metaRunSql('UPDATE automations SET action_graph_json = $graph WHERE id = $id', {
            id: row.id,
            graph: JSON.stringify(graph),
          });
      }
    },
  },
  {
    version: 12,
    name: 'data_list_groups',
    up: async (ctx) => {
      await ctx.metaRunSql(`
        CREATE TABLE IF NOT EXISTS data_groups (
          id VARCHAR PRIMARY KEY,
          scope VARCHAR NOT NULL,
          name VARCHAR NOT NULL,
          sort_index BIGINT NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL
        )
      `);
      await ctx.metaRunSql(
        'CREATE INDEX IF NOT EXISTS idx_data_groups_scope ON data_groups(scope)'
      );
      await ctx.ensureMetadataColumn('data_pipelines', 'group_id', 'VARCHAR');
      await ctx.ensureMetadataColumn('data_raw_tables', 'group_id', 'VARCHAR');
    },
  },
  {
    version: 13,
    name: 'data_pipeline_runs',
    up: async (ctx) => {
      // Per-run records so the logs tab can answer "what happened in this
      // run" for both trial and persisted executions. Node stats stay keyed
      // by run_id and are retained alongside their run row.
      await ctx.metaRunSql(`
        CREATE TABLE IF NOT EXISTS data_pipeline_runs (
          id VARCHAR PRIMARY KEY,
          pipeline_id VARCHAR NOT NULL,
          seq INTEGER NOT NULL,
          trigger VARCHAR NOT NULL,
          status VARCHAR NOT NULL,
          workflow_signature VARCHAR,
          input_rows BIGINT,
          output_rows BIGINT,
          error VARCHAR,
          failed_node_id VARCHAR,
          started_at BIGINT NOT NULL,
          finished_at BIGINT,
          created_at BIGINT NOT NULL
        )
      `);
      await ctx.metaRunSql(
        'CREATE INDEX IF NOT EXISTS idx_data_pipeline_runs_pipeline ON data_pipeline_runs(pipeline_id, seq DESC)'
      );
    },
  },
  {
    version: 14,
    name: 'cloud_raw_table_source',
    up: async (ctx) => {
      const rows = await ctx.metaQueryRows<{ id: string; config_json: string }>(
        `SELECT id, config_json FROM data_raw_tables WHERE source_kind = 'csv' OR source_kind IS NULL`
      );
      for (const row of rows) {
        let config;
        try {
          config = JSON.parse(row.config_json);
        } catch {
          continue;
        }
        if (
          config?.sourceKind !== 'csv' ||
          typeof config.cloudMirror?.tableId !== 'string' ||
          !config.cloudMirror.tableId.trim()
        )
          continue;
        const cloudConfig = { ...config, sourceKind: 'cloud' };
        for (const key of ['header', 'dataRegion', 'encoding', 'delimiter'])
          delete cloudConfig[key];
        await ctx.metaRunSql(
          `UPDATE data_raw_tables SET source_kind = 'cloud', config_json = $config WHERE id = $id`,
          { id: row.id, config: JSON.stringify(cloudConfig) }
        );
      }
    },
  },
  {
    version: 15,
    name: 'strip_cached_operator_dsl',
    up: (ctx) => migrateWorkflowNodeConfigs(ctx, stripCachedOperatorDsl),
  },
  {
    version: 16,
    name: 'prep_dsl_v3_config_naming',
    up: (ctx) => migrateWorkflowNodeConfigs(ctx, migrateConfigToV3Naming),
  },
  {
    version: 17,
    name: 'expression_sql_quote_semantics',
    up: (ctx) => migrateWorkflowNodeConfigs(ctx, migrateConfigQuoteSemantics),
  },
  {
    // Idempotent re-run of v17: an interrupted build could record v17 without rewriting.
    // Configs already using 'text' literals are left untouched.
    version: 18,
    name: 'expression_sql_quote_semantics_verify',
    up: (ctx) => migrateWorkflowNodeConfigs(ctx, migrateConfigQuoteSemantics),
  },
  {
    version: 19,
    name: 'unify_operator_type_names',
    up: (ctx) => renameLegacyOperatorTypes(ctx),
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
        `Data pipeline metadata schema v${maxApplied} is newer than this build ` +
        `(supports v${METADATA_SCHEMA_VERSION}); writes are disabled`;
      logWarn(`[DataPipelineStore] ${ctx.metadataReadOnlyReason}`);
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
    log('[DataPipelineStore] Applied metadata migration', {
      version: migration.version,
      name: migration.name,
    });
  }
}
