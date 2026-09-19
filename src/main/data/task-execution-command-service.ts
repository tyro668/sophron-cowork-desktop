import type { DataCleaningTask, DataRunTaskInput } from '../../shared/contracts';
import type { DataTaskStore } from './data-task-store';
import {
  DataCommandError,
  type GetRunResultCommand,
  type RunGeneratedTaskCommand,
  type RunGeneratedTaskResult,
  type RunResult,
  type RunTaskCommand,
  type RunTaskResult,
  type UploadDataTableToCloudCommand,
  type UploadDataTableToCloudResult,
} from './data-command-types';
import { CloudAnalysisCommandService } from './cloud-analysis-command-service';
import { AutomationInputResolver } from './automation-input-resolver';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import { GeneratedOutputResolver } from './generated-output-resolver';
import { WorkflowDslCompiler } from './workflow-dsl-compiler';
import { WorkflowPreviewService } from './workflow-preview-service';
import {
  diagnosticsWithSeverity,
  hashWorkflowGraph,
  logDataCommandFallback,
  normalizeOptionalName,
  summarizeDiagnostics,
  toCommandError,
  toWorkflowSaveShape,
} from './data-command-utils';
import { log } from '../utils/logger';
import { validateGeneratedOutputPreviewSchema, validateGeneratedTaskSchema } from './workflow';

export interface TaskExecutionCommandServiceOptions {
  onTaskCompleted?: (task: DataCleaningTask) => void;
  uploadDataTableToCloud?: (
    input: UploadDataTableToCloudCommand
  ) => Promise<UploadDataTableToCloudResult>;
}

export class TaskExecutionCommandService {
  constructor(
    private readonly store: DataTaskStore,
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly compiler: WorkflowDslCompiler,
    private readonly preview: WorkflowPreviewService,
    private readonly inputResolver: AutomationInputResolver,
    private readonly outputResolver: GeneratedOutputResolver,
    private readonly cloudAnalysis: CloudAnalysisCommandService,
    private readonly options: TaskExecutionCommandServiceOptions = {}
  ) {}

  async runTask(input: RunTaskCommand): Promise<RunTaskResult> {
    return this.locks.withKeyedLock(`task:${input.taskId}`, () => this.runTaskUnlocked(input));
  }

  async runGeneratedTask(input: RunGeneratedTaskCommand): Promise<RunGeneratedTaskResult> {
    return this.locks.withKeyedLock(`task:${input.taskId}`, () =>
      this.runGeneratedTaskUnlocked(input)
    );
  }

  async getRunResult(input: GetRunResultCommand): Promise<RunResult> {
    const task = await this.resources.requireTask(input.taskId);
    const preview = await this.preview.previewTaskOutput(
      input.taskId,
      task,
      input.previewRows,
      undefined,
      input.offset
    );
    return { task, preview, outputTableId: await this.resolveOutputTableId(task) };
  }

  private async resolveOutputTableId(task: DataCleaningTask): Promise<string | undefined> {
    if (!task.outputTable) return undefined;
    return (await this.store.findOutputTableByPhysicalName(task.outputTable))?.id;
  }

