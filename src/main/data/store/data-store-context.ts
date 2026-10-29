/**
 * @module data/store/data-store-context
 *
 * Infrastructure runtime for the data workspace: owns the DuckDB instance and
 * connection, the optional SQLite metadata database, the serialized
 * "exclusive" section queue, schema initialization, and the generic
 * query/physical-table helpers every repository and service builds on.
 * Domain logic does not live here.
 */
import type { DataColumnTypeInfo } from '../../../shared/contracts';
import {
  dataFieldTypeFromDuckDbType,
  duckDbTypeForDataFieldType,
} from '../../../shared/data-field-types';
import { log } from '../../utils/logger';
import { compileTypedProjection, quoteIdentifier, toNumber } from '../operators';
import { DataPipelineStoreOptions, isDuckDbTransactionStateError } from './data-store-records';
import { inferDataFieldTypeFromValues } from './input-source';
import { migrateMetadataSchema } from './migrations';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { AsyncLocalStorage } from 'async_hooks';
import type Database from 'better-sqlite3';
import * as fs from 'fs';
import { dirname, join } from 'path';

export class DataStoreContext {
  readonly dbPath: string;
  /** Root of the 自定义 normalizer git repos. */
  readonly normalizersRoot: string;
  readonly now: () => number;
  readonly metadataDb: Database.Database | null;
  instance: DuckDBInstance | null = null;
  connection: DuckDBConnection | null = null;
  /** Set by migrateMetadataSchema when the on-disk schema is newer than this build. */
  metadataReadOnly = false;
  metadataReadOnlyReason: string | null = null;
  metadataInitPromise: Promise<void> | null = null;
  duckInitPromise: Promise<void> | null = null;
  exclusiveQueue: Promise<void> = Promise.resolve();
  readonly exclusiveContext = new AsyncLocalStorage<boolean>();
  private readonly postReadyHooks: Array<() => Promise<void>> = [];
  private postReadyPromise: Promise<void> | null = null;

