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
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowEdgeInput,
  DataWorkflowNode,
  DataWorkflowNodeInput,
  DataWorkflowOperatorType,
  DataWorkflowSaveInput,
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

interface DataWorkflowNodeRow {
  id: string;
  task_id: string;
  node_key: string;
  label: string;
  ordinal: number | string;
  operator_type: string | null;
  x: number | string | null;
  y: number | string | null;
  config_json: string | null;
  created_at: number | string;
  updated_at: number | string | null;
}

interface DataWorkflowEdgeRow {
  id: string;
  task_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  target_handle: string | null;
  created_at: number | string;
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

const WORKFLOW_OPERATOR_TYPES: readonly DataWorkflowOperatorType[] = [
  'input_source',
  'filter',
  'field_select',
  'deduplicate',
  'missing_value',
  'type_convert',
  'sort',
  'join',
  'aggregate',
  'calculate_field',
  'field_mapping',
  'output',
];

const WORKFLOW_OPERATOR_TYPE_SET = new Set<string>(WORKFLOW_OPERATOR_TYPES);

const DEFAULT_OPERATOR_LABELS: Record<DataWorkflowOperatorType, string> = {
  input_source: '数据源',
  filter: '筛选',
  field_select: '字段选择',
  deduplicate: '去重',
  missing_value: '缺失值处理',
  type_convert: '类型转换',
  sort: '排序',
  join: '表连接',
  aggregate: '聚合',
  calculate_field: '计算字段',
  field_mapping: '字段映射',
  output: '输出',
};

const LEGACY_DEFAULT_WORKFLOW_NODES: ReadonlyArray<{
  key: string;
  type: DataWorkflowOperatorType;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}> = [
  {
    key: 'source',
    type: 'input_source',
    label: DEFAULT_OPERATOR_LABELS.input_source,
    x: 48,
    y: 128,
    config: { output: 'raw_dataset' },
  },
  {
    key: 'filter',
    type: 'filter',
    label: DEFAULT_OPERATOR_LABELS.filter,
    x: 190,
    y: 128,
    config: { condition: '' },
  },
  {
    key: 'deduplicate',
    type: 'deduplicate',
    label: DEFAULT_OPERATOR_LABELS.deduplicate,
    x: 332,
    y: 128,
    config: { strategy: 'all_columns' },
  },
  {
    key: 'missing',
    type: 'missing_value',
    label: DEFAULT_OPERATOR_LABELS.missing_value,
    x: 474,
    y: 128,
    config: {
      strategy: 'by_column',
      rules: [
        { column: 'user_id', ratio: '0.02%', method: 'skip' },
        { column: 'device_id', ratio: '1.15%', method: 'skip' },
        { column: 'event_time', ratio: '3.24%', method: 'forward_fill' },
        { column: 'event_type', ratio: '0.85%', method: 'mode_fill' },
        { column: 'page_id', ratio: '12.41%', method: 'drop' },
      ],
    },
  },
  {
    key: 'calculate',
    type: 'calculate_field',
    label: DEFAULT_OPERATOR_LABELS.calculate_field,
    x: 190,
    y: 270,
    config: { expression: '' },
  },
  {
    key: 'mapping',
    type: 'field_mapping',
    label: DEFAULT_OPERATOR_LABELS.field_mapping,
    x: 474,
    y: 270,
    config: { mappings: [] },
  },
  {
    key: 'output',
    type: 'output',
    label: DEFAULT_OPERATOR_LABELS.output,
    x: 474,
    y: 412,
    config: { destination: 'duckdb_table' },
  },
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
    const taskWindow = normalizeListWindow(query.taskOffset, query.taskLimit);
    const datasetWindow = normalizeListWindow(query.datasetOffset, query.datasetLimit);
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
    const taskCountRows = await this.queryRows<{ count: number | string }>(
      `
        SELECT count(*) AS count
        FROM data_cleaning_tasks
        WHERE $query = ''
          OR lower(name) LIKE $like ESCAPE '\\'
          OR lower(coalesce(source_path, '')) LIKE $like ESCAPE '\\'
      `,
      { query: normalizedQuery, like }
    );
    const taskRows = await this.queryRows<DataTaskRow>(
      `
        SELECT *
        FROM data_cleaning_tasks
        WHERE $query = ''
          OR lower(name) LIKE $like ESCAPE '\\'
          OR lower(coalesce(source_path, '')) LIKE $like ESCAPE '\\'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ${taskWindow.limit} OFFSET ${taskWindow.offset}
      `,
      { query: normalizedQuery, like }
    );
    const datasetCountRows = await this.queryRows<{ count: number | string }>(
      `
        SELECT count(*) AS count
        FROM data_datasets
        WHERE $query = ''
          OR lower(name) LIKE $like ESCAPE '\\'
          OR lower(source_path) LIKE $like ESCAPE '\\'
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
        LIMIT ${datasetWindow.limit} OFFSET ${datasetWindow.offset}
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
      totalTasks: toNumber(taskCountRows[0]?.count),
      totalDatasets: toNumber(datasetCountRows[0]?.count),
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
        nodeCount: 0,
        sourcePath,
        createdAt: now,
        updatedAt: now,
      }
    );
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
      const nodeCount = await this.countWorkflowNodes(id);
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
          nodeCount,
          sourcePath,
          sourceDatasetId: result.sourceDatasetId,
          outputTable: result.outputTable,
          rowCount: result.rowCount,
          columnCount: result.columnCount,
          lastRunAt: completedAt,
          updatedAt: completedAt,
        }
      );
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
    await this.runSql('DELETE FROM data_workflow_edges WHERE task_id = $id', { id });
    await this.runSql('DELETE FROM data_workflow_nodes WHERE task_id = $id', { id });
    await this.runSql('DELETE FROM data_cleaning_tasks WHERE id = $id', { id });
    return true;
  }

  async getTaskWorkflow(id: string): Promise<DataTaskWorkflow> {
    await this.ensureReady();
    await this.requireTask(id);
    const nodes = await this.getWorkflowNodes(id);
    const edges = await this.getWorkflowEdges(id);
    return { task: await this.requireTask(id), nodes, edges };
  }

  async saveTaskWorkflow(id: string, input: DataWorkflowSaveInput): Promise<DataTaskWorkflow> {
    await this.ensureReady();
    await this.requireTask(id);
    const updatedAt = this.now();
    const nodes = normalizeWorkflowNodeInputs(input.nodes);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = normalizeWorkflowEdgeInputs(input.edges, nodeIds);

    await this.runSql('BEGIN TRANSACTION');
    try {
      await this.runSql('DELETE FROM data_workflow_edges WHERE task_id = $taskId', { taskId: id });
      await this.runSql('DELETE FROM data_workflow_nodes WHERE task_id = $taskId', { taskId: id });
      for (const [index, node] of nodes.entries()) {
        await this.runSql(
          `
            INSERT INTO data_workflow_nodes (
              id, task_id, node_key, label, ordinal, operator_type, x, y,
              config_json, created_at, updated_at
            )
            VALUES (
              $id, $taskId, $nodeKey, $label, $ordinal, $operatorType, $x, $y,
              $configJson, $createdAt, $updatedAt
            )
          `,
          {
            id: node.id,
            taskId: id,
            nodeKey: node.id,
            label: node.label,
            ordinal: index + 1,
            operatorType: node.type,
            x: node.x,
            y: node.y,
            configJson: JSON.stringify(node.config ?? {}),
            createdAt: updatedAt,
            updatedAt,
          }
        );
      }
      for (const edge of edges) {
        await this.runSql(
          `
            INSERT INTO data_workflow_edges (
              id, task_id, source_node_id, target_node_id, source_handle, target_handle, created_at
            )
            VALUES (
              $id, $taskId, $sourceNodeId, $targetNodeId, $sourceHandle, $targetHandle, $createdAt
            )
          `,
          {
            id: edge.id,
            taskId: id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
            createdAt: updatedAt,
          }
        );
      }
      await this.runSql(
        `
          UPDATE data_cleaning_tasks
          SET node_count = $nodeCount,
              updated_at = $updatedAt
          WHERE id = $taskId
        `,
        { taskId: id, nodeCount: nodes.length, updatedAt }
      );
      await this.runSql('COMMIT');
    } catch (error) {
      await this.runSql('ROLLBACK').catch(() => undefined);
      throw error;
    }

    return this.getTaskWorkflow(id);
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
    await this.removeLegacyDefaultWorkflowGraphs();
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
    await this.ensureColumn('data_workflow_nodes', 'operator_type', 'VARCHAR');
    await this.ensureColumn('data_workflow_nodes', 'x', 'DOUBLE');
    await this.ensureColumn('data_workflow_nodes', 'y', 'DOUBLE');
    await this.ensureColumn('data_workflow_nodes', 'config_json', 'VARCHAR');
    await this.ensureColumn('data_workflow_nodes', 'updated_at', 'BIGINT');
    await this.runSql(`
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
    await this.runSql(`
      UPDATE data_workflow_nodes
      SET operator_type = coalesce(operator_type, node_key),
          x = coalesce(x, 48 + (ordinal - 1) * 142),
          y = coalesce(y, 128),
          config_json = coalesce(config_json, '{}'),
          updated_at = coalesce(updated_at, created_at)
    `);
  }

  private async ensureColumn(tableName: string, columnName: string, definition: string): Promise<void> {
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
      await this.runSql(
        `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
      );
    }
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
          DELETE FROM data_workflow_edges
          WHERE task_id IN (${demoTaskRows.map((_, index) => `$id${index}`).join(', ')})
        `,
        Object.fromEntries(demoTaskRows.map((row, index) => [`id${index}`, row.id]))
      );
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

  private async removeLegacyDefaultWorkflowGraphs(): Promise<void> {
    const workflowRows = await this.queryRows<DataWorkflowNodeRow>(
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
    await this.runSql(
      `
        DELETE FROM data_workflow_edges
        WHERE task_id IN (${placeholders})
      `,
      values
    );
    await this.runSql(
      `
        DELETE FROM data_workflow_nodes
        WHERE task_id IN (${placeholders})
      `,
      values
    );
    await this.runSql(
      `
        UPDATE data_cleaning_tasks
        SET node_count = 0
        WHERE id IN (${placeholders})
      `,
      values
    );
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
    const workflowNodes = await this.getWorkflowNodes(task.id);
    if (workflowNodes.length > 0) {
      const workflowEdges = await this.getWorkflowEdges(task.id);
      return this.runWorkflowIntoTaskOutput(task, sourcePath, workflowNodes, workflowEdges);
    }

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

  private async runWorkflowIntoTaskOutput(
    task: DataCleaningTask,
    sourcePath: string,
    nodes: DataWorkflowNode[],
    edges: DataWorkflowEdge[]
  ): Promise<{
    outputTable: string;
    rowCount: number;
    columnCount: number;
    sourceDatasetId: string;
  }> {
    const outputNode = nodes.find((node) => node.type === 'output');
    const outputTable = getOutputTableName(outputNode, task.outputTable || tableNameFromId('clean_task', task.id));
    const relationByNode = new Map<string, string>();
    await this.dropTableIfExists(outputTable);

    for (const node of nodes) {
      if (node.type === 'output') {
        continue;
      }
      if (node.type === 'input_source') {
        relationByNode.set(node.id, await this.materializeInputSource(node, sourcePath));
        continue;
      }

      const outputRelation = tableNameFromId(`workflow_${node.type}`, node.id);
      await this.dropTableIfExists(outputRelation);
      const sql = await this.compileWorkflowNodeSql(node, outputRelation, relationByNode, edges);
      await this.runSql(sql);
      relationByNode.set(node.id, outputRelation);
    }

    const finalInputId = outputNode
      ? this.findIncomingNodeId(outputNode.id, edges, 'input')
      : findLastMaterializedNodeId(nodes, relationByNode);
    const finalRelation = finalInputId ? relationByNode.get(finalInputId) : null;
    if (!finalRelation) {
      throw new Error('Workflow has no materialized output relation');
    }
    await this.runSql(
      `CREATE TABLE ${quoteIdentifier(outputTable)} AS SELECT * FROM ${quoteIdentifier(finalRelation)}`
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
    return { outputTable, rowCount, columnCount, sourceDatasetId: dataset.id };
  }

  private async materializeInputSource(node: DataWorkflowNode, taskSourcePath: string): Promise<string> {
    const source = typeof node.config.source === 'string' ? node.config.source : 'task';
    const tableName = tableNameFromId('workflow_source', node.id);
    await this.dropTableIfExists(tableName);
    if (source === 'dataset') {
      const datasetRef = String(node.config.datasetId ?? node.config.name ?? node.config.alias ?? '');
      const dataset = await this.findDatasetByReference(datasetRef);
      if (!dataset) {
        throw new Error(`Dataset source not found: ${datasetRef}`);
      }
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${quoteIdentifier(
          dataset.tableName
        )}`
      );
      return tableName;
    }

    const filePath =
      source === 'file' && typeof node.config.filePath === 'string'
        ? normalizeSourcePath(node.config.filePath)
        : taskSourcePath;
    const relation = readRelationForPath(filePath, 'sourcePath');
    await this.runSql(`CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`, {
      sourcePath: filePath,
    });
    return tableName;
  }

  private async compileWorkflowNodeSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[]
  ): Promise<string> {
    if (node.type === 'join') {
      return this.compileJoinSql(node, outputRelation, relationByNode, edges);
    }
    const inputId = this.findIncomingNodeId(node.id, edges, 'input');
    const inputRelation = inputId ? relationByNode.get(inputId) : null;
    if (!inputRelation) {
      throw new Error(`Workflow node has no input: ${node.id}`);
    }
    const columns = await this.getTableColumns(inputRelation);
    const input = quoteIdentifier(inputRelation);
    const output = quoteIdentifier(outputRelation);
    switch (node.type) {
      case 'field_select':
        return compileFieldSelectSql(output, input, columns, node.config);
      case 'field_mapping':
        return compileFieldMappingSql(output, input, columns, node.config);
      case 'missing_value':
        return compileMissingValueSql(output, input, columns, node.config);
      case 'type_convert':
        return compileTypeConvertSql(output, input, columns, node.config);
      case 'filter':
        return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} WHERE ${compileScalarExpression(
          String(node.config.condition ?? 'true')
        )}`;
      case 'deduplicate':
        return compileDeduplicateSql(output, input, columns, node.config);
      case 'sort':
        return compileSortSql(output, input, node.config);
      case 'calculate_field':
        return compileCalculateFieldSql(output, input, node.config);
      case 'aggregate':
        return compileAggregateSql(output, input, node.config);
      default:
        return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}`;
    }
  }

  private async compileJoinSql(
    node: DataWorkflowNode,
    outputRelation: string,
    relationByNode: Map<string, string>,
    edges: DataWorkflowEdge[]
  ): Promise<string> {
    const leftNodeId = this.findIncomingNodeId(node.id, edges, 'left');
    const rightNodeId = this.findIncomingNodeId(node.id, edges, 'right');
    const leftRelation = leftNodeId ? relationByNode.get(leftNodeId) : null;
    const rightRelation = rightNodeId ? relationByNode.get(rightNodeId) : null;
    if (!leftRelation || !rightRelation) {
      throw new Error(`Join node requires left and right inputs: ${node.id}`);
    }
    const leftColumns = await this.getTableColumns(leftRelation);
    const rightColumns = await this.getTableColumns(rightRelation);
    const output = quoteIdentifier(outputRelation);
    const left = quoteIdentifier(leftRelation);
    const right = quoteIdentifier(rightRelation);
    const joinType = String(node.config.joinType ?? 'left');
    if (joinType === 'semi' || joinType === 'anti') {
      const existsOperator = joinType === 'semi' ? 'EXISTS' : 'NOT EXISTS';
      const condition = compileJoinConditionList(node.config.conditions);
      return `
        CREATE TEMP TABLE ${output} AS
        SELECT l.*
        FROM ${left} l
        WHERE ${existsOperator} (
          SELECT 1 FROM ${right} r WHERE ${condition}
        )
      `;
    }
    if (joinType === 'asof') {
      return compileAsofJoinSql(output, left, right, leftColumns, rightColumns, node.config);
    }
    const condition = joinType === 'cross' ? '' : ` ON ${compileJoinConditionList(node.config.conditions)}`;
    const sqlJoinType = joinType === 'full' ? 'FULL OUTER' : joinType.toUpperCase();
    const projection = compileJoinProjection(
      node.config.keep,
      leftColumns,
      rightColumns,
      node.config.conflict,
      typeof node.config.rightAlias === 'string' ? node.config.rightAlias : undefined
    );
    return `
      CREATE TEMP TABLE ${output} AS
      SELECT ${projection}
      FROM ${left} l
      ${sqlJoinType} JOIN ${right} r${condition}
    `;
  }

  private findIncomingNodeId(
    nodeId: string,
    edges: DataWorkflowEdge[],
    targetHandle: string
  ): string | null {
    return (
      edges.find(
        (edge) =>
          edge.targetNodeId === nodeId && (edge.targetHandle ?? 'input') === targetHandle
      )?.sourceNodeId ?? null
    );
  }

  private async findDatasetByReference(reference: string): Promise<DataDataset | null> {
    const rows = await this.queryRows<DataDatasetRow>(
      `
        SELECT *
        FROM data_datasets
        WHERE id = $reference
           OR name = $reference
           OR table_name = $reference
        LIMIT 1
      `,
      { reference }
    );
    return rows[0] ? mapDatasetRow(rows[0]) : null;
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

  private async getWorkflowNodes(taskId: string): Promise<DataWorkflowNode[]> {
    const rows = await this.queryRows<DataWorkflowNodeRow>(
      `
        SELECT *
        FROM data_workflow_nodes
        WHERE task_id = $taskId
        ORDER BY ordinal ASC, created_at ASC
      `,
      { taskId }
    );
    return rows.map(mapWorkflowNodeRow);
  }

  private async getWorkflowEdges(taskId: string): Promise<DataWorkflowEdge[]> {
    const rows = await this.queryRows<DataWorkflowEdgeRow>(
      `
        SELECT *
        FROM data_workflow_edges
        WHERE task_id = $taskId
        ORDER BY created_at ASC
      `,
      { taskId }
    );
    return rows.map(mapWorkflowEdgeRow);
  }

  private async countWorkflowNodes(taskId: string): Promise<number> {
    const rows = await this.queryRows<{ count: number | string }>(
      'SELECT count(*) AS count FROM data_workflow_nodes WHERE task_id = $taskId',
      { taskId }
    );
    return toNumber(rows[0]?.count);
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

function mapWorkflowNodeRow(row: DataWorkflowNodeRow): DataWorkflowNode {
  const type = normalizeOperatorType(row.operator_type ?? row.node_key);
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    type,
    label: row.label ? String(row.label) : DEFAULT_OPERATOR_LABELS[type],
    x: toFiniteNumber(row.x, 48),
    y: toFiniteNumber(row.y, 128),
    config: parseWorkflowConfig(row.config_json),
    createdAt: toNumber(row.created_at),
    updatedAt: row.updated_at === null ? toNumber(row.created_at) : toNumber(row.updated_at),
  };
}

function mapWorkflowEdgeRow(row: DataWorkflowEdgeRow): DataWorkflowEdge {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    sourceNodeId: String(row.source_node_id),
    targetNodeId: String(row.target_node_id),
    sourceHandle: row.source_handle ? String(row.source_handle) : null,
    targetHandle: row.target_handle ? String(row.target_handle) : null,
    createdAt: toNumber(row.created_at),
  };
}

function isLegacyDefaultWorkflow(rows: DataWorkflowNodeRow[]): boolean {
  if (rows.length !== LEGACY_DEFAULT_WORKFLOW_NODES.length) {
    return false;
  }
  return rows.every((row, index) => {
    const legacyNode = LEGACY_DEFAULT_WORKFLOW_NODES[index];
    return (
      normalizeOperatorType(row.operator_type ?? row.node_key) === legacyNode.type &&
      String(row.label) === legacyNode.label &&
      Math.abs(toFiniteNumber(row.x, Number.NaN) - legacyNode.x) < 0.001 &&
      Math.abs(toFiniteNumber(row.y, Number.NaN) - legacyNode.y) < 0.001
    );
  });
}

function normalizeWorkflowNodeInputs(nodes: DataWorkflowNodeInput[]): DataWorkflowNodeInput[] {
  return nodes.map((node, index) => {
    const type = normalizeOperatorType(node.type);
    const label = node.label.trim() || DEFAULT_OPERATOR_LABELS[type];
    return {
      id: node.id.trim() || uuidv4(),
      type,
      label,
      x: toFiniteNumber(node.x, 80 + index * 28),
      y: toFiniteNumber(node.y, 120 + index * 24),
      config: node.config ?? {},
    };
  });
}

function normalizeWorkflowEdgeInputs(
  edges: DataWorkflowEdgeInput[],
  nodeIds: Set<string>
): DataWorkflowEdgeInput[] {
  const seen = new Set<string>();
  const normalized: DataWorkflowEdgeInput[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      continue;
    }
    const key = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.sourceHandle ?? ''}:${
      edge.targetHandle ?? ''
    }`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      id: edge.id.trim() || uuidv4(),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle ?? 'output',
      targetHandle: edge.targetHandle ?? 'input',
    });
  }
  return normalized;
}

function parseWorkflowConfig(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function normalizeOperatorType(value: string | null | undefined): DataWorkflowOperatorType {
  if (value && WORKFLOW_OPERATOR_TYPE_SET.has(value)) {
    return value as DataWorkflowOperatorType;
  }
  switch (value) {
    case 'load_source':
      return 'input_source';
    case 'profile_schema':
      return 'field_select';
    case 'drop_empty_rows':
      return 'missing_value';
    case 'deduplicate_rows':
      return 'deduplicate';
    case 'join_table':
    case 'asof_join':
      return 'join';
    case 'write_duckdb_table':
    case 'publish_dataset':
      return 'output';
    default:
      return 'filter';
  }
}

function getOutputTableName(node: DataWorkflowNode | undefined, fallback: string): string {
  if (!node) return fallback;
  const table = node.config.table;
  return typeof table === 'string' && table.trim() ? table.trim() : fallback;
}

function findLastMaterializedNodeId(
  nodes: DataWorkflowNode[],
  relationByNode: Map<string, string>
): string | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (relationByNode.has(node.id)) return node.id;
  }
  return null;
}

function compileFieldSelectSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const selected = stringArray(config.columns);
  const outputColumns =
    config.mode === 'exclude'
      ? columns.filter((column) => !selected.includes(column))
      : selected.length > 0
        ? selected
        : columns;
  return `CREATE TEMP TABLE ${output} AS SELECT ${quoteColumnList(outputColumns)} FROM ${input}`;
}

function compileFieldMappingSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const mappings = objectArray(config.mappings);
  const sourceToTarget = new Map(
    mappings.flatMap((mapping) =>
      typeof mapping.source === 'string' && typeof mapping.target === 'string'
        ? [[mapping.source, mapping.target] as const]
        : []
    )
  );
  const projections = columns.map((column) => {
    const target = sourceToTarget.get(column);
    return target
      ? `${quoteIdentifier(column)} AS ${quoteIdentifier(target)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

function compileMissingValueSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  if (config.strategy === 'drop_empty_rows') {
    const nonEmptyFilter =
      columns.length > 0
        ? columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' OR ')
        : 'true';
    return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input} WHERE ${nonEmptyFilter}`;
  }
  const rules = objectArray(config.rules);
  const expressions = new Map(columns.map((column) => [column, quoteIdentifier(column)]));
  const filters: string[] = [];
  for (const rule of rules) {
    if (typeof rule.column !== 'string' || !columns.includes(rule.column)) continue;
    const current = expressions.get(rule.column) ?? quoteIdentifier(rule.column);
    switch (rule.method) {
      case 'nullify_values':
        expressions.set(
          rule.column,
          `CASE WHEN ${current} IN (${unknownArray(rule.values).map(literalToSql).join(', ')}) THEN NULL ELSE ${current} END`
        );
        break;
      case 'literal_fill':
        expressions.set(rule.column, `COALESCE(${current}, ${literalToSql(rule.value)})`);
        break;
      case 'drop':
        filters.push(`${quoteIdentifier(rule.column)} IS NOT NULL`);
        break;
      default:
        break;
    }
  }
  const projections = columns.map(
    (column) => `${expressions.get(column) ?? quoteIdentifier(column)} AS ${quoteIdentifier(column)}`
  );
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}${
    filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : ''
  }`;
}

function compileTypeConvertSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const conversions = objectArray(config.conversions);
  const byColumn = new Map(
    conversions.flatMap((conversion) =>
      typeof conversion.column === 'string' && typeof conversion.type === 'string'
        ? [[conversion.column, conversion.type] as const]
        : []
    )
  );
  const projections = columns.map((column) => {
    const targetType = byColumn.get(column);
    return targetType
      ? `TRY_CAST(${quoteIdentifier(column)} AS ${duckDbType(targetType)}) AS ${quoteIdentifier(column)}`
      : quoteIdentifier(column);
  });
  return `CREATE TEMP TABLE ${output} AS SELECT ${projections.join(', ')} FROM ${input}`;
}

function compileDeduplicateSql(
  output: string,
  input: string,
  columns: string[],
  config: Record<string, unknown>
): string {
  const keys = stringArray(config.columns);
  if (keys.length === 0) {
    return `CREATE TEMP TABLE ${output} AS SELECT DISTINCT * FROM ${input}`;
  }
  const partitionBy = keys.map(quoteIdentifier).join(', ');
  const orderBy = sortKeysToSql(config.orderBy);
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT ${quoteColumnList(columns)}
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partitionBy}${orderBy ? ` ORDER BY ${orderBy}` : ''}) AS __rn
      FROM ${input}
    )
    WHERE __rn = 1
  `;
}