  private async runTaskUnlocked(input: RunTaskCommand): Promise<RunTaskResult> {
    await this.resources.requireTask(input.taskId);
    const outputMode = input.mode === 'persisted' ? 'persisted' : 'temporary';
    let compiled: Awaited<ReturnType<WorkflowDslCompiler['compileWorkflowDsl']>> | null = null;
    if (input.workflowDsl) {
      compiled = await this.compiler.compileWorkflowDsl(input.workflowDsl, {
        inputTableId: input.inputTableId,
        inputAlias: input.inputAlias,
        inputs: input.inputResources,
        outputTableId: input.outputTableId,
      });
      const errors = diagnosticsWithSeverity(compiled.diagnostics, 'error');
      if (errors.length > 0) {
        throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
          diagnostics: compiled.diagnostics,
        });
      }
    }

    const runInput: DataRunTaskInput = { outputMode };
    if (compiled) runInput.workflow = compiled.workflow;
    let temporaryTask: DataCleaningTask | undefined;
    try {
      const execution =
        outputMode === 'temporary'
          ? await this.store.validateTaskWorkflow(input.taskId, runInput)
          : await this.store.runTaskWithDiagnostics(input.taskId, runInput);
      const task = execution.task;
      if (outputMode === 'temporary') temporaryTask = task;
      if (compiled && input.saveWorkflow) {
        await this.store.saveTaskWorkflow(input.taskId, compiled.workflow);
      }
      if (outputMode === 'persisted') this.options.onTaskCompleted?.(task);
      return {
        task,
        outputTableId:
          outputMode === 'persisted' ? await this.resolveOutputTableId(task) : undefined,
        preview: await this.preview.previewTaskOutput(
          input.taskId,
          task,
          input.previewRows,
          compiled?.workflow
        ),
        diagnostics: [...(compiled?.diagnostics ?? []), ...execution.diagnostics],
        nodeStats: execution.nodeStats,
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    } finally {
      if (temporaryTask || outputMode === 'temporary') {
        await this.store.cleanupTemporaryTaskResources(input.taskId).catch((cleanupError) => {
          logDataCommandFallback('Failed to clean temporary task resources', cleanupError, {
            taskId: input.taskId,
          });
        });
      }
    }
  }

  private async runGeneratedTaskUnlocked(
    input: RunGeneratedTaskCommand
  ): Promise<RunGeneratedTaskResult> {
    const startedAt = Date.now();
    const prepareStartedAt = Date.now();
    const preparedInput = await this.inputResolver.prepareGeneratedTaskInput({
      source: input.source,
    });
    const prepareDurationMs = Date.now() - prepareStartedAt;
    validateGeneratedTaskSchema(
      preparedInput.columnsSnapshot,
      input.requiredColumns ?? [],
      input.schemaPolicy ?? 'required_subset'
    );
    const { outputTable } = await this.outputResolver.resolveGeneratedOutputTable(
      input.output,
      preparedInput.inputTable.name
    );
    const compileStartedAt = Date.now();
    const workflowDslOverride = normalizeOptionalName(input.workflowDsl);
    const candidate = workflowDslOverride
      ? await this.compiler.compileWorkflowDsl(workflowDslOverride, {
          inputTableId: preparedInput.inputTable.id,
          outputTableId: outputTable.id,
        })
      : {
          workflow: await this.compiler.applyWorkflowResourceBindings(
            toWorkflowSaveShape(await this.store.getTaskWorkflow(input.taskId)),
            {
              inputTableId: preparedInput.inputTable.id,
              outputTableId: outputTable.id,
            }
          ),
          diagnostics: [],
        };
    const candidateErrors = diagnosticsWithSeverity(candidate.diagnostics, 'error');
    if (candidateErrors.length > 0) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(candidateErrors), {
        diagnostics: candidate.diagnostics,
      });
    }
    const compileDurationMs = Date.now() - compileStartedAt;
    const workflowHash = hashWorkflowGraph(candidate.workflow);
    const runStartedAt = Date.now();
    const temporaryExecution = await this.store.validateTaskWorkflow(input.taskId, {
      workflow: candidate.workflow,
    });
    try {
      const preview = await this.preview.previewTaskOutput(
        input.taskId,
        temporaryExecution.task,
        input.previewRows,
        candidate.workflow
      );
      let result: RunTaskResult = {
        task: temporaryExecution.task,
        preview,
        diagnostics: [...candidate.diagnostics, ...temporaryExecution.diagnostics],
        nodeStats: temporaryExecution.nodeStats,
      };
      let committedTask: DataCleaningTask | undefined;
      const outputSchemaErrors = validateGeneratedOutputPreviewSchema(
        result.preview,
        input.expectedOutputSchema ?? []
      );
      if (outputSchemaErrors.length > 0) {
        throw new DataCommandError('VALIDATION_FAILED', summarizeDiagnostics(outputSchemaErrors), {
          diagnostics: outputSchemaErrors,
        });
      }
      if ((input.mode ?? 'persisted') === 'persisted') {
        committedTask = await this.store.commitValidatedTaskOutput(
          input.taskId,
          temporaryExecution.task,
          candidate.workflow,
          temporaryExecution.watermarkUpdates,
          temporaryExecution.nodeStats,
          temporaryExecution.stagedSinks
        );
        result = { ...result, task: committedTask };
      }
      const runDurationMs = Date.now() - runStartedAt;
      let uploaded: RunGeneratedTaskResult['uploaded'];
      let uploadDurationMs = 0;
      if (input.output.location === 'cloud') {
        const folderId = await this.resolveCloudOutputFolderId(input);
        if (input.output.writeMode === 'create' && !folderId) {
          throw new DataCommandError(
            'INVALID_ARGUMENT',
            'Cloud output folderId is required. Please reselect the input cloud table or target project before running the automation.'
          );
        }
        const uploadStartedAt = Date.now();
        uploaded = await (
          this.options.uploadDataTableToCloud ??
          ((command) => this.cloudAnalysis.uploadDataTableToCloud(command))
        )({
          tableKind: 'output',
          id: outputTable.id,
          writeMode: input.output.writeMode === 'replace' ? 'REPLACE' : 'CREATE',
          tableId: input.output.writeMode === 'replace' ? input.output.targetTableId : undefined,
          tableName: input.output.tableName || outputTable.name,
          spaceId: input.output.spaceId,
          projectId: input.output.projectId,
          datasourceId: input.output.datasourceId,
          folderId,
          waitForDone: true,
        });
        uploadDurationMs = Date.now() - uploadStartedAt;
      }
      if (committedTask) this.options.onTaskCompleted?.(committedTask);
      log('[DataCommandService] Generated data task finished', {
        taskId: input.taskId,
        workflowHash,
        sourceLocation: input.source.location,
        outputLocation: input.output.location,
        prepareDurationMs,
        compileDurationMs,
        runDurationMs,
        uploadDurationMs,
        totalDurationMs: Date.now() - startedAt,
      });
      return {
        ...result,
        inputTableId: preparedInput.inputTable.id,
        outputTableId: outputTable.id,
        uploaded,
        tokenUsage: 0,
        workflowHash,
        stageDurationsMs: {
          prepare: prepareDurationMs,
          compile: compileDurationMs,
          executeAndValidate: runDurationMs,
          upload: uploadDurationMs,
          total: Date.now() - startedAt,
        },
      };
    } finally {
      await this.store.cleanupTemporaryTaskResources(input.taskId).catch((cleanupError) => {
        logDataCommandFallback('Failed to clean generated-task temporary resources', cleanupError, {
          taskId: input.taskId,
        });
      });
    }
  }

  private async resolveCloudOutputFolderId(
    input: RunGeneratedTaskCommand
  ): Promise<string | undefined> {
    const configuredFolderId =
      normalizeOptionalName(input.output.folderId) ?? normalizeOptionalName(input.source.folderId);
    if (configuredFolderId) return configuredFolderId;
    const spaceId =
      normalizeOptionalName(input.output.spaceId) ?? normalizeOptionalName(input.source.spaceId);
    const projectId =
      normalizeOptionalName(input.output.projectId) ??
      normalizeOptionalName(input.source.projectId);
    if (!spaceId || !projectId) return undefined;
    const projects = await this.cloudAnalysis.listCloudProjects({ spaceId });
    return projects.projects.find((project) => project.projectId === projectId)?.folderId;
  }
}