  constructor(dbPath: string, options: DataPipelineStoreOptions = {}) {
    this.dbPath = dbPath;
    this.normalizersRoot = options.normalizersRoot ?? join(dirname(dbPath), 'normalizers');
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
        log('[DataPipelineStore] DuckDB exclusive section finished', {
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
  async ensureMetadataReady(): Promise<void> {
    if (!this.metadataInitPromise) {
      // Reset on failure so a transient migration error can be retried
      // instead of pinning a rejected promise forever.
      this.metadataInitPromise = this.initializeMetadata().catch((error) => {
        this.metadataInitPromise = null;
        throw error;
      });
    }
    await this.metadataInitPromise;
  }
  /**
   * Registers a hook that runs once after both the metadata store and DuckDB
   * are ready (e.g. pending output-commit recovery). The facade wires these.
   */
  registerPostReadyHook(hook: () => Promise<void>): void {
    this.postReadyHooks.push(hook);
  }

  async ensureReady(): Promise<void> {
    await this.ensureMetadataReady();
    await this.ensureDuckDbReady();
    if (!this.postReadyPromise) {
      this.postReadyPromise = (async () => {
        for (const hook of this.postReadyHooks) {
          await hook();
        }
      })();
    }
    await this.postReadyPromise;
  }
  async ensureDuckDbReady(): Promise<void> {
    if (this.connection) {
      return;
    }
    if (!this.duckInitPromise) {
      this.duckInitPromise = this.initializeDuckDb();
    }
    await this.duckInitPromise;
  }
  async initializeDuckDb(): Promise<void> {
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    this.instance = await DuckDBInstance.create(this.dbPath);
    this.connection = await this.instance.connect();
  }
  async recoverDuckDbTransactionState(): Promise<void> {
    try {
      await this.runSql('ROLLBACK');
    } catch {
      await this.resetDuckDbConnection();
    }
  }
  async resetDuckDbConnection(): Promise<void> {
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
  async initializeMetadata(): Promise<void> {
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    if (!this.metadataDb) {
      await this.ensureDuckDbReady();
    }
    await migrateMetadataSchema(this);
  }
  async ensureMetadataColumn(
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
  async getTableColumns(tableName: string): Promise<string[]> {
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
  async inferTableColumnTypes(tableName: string): Promise<DataColumnTypeInfo[]> {
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
  async createTypedTableFromRelation(tableName: string, relationTableName: string): Promise<void> {
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
  async countRows(tableName: string): Promise<number> {
    const rows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`
    );
    return toNumber(rows[0]?.count);
  }
  async dropTableIfExists(tableName: string): Promise<void> {
    await this.runSql(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
  }
  async physicalTableExists(tableName: string): Promise<boolean> {
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
  async metaRunSql(sql: string, values?: Record<string, string | number | null>): Promise<void> {
    if (this.metadataReadOnly) {
      throw new Error(this.metadataReadOnlyReason ?? 'Data pipeline metadata store is read-only');
    }
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
  async metaQueryRows<T extends object>(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<T[]> {
    if (!this.metadataDb) {
      return this.queryRows<T>(sql, values);
    }
    return this.metadataDb.prepare(sql).all(values ?? {}) as T[];
  }
  relatedPipelineNamesSeparatorSql(): string {
    return this.metadataDb ? 'char(31)' : 'chr(31)';
  }
  rawTableRelatedPipelineNamesSql(inputAlias: string): string {
    return `
        (
          SELECT group_concat(t.name, ${this.relatedPipelineNamesSeparatorSql()})
          FROM data_pipelines t
          WHERE t.source_raw_table_id = ${inputAlias}.id
            OR t.source_path = ${inputAlias}.source_path
            OR EXISTS (
              SELECT 1
              FROM data_workflow_nodes n
              WHERE n.pipeline_id = t.id
                AND coalesce(n.operator_type, n.node_key) IN ('input', 'read_source')
                AND (
                  coalesce(n.config_json, '') LIKE '%"rawTableId":"' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"rawTableId": "' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"rawTableId":"' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"rawTableId": "' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"sourceRawTableId":"' || ${inputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"sourceRawTableId": "' || ${inputAlias}.id || '"%'
                )
            )
        )
      `;
  }
  resultTableRelatedPipelineIdsSql(outputAlias: string): string {
    return this.resultTableRelatedPipelineSql(outputAlias, 'id');
  }
  resultTableRelatedPipelineNamesSql(outputAlias: string): string {
    return this.resultTableRelatedPipelineSql(outputAlias, 'name');
  }
  private resultTableRelatedPipelineSql(outputAlias: string, column: 'id' | 'name'): string {
    return `
        (
          SELECT group_concat(t.${column}, ${this.relatedPipelineNamesSeparatorSql()})
          FROM data_pipelines t
          WHERE t.result_table = ${outputAlias}.table_name
            OR EXISTS (
              SELECT 1
              FROM data_workflow_nodes n
              WHERE n.pipeline_id = t.id
                AND coalesce(n.operator_type, n.node_key) IN ('output', 'write_duckdb_table', 'publish_rawTable')
                AND (
                  coalesce(n.config_json, '') LIKE '%"outputResultTableId":"' || ${outputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"outputResultTableId": "' || ${outputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"resultTableId":"' || ${outputAlias}.id || '"%'
                  OR coalesce(n.config_json, '') LIKE '%"resultTableId": "' || ${outputAlias}.id || '"%'
                )
            )
        )
      `;
  }
  async runSql(sql: string, values?: Record<string, string | number | null>): Promise<void> {
    // When the metadata schema is newer than this build the whole store is
    // read-only — physical writes without matching metadata bookkeeping
    // would only produce orphan tables.
    if (this.metadataReadOnly) {
      throw new Error(this.metadataReadOnlyReason ?? 'Data pipeline store is read-only');
    }
    const connection = this.requireConnection();
    await connection.run(sql, values);
  }
  async queryRows<T extends object>(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<T[]> {
    const connection = this.requireConnection();
    const reader = await connection.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as T[];
  }
  requireConnection(): DuckDBConnection {
    if (!this.connection) {
      throw new Error('DuckDB data store is not initialized');
    }
    return this.connection;
  }
  /** Public column snapshot for a physical table (manifest/schema consumers). */
  async getTableColumnSnapshot(tableName: string): Promise<DataColumnTypeInfo[]> {
    await this.ensureReady();
    if (!(await this.physicalTableExists(tableName))) return [];
    return this.getTableColumnTypes(tableName);
  }
  async getTableColumnTypes(tableName: string): Promise<DataColumnTypeInfo[]> {
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