function compileSortSql(output: string, input: string, config: Record<string, unknown>): string {
  const orderBy = sortKeysToSql(config.keys);
  return `CREATE TEMP TABLE ${output} AS SELECT * FROM ${input}${orderBy ? ` ORDER BY ${orderBy}` : ''}`;
}

function compileCalculateFieldSql(
  output: string,
  input: string,
  config: Record<string, unknown>
): string {
  const calculations = objectArray(config.calculations);
  const additions = calculations.flatMap((calculation) =>
    typeof calculation.field === 'string' && typeof calculation.expression === 'string'
      ? [`${compileScalarExpression(calculation.expression)} AS ${quoteIdentifier(calculation.field)}`]
      : []
  );
  return `CREATE TEMP TABLE ${output} AS SELECT *${
    additions.length > 0 ? `, ${additions.join(', ')}` : ''
  } FROM ${input}`;
}

function compileAggregateSql(output: string, input: string, config: Record<string, unknown>): string {
  const groupBy = stringArray(config.groupBy);
  const metrics = objectArray(config.metrics).flatMap((metric) => {
    if (
      typeof metric.function !== 'string' ||
      typeof metric.expression !== 'string' ||
      typeof metric.alias !== 'string'
    ) {
      return [];
    }
    const expression =
      metric.expression === '*' ? '*' : compileScalarExpression(metric.expression);
    return [
      metric.function === 'count_distinct'
        ? `COUNT(DISTINCT ${expression}) AS ${quoteIdentifier(metric.alias)}`
        : `${metric.function.toUpperCase()}(${expression}) AS ${quoteIdentifier(metric.alias)}`,
    ];
  });
  const groupProjection = groupBy.map(quoteIdentifier);
  const projection = [...groupProjection, ...metrics].join(', ') || 'COUNT(*) AS "row_count"';
  return `CREATE TEMP TABLE ${output} AS SELECT ${projection} FROM ${input}${
    groupBy.length > 0 ? ` GROUP BY ${groupProjection.join(', ')}` : ''
  }`;
}

