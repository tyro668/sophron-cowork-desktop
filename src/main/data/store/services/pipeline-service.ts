/** Pipeline lifecycle orchestration: CRUD, run, save workflow, cleanup. */
import type {
  DataPipeline,
  DataCreatePipelineInput,
  DataRunPipelineInput,
  DataPipelineRun,
  DataPipelineRunTrigger,
  DataPipelineStatus,
  DataPipelineWorkflow,
  DataUpdatePipelineInput,
  DataWorkflowSaveInput,
} from '../../../../shared/contracts';
import type { PrepDiagnostic } from '../../../../shared/prep-dsl/ast';
import type { WorkflowNodeRunStat } from '../../data-command-types';
import { DataStoreContext } from '../data-store-context';
import { normalizeSourcePath } from '../input-source';
import { CacheRepository } from '../repositories/cache-repository';
import { RawTableRepository } from '../repositories/raw-table-repository';
import { RunStatsRepository } from '../repositories/run-stats-repository';
import { PipelineRunsRepository } from '../repositories/pipeline-runs-repository';
import { PipelineRepository } from '../repositories/pipeline-repository';
import { WorkflowRepository } from '../repositories/workflow-repository';
import {
  normalizeRuntimeWorkflowInput,
  normalizeScopedWorkflowInputs,
  runtimeWorkflowToSaveInput,
  workflowExecutionSignature,
} from '../workflow-model';
import { OutputCommitCoordinator } from './output-commit-coordinator';
import { WorkflowBindingResolver } from './workflow-binding-resolver';
import { WorkflowExecutor } from './workflow-executor';
import { WorkflowValidator } from './workflow-validator';
import { v4 as uuidv4 } from 'uuid';

/**
 * The executor stamps node failures with `workflowOrigin.nodeId`; fall back
 * to the message wrapper ("Workflow node <id> (<type>) failed: …") so the
 * run row always names the node that broke.
 */
