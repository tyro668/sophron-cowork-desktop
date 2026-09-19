/** Node-level previews: rows, columns, column types, distinct values. */
import type {
  DataColumnTypeInfo,
  DataFieldType,
  DataInputTablePreview,
  DataWorkflowNode,
  DataCleaningTask,
  DataPreviewWorkflowNodeInput,
  DataWorkflowSaveInput,
} from '../../../../shared/contracts';
import { isDataFieldType } from '../../../../shared/data-field-types';
import { parseFieldRefExact } from '../../../../shared/prep-dsl';
import {
  buildWorkflowPlan,
  propagateWorkflowPlanSchemas,
  type PlanColumn,
} from '../../../../shared/workflow-plan';
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
import { WorkflowRepository } from '../repositories/workflow-repository';
import { stringConfigValue } from '../workflow-model';
import { WorkflowCompiler } from './workflow-compiler';

export class WorkflowNodePreviewService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly tasks: TaskRepository,
    private readonly datasets: DatasetRepository,
    private readonly caches: CacheRepository,
    private readonly compiler: WorkflowCompiler,
    private readonly workflows: WorkflowRepository
  ) {}
  async previewWorkflowNode(input: DataPreviewWorkflowNodeInput): Promise<DataInputTablePreview> {
    // Node previews may materialize cache/preview tables — physical writes
    // serialize with commits through the exclusive section.
    return this.ctx.runExclusive(
      () => this.previewWorkflowNodeUnsafe(input),
      `previewWorkflowNode:${input.taskId}:${input.nodeId}`
    );
  }
  private async previewWorkflowNodeUnsafe(
    input: DataPreviewWorkflowNodeInput
  ): Promise<DataInputTablePreview> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(input.taskId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
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
      // No materialized table yet — surface the plan-inferred schema so the
      // data tab still shows the expected columns instead of a blank grid.
      const inferred = await this.inferWorkflowNodeSchema(task, node, input.workflow);
      return {
        columns: (inferred ?? []).map((column) => column.name),
        columnTypes: toColumnTypeInfos(inferred),
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
    return this.ctx.runExclusive(
      () => this.getWorkflowNodeColumnsUnsafe(input),
      `getWorkflowNodeColumns:${input.taskId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeColumnsUnsafe(
    input: DataPreviewWorkflowNodeInput
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

    const inputSourceColumns = await this.compiler.resolveInputSourceColumns(node, task.sourcePath);
    if (inputSourceColumns) {
      return inputSourceColumns;
    }

    // The live draft's plan-inferred schema wins over a materialized cache
    // table — the cache may still carry the previous run's column names.
    if (input.workflow?.nodes?.length) {
      const inferred = await this.inferWorkflowNodeSchema(task, node, input.workflow);
      if (inferred) {
        return inferred.map((column) => column.name);
      }
    }

    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);

    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      return (
        (await this.inferWorkflowNodeSchema(task, node, input.workflow))?.map(
          (column) => column.name
        ) ?? []
      );
    }

    return this.ctx.getTableColumns(tableName);
  }
  async getWorkflowNodeColumnTypes(
    input: DataPreviewWorkflowNodeInput
  ): Promise<DataColumnTypeInfo[]> {
    return this.ctx.runExclusive(
      () => this.getWorkflowNodeColumnTypesUnsafe(input),
      `getWorkflowNodeColumnTypes:${input.taskId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeColumnTypesUnsafe(
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

    // Same precedence as column names: draft-inferred schema first, cache
    // table only fills types the plan cannot determine.
    const tableName = await this.resolveWorkflowNodePreviewTable(task, node);
    const tableExists = tableName ? await this.ctx.physicalTableExists(tableName) : false;
    if (input.workflow?.nodes?.length) {
      const inferred = await this.inferWorkflowNodeSchema(task, node, input.workflow);
      if (inferred) {
        const cacheTypes =
          tableName && tableExists ? await this.ctx.getTableColumnTypes(tableName) : [];
        return mergeInferredWithCacheTypes(inferred, cacheTypes);
      }
    }
    if (!tableName || !tableExists) {
      return toColumnTypeInfos(await this.inferWorkflowNodeSchema(task, node, input.workflow));
    }

    return this.ctx.getTableColumnTypes(tableName);
  }

  /**
   * Plan-level schema fallback: propagates input-source column types through
   * the workflow graph so downstream field selectors keep type info before any
   * run materializes preview tables. The queried node's current (possibly
   * unsaved) config is overlaid onto its counterpart. `draftWorkflow` — the
   * live canvas graph — wins over the saved workflow when provided, so
   * unsaved topology edits are reflected as well.
   */
  private async inferWorkflowNodeSchema(
    task: DataCleaningTask,
    node: DataWorkflowNode,
    draftWorkflow?: DataWorkflowSaveInput | null
  ): Promise<PlanColumn[] | null> {
    const draft = draftWorkflow?.nodes?.length ? draftWorkflow : null;
    const runtime = draft
      ? {
          nodes: draft.nodes.map((item) => ({
            id: item.id,
            taskId: task.id,
            type: item.type,
            label: item.label ?? '',
            x: item.x ?? 0,
            y: item.y ?? 0,
            config: item.config ?? {},
            createdAt: 0,
            updatedAt: 0,
          })),
          edges: draft.edges.map((item) => ({
            id: item.id,
            taskId: task.id,
            sourceNodeId: item.sourceNodeId,
            targetNodeId: item.targetNodeId,
            sourceHandle: item.sourceHandle ?? null,
            targetHandle: item.targetHandle ?? null,
            createdAt: 0,
          })),
        }
      : await this.workflows.getRuntimeWorkflow(task.id);
    if (runtime.nodes.length === 0) return null;
    const overlaid = runtime.nodes.map((item) =>
      item.id === node.id ? { ...item, type: node.type, config: node.config } : item
    );
    const { plan } = buildWorkflowPlan({ nodes: overlaid, edges: runtime.edges });
    const inputSchemas = new Map<string, PlanColumn[]>();
    for (const planNode of plan.nodes) {
      if (planNode.type !== 'input_source') continue;
      const taskNode = overlaid.find((item) => item.id === planNode.id);
      if (!taskNode) continue;
      const columns = await this.compiler.resolveInputSourceColumnTypes(taskNode, task.sourcePath);
      if (columns) inputSchemas.set(planNode.id, columns);
    }
    const { schemas } = propagateWorkflowPlanSchemas(
      plan,
      (planNode) => inputSchemas.get(planNode.id) ?? null
    );
    const schema = schemas.get(node.id);
    return schema?.known ? schema.columns : null;
  }
  async getWorkflowNodeColumnValues(
    input: DataPreviewWorkflowNodeInput & { column: string }
  ): Promise<string[]> {
    return this.ctx.runExclusive(
      () => this.getWorkflowNodeColumnValuesUnsafe(input),
      `getWorkflowNodeColumnValues:${input.taskId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeColumnValuesUnsafe(
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
    return this.ctx.runExclusive(
      () => this.getWorkflowNodeRowCountUnsafe(input),
      `getWorkflowNodeRowCount:${input.taskId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeRowCountUnsafe(
    input: DataPreviewWorkflowNodeInput
  ): Promise<number> {
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

/** Plan-inferred columns carry optional types; unknowns stay absent so field selectors render the same "?" state as before. */
function toColumnTypeInfos(columns: PlanColumn[] | null): DataColumnTypeInfo[] {
  return (columns ?? [])
    .filter((column) => isDataFieldType(column.type))
    .map((column) => ({
      name: column.name,
      type: column.type as DataFieldType,
      storageType: column.type ?? '',
    }));
}

/**
 * Draft-inferred columns win over a materialized cache table; where the plan
 * cannot determine a column's type, the cached table's physical type fills in
 * for same-named columns so the selector keeps a real type when available.
 */
function mergeInferredWithCacheTypes(
  columns: PlanColumn[] | null,
  cacheTypes: DataColumnTypeInfo[]
): DataColumnTypeInfo[] {
  const cacheByName = new Map(cacheTypes.map((typeInfo) => [typeInfo.name, typeInfo]));
  const merged: DataColumnTypeInfo[] = [];
  for (const column of columns ?? []) {
    if (isDataFieldType(column.type)) {
      merged.push({
        name: column.name,
        type: column.type as DataFieldType,
        storageType: column.type ?? '',
      });
      continue;
    }
    const cached = cacheByName.get(column.name);
    if (cached) merged.push(cached);
  }
  return merged;
}