function compileJoinConditionList(value: unknown): string {
  const conditions = objectArray(value);
  return (
    conditions
      .flatMap((condition) =>
        typeof condition.left === 'string' && typeof condition.right === 'string'
          ? [`l.${quoteIdentifier(lastQualifiedPart(condition.left))} = r.${quoteIdentifier(lastQualifiedPart(condition.right))}`]
          : []
      )
      .join(' AND ') || 'true'
  );
}

function compileJoinProjection(
  keep: unknown,
  leftColumns: string[],
  rightColumns: string[],
  conflict: unknown,
  rightAlias?: string
): string {
  const items = objectArray(keep);
  if (items.length === 0) {
    const rightPrefix = getRightPrefix(conflict);
    return [
      'l.*',
      ...rightColumns.map(
        (column) => `r.${quoteIdentifier(column)} AS ${quoteIdentifier(`${rightPrefix}${column}`)}`
      ),
    ].join(', ');
  }
  return items
    .flatMap((item) => {
      if (item.side === 'left' && item.wildcard) return ['l.*'];
      if (item.side === 'right' && item.wildcard) return ['r.*'];
      if (typeof item.source !== 'string') return [];
      const side =
        rightAlias && item.source.startsWith(`${rightAlias}.`)
          ? 'r'
          : leftColumns.includes(lastQualifiedPart(item.source))
            ? 'l'
            : 'r';
      const alias = typeof item.alias === 'string' ? item.alias : lastQualifiedPart(item.source);
      return [`${side}.${quoteIdentifier(lastQualifiedPart(item.source))} AS ${quoteIdentifier(alias)}`];
    })
    .join(', ');
}