function failedNodeIdOf(error: unknown): string | null {
  const origin = (error as { workflowOrigin?: { nodeId?: unknown } }).workflowOrigin;
  if (origin && typeof origin.nodeId === 'string') return origin.nodeId;
  const message = error instanceof Error ? error.message : String(error);
  return /^Workflow node (\S+) \(/.exec(message)?.[1] ?? null;
}

export class PipelineService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly pipelines: PipelineRepository,
    private readonly rawTables: RawTableRepository,
    private readonly workflows: WorkflowRepository,
    private readonly caches: CacheRepository,
    private readonly runStats: RunStatsRepository,
    private readonly pipelineRuns: PipelineRunsRepository,
    private readonly executor: WorkflowExecutor,
    private readonly validator: WorkflowValidator,
    private readonly commitCoordinator: OutputCommitCoordinator,
    private readonly binding: WorkflowBindingResolver
  ) {}
  async createPipeline(input: DataCreatePipelineInput): Promise<DataPipeline> {
    await this.ctx.ensureMetadataReady();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Pipeline name is required');
    }
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : null;
    const sourceRawTableId = input.sourceRawTableId
      ? (await this.rawTables.requireInputRawTable(input.sourceRawTableId)).id
      : null;
    const resultTable = input.resultTableId
      ? (await this.rawTables.requireResultTable(input.resultTableId)).tableName
      : null;
    const now = this.ctx.now();
    const id = uuidv4();
    const status: DataPipelineStatus = sourcePath || sourceRawTableId ? 'pending' : 'draft';
    await this.pipelines.insertPipeline({
      id,
      name,
      status,
      sourcePath,
      sourceRawTableId,
      resultTable,
      createdAt: now,
      updatedAt: now,
    });
    return this.pipelines.requirePipeline(id);
  }
  async updatePipeline(input: DataUpdatePipelineInput): Promise<DataPipeline> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.requirePipeline(input.id);
    const name = input.name?.trim();
    if (name !== undefined && !name) {
      throw new Error('Pipeline name is required');
    }
    const updatedAt = this.ctx.now();
    await this.pipelines.renamePipeline(pipeline.id, name ?? pipeline.name, updatedAt);
    return this.pipelines.requirePipeline(pipeline.id);
  }
  async runPipeline(id: string, input: DataRunPipelineInput = {}): Promise<DataPipeline> {
    const result = await this.runPipelineWithDiagnostics(id, input);
    if (result.failure) throw new Error(result.failure.message);
    return result.pipeline;
  }
  async runPipelineWithDiagnostics(
    id: string,
    input: DataRunPipelineInput = {}
  ): Promise<{
    pipeline: DataPipeline;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    failure?: { message: string };
  }> {
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureMetadataReady();
      const runtimeWorkflow = input.workflow
        ? normalizeRuntimeWorkflowInput(id, input.workflow, this.ctx.now())
        : await this.workflows.getRuntimeWorkflow(id);
      const workflow = input.workflow ?? runtimeWorkflowToSaveInput(runtimeWorkflow);
      const signature = workflowExecutionSignature(workflow);
      const trigger: DataPipelineRunTrigger = input.outputMode === 'temporary' ? 'trial' : 'run';
      const runId = uuidv4();
      const startedAt = this.ctx.now();
      await this.recordRunStart(id, runId, trigger, signature, startedAt);

      if (input.outputMode === 'temporary') {
        try {
          const result = await this.executor.runPipelineToTemporaryOutputUnsafe(id, {
            ...input,
            workflow,
          });
          if (result.nodeStats && result.nodeStats.length > 0) {
            await this.runStats
              .persistPipelineNodeStats(id, runId, result.nodeStats)
              .catch(() => undefined);
          }
          await this.finishRunSafely(runId, 'completed', result.nodeStats, null);
          await this.prunePipelineRuns(id);
          return {
            ...result,
            nodeStats: result.nodeStats?.map((stat) => ({ ...stat, runId })),
          };
        } catch (error) {
          // Trial runs still record their row + partially collected stats so
          // the logs tab can show where the run broke instead of a bare
          // "no logs" empty state.
          const message = error instanceof Error ? error.message : String(error);
          const failedStats = (error as { nodeStats?: WorkflowNodeRunStat[] }).nodeStats;
          if (failedStats && failedStats.length > 0) {
            await this.runStats
              .persistPipelineNodeStats(id, runId, failedStats)
              .catch(() => undefined);
          }
          await this.finishRunSafely(runId, 'failed', failedStats, message, failedNodeIdOf(error));
          await this.prunePipelineRuns(id);
          const pipeline = await this.pipelines.requirePipeline(id);
          return {
            pipeline,
            diagnostics: [],
            nodeStats: failedStats?.map((stat) => ({ ...stat, runId })),
            failure: { message },
          };
        }
      }

      await this.ctx.ensureReady();
      const pipeline = await this.pipelines.requirePipeline(id);
      const sourcePath = input.sourcePath
        ? normalizeSourcePath(input.sourcePath)
        : pipeline.sourcePath;
      await this.pipelines.markPipelineRunning(id, sourcePath, startedAt);

      try {
        const validated = await this.executor.runPipelineToTemporaryOutputUnsafe(id, {
          ...input,
          workflow,
          outputMode: 'temporary',
        });
        const committedPipeline = await this.commitCoordinator.commitValidatedPipelineOutput(
          id,
          validated.pipeline,
          workflow,
          validated.watermarkUpdates,
          validated.nodeStats,
          validated.stagedSinks,
          runId
        );
        await this.finishRunSafely(runId, 'completed', validated.nodeStats, null);
        await this.prunePipelineRuns(id);
        return {
          pipeline: committedPipeline,
          diagnostics: validated.diagnostics,
          nodeStats: validated.nodeStats?.map((stat) => ({ ...stat, runId })),
        };
      } catch (error) {
        const failedAt = this.ctx.now();
        const message = error instanceof Error ? error.message : String(error);
        const failedStats = (error as { nodeStats?: WorkflowNodeRunStat[] }).nodeStats;
        if (failedStats && failedStats.length > 0) {
          await this.runStats
            .persistPipelineNodeStats(id, runId, failedStats)
            .catch(() => undefined);
        }
        await this.finishRunSafely(runId, 'failed', failedStats, message, failedNodeIdOf(error));
        await this.prunePipelineRuns(id);
        await this.pipelines.markPipelineFailed(id, message, failedAt);
        await this.cleanupTemporaryPipelineResources(id).catch(() => undefined);
        throw error;
      }
    }, `runPipeline:${id}`);
  }

  /**
   * Run recording is observability, never a gate — every write is
   * best-effort so a read-only/legacy metadata store cannot break a run.
   */
  private async recordRunStart(
    pipelineId: string,
    runId: string,
    trigger: DataPipelineRunTrigger,
    workflowSignature: string,
    startedAt: number
  ): Promise<void> {
    try {
      const seq = await this.pipelineRuns.nextSeq(pipelineId);
      await this.pipelineRuns.insertRun({
        id: runId,
        pipelineId,
        seq,
        trigger,
        workflowSignature,
        startedAt,
      });
    } catch {
      /* metadata read-only or table missing — run still proceeds */
    }
  }

  private async finishRunSafely(
    runId: string,
    status: 'completed' | 'failed',
    stats: WorkflowNodeRunStat[] | undefined,
    error: string | null,
    failedNodeId: string | null = null
  ): Promise<void> {
    const inputs = (stats ?? []).filter((stat) => stat.nodeType === 'input');
    const outputs = (stats ?? []).filter((stat) => stat.nodeType === 'output');
    await this.pipelineRuns
      .finishRun(runId, {
        status,
        inputRows: inputs.length ? inputs.reduce((sum, stat) => sum + stat.outputRows, 0) : null,
        outputRows: outputs.length ? outputs.reduce((sum, stat) => sum + stat.outputRows, 0) : null,
        error,
        failedNodeId,
        finishedAt: this.ctx.now(),
      })
      .catch(() => undefined);
  }

  /** Keeps the newest 20 runs per pipeline and sweeps their stats + orphans. */
  private async prunePipelineRuns(pipelineId: string): Promise<void> {
    try {
      const removed = await this.pipelineRuns.prunePipelineRuns(pipelineId, 20);
      if (removed.length > 0) {
        await this.runStats.deleteStatsForRuns(pipelineId, removed);
      }
      await this.runStats.deleteOrphanStats(pipelineId);
    } catch {
      /* retention is best-effort */
    }
  }

  /**
   * Stats for the canvas: the latest committed (non-trial) run. Falls back
   * to the newest persisted batch for pipelines whose stats predate run records.
   */
  async getPipelineNodeStats(pipelineId: string): Promise<WorkflowNodeRunStat[]> {
    const run = await this.pipelineRuns.getLatestPipelineRun(pipelineId, 'run').catch(() => null);
    if (run) {
      return this.runStats.getPipelineRunStats(pipelineId, run.id);
    }
    return this.runStats.getLatestPipelineNodeStats(pipelineId);
  }

  async listPipelineRuns(pipelineId: string, limit?: number): Promise<DataPipelineRun[]> {
    return this.pipelineRuns.listPipelineRuns(pipelineId, limit);
  }

  async getPipelineRunNodeStats(pipelineId: string, runId: string): Promise<WorkflowNodeRunStat[]> {
    return this.runStats.getPipelineRunStats(pipelineId, runId);
  }
  async validatePipelineWorkflow(
    id: string,
    input: DataRunPipelineInput
  ): Promise<{
    pipeline: DataPipeline;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    return this.ctx.runExclusive(
      () => this.executor.runPipelineToTemporaryOutputUnsafe(id, input),
      `validatePipelineWorkflow:${id}`
    );
  }
  async discardTemporaryPipelineOutput(pipeline: DataPipeline): Promise<void> {
    const tableName = pipeline.resultTable;
    if (!tableName || !tableName.startsWith('temp_pipeline_')) return;
    await this.ctx.runExclusive(
      () => this.ctx.dropTableIfExists(tableName),
      `discardTemporary:${pipeline.id}`
    );
  }
  async cleanupTemporaryPipelineResources(pipelineId: string): Promise<void> {
    await this.ctx.runExclusive(async () => {
      await this.ctx.ensureReady();
      const tableNames = await this.caches.listTemporaryCacheTableNames(pipelineId);
      for (const tableName of tableNames) {
        await this.ctx.dropTableIfExists(tableName).catch(() => undefined);
      }
      await this.caches.deleteTemporaryCacheRows(pipelineId);
    }, `cleanupTemporaryPipelineResources:${pipelineId}`);
  }
  async deletePipeline(id: string): Promise<boolean> {
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureMetadataReady();
      const pipeline = await this.pipelines.getPipeline(id);
      if (!pipeline) {
        return false;
      }
      if (pipeline.resultTable) {
        // Ownership boundary: a rawTable row carrying the explicit
        // result-table marker is a user-managed resource the pipeline only
        // references (bound via resultTableId or an output node's
        // outputResultTableId). Only pipeline-owned output tables — no explicit row —
        // have their physical table and metadata rows removed.
        if (!(await this.rawTables.hasExplicitResultTableForTableName(pipeline.resultTable))) {
          await this.ctx.ensureReady();
          await this.ctx.dropTableIfExists(pipeline.resultTable);
          await this.rawTables.deleteRawTableRowsByTableName(pipeline.resultTable);
        }
      }
      await this.caches.deleteWorkflowNodeCachesForPipeline(id);
      await this.workflows.deletePipelineGraph(id);
      await this.pipelines.deletePipelineRow(id);
      return true;
    }, `deletePipeline:${id}`);
  }
  async deletePipelineMetadataOnly(id: string): Promise<boolean> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.getPipeline(id);
    if (!pipeline) return false;
    await this.caches.deleteWorkflowNodeCachesForPipeline(
      id,
      pipeline.resultTable ? new Set([pipeline.resultTable]) : undefined
    );
    await this.workflows.deletePipelineGraph(id);
    await this.pipelines.deletePipelineRow(id);
    return true;
  }
  async getPipelineWorkflow(id: string): Promise<DataPipelineWorkflow> {
    await this.ctx.ensureMetadataReady();
    const pipeline = await this.pipelines.requirePipeline(id);
    const nodes = await this.workflows.getWorkflowNodes(id);
    const edges = await this.workflows.getWorkflowEdges(id);
    return { pipeline, nodes, edges };
  }
  async savePipelineWorkflow(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<DataPipelineWorkflow> {
    return this.ctx.runExclusive(
      () => this.savePipelineWorkflowUnsafe(id, input),
      `savePipelineWorkflow:${id}`
    );
  }
  async savePipelineWorkflowUnsafe(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<DataPipelineWorkflow> {
    await this.ctx.ensureReady();
    const pipeline = await this.pipelines.requirePipeline(id);
    const previousWorkflow = await this.workflows.getRuntimeWorkflow(id);
    const updatedAt = this.ctx.now();
    const scopedWorkflow = normalizeScopedWorkflowInputs(id, input);
    let nodes = scopedWorkflow.nodes;
    const edges = scopedWorkflow.edges;

    const planDiagnostics =
      nodes.length > 0
        ? await this.validator.validateWorkflowPlanForPipeline(id, { nodes, edges })
        : [];
    const planErrors = planDiagnostics.filter((item) => item.severity === 'error');
    if (planErrors.length > 0) {
      throw new Error(
        `Workflow plan validation failed: ${planErrors.map((item) => item.message).join('; ')}`
      );
    }

    await this.ctx.metaRunSql('BEGIN TRANSACTION');
    try {
      nodes = await this.binding.prepareWorkflowOutputNodesForSave(nodes, updatedAt);
      await this.workflows.deletePipelineGraph(id);
      for (const [index, node] of nodes.entries()) {
        await this.workflows.insertWorkflowNode(id, node, index + 1, updatedAt);
      }
      for (const edge of edges) {
        await this.workflows.insertWorkflowEdge(id, edge, updatedAt);
      }
      await this.pipelines.setPipelineNodeCount(id, nodes.length, updatedAt);
      await this.ctx.metaRunSql('COMMIT');
    } catch (error) {
      await this.ctx.metaRunSql('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const executionChanged =
      workflowExecutionSignature(runtimeWorkflowToSaveInput(previousWorkflow)) !==
      workflowExecutionSignature({ nodes, edges });
    if (executionChanged) {
      await this.caches.deleteWorkflowNodeCachesForPipeline(
        id,
        pipeline.resultTable ? new Set([pipeline.resultTable]) : undefined
      );
    }

    return this.getPipelineWorkflow(id);
  }
  async getPipelineRecord(id: string): Promise<DataPipeline | null> {
    await this.ctx.ensureMetadataReady();
    return this.pipelines.getPipeline(id);
  }
}
