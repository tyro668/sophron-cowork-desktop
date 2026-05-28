import * as fs from 'fs';
import { basename, dirname, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type {
  DataCleaningTask,
  DataCreateTaskInput,
  DataDashboard,
  DataDashboardQuery,
  DataDataset,
  DataImportDatasetInput,
  DataRunTaskInput,
  DataTaskStatus,
  DataTaskStatusCounts,
} from '../../renderer/types';

interface DataTaskStoreOptions {
  now?: () => number;
}

interface DataTaskRow {
  id: string;
  name: string;
  status: string;
  node_count: number | string;
  source_path: string | null;
  source_dataset_id: string | null;
  output_table: string | null;
  row_count: number | string | null;
  column_count: number | string | null;
  error: string | null;
  scheduled_for: number | string | null;
  created_at: number | string;
  updated_at: number | string;
  last_run_at: number | string | null;
}

interface DataDatasetRow {
  id: string;
  name: string;
  source_path: string;
  table_name: string;
  row_count: number | string;
  column_count: number | string;
  created_at: number | string;
  updated_at: number | string;
}

interface DashboardSummaryRow {
  task_count: number | string;
  workflow_node_count: number | string | null;
  running_count: number | string | null;
  today_schedule_count: number | string | null;
  draft_count: number | string | null;
  pending_count: number | string | null;
  completed_count: number | string | null;
  stopped_count: number | string | null;
  failed_count: number | string | null;
}

const WORKFLOW_NODE_LABELS = [
  'load_source',
  'profile_schema',
  'drop_empty_rows',
  'deduplicate_rows',
  'write_duckdb_table',
  'publish_dataset',
];

const LEGACY_DEMO_TASK_NAMES = [
  '用户行为数据清洗',
  '销售数据汇总',
  '营销数据集成',
  '日志数据处理',
  '第三方数据加载',
  '客户分群清洗',
  '订单异常值处理',
  '库存日报清洗',
];

export class DataTaskStore {
  private readonly dbPath: string;
  private readonly now: () => number;
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string, options: DataTaskStoreOptions = {}) {
    this.dbPath = dbPath;
    this.now = options.now ?? (() => Date.now());
  }

  async getDashboard(query: DataDashboardQuery = {}): Promise<DataDashboard> {
    await this.ensureReady();
    const normalizedQuery = (query.query ?? '').trim().toLowerCase();
    const like = `%${normalizedQuery.replace(/[%_\\]/g, '\\$&')}%`;
    const todayStart = startOfToday(this.now());
    const todayEnd = todayStart + 86_400_000;
    const summaryRows = await this.queryRows<DashboardSummaryRow>(
      `
        SELECT
          count(*) AS task_count,
          coalesce(sum(node_count), 0) AS workflow_node_count,
          coalesce(sum(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running_count,
          coalesce(sum(CASE WHEN scheduled_for >= $todayStart AND scheduled_for < $todayEnd THEN 1 ELSE 0 END), 0) AS today_schedule_count,
          coalesce(sum(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
          coalesce(sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          coalesce(sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
          coalesce(sum(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END), 0) AS stopped_count,
          coalesce(sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count
        FROM data_cleaning_tasks
      `,
      { todayStart, todayEnd }
    );
    const taskRows = await this.queryRows<DataTaskRow>(
      `
        SELECT *
        FROM data_cleaning_tasks
        WHERE $query = ''
          OR lower(name) LIKE $like ESCAPE '\\'
          OR lower(coalesce(source_path, '')) LIKE $like ESCAPE '\\'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 200
      `,
      { query: normalizedQuery, like }
    );
    const datasetRows = await this.queryRows<DataDatasetRow>(
      `
        SELECT *
        FROM data_datasets
        WHERE $query = ''
          OR lower(name) LIKE $like ESCAPE '\\'
          OR lower(source_path) LIKE $like ESCAPE '\\'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 200
      `,
      { query: normalizedQuery, like }
    );

    const summary = summaryRows[0] ?? {
      task_count: 0,
      workflow_node_count: 0,
      running_count: 0,
      today_schedule_count: 0,
      draft_count: 0,
      pending_count: 0,
      completed_count: 0,
      stopped_count: 0,
      failed_count: 0,
    };
    const statusCounts: DataTaskStatusCounts = {
      running: toNumber(summary.running_count),
      completed: toNumber(summary.completed_count),
      stopped: toNumber(summary.stopped_count),
      draft: toNumber(summary.draft_count),
      pending: toNumber(summary.pending_count),
      failed: toNumber(summary.failed_count),
    };

    return {
      summary: {
        taskCount: toNumber(summary.task_count),
        workflowNodeCount: toNumber(summary.workflow_node_count),
        runningCount: statusCounts.running,
        todayScheduleCount: toNumber(summary.today_schedule_count),
        statusCounts,
      },
      tasks: taskRows.map(mapTaskRow),
      datasets: datasetRows.map(mapDatasetRow),
      totalTasks: taskRows.length,
      totalDatasets: datasetRows.length,
    };
  }

  async createTask(input: DataCreateTaskInput): Promise<DataCleaningTask> {
    await this.ensureReady();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Task name is required');
    }
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : null;
    const now = this.now();
    const id = uuidv4();
    const status: DataTaskStatus = sourcePath ? 'pending' : 'draft';
    await this.runSql(
      `
        INSERT INTO data_cleaning_tasks (
          id, name, status, node_count, source_path, source_dataset_id, output_table,
          row_count, column_count, error, scheduled_for, created_at, updated_at, last_run_at
        )
        VALUES (
          $id, $name, $status, $nodeCount, $sourcePath, NULL, NULL,
          NULL, NULL, NULL, NULL, $createdAt, $updatedAt, NULL
        )
      `,
      {
        id,
        name,
        status,
        nodeCount: 4,
        sourcePath,
        createdAt: now,
        updatedAt: now,
      }
    );
    await this.replaceWorkflowNodes(id, 4, now);
    return this.requireTask(id);
  }

  async runTask(id: string, input: DataRunTaskInput = {}): Promise<DataCleaningTask> {
    await this.ensureReady();
    const task = await this.requireTask(id);
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : task.sourcePath;
    const startedAt = this.now();
    if (!sourcePath) {
      const message = 'Data source file is required before running a cleaning task';
      await this.runSql(
        `
          UPDATE data_cleaning_tasks
          SET status = 'failed',
              error = $error,
              updated_at = $updatedAt,
              last_run_at = $lastRunAt
          WHERE id = $id
        `,
        { id, error: message, updatedAt: startedAt, lastRunAt: startedAt }
      );
      throw new Error(message);
    }
    await this.runSql(
      `
        UPDATE data_cleaning_tasks
        SET status = 'running',
            source_path = $sourcePath,
            error = NULL,
            updated_at = $updatedAt
        WHERE id = $id
      `,
      { id, sourcePath, updatedAt: startedAt }
    );

    try {
      const result = sourcePath
        ? await this.cleanSourceIntoTaskOutput(task, sourcePath)
        : {
            outputTable: task.outputTable,
            rowCount: task.rowCount ?? 0,
            columnCount: task.columnCount ?? 0,
            sourceDatasetId: task.sourceDatasetId,
          };
      const completedAt = this.now();
      await this.runSql(
        `
          UPDATE data_cleaning_tasks
          SET status = 'completed',
              node_count = $nodeCount,
              source_path = $sourcePath,
              source_dataset_id = $sourceDatasetId,
              output_table = $outputTable,
              row_count = $rowCount,
              column_count = $columnCount,
              last_run_at = $lastRunAt,
              updated_at = $updatedAt,
              error = NULL
          WHERE id = $id
        `,
        {
          id,
          nodeCount: WORKFLOW_NODE_LABELS.length,
          sourcePath,
          sourceDatasetId: result.sourceDatasetId,
          outputTable: result.outputTable,
          rowCount: result.rowCount,
          columnCount: result.columnCount,
          lastRunAt: completedAt,
          updatedAt: completedAt,
        }
      );
      await this.replaceWorkflowNodes(id, WORKFLOW_NODE_LABELS.length, completedAt);
      return this.requireTask(id);
    } catch (error) {
      const failedAt = this.now();
      const message = error instanceof Error ? error.message : String(error);
      await this.runSql(
        `
          UPDATE data_cleaning_tasks
          SET status = 'failed',
              error = $error,
              updated_at = $updatedAt,
              last_run_at = $lastRunAt
          WHERE id = $id
        `,
        { id, error: message, updatedAt: failedAt, lastRunAt: failedAt }
      );
      throw error;
    }
  }

  async importDataset(input: DataImportDatasetInput): Promise<DataDataset> {
    await this.ensureReady();
    const sourcePath = normalizeSourcePath(input.filePath);
    const id = uuidv4();
    const tableName = tableNameFromId('dataset', id);
    const relation = readRelationForPath(sourcePath, 'sourcePath');
    try {
      await this.runSql(`CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`, {
        sourcePath,
      });
      const rowCount = await this.countRows(tableName);
      const columnCount = (await this.getTableColumns(tableName)).length;
      const now = this.now();
      const name = input.name?.trim() || datasetNameFromPath(sourcePath);
      await this.runSql(
        `
          INSERT INTO data_datasets (
            id, name, source_path, table_name, row_count, column_count, created_at, updated_at
          )
          VALUES (
            $id, $name, $sourcePath, $tableName, $rowCount, $columnCount, $createdAt, $updatedAt
          )
        `,
        {
          id,
          name,
          sourcePath,
          tableName,
          rowCount,
          columnCount,
          createdAt: now,
          updatedAt: now,
        }
      );
      return this.requireDataset(id);
    } catch (error) {
      await this.dropTableIfExists(tableName);
      throw error;
    }
  }

  async deleteTask(id: string): Promise<boolean> {
    await this.ensureReady();
    const task = await this.getTask(id);
    if (!task) {
      return false;
    }
    if (task.outputTable) {
      await this.dropTableIfExists(task.outputTable);
      await this.runSql('DELETE FROM data_datasets WHERE table_name = $tableName', {
        tableName: task.outputTable,
      });
    }
    await this.runSql('DELETE FROM data_workflow_nodes WHERE task_id = $id', { id });
    await this.runSql('DELETE FROM data_cleaning_tasks WHERE id = $id', { id });
    return true;
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
        this.initPromise = null;
      }
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.connection) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    fs.mkdirSync(dirname(this.dbPath), { recursive: true });
    this.instance = await DuckDBInstance.create(this.dbPath);
    this.connection = await this.instance.connect();
    await this.createSchema();
    await this.removeLegacyDemoRows();
  }

  private async createSchema(): Promise<void> {
    await this.runSql(`
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
    await this.runSql(`
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
    await this.runSql(`
      CREATE TABLE IF NOT EXISTS data_workflow_nodes (
        id VARCHAR PRIMARY KEY,
        task_id VARCHAR NOT NULL,
        node_key VARCHAR NOT NULL,
        label VARCHAR NOT NULL,
        ordinal INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
  }

  private async removeLegacyDemoRows(): Promise<void> {
    const placeholders = LEGACY_DEMO_TASK_NAMES.map((_, index) => `$name${index}`).join(', ');
    const values = Object.fromEntries(
      LEGACY_DEMO_TASK_NAMES.map((name, index) => [`name${index}`, name])
    );
    const demoTaskRows = await this.queryRows<{ id: string }>(
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
      await this.runSql(
        `
          DELETE FROM data_workflow_nodes
          WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
        `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
      await this.runSql(
        `
          DELETE FROM data_cleaning_tasks
          WHERE id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
        `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
    }
    await this.runSql("DELETE FROM data_datasets WHERE source_path LIKE 'local://samples/%'");
  }

  private async cleanSourceIntoTaskOutput(
    task: DataCleaningTask,
    sourcePath: string
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string;
  }> {
    const outputTable = task.outputTable || tableNameFromId('clean_task', task.id);
    const rawTable = tableNameFromId('raw_task', uuidv4());
    const relation = readRelationForPath(sourcePath, 'sourcePath');
    await this.dropTableIfExists(rawTable);
    await this.dropTableIfExists(outputTable);
    try {
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(rawTable)} AS SELECT * FROM ${relation}`,
        { sourcePath }
      );
      const columns = await this.getTableColumns(rawTable);
      const nonEmptyFilter =
        columns.length > 0
          ? columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' OR ')
          : 'true';
      await this.runSql(
        `
          CREATE TABLE ${quoteIdentifier(outputTable)} AS
          SELECT DISTINCT *
          FROM ${quoteIdentifier(rawTable)}
          WHERE ${nonEmptyFilter}
        `
      );
      const rowCount = await this.countRows(outputTable);
      const columnCount = (await this.getTableColumns(outputTable)).length;
      const dataset = await this.upsertDatasetForTaskOutput(
        task.name,
        sourcePath,
        outputTable,
        rowCount,
        columnCount
      );
      return {
        outputTable,
        rowCount,
        columnCount,
        sourceDatasetId: dataset.id,
      };
    } finally {
      await this.dropTableIfExists(rawTable);
    }
  }

  private async upsertDatasetForTaskOutput(
    taskName: string,
    sourcePath: string,
    tableName: string,
    rowCount: number,
    columnCount: number
  ): Promise<DataDataset> {
    const existingRows = await this.queryRows<{ id: string }>(
      'SELECT id FROM data_datasets WHERE table_name = $tableName LIMIT 1',
      { tableName }
    );
    const now = this.now();
    const name = `${taskName} cleaned`;
    if (existingRows[0]?.id) {
      await this.runSql(
        `
          UPDATE data_datasets
          SET name = $name,
              source_path = $sourcePath,
              row_count = $rowCount,
              column_count = $columnCount,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        {
          id: existingRows[0].id,
          name,
          sourcePath,
          rowCount,
          columnCount,
          updatedAt: now,
        }
      );
      return this.requireDataset(existingRows[0].id);
    }

    const id = uuidv4();
    await this.runSql(
      `
        INSERT INTO data_datasets (
          id, name, source_path, table_name, row_count, column_count, created_at, updated_at
        )
        VALUES (
          $id, $name, $sourcePath, $tableName, $rowCount, $columnCount, $createdAt, $updatedAt
        )
      `,
      {
        id,
        name,
        sourcePath,
        tableName,
        rowCount,
        columnCount,
        createdAt: now,
        updatedAt: now,
      }
    );
    return this.requireDataset(id);
  }

  private async replaceWorkflowNodes(taskId: string, nodeCount: number, createdAt: number) {
    await this.runSql('DELETE FROM data_workflow_nodes WHERE task_id = $taskId', { taskId });
    for (let index = 0; index < nodeCount; index += 1) {
      const nodeKey = WORKFLOW_NODE_LABELS[index] ?? `custom_step_${index + 1}`;
      await this.runSql(
        `
          INSERT INTO data_workflow_nodes (id, task_id, node_key, label, ordinal, created_at)
          VALUES ($id, $taskId, $nodeKey, $label, $ordinal, $createdAt)
        `,
        {
          id: uuidv4(),
          taskId,
          nodeKey,
          label: nodeKey,
          ordinal: index + 1,
          createdAt,
        }
      );
    }
  }

  private async getTask(id: string): Promise<DataCleaningTask | null> {
    const rows = await this.queryRows<DataTaskRow>(
      'SELECT * FROM data_cleaning_tasks WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  private async requireTask(id: string): Promise<DataCleaningTask> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Data cleaning task not found: ${id}`);
    }
    return task;
  }

  private async requireDataset(id: string): Promise<DataDataset> {
    const rows = await this.queryRows<DataDatasetRow>(
      'SELECT * FROM data_datasets WHERE id = $id LIMIT 1',
      { id }
    );
    if (!rows[0]) {
      throw new Error(`Dataset not found: ${id}`);
    }
    return mapDatasetRow(rows[0]);
  }

  private async getTableColumns(tableName: string): Promise<string[]> {
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

  private async countRows(tableName: string): Promise<number> {
    const rows = await this.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`
    );
    return toNumber(rows[0]?.count);
  }

  private async dropTableIfExists(tableName: string): Promise<void> {
    await this.runSql(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
  }

  private async runSql(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<void> {
    const connection = this.requireConnection();
    await connection.run(sql, values);
  }

  private async queryRows<T extends object>(
    sql: string,
    values?: Record<string, string | number | null>
  ): Promise<T[]> {
    const connection = this.requireConnection();
    const reader = await connection.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as T[];
  }

  private requireConnection(): DuckDBConnection {
    if (!this.connection) {
      throw new Error('DuckDB data store is not initialized');
    }
    return this.connection;
  }
}

export function createDataTaskStore(dbPath: string, options?: DataTaskStoreOptions): DataTaskStore {
  return new DataTaskStore(dbPath, options);
}

function mapTaskRow(row: DataTaskRow): DataCleaningTask {
  return {
    id: String(row.id),
    name: String(row.name),
    status: normalizeStatus(row.status),
    nodeCount: toNumber(row.node_count),
    sourcePath: row.source_path ? String(row.source_path) : null,
    sourceDatasetId: row.source_dataset_id ? String(row.source_dataset_id) : null,
    outputTable: row.output_table ? String(row.output_table) : null,
    rowCount: row.row_count === null ? null : toNumber(row.row_count),
    columnCount: row.column_count === null ? null : toNumber(row.column_count),
    error: row.error ? String(row.error) : null,
    scheduledFor: row.scheduled_for === null ? null : toNumber(row.scheduled_for),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    lastRunAt: row.last_run_at === null ? null : toNumber(row.last_run_at),
  };
}

function mapDatasetRow(row: DataDatasetRow): DataDataset {
  return {
    id: String(row.id),
    name: String(row.name),
    sourcePath: String(row.source_path),
    tableName: String(row.table_name),
    rowCount: toNumber(row.row_count),
    columnCount: toNumber(row.column_count),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
  };
}

function normalizeStatus(value: string): DataTaskStatus {
  if (
    value === 'running' ||
    value === 'completed' ||
    value === 'stopped' ||
    value === 'draft' ||
    value === 'pending' ||
    value === 'failed'
  ) {
    return value;
  }
  return 'draft';
}

function toNumber(value: number | string | bigint | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSourcePath(filePath: string): string {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Data source file does not exist: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Data source path is not a file: ${filePath}`);
  }
  readRelationForPath(filePath, 'sourcePath');
  return filePath;
}

function readRelationForPath(filePath: string, parameterName: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return `read_csv_auto($${parameterName}, header = true)`;
  }
  if (extension === '.tsv' || extension === '.tab') {
    return `read_csv_auto($${parameterName}, header = true, delim = '\t')`;
  }
  if (extension === '.json' || extension === '.jsonl' || extension === '.ndjson') {
    return `read_json_auto($${parameterName})`;
  }
  if (extension === '.parquet') {
    return `read_parquet($${parameterName})`;
  }
  throw new Error(`Unsupported data file type: ${extension || '(none)'}`);
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe DuckDB identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function tableNameFromId(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^A-Za-z0-9]/g, '_')}`;
}

function datasetNameFromPath(filePath: string): string {
  const name = basename(filePath);
  const extension = extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}

function startOfToday(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