function compileAsofJoinSql(
  output: string,
  left: string,
  right: string,
  leftColumns: string[],
  rightColumns: string[],
  config: Record<string, unknown>
): string {
  const asof = isRecord(config.asof) ? config.asof : {};
  const leftTime = lastQualifiedPart(String(asof.leftTime ?? ''));
  const rightTime = lastQualifiedPart(String(asof.rightTime ?? ''));
  const operator = asof.operator === '<=' ? '>=' : '<=';
  const direction = asof.operator === '<=' ? 'ASC' : 'DESC';
  const byConditions = objectArray(asof.by)
    .flatMap((condition) =>
      typeof condition.left === 'string' && typeof condition.right === 'string'
        ? [`r.${quoteIdentifier(lastQualifiedPart(condition.right))} = l.${quoteIdentifier(lastQualifiedPart(condition.left))}`]
        : []
    )
    .join(' AND ');
  const tolerance = typeof asof.tolerance === 'string' ? asof.tolerance : '';
  const toleranceClause = tolerance
    ? ` AND ABS(EPOCH_MS(r.${quoteIdentifier(rightTime)}) - EPOCH_MS(l.${quoteIdentifier(leftTime)})) <= ${durationToMilliseconds(tolerance)}`
    : '';
  const projection = compileJoinProjection(
    config.keep,
    leftColumns,
    rightColumns,
    config.conflict,
    typeof config.rightAlias === 'string' ? config.rightAlias : undefined
  );
  return `
    CREATE TEMP TABLE ${output} AS
    SELECT ${projection}
    FROM ${left} l
    LEFT JOIN LATERAL (
      SELECT *
      FROM ${right} r
      WHERE r.${quoteIdentifier(rightTime)} ${operator} l.${quoteIdentifier(leftTime)}
        ${byConditions ? `AND ${byConditions}` : ''}
        ${toleranceClause}
      ORDER BY r.${quoteIdentifier(rightTime)} ${direction}
      LIMIT 1
    ) r ON true
  `;
}

