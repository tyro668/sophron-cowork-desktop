import { resolveCsvReadPath } from '../csv-encoding';
import { resolveSqlQuerySchemas } from '../../workflow/sql-query-schemas';
/** Node-level previews: rows, columns, column types, distinct values. */
import type {
  DataColumnTypeInfo,
  DataFieldType,
  DataRawTablePreview,
  DataWorkflowNode,
  DataPipeline,
  DataPreviewWorkflowNodeInput,
  DataWorkflowSaveInput,
} from '../../../../shared/contracts';
import { isDataFieldType } from '../../../../shared/data-field-types';
import { parseFieldRefExact } from '../../../../shared/expression-syntax/fields';
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
import { RawTableRepository } from '../repositories/raw-table-repository';
import { OutputCommitJournal } from '../repositories/output-commit-journal';
import { PipelineRepository } from '../repositories/pipeline-repository';
import { WorkflowRepository } from '../repositories/workflow-repository';
import { stringConfigValue } from '../workflow-model';
import { WorkflowCompiler } from './workflow-compiler';

export class WorkflowNodePreviewService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly pipelines: PipelineRepository,
    private readonly rawTables: RawTableRepository,
    private readonly caches: CacheRepository,
    private readonly compiler: WorkflowCompiler,
    private readonly workflows: WorkflowRepository,
    private readonly outputCommits: OutputCommitJournal
  ) {}
  async previewWorkflowNode(input: DataPreviewWorkflowNodeInput): Promise<DataRawTablePreview> {
    // Node previews may materialize cache/preview tables — physical writes
    // serialize with commits through the exclusive section.
    return this.ctx.runExclusive(
      () => this.previewWorkflowNodeUnsafe(input),
      `previewWorkflowNode:${input.pipelineId}:${input.nodeId}`
    );
  }
  private async previewWorkflowNodeUnsafe(
    input: DataPreviewWorkflowNodeInput
  ): Promise<DataRawTablePreview> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.requirePipeline(input.pipelineId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      pipelineId: pipeline.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };
    const previewSource = await this.resolveWorkflowNodePreviewTable(pipeline, node);
    const tableName = previewSource?.tableName ?? null;

    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      // No materialized table yet — surface the plan-inferred schema so the
      // data tab still shows the expected columns instead of a blank grid.
      const inferred = await this.inferWorkflowNodeSchema(pipeline, node, input.workflow);
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
      generatedAt: previewSource?.generatedAt ?? null,
      workflowSignature: previewSource?.workflowSignature ?? null,
    };
  }
  async getWorkflowNodeColumns(input: DataPreviewWorkflowNodeInput): Promise<string[]> {
    return this.ctx.runExclusive(
      () => this.getWorkflowNodeColumnsUnsafe(input),
      `getWorkflowNodeColumns:${input.pipelineId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeColumnsUnsafe(
    input: DataPreviewWorkflowNodeInput
  ): Promise<string[]> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.requirePipeline(input.pipelineId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      pipelineId: pipeline.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    const inputSourceColumns = await this.compiler.resolveInputSourceColumns(
      node,
      pipeline.sourcePath
    );
    if (inputSourceColumns) {
      return inputSourceColumns;
    }

    // The live draft's plan-inferred schema wins over a materialized cache
    // table — the cache may still carry the previous run's column names.
    if (input.workflow?.nodes?.length) {
      const inferred = await this.inferWorkflowNodeSchema(pipeline, node, input.workflow);
      if (inferred) {
        return inferred.map((column) => column.name);
      }
    }

    const tableName =
      (await this.resolveWorkflowNodePreviewTable(pipeline, node))?.tableName ?? null;

    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      return (
        (await this.inferWorkflowNodeSchema(pipeline, node, input.workflow))?.map(
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
      `getWorkflowNodeColumnTypes:${input.pipelineId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeColumnTypesUnsafe(
    input: DataPreviewWorkflowNodeInput
  ): Promise<DataColumnTypeInfo[]> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.requirePipeline(input.pipelineId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      pipelineId: pipeline.id,
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
    const tableName =
      (await this.resolveWorkflowNodePreviewTable(pipeline, node))?.tableName ?? null;
    const tableExists = tableName ? await this.ctx.physicalTableExists(tableName) : false;
    if (input.workflow?.nodes?.length) {
      const inferred = await this.inferWorkflowNodeSchema(pipeline, node, input.workflow);
      if (inferred) {
        const cacheTypes =
          tableName && tableExists ? await this.ctx.getTableColumnTypes(tableName) : [];
        return mergeInferredWithCacheTypes(inferred, cacheTypes);
      }
    }
    if (!tableName || !tableExists) {
      return toColumnTypeInfos(await this.inferWorkflowNodeSchema(pipeline, node, input.workflow));
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
    pipeline: DataPipeline,
    node: DataWorkflowNode,
    draftWorkflow?: DataWorkflowSaveInput | null
  ): Promise<PlanColumn[] | null> {
    const draft = draftWorkflow?.nodes?.length ? draftWorkflow : null;
    const runtime = draft
      ? {
          nodes: draft.nodes.map((item) => ({
            id: item.id,
            pipelineId: pipeline.id,
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
            pipelineId: pipeline.id,
            sourceNodeId: item.sourceNodeId,
            targetNodeId: item.targetNodeId,
            sourceHandle: item.sourceHandle ?? null,
            targetHandle: item.targetHandle ?? null,
            createdAt: 0,
          })),
        }
      : await this.workflows.getRuntimeWorkflow(pipeline.id);
    if (runtime.nodes.length === 0) return null;
    const overlaid = runtime.nodes.map((item) =>
      item.id === node.id ? { ...item, type: node.type, config: node.config } : item
    );
    const { plan } = buildWorkflowPlan({ nodes: overlaid, edges: runtime.edges });
    const inputSchemas = new Map<string, PlanColumn[]>();
    for (const planNode of plan.nodes) {
      if (planNode.type !== 'input') continue;
      const pipelineNode = overlaid.find((item) => item.id === planNode.id);
      if (!pipelineNode) continue;
      const columns = await this.compiler.resolveInputSourceColumnTypes(
        pipelineNode,
        pipeline.sourcePath
      );
      if (columns) inputSchemas.set(planNode.id, columns);
    }
    const sqlSchemas = await resolveSqlQuerySchemas(this.ctx.connection!, plan, inputSchemas);
    const { schemas } = propagateWorkflowPlanSchemas(
      plan,
      (planNode) => sqlSchemas.resolved.get(planNode.id) ?? null
    );
    const schema = schemas.get(node.id);
    return schema?.known ? schema.columns : null;
  }
  async getWorkflowNodeColumnValues(
    input: DataPreviewWorkflowNodeInput & { column: string }
  ): Promise<string[]> {
    return this.ctx.runExclusive(
      () => this.getWorkflowNodeColumnValuesUnsafe(input),
      `getWorkflowNodeColumnValues:${input.pipelineId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeColumnValuesUnsafe(
    input: DataPreviewWorkflowNodeInput & { column: string }
  ): Promise<string[]> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.requirePipeline(input.pipelineId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      pipelineId: pipeline.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };

    let tableName = (await this.resolveWorkflowNodePreviewTable(pipeline, node))?.tableName ?? null;
    if (!tableName || !(await this.ctx.physicalTableExists(tableName))) {
      // 缓存表不存在，尝试从源文件加载数据创建临时表
      if (node.type !== 'input' || node.config.disabled === true) {
        return [];
      }
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.rawTableId)
            ? 'rawTable'
            : 'pipeline';
      if (source === 'rawTable') {
        return [];
      }
      const filePath =
        source === 'file' && typeof node.config.filePath === 'string'
          ? normalizeSourcePath(node.config.filePath)
          : pipeline.sourcePath;
      if (!filePath) {
        return [];
      }
      tableName = tableNameFromId('workflow_preview_values', node.id);
      await this.ctx.dropTableIfExists(tableName);
      const relation = readRelationForPath(filePath, 'sourcePath');
      await this.ctx.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${relation}`,
        { sourcePath: resolveCsvReadPath(filePath) }
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
      `getWorkflowNodeRowCount:${input.pipelineId}:${input.nodeId}`
    );
  }
  private async getWorkflowNodeRowCountUnsafe(
    input: DataPreviewWorkflowNodeInput
  ): Promise<number> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.requirePipeline(input.pipelineId);
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const nodeConfig = input.nodeConfig ?? {};
    const node: DataWorkflowNode = {
      id: input.nodeId,
      pipelineId: pipeline.id,
      type: input.nodeType,
      label: '',
      x: 0,
      y: 0,
      config: nodeConfig,
      createdAt: 0,
      updatedAt: 0,
    };
    const tableName =
      (await this.resolveWorkflowNodePreviewTable(pipeline, node))?.tableName ?? null;
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
  /** Resolves the physical preview table. Cache-sourced tables also carry the
   *  generation timestamp and the upstream signature they were built under —
   *  the renderer needs both for the stale-preview badge and "updated at". */
  async resolveWorkflowNodePreviewTable(
    pipeline: DataPipeline,
    node: DataWorkflowNode
  ): Promise<{
    tableName: string;
    generatedAt?: number;
    workflowSignature?: string | null;
  } | null> {
    if (node.config.disabled === true) {
      return null;
    }
    if (node.type === 'input') {
      const source =
        typeof node.config.source === 'string'
          ? node.config.source
          : stringConfigValue(node.config.rawTableId)
            ? 'rawTable'
            : 'pipeline';
      if (source === 'rawTable') {
        const rawTableRef =
          stringConfigValue(node.config.rawTableId) ||
          stringConfigValue(node.config.rawTableId) ||
          stringConfigValue(node.config.sourceRawTableId) ||
          stringConfigValue(node.config.name) ||
          stringConfigValue(node.config.alias);
        if (!rawTableRef) {
          return null;
        }
        const rawTable = await this.rawTables.findRawTableByReference(rawTableRef);
        return rawTable?.tableName ? { tableName: rawTable.tableName } : null;
      }
    }
    const cache = await this.caches.findWorkflowNodeCache(pipeline.id, node.id);
    if (cache) {
      return {
        tableName: cache.tableName,
        generatedAt: cache.generatedAt,
        workflowSignature: cache.workflowSignature,
      };
    }
    if (node.type === 'input') {
      return { tableName: tableNameFromId('workflow_source', node.id) };
    }
    if (node.type === 'output') {
      const outputResultTableId =
        stringConfigValue(node.config.outputResultTableId) ||
        stringConfigValue(node.config.resultTableId);
      const resultTableName = outputResultTableId
        ? (await this.rawTables.getResultTable(outputResultTableId))?.tableName
        : stringConfigValue(node.config.table) ||
          pipeline.resultTable ||
          tableNameFromId('clean_pipeline', pipeline.id);
      if (!resultTableName) {
        return null;
      }
      // The sink's cache row dies with its staging table post-commit; the
      // commit journal keeps the generating signature + timestamp instead.
      const provenance = await this.outputCommits.findLatestCommittedForTarget(
        pipeline.id,
        resultTableName
      );
      return {
        tableName: resultTableName,
        generatedAt: provenance?.generatedAt,
        workflowSignature: provenance?.workflowSignature ?? null,
      };
    }
    return { tableName: tableNameFromId(`workflow_${node.type}`, node.id) };
  }
}

/** Plan-inferred columns carry optional types; unknowns stay absent so field selectors render the same "?" state as before. */
function toColumnTypeInfos(columns: PlanColumn[] | null): DataColumnTypeInfo[] {
  return (columns ?? [])
    .filter((column) => isDataFieldType(column.type))
    .map((column) => ({
      name: column.name,
      type: column.type as DataFieldType,
      storageType: column.storageType ?? column.type ?? '',
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
        storageType: column.storageType ?? column.type ?? '',
      });
      continue;
    }
    const cached = cacheByName.get(column.name);
    if (cached) merged.push(cached);
  }
  return merged;
}
