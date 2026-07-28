import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { AsyncLocalStorage } from 'async_hooks';
import type Database from 'better-sqlite3';
import * as fs from 'fs';
import { dirname } from 'path';
import type {
  DataColumnTypeInfo,
  DataInputTableSourceSummary,
  DataSummarizeInputTableSourceInput,
} from '../../../renderer/types';
import {
  dataFieldTypeFromDuckDbType,
  duckDbTypeForDataFieldType,
} from '../../../shared/data-field-types';
import { log } from '../../utils/logger';
import { compileTypedProjection, quoteIdentifier, toNumber } from '../operators';
import {
  DataDatasetRow,
  DataTaskStoreOptions,
  LEGACY_DEMO_TASK_NAMES,
  OUTPUT_TABLE_CONFIG_KIND,
  isDuckDbTransactionStateError,
  isLegacyExplicitOutputTableRow,
  outputTableConfigJson,
  parseOutputTableConfig,
  storedDatasetSourceKindSql,
} from './data-store-records';
import { inferDataFieldTypeFromValues } from './input-source';
import { DataWorkflowNodeRow, isLegacyDefaultWorkflow } from './workflow-model';

export abstract class DataStoreRuntime {
  protected readonly dbPath: string;

  protected readonly now: () => number;

  protected readonly metadataDb: Database.Database | null;

  protected instance: DuckDBInstance | null = null;

  protected connection: DuckDBConnection | null = null;

  protected metadataInitPromise: Promise<void> | null = null;

  protected duckInitPromise: Promise<void> | null = null;

  protected exclusiveQueue: Promise<void> = Promise.resolve();

  protected readonly exclusiveContext = new AsyncLocalStorage<boolean>();

  constructor(dbPath: string, options: DataTaskStoreOptions = {}) {
    this.dbPath = dbPath;
    this.now = options.now ?? (() => Date.now());
    if (options.metadataDb) {
      this.metadataDb = options.metadataDb.raw;
    } else {
      this.metadataDb = null;
    }
  }

