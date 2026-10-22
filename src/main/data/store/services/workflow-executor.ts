import { sqlNamedInputs } from '../../../../shared/sql-query';
/** Executes workflows into staging tables (temporary output mode). */
import { resolveCsvReadPath } from '../csv-encoding';
import type {
  DataWorkflowEdge,
  DataWorkflowNode,
  DataPipeline,
  DataRunPipelineInput,
} from '../../../../shared/contracts';
import type { PrepDiagnostic } from '../../../../shared/prep-dsl/ast';
import { getWorkflowUpstreamSignature } from '../../../../shared/workflow-plan';
import type { WorkflowNodeRunStat } from '../../data-command-types';
import {
  quoteIdentifier,
  toNumber,
  literalToSql,
  compileFilterConditionExpression,
  isRecord,
} from '../../operators';
import { DataStoreContext } from '../data-store-context';
import { isDuckDbTransactionStateError, tableNameFromId } from '../data-store-records';
import { normalizeSourcePath, readRelationForPath } from '../input-source';
import { CacheRepository } from '../repositories/cache-repository';
import { RawTableRepository } from '../repositories/raw-table-repository';
import { PipelineRepository } from '../repositories/pipeline-repository';
import { WatermarkRepository } from '../repositories/watermark-repository';
import { WorkflowRepository } from '../repositories/workflow-repository';
import {
  RuntimeWorkflow,
  WORKFLOW_TEMP_CACHE_TTL_MS,
  WorkflowCacheScope,
  WorkflowOutputMode,
  findWorkflowTerminalNodeId,
  normalizeRuntimeWorkflowInput,
  runtimeWorkflowToSaveInput,
  toPersistentCreateTableSql,
  workflowRequiresPipelineSource,
} from '../workflow-model';
import { WorkflowBindingResolver } from './workflow-binding-resolver';
import { WorkflowCompiler } from './workflow-compiler';
import { WorkflowValidator } from './workflow-validator';
import { v4 as uuidv4 } from 'uuid';

