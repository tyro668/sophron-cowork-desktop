/** Task lifecycle orchestration: CRUD, run, save workflow, cleanup. */
import type {
  DataCleaningTask,
  DataCreateTaskInput,
  DataRunTaskInput,
  DataTaskRun,
  DataTaskRunTrigger,
  DataTaskStatus,
  DataTaskWorkflow,
  DataUpdateTaskInput,
  DataWorkflowSaveInput,
} from '../../../../shared/contracts';
import type { PrepDiagnostic } from '../../../../shared/prep-dsl/ast';
import type { WorkflowNodeRunStat } from '../../data-command-types';
import { DataStoreContext } from '../data-store-context';
import { normalizeSourcePath } from '../input-source';
import { CacheRepository } from '../repositories/cache-repository';
import { DatasetRepository } from '../repositories/dataset-repository';
import { RunStatsRepository } from '../repositories/run-stats-repository';
import { TaskRunsRepository } from '../repositories/task-runs-repository';
import { TaskRepository } from '../repositories/task-repository';
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

export class TaskService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly tasks: TaskRepository,
    private readonly datasets: DatasetRepository,
    private readonly workflows: WorkflowRepository,
    private readonly caches: CacheRepository,
    private readonly runStats: RunStatsRepository,
    private readonly taskRuns: TaskRunsRepository,
    private readonly executor: WorkflowExecutor,
    private readonly validator: WorkflowValidator,
    private readonly commitCoordinator: OutputCommitCoordinator,
    private readonly binding: WorkflowBindingResolver
  ) {}
  async createTask(input: DataCreateTaskInput): Promise<DataCleaningTask> {
    await this.ctx.ensureMetadataReady();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Task name is required');
    }
    const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : null;
    const sourceDatasetId = input.sourceDatasetId
      ? (await this.datasets.requireInputDataset(input.sourceDatasetId)).id
      : null;
    const outputTable = input.outputTableId
      ? (await this.datasets.requireOutputTable(input.outputTableId)).tableName
      : null;
    const now = this.ctx.now();
    const id = uuidv4();
    const status: DataTaskStatus = sourcePath || sourceDatasetId ? 'pending' : 'draft';
    await this.tasks.insertTask({
      id,
      name,
      status,
      sourcePath,
      sourceDatasetId,
      outputTable,
      createdAt: now,
      updatedAt: now,
    });
    return this.tasks.requireTask(id);
  }
  async updateTask(input: DataUpdateTaskInput): Promise<DataCleaningTask> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(input.id);
    const name = input.name?.trim();
    if (name !== undefined && !name) {
      throw new Error('Task name is required');
    }
    const updatedAt = this.ctx.now();
    await this.tasks.renameTask(task.id, name ?? task.name, updatedAt);
    return this.tasks.requireTask(task.id);
  }
  async runTask(id: string, input: DataRunTaskInput = {}): Promise<DataCleaningTask> {
    const result = await this.runTaskWithDiagnostics(id, input);
    if (result.failure) throw new Error(result.failure.message);
    return result.task;
  }
  async runTaskWithDiagnostics(
    id: string,
    input: DataRunTaskInput = {}
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    failure?: { message: string };
  }> {
    return this.ctx.runExclusive(async () => {
      const runtimeWorkflow = input.workflow
        ? normalizeRuntimeWorkflowInput(id, input.workflow, this.ctx.now())
        : await this.workflows.getRuntimeWorkflow(id);
      const workflow = input.workflow ?? runtimeWorkflowToSaveInput(runtimeWorkflow);
      const signature = workflowExecutionSignature(workflow);
      const trigger: DataTaskRunTrigger = input.outputMode === 'temporary' ? 'trial' : 'run';
      const runId = uuidv4();
      const startedAt = this.ctx.now();
      await this.recordRunStart(id, runId, trigger, signature, startedAt);

      if (input.outputMode === 'temporary') {
        try {
          const result = await this.executor.runTaskToTemporaryOutputUnsafe(id, {
            ...input,
            workflow,
          });
          if (result.nodeStats && result.nodeStats.length > 0) {
            await this.runStats
              .persistTaskNodeStats(id, runId, result.nodeStats)
              .catch(() => undefined);
          }
          await this.finishRunSafely(runId, 'completed', result.nodeStats, null);
          await this.pruneTaskRuns(id);
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
            await this.runStats.persistTaskNodeStats(id, runId, failedStats).catch(() => undefined);
          }
          await this.finishRunSafely(runId, 'failed', failedStats, message, failedNodeIdOf(error));
          await this.pruneTaskRuns(id);
          const task = await this.tasks.requireTask(id);
          return {
            task,
            diagnostics: [],
            nodeStats: failedStats?.map((stat) => ({ ...stat, runId })),
            failure: { message },
          };
        }
      }

      await this.ctx.ensureReady();
      const task = await this.tasks.requireTask(id);
      const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : task.sourcePath;
      await this.tasks.markTaskRunning(id, sourcePath, startedAt);

      try {
        const validated = await this.executor.runTaskToTemporaryOutputUnsafe(id, {
          ...input,
          workflow,
          outputMode: 'temporary',
        });
        const committedTask = await this.commitCoordinator.commitValidatedTaskOutput(
          id,
          validated.task,
          workflow,
          validated.watermarkUpdates,
          validated.nodeStats,
          validated.stagedSinks,
          runId
        );
        await this.finishRunSafely(runId, 'completed', validated.nodeStats, null);
        await this.pruneTaskRuns(id);
        return {
          task: committedTask,
          diagnostics: validated.diagnostics,
          nodeStats: validated.nodeStats?.map((stat) => ({ ...stat, runId })),
        };
      } catch (error) {
        const failedAt = this.ctx.now();
        const message = error instanceof Error ? error.message : String(error);
        const failedStats = (error as { nodeStats?: WorkflowNodeRunStat[] }).nodeStats;
        if (failedStats && failedStats.length > 0) {
          await this.runStats.persistTaskNodeStats(id, runId, failedStats).catch(() => undefined);
        }
        await this.finishRunSafely(runId, 'failed', failedStats, message, failedNodeIdOf(error));
        await this.pruneTaskRuns(id);
        await this.tasks.markTaskFailed(id, message, failedAt);
        await this.cleanupTemporaryTaskResources(id).catch(() => undefined);
        throw error;
      }
    }, `runTask:${id}`);
  }

  /**
   * Run recording is observability, never a gate — every write is
   * best-effort so a read-only/legacy metadata store cannot break a run.
   */
  private async recordRunStart(
    taskId: string,
    runId: string,
    trigger: DataTaskRunTrigger,
    workflowSignature: string,
    startedAt: number
  ): Promise<void> {
    try {
      const seq = await this.taskRuns.nextSeq(taskId);
      await this.taskRuns.insertRun({
        id: runId,
        taskId,
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
    const inputs = (stats ?? []).filter((stat) => stat.nodeType === 'input_source');
    const outputs = (stats ?? []).filter((stat) => stat.nodeType === 'output');
    await this.taskRuns
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

  /** Keeps the newest 20 runs per task and sweeps their stats + orphans. */
  private async pruneTaskRuns(taskId: string): Promise<void> {
    try {
      const removed = await this.taskRuns.pruneTaskRuns(taskId, 20);
      if (removed.length > 0) {
        await this.runStats.deleteStatsForRuns(taskId, removed);
      }
      await this.runStats.deleteOrphanStats(taskId);
    } catch {
      /* retention is best-effort */
    }
  }

  /**
   * Stats for the canvas: the latest committed (non-trial) run. Falls back
   * to the newest persisted batch for tasks whose stats predate run records.
   */
  async getTaskNodeStats(taskId: string): Promise<WorkflowNodeRunStat[]> {
    const run = await this.taskRuns.getLatestTaskRun(taskId, 'run').catch(() => null);
    if (run) {
      return this.runStats.getTaskRunStats(taskId, run.id);
    }
    return this.runStats.getLatestTaskNodeStats(taskId);
  }

  async listTaskRuns(taskId: string, limit?: number): Promise<DataTaskRun[]> {
    return this.taskRuns.listTaskRuns(taskId, limit);
  }

  async getTaskRunNodeStats(taskId: string, runId: string): Promise<WorkflowNodeRunStat[]> {
    return this.runStats.getTaskRunStats(taskId, runId);
  }
  async validateTaskWorkflow(
    id: string,
    input: DataRunTaskInput
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    return this.ctx.runExclusive(
      () => this.executor.runTaskToTemporaryOutputUnsafe(id, input),
      `validateTaskWorkflow:${id}`
    );
  }
  async discardTemporaryTaskOutput(task: DataCleaningTask): Promise<void> {
    const tableName = task.outputTable;
    if (!tableName || !tableName.startsWith('temp_task_')) return;
    await this.ctx.runExclusive(
      () => this.ctx.dropTableIfExists(tableName),
      `discardTemporary:${task.id}`
    );
  }
  async cleanupTemporaryTaskResources(taskId: string): Promise<void> {
    await this.ctx.runExclusive(async () => {
      await this.ctx.ensureReady();
      const tableNames = await this.caches.listTemporaryCacheTableNames(taskId);
      for (const tableName of tableNames) {
        await this.ctx.dropTableIfExists(tableName).catch(() => undefined);
      }
      await this.caches.deleteTemporaryCacheRows(taskId);
    }, `cleanupTemporaryTaskResources:${taskId}`);
  }
  async deleteTask(id: string): Promise<boolean> {
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureMetadataReady();
      const task = await this.tasks.getTask(id);
      if (!task) {
        return false;
      }
      if (task.outputTable) {
        // Ownership boundary: a dataset row carrying the explicit
        // output-table marker is a user-managed resource the task only
        // references (bound via outputTableId or an output node's
        // outputDatasetId). Only task-owned output tables — no explicit row —
        // have their physical table and metadata rows removed.
        if (!(await this.datasets.hasExplicitOutputTableForTableName(task.outputTable))) {
          await this.ctx.ensureReady();
          await this.ctx.dropTableIfExists(task.outputTable);
          await this.datasets.deleteDatasetRowsByTableName(task.outputTable);
        }
      }
      await this.caches.deleteWorkflowNodeCachesForTask(id);
      await this.workflows.deleteTaskGraph(id);
      await this.tasks.deleteTaskRow(id);
      return true;
    }, `deleteTask:${id}`);
  }
  async deleteTaskMetadataOnly(id: string): Promise<boolean> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.getTask(id);
    if (!task) return false;
    await this.caches.deleteWorkflowNodeCachesForTask(
      id,
      task.outputTable ? new Set([task.outputTable]) : undefined
    );
    await this.workflows.deleteTaskGraph(id);
    await this.tasks.deleteTaskRow(id);
    return true;
  }
  async getTaskWorkflow(id: string): Promise<DataTaskWorkflow> {
    await this.ctx.ensureMetadataReady();
    const task = await this.tasks.requireTask(id);
    const nodes = await this.workflows.getWorkflowNodes(id);
    const edges = await this.workflows.getWorkflowEdges(id);
    return { task, nodes, edges };
  }
  async saveTaskWorkflow(id: string, input: DataWorkflowSaveInput): Promise<DataTaskWorkflow> {
    return this.ctx.runExclusive(
      () => this.saveTaskWorkflowUnsafe(id, input),
      `saveTaskWorkflow:${id}`
    );
  }
  async saveTaskWorkflowUnsafe(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<DataTaskWorkflow> {
    await this.ctx.ensureReady();
    const task = await this.tasks.requireTask(id);
    const previousWorkflow = await this.workflows.getRuntimeWorkflow(id);
    const updatedAt = this.ctx.now();
    const scopedWorkflow = normalizeScopedWorkflowInputs(id, input);
    let nodes = scopedWorkflow.nodes;
    const edges = scopedWorkflow.edges;

    const planDiagnostics =
      nodes.length > 0
        ? await this.validator.validateWorkflowPlanForTask(id, { nodes, edges })
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
      await this.workflows.deleteTaskGraph(id);
      for (const [index, node] of nodes.entries()) {
        await this.workflows.insertWorkflowNode(id, node, index + 1, updatedAt);
      }
      for (const edge of edges) {
        await this.workflows.insertWorkflowEdge(id, edge, updatedAt);
      }
      await this.tasks.setTaskNodeCount(id, nodes.length, updatedAt);
      await this.ctx.metaRunSql('COMMIT');
    } catch (error) {
      await this.ctx.metaRunSql('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const executionChanged =
      workflowExecutionSignature(runtimeWorkflowToSaveInput(previousWorkflow)) !==
      workflowExecutionSignature({ nodes, edges });
    if (executionChanged) {
      await this.caches.deleteWorkflowNodeCachesForTask(
        id,
        task.outputTable ? new Set([task.outputTable]) : undefined
      );
    }

    return this.getTaskWorkflow(id);
  }
  async getTaskRecord(id: string): Promise<DataCleaningTask | null> {
    await this.ctx.ensureMetadataReady();
    return this.tasks.getTask(id);
  }
}