  async runExclusive<T>(work: () => Promise<T>, label = 'duckdb'): Promise<T> {
    if (this.exclusiveContext.getStore()) {
      return work();
    }
    const queuedAt = Date.now();
    const previous = this.exclusiveQueue;
    let release!: () => void;
    this.exclusiveQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    const startedAt = Date.now();
    const waitMs = startedAt - queuedAt;
    try {
      return await this.exclusiveContext.run(true, work);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isDuckDbTransactionStateError(message)) {
        await this.recoverDuckDbTransactionState();
      }
      throw error;
    } finally {
      const durationMs = Date.now() - startedAt;
      if (waitMs > 0 || durationMs >= 1_000) {
        log('[DataTaskStore] DuckDB exclusive section finished', {
          label,
          waitMs,
          durationMs,
        });
      }
      release();
    }
  }

  close(): void {
    try {
      this.connection?.closeSync();
    } finally {
      this.connection = null;
      try {
        this.instance?.closeSync();
      } finally {
        this.instance = null;
        this.duckInitPromise = null;
        this.metadataInitPromise = null;
      }
    }
  }

  protected async ensureMetadataReady(): Promise<void> {
    if (!this.metadataInitPromise) {
      this.metadataInitPromise = this.initializeMetadata();
    }
    await this.metadataInitPromise;
  }

  protected async ensureReady(): Promise<void> {
    await this.ensureMetadataReady();
    await this.ensureDuckDbReady();
  }

  protected async ensureDuckDbReady(): Promise<void> {
    if (this.connection) {
      return;
    }
    if (!this.duckInitPromise) {
      this.duckInitPromise = this.initializeDuckDb();
    }
    await this.duckInitPromise;
  }

  protected async initializeDuckDb(): Promise<void> {
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    this.instance = await DuckDBInstance.create(this.dbPath);
    this.connection = await this.instance.connect();
  }

  protected async recoverDuckDbTransactionState(): Promise<void> {
    try {
      await this.runSql('ROLLBACK');
    } catch {
      await this.resetDuckDbConnection();
    }
  }

  protected async resetDuckDbConnection(): Promise<void> {
    try {
      this.connection?.closeSync();
    } catch {
      // Ignore close failures while replacing a broken connection.
    } finally {
      this.connection = null;
    }
    try {
      this.instance?.closeSync();
    } catch {
      // Ignore close failures while replacing a broken connection.
    } finally {
      this.instance = null;
      this.duckInitPromise = null;
    }
    await this.ensureDuckDbReady();
  }

  protected async initializeMetadata(): Promise<void> {
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    if (!this.metadataDb) {
      await this.ensureDuckDbReady();
    }
    await this.createSchema();
    await this.removeLegacyDemoRows();
    await this.removeLegacyDefaultWorkflowGraphs();
  }

  protected async createSchema(): Promise<void> {
    await this.metaRunSql(`
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
    await this.metaRunSql(`
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
    await this.ensureMetadataColumn('data_datasets', 'source_kind', 'VARCHAR');
    await this.ensureMetadataColumn('data_datasets', 'config_json', 'VARCHAR');
    await this.ensureMetadataColumn('data_datasets', 'file_count', 'INTEGER');
    await this.cleanupOutputTableMetadata();
    await this.metaRunSql(`
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
    await this.metaRunSql(`
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
    await this.metaRunSql(`
        CREATE TABLE IF NOT EXISTS data_workflow_nodes (
          id VARCHAR PRIMARY KEY,
          task_id VARCHAR NOT NULL,
          node_key VARCHAR NOT NULL,
          label VARCHAR NOT NULL,
          ordinal INTEGER NOT NULL,
          created_at BIGINT NOT NULL
        )
      `);
    await this.ensureMetadataColumn('data_workflow_nodes', 'operator_type', 'VARCHAR');
    await this.ensureMetadataColumn('data_workflow_nodes', 'x', 'DOUBLE');
    await this.ensureMetadataColumn('data_workflow_nodes', 'y', 'DOUBLE');
    await this.ensureMetadataColumn('data_workflow_nodes', 'config_json', 'VARCHAR');
    await this.ensureMetadataColumn('data_workflow_nodes', 'updated_at', 'BIGINT');
    await this.metaRunSql(`
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
    await this.metaRunSql(`
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
    await this.createMetadataIndexes();
    await this.metaRunSql(`
        UPDATE data_workflow_nodes
        SET operator_type = coalesce(operator_type, node_key),
            x = coalesce(x, 48 + (ordinal - 1) * 142),
            y = coalesce(y, 128),
            config_json = coalesce(config_json, '{}'),
            updated_at = coalesce(updated_at, created_at)
      `);
  }

  protected async cleanupOutputTableMetadata(): Promise<void> {
    const rows = await this.metaQueryRows<DataDatasetRow>(
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
        await this.metaRunSql(
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
      await this.metaRunSql('DELETE FROM data_datasets WHERE id = $id', { id });
    }
  }

  protected async ensureMetadataColumn(
    tableName: string,
    columnName: string,
    definition: string
  ): Promise<void> {
    if (this.metadataDb) {
      const rows = await this.metaQueryRows<{ name: string }>(
        `PRAGMA table_info(${quoteIdentifier(tableName)})`
      );
      if (!rows.some((row) => row.name === columnName)) {
        await this.metaRunSql(
          `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
        );
      }
      return;
    }

    const rows = await this.queryRows<{ column_name: string }>(
      `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = $tableName
            AND column_name = $columnName
          LIMIT 1
        `,
      { tableName, columnName }
    );
    if (rows.length === 0) {
      await this.metaRunSql(
        `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
      );
    }
  }

  protected async createMetadataIndexes(): Promise<void> {
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
    ];
    for (const statement of indexStatements) {
      await this.metaRunSql(statement);
    }
  }

  protected async removeLegacyDemoRows(): Promise<void> {
    const placeholders = LEGACY_DEMO_TASK_NAMES.map((_, index) => `$name${index}`).join(', ');
    const values = Object.fromEntries(
      LEGACY_DEMO_TASK_NAMES.map((name, index) => [`name${index}`, name])
    );
    const demoTaskRows = await this.metaQueryRows<{ id: string }>(
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
      await this.metaRunSql(
        `
            DELETE FROM data_workflow_edges
            WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
          `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
      await this.metaRunSql(
        `
            DELETE FROM data_workflow_nodes
            WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
          `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
      await this.metaRunSql(
        `
            DELETE FROM data_cleaning_tasks
            WHERE id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
          `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
    }
    await this.metaRunSql("DELETE FROM data_datasets WHERE source_path LIKE 'local://samples/%'");
  }

  protected async removeLegacyDefaultWorkflowGraphs(): Promise<void> {
    const workflowRows = await this.metaQueryRows<DataWorkflowNodeRow>(
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
    await this.metaRunSql(
      `
          DELETE FROM data_workflow_edges
          WHERE task_id IN (${placeholders})
        `,
      values
    );
    await this.metaRunSql(
      `
          DELETE FROM data_workflow_nodes
          WHERE task_id IN (${placeholders})
        `,
      values
    );
    await this.metaRunSql(
      `
          UPDATE data_cleaning_tasks
          SET node_count = 0
          WHERE id IN (${placeholders})
        `,
      values
    );
  }

  protected async getTableColumns(tableName: string): Promise<string[]> {
    const rows = await this.queryRows<{ column_name: string }>(
      `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = $tableName
          ORDER BY ordinal_position
        `,
      { tableName }
    );
    return rows.map((row) => String(row.column_name));
  }

  protected async inferTableColumnTypes(tableName: string): Promise<DataColumnTypeInfo[]> {
    const physicalTypes = await this.getTableColumnTypes(tableName);
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 1000`
    );
    return physicalTypes.map((column) => {
      if (column.type !== 'text') {
        return column;
      }
      const inferredType = inferDataFieldTypeFromValues(rows.map((row) => row[column.name]));
      return {
        name: column.name,
        type: inferredType,
        storageType: duckDbTypeForDataFieldType(inferredType),
      };
    });
  }

  protected async createTypedTableFromRelation(
    tableName: string,
    relationTableName: string
  ): Promise<void> {
    const columnTypes = await this.inferTableColumnTypes(relationTableName);
    const projections =
      columnTypes.length > 0
        ? columnTypes
            .map((column) => compileTypedProjection(column, quoteIdentifier(column.name)))
            .join(', ')
        : '*';
    await this.runSql(
      `CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT ${projections} FROM ${quoteIdentifier(
        relationTableName
      )}`
    );
  }

  protected async countRows(tableName: string): Promise<number> {
    const rows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`
    );
    return toNumber(rows[0]?.count);
  }

  protected async dropTableIfExists(tableName: string): Promise<void> {
    await this.runSql(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
  }

  protected async physicalTableExists(tableName: string): Promise<boolean> {
    const rows = await this.queryRows<{ table_name: string }>(
      `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_name = $tableName
          LIMIT 1
        `,
      { tableName }
    );
    return rows.length > 0;
  }

  protected async metaRunSql(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<void> {
    if (!this.metadataDb) {
      await this.runSql(sql, values);
      return;
    }
    if (values) {
      this.metadataDb.prepare(sql).run(values);
      return;
    }
    this.metadataDb.exec(sql);
  }

  protected async metaQueryRows<T extends object>(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<T[]> {
    if (!this.metadataDb) {
      return this.queryRows<T>(sql, values);
    }
    return this.metadataDb.prepare(sql).all(values ?? {}) as T[];
  }

  protected relatedTaskNamesSeparatorSql(): string {
    return this.metadataDb ? 'char(31)' : 'chr(31)';
  }

  protected inputTableRelatedTaskNamesSql(inputAlias: string): string {
    return `
        (
          SELECT group_concat(t.name, ${this.relatedTaskNamesSeparatorSql()})
          FROM data_cleaning_tasks t
          WHERE t.source_dataset_id = ${inputAlias}.id
            OR t.source_path = ${inputAlias}.source_path
            OR EXISTS (
              SELECT 1
              FROM data_workflow_nodes n
              WHERE n.task_id = t.id
                AND coalesce(n.operator_type, n.node_key) IN ('input_source', 'read_source')
                AND (
                  coalesce(n.config_json, '') LIKE '%"datasetId":"' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"datasetId": "' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"inputTableId":"' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"inputTableId": "' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"sourceDatasetId":"' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"sourceDatasetId": "' || ${inputAlias}.id || '"%'
                )
            )
        )
      `;
  }

  protected outputTableRelatedTaskNamesSql(outputAlias: string): string {
    return `
        (
          SELECT group_concat(t.name, ${this.relatedTaskNamesSeparatorSql()})
          FROM data_cleaning_tasks t
          WHERE t.output_table = ${outputAlias}.table_name
            OR EXISTS (
              SELECT 1
              FROM data_workflow_nodes n
              WHERE n.task_id = t.id
                AND coalesce(n.operator_type, n.node_key) IN ('output', 'write_duckdb_table', 'publish_dataset')
                AND (
                  coalesce(n.config_json, '') LIKE '%"outputDatasetId":"' || ${outputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"outputDatasetId": "' || ${outputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"outputTableId":"' || ${outputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"outputTableId": "' || ${outputAlias}.id || '"%'
                )
            )
        )
      `;
  }

  protected async runSql(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<void> {
    const connection = this.requireConnection();
    await connection.run(sql, values);
  }

  protected async queryRows<T extends object>(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<T[]> {
    const connection = this.requireConnection();
    const reader = await connection.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as T[];
  }

  protected requireConnection(): DuckDBConnection {
    if (!this.connection) {
      throw new Error('DuckDB data store is not initialized');
    }
    return this.connection;
  }

  abstract summarizeInputTableSource(
    input: DataSummarizeInputTableSourceInput
  ): Promise<DataInputTableSourceSummary>;

  protected abstract findWorkflowNodeCacheTable(
    taskId: string,
    nodeId: string
  ): Promise<string | null>;

  protected async getTableColumnTypes(tableName: string): Promise<DataColumnTypeInfo[]> {
    const rows = await this.queryRows<{ column_name: string; data_type: string }>(
      `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $tableName
        ORDER BY ordinal_position
      `,
      { tableName }
    );
    return rows.map((row) => ({
      name: String(row.column_name),
      type: dataFieldTypeFromDuckDbType(String(row.data_type)),
      storageType: String(row.data_type),
    }));
  }
}