export class WorkflowExecutor {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly pipelines: PipelineRepository,
    private readonly rawTables: RawTableRepository,
    private readonly caches: CacheRepository,
    private readonly watermarks: WatermarkRepository,
    private readonly workflows: WorkflowRepository,
    private readonly validator: WorkflowValidator,
    private readonly compiler: WorkflowCompiler,
    private readonly binding: WorkflowBindingResolver
  ) {}
  /**
   * `expect` node: materializes the conforming main stream and the reject
   * stream of violating rows. Without `rejectStream` any violation fails the
   * run and reports sample rows.
   */
  private async materializeExpectNode(
    node: DataWorkflowNode,
    inputRelation: string,
    outputRelation: string,
    rejectRelation: string
  ): Promise<{
    rejectedRows: number;
    sample: Record<string, unknown>[];
    /** Set when the assertion fails the run — callers must record stats, then throw it. */
    failure?: string;
  }> {
    const config = node.config;
    const kind = typeof config.kind === 'string' ? config.kind : 'expression';
    const input = quoteIdentifier(inputRelation);
    await this.ctx.dropTableIfExists(outputRelation);
    await this.ctx.dropTableIfExists(rejectRelation);

    if (kind === 'row_count') {
      const operator = typeof config.operator === 'string' ? config.operator : '>=';
      const value = Number(config.value ?? 0);
      const count = await this.ctx.countRows(inputRelation);
      const ok =
        operator === '>'
          ? count > value
          : operator === '>='
            ? count >= value
            : operator === '<'
              ? count < value
              : operator === '<='
                ? count <= value
                : operator === '!='
                  ? count !== value
                  : count === value;
      if (!ok) {
        return {
          rejectedRows: 0,
          sample: [],
          failure: `Expect failed at node ${node.id}: row count ${count} does not satisfy rows ${operator} ${value}`,
        };
      }
      await this.ctx.runSql(
        `CREATE TABLE ${quoteIdentifier(outputRelation)} AS SELECT * FROM ${input}`
      );
      await this.ctx.runSql(
        `CREATE TABLE ${quoteIdentifier(rejectRelation)} AS SELECT * FROM ${input} WHERE false`
      );
      return { rejectedRows: 0, sample: [] };
    }

    let violation: string;
    if (kind === 'unique') {
      const columns = (Array.isArray(config.fields) ? config.fields : []).map((column) =>
        quoteIdentifier(String(column))
      );
      if (columns.length === 0) {
        throw new Error(`Expect unique at node ${node.id} requires at least one field`);
      }
      const match = columns
        .map((column) => `_d.${column} IS NOT DISTINCT FROM t.${column}`)
        .join(' AND ');
      violation = `EXISTS (
        SELECT 1 FROM (
          SELECT ${columns.join(', ')}, COUNT(*) AS _n
          FROM ${input} GROUP BY ${columns.join(', ')} HAVING _n > 1
        ) _d WHERE ${match}
      )`;
    } else {
      const expression =
        typeof config.expression === 'string' && config.expression.trim()
          ? config.expression
          : 'true';
      // `IS NOT TRUE` treats NULL (unknown) results as violations so rejected
      // rows never silently vanish from both streams.
      violation = `(${compileFilterConditionExpression(expression)}) IS NOT TRUE`;
    }

    const sample = await this.ctx.queryRows<Record<string, unknown>>(
      `SELECT * FROM ${input} t WHERE ${violation} LIMIT 5`
    );
    const rejectedRows = await this.countRejectRows(input, violation);
    const rejectStream = typeof config.rejectStream === 'string' ? config.rejectStream.trim() : '';
    if (rejectedRows > 0 && !rejectStream) {
      // Keep the message short — violating rows are persisted via node stats
      // and rendered by the UI's structured assertion-failure panel.
      const inputRows = await this.ctx.countRows(inputRelation);
      return {
        rejectedRows,
        sample,
        failure: `Expect failed at node ${node.id}: ${rejectedRows} of ${inputRows} row(s) violate the assertion`,
      };
    }
    await this.ctx.runSql(
      `CREATE TABLE ${quoteIdentifier(outputRelation)} AS SELECT * FROM ${input} t WHERE NOT (${violation})`
    );
    await this.ctx.runSql(
      `CREATE TABLE ${quoteIdentifier(rejectRelation)} AS SELECT * FROM ${input} t WHERE ${violation}`
    );
    return { rejectedRows, sample };
  }
  private async countRejectRows(input: string, violation: string): Promise<number> {
    const rows = await this.ctx.queryRows<{ count: number | string }>(
      `SELECT count(*) AS count FROM ${input} t WHERE ${violation}`
    );
    return toNumber(rows[0]?.count);
  }
  /**
   * Bound input tables always materialize in full. File sources may use
   * `incremental by [col]` to read rows newer than the stored watermark.
   */
  private async materializeInputSourceWithContract(
    pipeline: DataPipeline,
    node: DataWorkflowNode,
    sourcePath: string | null,
    outputRelation: string,
    watermarkUpdates: Array<{ nodeId: string; column: string; value: string }>
  ): Promise<string> {
    const incrementalBy =
      typeof node.config.incrementalBy === 'string' ? node.config.incrementalBy.trim() : '';
    const relation = await this.compiler.materializeInputSource(node, sourcePath, outputRelation);
    const usesRawTable =
      node.config.source === 'rawTable' ||
      (typeof node.config.source !== 'string' && Boolean(node.config.rawTableId));
    // Older saved workflows may still contain incrementalBy on a bound table.
    if (usesRawTable) return relation;
    if (!incrementalBy) return relation;

    const column = quoteIdentifier(incrementalBy);
    const table = quoteIdentifier(relation);
    const previous = await this.watermarks.getPipelineWatermark(
      pipeline.id,
      node.id,
      incrementalBy
    );
    if (previous !== null) {
      const filtered = `${relation}_incr`;
      await this.ctx.dropTableIfExists(filtered);
      await this.ctx.runSql(
        `CREATE TABLE ${quoteIdentifier(filtered)} AS SELECT * FROM ${table}
         WHERE ${column} > ${literalToSql(previous)}`
      );
      await this.ctx.dropTableIfExists(relation);
      const maxRow = await this.ctx.queryRows<{ value: unknown }>(
        `SELECT CAST(MAX(${column}) AS VARCHAR) AS value FROM ${quoteIdentifier(filtered)}`
      );
      const value = maxRow[0]?.value;
      if (value !== null && value !== undefined) {
        watermarkUpdates.push({ nodeId: node.id, column: incrementalBy, value: String(value) });
      }
      return filtered;
    }
    const maxRow = await this.ctx.queryRows<{ value: unknown }>(
      `SELECT CAST(MAX(${column}) AS VARCHAR) AS value FROM ${table}`
    );
    const value = maxRow[0]?.value;
    if (value !== null && value !== undefined) {
      watermarkUpdates.push({ nodeId: node.id, column: incrementalBy, value: String(value) });
    }
    return relation;
  }
  async runPipelineToTemporaryOutputUnsafe(
    id: string,
    input: DataRunPipelineInput
  ): Promise<{
    pipeline: DataPipeline;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    const diagnostics: PrepDiagnostic[] = [];
    await this.ctx.ensureReady();
    await this.caches.cleanupExpiredWorkflowNodeCaches();
    const pipeline = await this.pipelines.requirePipeline(id);
    const sourcePath = input.sourcePath
      ? normalizeSourcePath(input.sourcePath)
      : pipeline.sourcePath;
    const startedAt = this.ctx.now();
    const runtimeWorkflow = input.workflow
      ? normalizeRuntimeWorkflowInput(pipeline.id, input.workflow, startedAt)
      : await this.workflows.getRuntimeWorkflow(pipeline.id);
    if (!sourcePath && workflowRequiresPipelineSource(runtimeWorkflow.nodes)) {
      throw new Error('Data source file is required before running a cleaning pipeline');
    }

    const planDiagnostics =
      runtimeWorkflow.nodes.length > 0
        ? await this.validator.validateWorkflowPlanForPipeline(
            pipeline.id,
            runtimeWorkflowToSaveInput(runtimeWorkflow)
          )
        : [];
    const planErrors = planDiagnostics.filter((item) => item.severity === 'error');
    if (planErrors.length > 0) {
      throw new Error(
        `Workflow plan validation failed: ${planErrors.map((item) => item.message).join('; ')}`
      );
    }
    diagnostics.push(...planDiagnostics);

    try {
      const result = await this.cleanSourceIntoPipelineOutput(
        pipeline,
        sourcePath,
        runtimeWorkflow,
        'temporary',
        diagnostics
      );
      return {
        pipeline: {
          ...pipeline,
          status: 'completed',
          sourcePath,
          sourceRawTableId: result.sourceRawTableId,
          resultTable: result.resultTable,
          rowCount: result.rowCount,
          columnCount: result.columnCount,
          error: null,
        },
        diagnostics,
        nodeStats: result.nodeStats,
        watermarkUpdates: result.watermarkUpdates,
        stagedSinks: result.stagedSinks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isDuckDbTransactionStateError(message)) {
        await this.ctx.recoverDuckDbTransactionState();
      }
      throw error;
    }
  }
  async cleanSourceIntoPipelineOutput(
    pipeline: DataPipeline,
    sourcePath: string | null,
    workflow: RuntimeWorkflow,
    outputMode: WorkflowOutputMode,
    diagnostics: PrepDiagnostic[] = []
  ): Promise<{
    resultTable: string;
    rowCount: number;
    columnCount: number;
    sourceRawTableId: string | null;
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    if (workflow.nodes.length > 0) {
      return this.runWorkflowIntoPipelineOutput(
        pipeline,
        sourcePath,
        workflow.nodes,
        workflow.edges,
        outputMode,
        diagnostics
      );
    }

    if (!sourcePath) {
      throw new Error('Data source file is required before running a cleaning pipeline');
    }

    const resultTable =
      outputMode === 'temporary'
        ? tableNameFromId('temp_pipeline', `${pipeline.id}_${uuidv4()}`)
        : pipeline.resultTable || tableNameFromId('clean_pipeline', pipeline.id);
    const stagingTable = tableNameFromId('raw_pipeline', uuidv4());
    const relation = readRelationForPath(sourcePath, 'sourcePath');
    await this.ctx.dropTableIfExists(stagingTable);
    await this.ctx.dropTableIfExists(resultTable);
    try {
      await this.ctx.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(stagingTable)} AS SELECT * FROM ${relation}`,
        { sourcePath: resolveCsvReadPath(sourcePath) }
      );
      const columns = await this.ctx.getTableColumns(stagingTable);
      const nonEmptyFilter =
        columns.length > 0
          ? columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' OR ')
          : 'true';
      await this.ctx.runSql(
        `
            CREATE TABLE ${quoteIdentifier(resultTable)} AS
            SELECT DISTINCT *
            FROM ${quoteIdentifier(stagingTable)}
            WHERE ${nonEmptyFilter}
          `
      );
      const rowCount = await this.ctx.countRows(resultTable);
      const columnCount = (await this.ctx.getTableColumns(resultTable)).length;
      if (outputMode === 'temporary') {
        return { resultTable, rowCount, columnCount, sourceRawTableId: null };
      }
      const rawTable = await this.rawTables.upsertRawTableForPipelineOutput(
        pipeline.name,
        sourcePath,
        resultTable,
        rowCount,
        columnCount
      );
      return {
        resultTable,
        rowCount,
        columnCount,
        sourceRawTableId: rawTable?.id ?? pipeline.sourceRawTableId,
      };
    } finally {
      await this.ctx.dropTableIfExists(stagingTable);
    }
  }
  async runWorkflowIntoPipelineOutput(
    pipeline: DataPipeline,
    sourcePath: string | null,
    nodes: DataWorkflowNode[],
    edges: DataWorkflowEdge[],
    outputMode: WorkflowOutputMode,
    diagnostics: PrepDiagnostic[] = []
  ): Promise<{
    resultTable: string;
    rowCount: number;
    columnCount: number;
    sourceRawTableId: string | null;
    nodeStats: WorkflowNodeRunStat[];
    watermarkUpdates: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const outputNode = nodes.find((node) => node.type === 'output');
    const nodeStats: WorkflowNodeRunStat[] = [];
    try {
      return await this.runWorkflowIntoPipelineOutputInner(
        pipeline,
        sourcePath,
        nodes,
        edges,
        outputMode,
        diagnostics,
        nodeById,
        outputNode ?? null,
        nodeStats
      );
    } catch (error) {
      // Preserve partially collected stats so failed runs stay inspectable.
      const holder = error as { nodeStats?: WorkflowNodeRunStat[] };
      if (!holder.nodeStats) holder.nodeStats = nodeStats;
      throw error;
    }
  }
  async runWorkflowIntoPipelineOutputInner(
    pipeline: DataPipeline,
    sourcePath: string | null,
    nodes: DataWorkflowNode[],
    edges: DataWorkflowEdge[],
    outputMode: WorkflowOutputMode,
    diagnostics: PrepDiagnostic[],
    nodeById: Map<string, DataWorkflowNode>,
    outputNode: DataWorkflowNode | null,
    nodeStats: WorkflowNodeRunStat[]
  ): Promise<{
    resultTable: string;
    rowCount: number;
    columnCount: number;
    sourceRawTableId: string | null;
    nodeStats: WorkflowNodeRunStat[];
    watermarkUpdates: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    const outputTarget: { tableName: string; outputResultTableId?: string } =
      outputMode === 'temporary'
        ? { tableName: tableNameFromId('temp_pipeline', `${pipeline.id}_${uuidv4()}`) }
        : await this.binding.resolveWorkflowOutputTarget(
            outputNode ?? undefined,
            pipeline.resultTable || tableNameFromId('clean_pipeline', pipeline.id)
          );
    const resultTable = outputTarget.tableName;
    const relationByNode = new Map<string, string>();
    const visitingNodeIds = new Set<string>();
    const watermarkUpdates: Array<{ nodeId: string; column: string; value: string }> = [];
    const cacheScope: WorkflowCacheScope = outputMode === 'temporary' ? 'temporary' : 'permanent';
    const cacheRunId = uuidv4();
    const cacheExpiresAt =
      cacheScope === 'temporary' ? this.ctx.now() + WORKFLOW_TEMP_CACHE_TTL_MS : null;
    // Cache rows carry the upstream-subgraph signature they were materialized
    // under — the renderer compares it against the live draft to flag stale
    // previews, and it survives editor reopens (unlike in-memory run basis).
    const signatureInput = {
      nodes: nodes.map((node) => ({ id: node.id, type: node.type, config: node.config })),
      edges: edges.map((edge) => ({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    };
    const upstreamSignatureFor = (nodeId: string) =>
      getWorkflowUpstreamSignature(signatureInput, nodeId);
    await this.ctx.dropTableIfExists(resultTable);

    const relationKeyOf = (nodeId: string, sourceHandle?: string | null) =>
      sourceHandle === 'reject' ? `${nodeId}#reject` : nodeId;

    const findIncomingEdge = (nodeId: string, targetHandle: string) =>
      edges.find(
        (edge) => edge.targetNodeId === nodeId && (edge.targetHandle ?? 'input') === targetHandle
      );

    const materializeEdgeSource = async (edge: DataWorkflowEdge): Promise<string> => {
      const relation = await materializeNode(edge.sourceNodeId);
      const keyed = relationByNode.get(relationKeyOf(edge.sourceNodeId, edge.sourceHandle));
      return keyed ?? relation;
    };

    const collectNodeStat = async (
      node: DataWorkflowNode,
      outputRelation: string,
      inputRelations: Array<{ handle: string; relation: string }>
    ) => {
      const outputRows = await this.ctx.countRows(outputRelation);
      const inputRowsByHandle: Record<string, number> = {};
      for (const { handle, relation } of inputRelations) {
        inputRowsByHandle[handle] =
          (inputRowsByHandle[handle] ?? 0) + (await this.ctx.countRows(relation));
      }
      const inputRows =
        inputRelations.length > 0
          ? Object.values(inputRowsByHandle).reduce((total, count) => total + count, 0)
          : null;
      const stat: WorkflowNodeRunStat = {
        nodeId: node.id,
        nodeType: node.type,
        inputRows,
        outputRows,
      };
      // Multi-input operators (join/set_op) report each side separately so a
      // "left + right → output" reading never collapses into one ambiguous sum.
      if (inputRelations.length > 1) {
        stat.inputRowsByHandle = inputRowsByHandle;
      }
      if (
        inputRows !== null &&
        ['filter', 'deduplicate', 'limit', 'expect'].includes(node.type) &&
        outputRows < inputRows
      ) {
        stat.droppedRows = inputRows - outputRows;
      }
      nodeStats.push(stat);
    };

    const materializeNode = async (nodeId: string): Promise<string> => {
      const existingRelation = relationByNode.get(nodeId);
      if (existingRelation) return existingRelation;
      if (visitingNodeIds.has(nodeId)) {
        throw new Error(`Workflow contains a cycle at node: ${nodeId}`);
      }
      const node = nodeById.get(nodeId);
      if (!node) {
        throw new Error(`Workflow node not found: ${nodeId}`);
      }
      if (node.type === 'output') {
        const outputEdge = findIncomingEdge(node.id, 'input');
        if (!outputEdge) {
          throw new Error(`Output node has no input: ${node.id}`);
        }
        return materializeEdgeSource(outputEdge);
      }
      visitingNodeIds.add(nodeId);
      try {
        const outputRelation = this.caches.getWorkflowNodeCacheTableName(
          pipeline.id,
          node,
          cacheScope,
          cacheRunId
        );
        if (node.type === 'input_source') {
          const relation = await this.materializeInputSourceWithContract(
            pipeline,
            node,
            sourcePath,
            outputRelation,
            watermarkUpdates
          );
          relationByNode.set(node.id, relation);
          await this.caches.registerWorkflowNodeCache(
            node,
            relation,
            cacheScope,
            cacheExpiresAt,
            upstreamSignatureFor(node.id)
          );
          await collectNodeStat(node, relation, []);
          return relation;
        }

        if (node.config.disabled === true) {
          const passthroughEdge =
            node.type === 'join' || node.type === 'set_op'
              ? (findIncomingEdge(node.id, 'left') ??
                findIncomingEdge(node.id, 'input') ??
                findIncomingEdge(node.id, 'right'))
              : findIncomingEdge(node.id, 'input');
          if (!passthroughEdge) {
            throw new Error(`Disabled workflow node has no passthrough input: ${node.id}`);
          }
          const relation = await materializeEdgeSource(passthroughEdge);
          relationByNode.set(node.id, relation);
          return relation;
        }

        if (node.type === 'join' || node.type === 'set_op') {
          const leftEdge = findIncomingEdge(node.id, 'left');
          const rightEdge = findIncomingEdge(node.id, 'right');
          if (!leftEdge || !rightEdge) {
            throw new Error(
              `${node.type === 'join' ? 'Join' : 'Set operation'} node requires left and right inputs: ${node.id}`
            );
          }
          await materializeEdgeSource(leftEdge);
          await materializeEdgeSource(rightEdge);
        } else {
          const inputEdge = findIncomingEdge(node.id, 'input');
          if (!inputEdge) {
            throw new Error(`Workflow node has no input: ${node.id}`);
          }
          await materializeEdgeSource(inputEdge);
        }

        if (node.type === 'expect') {
          const inputEdge = findIncomingEdge(node.id, 'input')!;
          const inputRelation = relationByNode.get(
            relationKeyOf(inputEdge.sourceNodeId, inputEdge.sourceHandle)
          )!;
          const rejectRelation = `${outputRelation}_reject`;
          const { rejectedRows, sample, failure } = await this.materializeExpectNode(
            node,
            inputRelation,
            outputRelation,
            rejectRelation
          );
          // Record the assertion's stats before failing the run so failed-run
          // stats still carry rejectedRows and the violating sample.
          const expectInputRows = await this.ctx.countRows(inputRelation);
          const expectOutputRows = failure ? 0 : await this.ctx.countRows(outputRelation);
          const expectStat: WorkflowNodeRunStat = {
            nodeId: node.id,
            nodeType: 'expect',
            inputRows: expectInputRows,
            outputRows: expectOutputRows,
            droppedRows: Math.max(0, expectInputRows - expectOutputRows),
            rejectedRows,
            ...(sample.length > 0 ? { sample } : {}),
          };
          nodeStats.push(expectStat);
          if (failure) throw new Error(failure);
          relationByNode.set(node.id, outputRelation);
          relationByNode.set(`${node.id}#reject`, rejectRelation);
          await this.caches.registerWorkflowNodeCache(
            node,
            outputRelation,
            cacheScope,
            cacheExpiresAt,
            upstreamSignatureFor(node.id)
          );
          return outputRelation;
        }

        await this.ctx.dropTableIfExists(outputRelation);
        const namedRelations: Array<{ alias: string; relation: string }> = [];
        if (node.type === 'sql_query' && typeof node.config.sql === 'string') {
          for (const named of sqlNamedInputs(node.config.sql, nodes)) {
            namedRelations.push({
              alias: named.alias,
              relation: await materializeNode(named.nodeId),
            });
          }
        }
        const sql = await this.compiler.compileWorkflowNodeSql(
          node,
          outputRelation,
          relationByNode,
          edges,
          diagnostics,
          namedRelations
        );
        try {
          await this.ctx.runSql(toPersistentCreateTableSql(sql));
        } catch (error) {
          const origin = isRecord(node.config.generatedOrigin)
            ? node.config.generatedOrigin
            : undefined;
          const cause = error instanceof Error ? error.message : String(error);
          const functionLabel =
            origin && typeof origin.functionName === 'string'
              ? ` in generated helper ${origin.functionName}`
              : '';
          const wrapped = new Error(
            `Workflow node ${node.id} (${node.type})${functionLabel} failed: ${cause}`
          ) as Error & { workflowOrigin?: Record<string, unknown> };
          wrapped.workflowOrigin = {
            ...(origin ?? {}),
            nodeId: node.id,
            nodeType: node.type,
          };
          throw wrapped;
        }
        relationByNode.set(node.id, outputRelation);
        await this.caches.registerWorkflowNodeCache(
          node,
          outputRelation,
          cacheScope,
          cacheExpiresAt,
          upstreamSignatureFor(node.id)
        );
        const inputRelations = edges
          .filter((edge) => edge.targetNodeId === node.id)
          .map((edge) => ({
            handle: edge.targetHandle ?? 'input',
            relation: relationByNode.get(relationKeyOf(edge.sourceNodeId, edge.sourceHandle)),
          }))
          .filter((entry): entry is { handle: string; relation: string } =>
            Boolean(entry.relation)
          );
        await collectNodeStat(node, outputRelation, inputRelations);
        return outputRelation;
      } finally {
        visitingNodeIds.delete(nodeId);
      }
    };

    // Materialize every output sink into its own staging table; the first
    // sink uses `resultTable` so pipeline metadata/preview stay compatible.
    const outputNodes = nodes.filter(
      (node) => node.type === 'output' && node.config.disabled !== true
    );
    const stagedSinks: Array<{ nodeId: string; stagingTable: string }> = [];
    let rowCount = 0;
    let columnCount = 0;
    if (outputNodes.length > 0) {
      for (const [index, sinkNode] of outputNodes.entries()) {
        const sinkEdge =
          findIncomingEdge(sinkNode.id, 'input') ??
          edges.find((edge) => edge.targetNodeId === sinkNode.id);
        if (!sinkEdge) {
          throw new Error(`Output node ${sinkNode.id} has no incoming edge`);
        }
        const sinkRelation = await materializeEdgeSource(sinkEdge);
        const stagingTable = index === 0 ? resultTable : `${resultTable}__sink${index}`;
        await this.ctx.dropTableIfExists(stagingTable);
        await this.ctx.runSql(
          `CREATE TABLE ${quoteIdentifier(stagingTable)} AS SELECT * FROM ${quoteIdentifier(sinkRelation)}`
        );
        await this.caches.registerWorkflowNodeCache(
          sinkNode,
          stagingTable,
          cacheScope,
          cacheExpiresAt,
          upstreamSignatureFor(sinkNode.id)
        );
        nodeStats.push({
          nodeId: sinkNode.id,
          nodeType: 'output',
          inputRows: await this.ctx.countRows(sinkRelation),
          outputRows: await this.ctx.countRows(stagingTable),
        });
        stagedSinks.push({ nodeId: sinkNode.id, stagingTable });
      }
      rowCount = await this.ctx.countRows(resultTable);
      columnCount = (await this.ctx.getTableColumns(resultTable)).length;
    } else {
      const finalInputId = findWorkflowTerminalNodeId(nodes, edges);
      if (!finalInputId) {
        throw new Error('Workflow has no materialized output relation');
      }
      const finalRelation = await materializeNode(finalInputId);
      await this.ctx.runSql(
        `CREATE TABLE ${quoteIdentifier(resultTable)} AS SELECT * FROM ${quoteIdentifier(finalRelation)}`
      );
      rowCount = await this.ctx.countRows(resultTable);
      columnCount = (await this.ctx.getTableColumns(resultTable)).length;
    }
    if (outputMode === 'temporary') {
      return {
        resultTable,
        rowCount,
        columnCount,
        sourceRawTableId: null,
        nodeStats,
        watermarkUpdates,
        stagedSinks,
      };
    }
    if (stagedSinks.length > 1) {
      throw new Error(
        'Direct persisted writes support a single output sink; run temporary + commit instead'
      );
    }
    const sourceRawTableId =
      (await this.binding.findWorkflowSourceRawTableId(nodes)) ?? pipeline.sourceRawTableId;
    const rawTable = await this.rawTables.upsertRawTableForPipelineOutput(
      pipeline.name,
      sourcePath,
      resultTable,
      rowCount,
      columnCount,
      outputTarget.outputResultTableId
    );
    void rawTable;
    return {
      resultTable,
      rowCount,
      columnCount,
      sourceRawTableId,
      nodeStats,
      watermarkUpdates,
      stagedSinks,
    };
  }
}
