/** Task lifecycle orchestration: CRUD, run, save workflow, cleanup. */
import type {
  DataCleaningTask,
  DataCreateTaskInput,
  DataRunTaskInput,
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

export class TaskService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly tasks: TaskRepository,
    private readonly datasets: DatasetRepository,
    private readonly workflows: WorkflowRepository,
    private readonly caches: CacheRepository,
    private readonly runStats: RunStatsRepository,
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
    return (await this.runTaskWithDiagnostics(id, input)).task;
  }
  async runTaskWithDiagnostics(
    id: string,
    input: DataRunTaskInput = {}
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
  }> {
    return this.ctx.runExclusive(async () => {
      if (input.outputMode === 'temporary') {
        return this.executor.runTaskToTemporaryOutputUnsafe(id, input);
      }

      await this.ctx.ensureReady();
      const task = await this.tasks.requireTask(id);
      const sourcePath = input.sourcePath ? normalizeSourcePath(input.sourcePath) : task.sourcePath;
      const runtimeWorkflow = input.workflow
        ? normalizeRuntimeWorkflowInput(id, input.workflow, this.ctx.now())
        : await this.workflows.getRuntimeWorkflow(id);
      const workflow = input.workflow ?? runtimeWorkflowToSaveInput(runtimeWorkflow);
      const startedAt = this.ctx.now();
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
          validated.stagedSinks
        );
        return {
          task: committedTask,
          diagnostics: validated.diagnostics,
          nodeStats: validated.nodeStats,
        };
      } catch (error) {
        const failedAt = this.ctx.now();
        const message = error instanceof Error ? error.message : String(error);
        // Per-node stats collected before the failure are persisted under a
        // failed-run id so exception samples stay inspectable.
        const failedStats = (error as { nodeStats?: WorkflowNodeRunStat[] }).nodeStats;
        if (failedStats && failedStats.length > 0) {
          await this.runStats
            .persistTaskNodeStats(id, `failed_${failedAt}`, failedStats)
            .catch(() => undefined);
        }
        await this.tasks.markTaskFailed(id, message, failedAt);
        await this.cleanupTemporaryTaskResources(id).catch(() => undefined);
        throw error;
      }
    }, `runTask:${id}`);
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