function compileScalarExpression(expression: string): string {
  return expression.replace(
    /(\[`(?:[^`\\]|\\.)*`\]|\[[A-Za-z_][A-Za-z0-9_]*\])(?:\.(\[`(?:[^`\\]|\\.)*`\]|\[[A-Za-z_][A-Za-z0-9_]*\]))?/g,
    (_match, first: string, second: string | undefined) => quoteIdentifier(unwrapFieldToken(second ?? first))
  );
}

function sortKeysToSql(value: unknown): string {
  return objectArray(value)
    .flatMap((key) =>
      typeof key.field === 'string'
        ? [
            `${quoteIdentifier(key.field)} ${
              key.direction === 'desc' ? 'DESC' : 'ASC'
            }${key.nulls === 'first' || key.nulls === 'last' ? ` NULLS ${String(key.nulls).toUpperCase()}` : ''}`,
          ]
        : []
    )
    .join(', ');
}

function quoteColumnList(columns: string[]): string {
  return columns.map(quoteIdentifier).join(', ') || '*';
}

function literalToSql(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function duckDbType(type: string): string {
  switch (type) {
    case 'string':
      return 'VARCHAR';
    case 'int':
      return 'INTEGER';
    case 'double':
      return 'DOUBLE';
    case 'decimal':
      return 'DECIMAL(18, 6)';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'timestamp':
      return 'TIMESTAMP';
    default:
      return type.toUpperCase();
  }
}

function lastQualifiedPart(value: string): string {
  return value.includes('.') ? value.split('.').at(-1) ?? value : value;
}

function unwrapFieldToken(token: string): string {
  const inner = token.slice(1, -1);
  return inner.startsWith('`') && inner.endsWith('`') ? inner.slice(1, -1) : inner;
}

function getRightPrefix(conflict: unknown): string {
  if (isRecord(conflict) && typeof conflict.rightPrefix === 'string') {
    return conflict.rightPrefix;
  }
  return 'right_';
}

function durationToMilliseconds(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (multipliers[unit] ?? 0);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function normalizeListWindow(
  offset: number | null | undefined,
  limit: number | null | undefined
): { offset: number; limit: number } {
  const normalizedOffset = Math.max(0, Math.floor(toFiniteNumber(offset, 0)));
  const normalizedLimit = Math.min(200, Math.max(1, Math.floor(toFiniteNumber(limit, 200))));
  return { offset: normalizedOffset, limit: normalizedLimit };
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

function toFiniteNumber(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
