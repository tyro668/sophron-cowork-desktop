/** Node-level previews: rows, columns, column types, distinct values. */
import type {
  DataColumnTypeInfo,
  DataInputTablePreview,
  DataWorkflowNode,
  DataCleaningTask,
  DataPreviewWorkflowNodeInput,
} from '../../../../shared/contracts';
import { parseFieldRefExact } from '../../../../shared/prep-dsl';
import { quoteIdentifier, toNumber } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import {
  normalizePreviewLimit,
  normalizePreviewOffset,
  normalizePreviewRow,
  normalizeSourcePath,
  readRelationForPath,
} from '../input-source';
import { CacheRepository } from '../repositories/cache-repository';
import { DatasetRepository } from '../repositories/dataset-repository';
import { TaskRepository } from '../repositories/task-repository';
import { stringConfigValue } from '../workflow-model';
import { WorkflowCompiler } from './workflow-compiler';

export class WorkflowNodePreviewService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly tasks: TaskRepository,
    private readonly datasets: DatasetRepository,
    private readonly caches: CacheRepository,
    private readonly compiler: WorkflowCompiler
  ) {}
  async previewWorkflowNode(input: DataPreviewWorkflowNodeInput): Promise<DataInputTablePreview> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(input.taskId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const nodeConfig = input.nodeConfig ?? {};
    const tableName = await this.resolveWorkflowNodePreviewTable(task, {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    });

    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        fileCount: 0,
        limit,
        offset,
        totalRows: 0,
      };
    }

    const quotedTableName = quoteIdentifier(tableName);
    const countRows = await this.ctx.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${quotedTableName}`
    );
    const rows = await this.ctx.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${quotedTableName} LIMIT ${limit} OFFSET ${offset}`
    );
    return {
      columns: await this.ctx.getTableColumns(tableName),
      columnTypes: await this.ctx.getTableColumnTypes(tableName),
      rows: rows.map(normalizePreviewRow),
      fileCount: 1,
      limit,
      offset,
      totalRows: toNumber(countRows[0]?.count),
    };
  }
  async getWorkflowNodeColumns(input: DataPreviewWorkflowNodeInput): Promise<string[]> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(input.taskId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const inputSourceColumns = await this.compiler.resolveInputSourceColumns(node, task.sourcePath);
    if (inputSourceColumns) {
      return inputSourceColumns;
    }

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);

    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      return [];
    }

    return this.ctx.getTableColumns(tableName);
  }
  async getWorkflowNodeColumnTypes(
    input: DataPreviewWorkflowNodeInput
  ): Promise<DataColumnTypeInfo[]> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(input.taskId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      return [];
    }

    return this.ctx.getTableColumnTypes(tableName);
  }
  async getWorkflowNodeColumnValues(
    input: DataPreviewWorkflowNodeInput & { column: string }
  ): Promise<string[]> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(input.taskId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    let tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      // 缓存表不存在，尝试从源文件加载数据创建临时表
      if (node.type !== 'input_source' || node.config.disabled === true) {
        return [];
      }
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.datasetId)
            ? 'dataset'
            : 'task';
      if (source === 'dataset') {
        return [];
      }
      const filePath =
        source === 'file' && typeof node.config.filePath === 'string'
          ? normalizeSourcePath(node.config.filePath)
          : task.sourcePath;
      if (!filePath) {
        return [];
      }
      tableName = tableNameFromId('workflow_preview_values', node.id);
      await this.ctx.dropTableIfExists(tableName);
      const relation = readRelationForPath(filePath, 'sourcePath');
      await this.ctx.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`,
        { sourcePath: filePath }
      );
    }

    const colName = parseFieldRefExact(input.column)?.name ?? input.column.trim();
    if (tableName && !(await this.ctx.physicalTableExists(tableName))) {
      return [];
    }
    const quotedCol = quoteIdentifier(colName);
    const quotedTable = quoteIdentifier(tableName);
    const rows = await this.ctx.queryRows<{ val: string }>(
      `SELECT DISTINCT ${quotedCol} AS val FROM ${quotedTable} WHERE ${quotedCol} IS NOT NULL ORDER BY ${quotedCol} LIMIT 100`,
      {}
    );
    return rows.map((row) => (row.val === null ? '' : String(row.val)));
  }
  async getWorkflowNodeRowCount(input: DataPreviewWorkflowNodeInput): Promise<number> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(input.taskId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      taskId: task.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };
    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      return 0;
    }
    const quotedTable = quoteIdentifier(tableName);
    const rows = await this.ctx.queryRows<{ cnt: number }>(
      `SELECT count(*) AS cnt FROM ${quotedTable}`,
      {}
    );
    return rows[0]?.cnt ?? 0;
  }
  async resolveWorkflowNodePreviewTable(
    task: DataCleaningTask,
    node: DataWorkflowNode
  ): Promise<string | null> {
    if (node.config.disabled === true) {
      return null;
    }
    if (node.type === 'input_source') {
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.datasetId)
            ? 'dataset'
            : 'task';
      if (source === 'dataset') {
        const datasetRef =
          stringConfigValue(node.config.datasetId) ||
          stringConfigValue(node.config.inputTableId) ||
          stringConfigValue(node.config.sourceDatasetId) ||
          stringConfigValue(node.config.name) ||
          stringConfigValue(node.config.alias);
        if (!datasetRef) {
          return null;
        }
        const dataset = await this.datasets.findDatasetByReference(datasetRef);
        return dataset?.tableName ?? null;
      }
    }
    const cachedTableName = await this.caches.findWorkflowNodeCacheTable(task.id, node.id);
    if (cachedTableName) {
      return cachedTableName;
    }
    if (node.type === 'input_source') {
      return tableNameFromId('workflow_source', node.id);
    }
    if (node.type === 'output') {
      const outputDatasetId =
        stringConfigValue(node.config.outputDatasetId) ||
        stringConfigValue(node.config.outputTableId);
      if (outputDatasetId) {
        const outputTable = await this.datasets.getOutputTable(outputDatasetId);
        return outputTable?.tableName ?? null;
      }
      return (
        stringConfigValue(node.config.table) ||
        task.outputTable ||
        tableNameFromId('clean_task', task.id)
      );
    }
    return tableNameFromId(`workflow_${node.type}`, node.id);
  }
}
