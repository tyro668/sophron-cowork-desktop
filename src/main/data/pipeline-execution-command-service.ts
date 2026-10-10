import type { DataPipeline, DataRunPipelineInput } from '../../shared/contracts';
import type { DataPipelineStore } from './data-pipeline-store';
import {
  DataCommandError,
  type GetRunResultCommand,
  type RunGeneratedPipelineCommand,
  type RunGeneratedPipelineResult,
  type RunResult,
  type RunPipelineCommand,
  type RunPipelineResult,
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
import { validateGeneratedOutputPreviewSchema, validateGeneratedPipelineSchema } from './workflow';

export interface PipelineExecutionCommandServiceOptions {
  onPipelineCompleted?: (pipeline: DataPipeline) => void;
  uploadDataTableToCloud?: (
    input: UploadDataTableToCloudCommand
  ) => Promise<UploadDataTableToCloudResult>;
}

export class PipelineExecutionCommandService {
  constructor(
    private readonly store: DataPipelineStore,
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly compiler: WorkflowDslCompiler,
    private readonly preview: WorkflowPreviewService,
    private readonly inputResolver: AutomationInputResolver,
    private readonly outputResolver: GeneratedOutputResolver,
    private readonly cloudAnalysis: CloudAnalysisCommandService,
    private readonly options: PipelineExecutionCommandServiceOptions = {}
  ) {}

  async runPipeline(input: RunPipelineCommand): Promise<RunPipelineResult> {
    return this.locks.withKeyedLock(`pipeline:${input.pipelineId}`, () =>
      this.runPipelineUnlocked(input)
    );
  }

  async runGeneratedPipeline(
    input: RunGeneratedPipelineCommand
  ): Promise<RunGeneratedPipelineResult> {
    return this.locks.withKeyedLock(`pipeline:${input.pipelineId}`, () =>
      this.runGeneratedPipelineUnlocked(input)
    );
  }

  async getRunResult(input: GetRunResultCommand): Promise<RunResult> {
    const pipeline = await this.resources.requirePipeline(input.pipelineId);
    const preview = await this.preview.previewPipelineOutput(
      input.pipelineId,
      pipeline,
      input.previewRows,
      undefined,
      input.offset
    );
    return { pipeline, preview, resultTableId: await this.resolveResultTableId(pipeline) };
  }

  private async resolveResultTableId(pipeline: DataPipeline): Promise<string | undefined> {
    if (!pipeline.resultTable) return undefined;
    return (await this.store.findResultTableByPhysicalName(pipeline.resultTable))?.id;
  }

  private async runPipelineUnlocked(input: RunPipelineCommand): Promise<RunPipelineResult> {
    await this.resources.requirePipeline(input.pipelineId);
    const outputMode = input.mode === 'persisted' ? 'persisted' : 'temporary';
    let compiled: Awaited<ReturnType<WorkflowDslCompiler['compileWorkflowDsl']>> | null = null;
    if (input.workflowDsl) {
      compiled = await this.compiler.compileWorkflowDsl(input.workflowDsl, {
        rawTableId: input.rawTableId,
        inputAlias: input.inputAlias,
        inputs: input.inputResources,
        resultTableId: input.resultTableId,
      });
      const errors = diagnosticsWithSeverity(compiled.diagnostics, 'error');
      if (errors.length > 0) {
        throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
          diagnostics: compiled.diagnostics,
        });
      }
    }

    const runInput: DataRunPipelineInput = { outputMode };
    if (compiled) runInput.workflow = compiled.workflow;
    let temporaryPipeline: DataPipeline | undefined;
    try {
      const execution =
        outputMode === 'temporary'
          ? await this.store.validatePipelineWorkflow(input.pipelineId, runInput)
          : await this.store.runPipelineWithDiagnostics(input.pipelineId, runInput);
      const pipeline = execution.pipeline;
      if (outputMode === 'temporary') temporaryPipeline = pipeline;
      if (compiled && input.saveWorkflow) {
        await this.store.savePipelineWorkflow(input.pipelineId, compiled.workflow);
      }
      if (outputMode === 'persisted') this.options.onPipelineCompleted?.(pipeline);
      return {
        pipeline,
        resultTableId:
          outputMode === 'persisted' ? await this.resolveResultTableId(pipeline) : undefined,
        preview: await this.preview.previewPipelineOutput(
          input.pipelineId,
          pipeline,
          input.previewRows,
          compiled?.workflow
        ),
        diagnostics: [...(compiled?.diagnostics ?? []), ...execution.diagnostics],
        nodeStats: execution.nodeStats,
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    } finally {
      if (temporaryPipeline || outputMode === 'temporary') {
        await this.store
          .cleanupTemporaryPipelineResources(input.pipelineId)
          .catch((cleanupError) => {
            logDataCommandFallback('Failed to clean temporary pipeline resources', cleanupError, {
              pipelineId: input.pipelineId,
            });
          });
      }
    }
  }

  private async runGeneratedPipelineUnlocked(
    input: RunGeneratedPipelineCommand
  ): Promise<RunGeneratedPipelineResult> {
    const startedAt = Date.now();
    const prepareStartedAt = Date.now();
    const preparedInput = await this.inputResolver.prepareGeneratedPipelineInput({
      source: input.source,
    });
    const prepareDurationMs = Date.now() - prepareStartedAt;
    validateGeneratedPipelineSchema(
      preparedInput.columnsSnapshot,
      input.requiredColumns ?? [],
      input.schemaPolicy ?? 'required_subset'
    );
    const { resultTable } = await this.outputResolver.resolveGeneratedResultTable(
      input.output,
      preparedInput.rawTable.name
    );
    const compileStartedAt = Date.now();
    const workflowDslOverride = normalizeOptionalName(input.workflowDsl);
    const candidate = workflowDslOverride
      ? await this.compiler.compileWorkflowDsl(workflowDslOverride, {
          rawTableId: preparedInput.rawTable.id,
          resultTableId: resultTable.id,
        })
      : {
          workflow: await this.compiler.applyWorkflowResourceBindings(
            toWorkflowSaveShape(await this.store.getPipelineWorkflow(input.pipelineId)),
            {
              rawTableId: preparedInput.rawTable.id,
              resultTableId: resultTable.id,
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
    const temporaryExecution = await this.store.validatePipelineWorkflow(input.pipelineId, {
      workflow: candidate.workflow,
    });
    try {
      const preview = await this.preview.previewPipelineOutput(
        input.pipelineId,
        temporaryExecution.pipeline,
        input.previewRows,
        candidate.workflow
      );
      let result: RunPipelineResult = {
        pipeline: temporaryExecution.pipeline,
        preview,
        diagnostics: [...candidate.diagnostics, ...temporaryExecution.diagnostics],
        nodeStats: temporaryExecution.nodeStats,
      };
      let committedPipeline: DataPipeline | undefined;
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
        committedPipeline = await this.store.commitValidatedPipelineOutput(
          input.pipelineId,
          temporaryExecution.pipeline,
          candidate.workflow,
          temporaryExecution.watermarkUpdates,
          temporaryExecution.nodeStats,
          temporaryExecution.stagedSinks
        );
        result = { ...result, pipeline: committedPipeline };
      }
      const runDurationMs = Date.now() - runStartedAt;
      let uploaded: RunGeneratedPipelineResult['uploaded'];
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
          tableKind: 'result',
          id: resultTable.id,
          writeMode: input.output.writeMode === 'replace' ? 'REPLACE' : 'CREATE',
          tableId: input.output.writeMode === 'replace' ? input.output.targetTableId : undefined,
          tableName: input.output.tableName || resultTable.name,
          spaceId: input.output.spaceId,
          projectId: input.output.projectId,
          datasourceId: input.output.datasourceId,
          folderId,
          waitForDone: true,
        });
        uploadDurationMs = Date.now() - uploadStartedAt;
      }
      if (committedPipeline) this.options.onPipelineCompleted?.(committedPipeline);
      log('[DataCommandService] Generated data pipeline finished', {
        pipelineId: input.pipelineId,
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
        rawTableId: preparedInput.rawTable.id,
        resultTableId: resultTable.id,
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
      await this.store.cleanupTemporaryPipelineResources(input.pipelineId).catch((cleanupError) => {
        logDataCommandFallback(
          'Failed to clean generated-pipeline temporary resources',
          cleanupError,
          {
            pipelineId: input.pipelineId,
          }
        );
      });
    }
  }

  private async resolveCloudOutputFolderId(
    input: RunGeneratedPipelineCommand
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
