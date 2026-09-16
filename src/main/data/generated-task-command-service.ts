import { randomUUID } from 'crypto';
import { exportPrepWorkflowDsl, type PrepDiagnostic } from '../../shared/prep-dsl';
import type { DataAutomationColumnSnapshot, DataCleaningTask } from '../../shared/contracts';
import type { DataTaskStore } from './data-task-store';
import type { DataTaskLlmUsageRecorder } from './data-task-llm-usage-recorder';
import {
  DataCommandError,
  type AnalyzedTaskRequirement,
  type AnalyzeTaskRequirementCommand,
  type AnalyzeTaskRequirementResult,
  type GenerateTaskFromRequirementCommand,
  type GenerateTaskFromRequirementResult,
  type RunTaskResult,
  type WorkflowSaveShape,
} from './data-command-types';
import { AutomationInputResolver } from './automation-input-resolver';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import { GeneratedOutputResolver } from './generated-output-resolver';
import { TaskCommandService } from './task-command-service';
import { WorkflowPreviewService } from './workflow-preview-service';
import {
  diagnosticsWithSeverity,
  hashWorkflowGraph,
  logDataCommandFallback,
  nextGeneratedTaskVersion,
  normalizeOptionalName,
  normalizeRequiredName,
  summarizeDiagnostics,
  toCommandError,
  type CompiledWorkflowCandidate,
} from './data-command-utils';
import {
  analyzeDataTaskRequirement,
  compileLoweredWorkflowToPlatformNodes,
  createGeneratedWorkflowRepairBudget,
  type GeneratedDataTaskWorkflow,
  generateDataTaskWorkflowFromRequirement,
  hashColumns,
  isWorkflowDiagnosticRepairable,
  normalizeWorkflowFailureDiagnostics,
  reconcileGeneratedWorkflowWithOutputPreview,
  repairGeneratedWorkflowFromDiagnostics,
  type WorkflowModelUsageEvent,
  validateGeneratedOutputPreviewSchema,
  validateGeneratedExecutableWorkflow,
  validateGeneratedWorkflowGenerationContract,
  workflowCommandCodeForDiagnostics,
  workflowDiagnosticsFromError,
} from './workflow';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from './workflow/prep-dsl-capability-profile';
import {
  createRequirementCapabilityContract,
  getRequirementCapabilityContractOperationTypes,
  type RequirementCapabilityContract,
} from './workflow/requirement-capability-registry';
import { RequirementAnalysisReceiptStore } from './requirement-analysis-receipt-store';

interface GeneratedWorkflowCandidateValidation {
  diagnostics: PrepDiagnostic[];
  generated?: GeneratedDataTaskWorkflow;
  candidate?: CompiledWorkflowCandidate;
  compatibilityDsl?: string;
}

export interface GeneratedTaskCommandServiceOptions {
  recordLlmUsage?: DataTaskLlmUsageRecorder;
  exportWorkflowDsl?: typeof exportPrepWorkflowDsl;
}

export class GeneratedTaskCommandService {
  constructor(
    private readonly store: DataTaskStore,
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly inputResolver: AutomationInputResolver,
    private readonly outputResolver: GeneratedOutputResolver,
    private readonly tasks: TaskCommandService,
    private readonly preview: WorkflowPreviewService,
    private readonly analysisReceipts: RequirementAnalysisReceiptStore,
    private readonly options: GeneratedTaskCommandServiceOptions = {}
  ) {}

  async generateTaskFromRequirement(
    input: GenerateTaskFromRequirementCommand
  ): Promise<GenerateTaskFromRequirementResult> {
    const generationId = normalizeOptionalName(input.usageTraceId) ?? randomUUID();
    const processRequirement = normalizeRequiredName(
      input.processRequirement,
      'Processing requirement is required'
    );
    const preparedInput = await this.inputResolver.prepareGeneratedTaskInput(input);
    const requirementContract = this.assertAnalysisReceipt(
      input,
      preparedInput.inputTable.id,
      preparedInput.columnsSnapshot
    );
    const displayInputTableName =
      normalizeOptionalName(input.source.tableName) || preparedInput.inputTable.name;
    const resolvedOutput = await this.outputResolver.resolveGeneratedOutputTable(
      input.output,
      displayInputTableName,
      input.outputConflictPolicy
    );
    const outputTable = resolvedOutput.outputTable;
    const reusableTask = await this.resolveReusableGeneratedTask(input.reuseTaskId);
    let createdTaskId: string | undefined;
    let task: DataCleaningTask;
    try {
      task =
        reusableTask ??
        (
          await this.tasks.createTask({
            name: await this.resources.createUniqueTaskName(
              normalizeOptionalName(input.taskName) ??
                `${displayInputTableName || '数据表'}_自动处理`
            ),
            sourceInputTableId: preparedInput.inputTable.id,
            outputTableId: outputTable.id,
          })
        ).task;
    } catch (error) {
      if (resolvedOutput.created) await this.rollbackOutputTable(outputTable.id);
      throw error;
    }
    if (!reusableTask) createdTaskId = task.id;
    const onModelUsage = (event: WorkflowModelUsageEvent): void => {
      this.recordWorkflowModelUsage(generationId, task.id, event);
    };
    try {
      return await this.locks.withKeyedLock(`task:${task.id}`, async () => {
        const repairBudget = createGeneratedWorkflowRepairBudget();
        let generated = await generateDataTaskWorkflowFromRequirement({
          inputTableId: preparedInput.inputTable.id,
          outputTableName: outputTable.name,
          requirement: processRequirement,
          columns: preparedInput.columnsSnapshot,
          requirementContract,
          runtimeConfig: input.runtimeConfig,
          repairBudget,
          onModelUsage,
          signal: input.signal,
        });
        let validation = await this.validateGeneratedWorkflowCandidate({
          taskId: task.id,
          inputTableId: preparedInput.inputTable.id,
          inputTableName: preparedInput.inputTable.name,
          outputTableId: outputTable.id,
          outputTableName: outputTable.name,
          outputPhysicalTableName: outputTable.tableName,
          columns: preparedInput.columnsSnapshot,
          generated,
        });
        generated = validation.generated ?? generated;
        let compatibilityDsl = validation.compatibilityDsl;
        let validationErrors = diagnosticsWithSeverity(validation.diagnostics, 'error');
        while (
          validationErrors.length > 0 &&
          validationErrors.every(isWorkflowDiagnosticRepairable)
        ) {
          if (!generated.javascriptSource) {
            throw new DataCommandError(
              'VALIDATION_FAILED',
              'Generated workflow repair requires the original JavaScript source',
              {
                diagnostics: normalizeWorkflowFailureDiagnostics(
                  [
                    {
                      severity: 'error',
                      code: 'MISSING_GENERATED_JAVASCRIPT_SOURCE',
                      message: 'Generated workflow repair requires the original JavaScript source',
                    },
                  ],
                  {
                    failureStage: 'internal',
                    commandErrorCode: 'VALIDATION_FAILED',
                    repairClass: 'none',
                  }
                ),
              }
            );
          }
          generated = await repairGeneratedWorkflowFromDiagnostics({
            inputTableId: preparedInput.inputTable.id,
            outputTableName: outputTable.name,
            requirement: processRequirement,
            columns: preparedInput.columnsSnapshot,
            requirementContract,
            runtimeConfig: input.runtimeConfig,
            failedJavascriptSource: generated.javascriptSource,
            diagnostics: validationErrors,
            repairBudget,
            onModelUsage,
            signal: input.signal,
          });
          validation = await this.validateGeneratedWorkflowCandidate({
            taskId: task.id,
            inputTableId: preparedInput.inputTable.id,
            inputTableName: preparedInput.inputTable.name,
            outputTableId: outputTable.id,
            outputTableName: outputTable.name,
            outputPhysicalTableName: outputTable.tableName,
            columns: preparedInput.columnsSnapshot,
            generated,
          });
          generated = validation.generated ?? generated;
          compatibilityDsl = validation.compatibilityDsl;
          validationErrors = diagnosticsWithSeverity(validation.diagnostics, 'error');
        }
        if (validationErrors.length > 0) {
          throw new DataCommandError(
            workflowCommandCodeForDiagnostics(validationErrors),
            summarizeDiagnostics(validationErrors),
            { diagnostics: validation.diagnostics }
          );
        }
        if (!validation.candidate) {
          throw new DataCommandError(
            'VALIDATION_FAILED',
            'Generated workflow validation completed without a compiled candidate'
          );
        }
        await this.store.saveTaskWorkflow(task.id, validation.candidate.workflow);
        return {
          taskId: task.id,
          taskName: task.name,
          outputTableId: outputTable.id,
          outputTableName: outputTable.name,
          ...(compatibilityDsl ? { workflowDsl: compatibilityDsl } : {}),
          workflowDslAvailable: Boolean(compatibilityDsl),
          requiredColumns: generated.requiredColumns,
          expectedOutputSchema: generated.expectedOutputSchema,
          lineage: generated.lineage,
          columnsSnapshot: preparedInput.columnsSnapshot,
          sourceSummaryHash: hashColumns(preparedInput.columnsSnapshot),
          workflowHash: hashWorkflowGraph(validation.candidate.workflow),
          version: nextGeneratedTaskVersion(input.currentVersion),
          generatedAt: Date.now(),
        };
      });
    } catch (error) {
      if (createdTaskId) {
        await this.store.deleteTaskMetadataOnly(createdTaskId).catch((cleanupError) => {
          logDataCommandFallback('Failed to roll back generated task metadata', cleanupError, {
            taskId: createdTaskId,
          });
        });
      }
      if (resolvedOutput.created) await this.rollbackOutputTable(outputTable.id);
      throw error;
    }
  }

  async analyzeTaskRequirement(
    input: AnalyzeTaskRequirementCommand
  ): Promise<AnalyzeTaskRequirementResult> {
    const generationId = normalizeOptionalName(input.usageTraceId) ?? randomUUID();
    const processRequirement = normalizeRequiredName(
      input.processRequirement,
      'Processing requirement is required'
    );
    const preparedInput = await this.inputResolver.prepareGeneratedTaskInput(input);
    const analysis = await analyzeDataTaskRequirement({
      requirement: processRequirement,
      columns: preparedInput.columnsSnapshot,
      runtimeConfig: input.runtimeConfig,
      signal: input.signal,
      onModelUsage: (result) => {
        this.recordOneShotUsage({
          generationId,
          feature: 'data_task_requirement_analysis',
          phase: 'requirement_analysis',
          result,
        });
      },
    });
    const result: AnalyzedTaskRequirement = {
      ...analysis,
      inputTableId: preparedInput.inputTable.id,
      inputTableName: preparedInput.inputTable.name,
      columnsSnapshot: preparedInput.columnsSnapshot,
      sourceSummaryHash: hashColumns(preparedInput.columnsSnapshot),
      capabilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
    };
    const receipt = this.analysisReceipts.create({
      sessionId: generationId,
      sourceUserMessageId: normalizeOptionalName(input.sourceUserMessageId),
      inputTableId: result.inputTableId,
      inputTableName: result.inputTableName,
      inputSchemaHash: result.sourceSummaryHash,
      processRequirement,
      analysis: result,
      capabilityProfileVersion: result.capabilityProfileVersion,
    });
    return { ...result, analysisId: receipt.id, expiresAt: receipt.expiresAt };
  }

  private assertAnalysisReceipt(
    input: GenerateTaskFromRequirementCommand,
    inputTableId: string,
    columns: DataAutomationColumnSnapshot[]
  ): RequirementCapabilityContract | undefined {
    const analysisId = normalizeOptionalName(
      typeof input.analysisId === 'string' ? input.analysisId : undefined
    );
    if (!analysisId) return undefined;
    const receipt = this.analysisReceipts.get(analysisId);
    if (!receipt) {
      throw new DataCommandError(
        'ANALYSIS_REQUIRED',
        'Requirement analysis was not found or has expired. Analyze the requirement again.'
      );
    }
    if (receipt.sessionId !== normalizeOptionalName(input.usageTraceId)) {
      throw new DataCommandError(
        'ANALYSIS_REQUIRED',
        'Requirement analysis does not belong to this generation flow.'
      );
    }
    if (receipt.capabilityProfileVersion !== AI_PREP_DSL_RUNTIME_PROFILE_VERSION) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'Data-task capabilities changed after analysis. Analyze the requirement again.'
      );
    }
    if (receipt.inputTableId !== inputTableId || receipt.inputSchemaHash !== hashColumns(columns)) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'The input table schema changed after analysis. Analyze the requirement again.'
      );
    }
    const supportedRequirement = receipt.analysis.items
      .filter((item) => item.status === 'supported')
      .map((item) => item.suggestedRequirement || item.requirement)
      .join('\n')
      .trim();
    const requestedRequirement = input.processRequirement.trim();
    const originalRequirement = receipt.processRequirement.trim();
    const canGenerateOriginal =
      receipt.analysis.status === 'supported' && requestedRequirement === originalRequirement;
    if (
      !supportedRequirement ||
      (!canGenerateOriginal && requestedRequirement !== supportedRequirement)
    ) {
      throw new DataCommandError(
        'REQUIREMENT_NOT_SUPPORTED',
        'Generation must use the supported requirements from the confirmed analysis.'
      );
    }
    const supportedItems = receipt.analysis.items.filter((item) => item.status === 'supported');
    const requirementContract = createRequirementCapabilityContract(
      supportedItems.flatMap((item) => item.capabilities ?? [])
    );
    const operationTypes = getRequirementCapabilityContractOperationTypes(requirementContract);
    if (requirementContract.capabilityIds.length === 0 || operationTypes.length === 0) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'Requirement analysis does not contain a certified generation capability contract. Analyze the requirement again.'
      );
    }
    return requirementContract;
  }

  private async validateGeneratedWorkflowCandidate(input: {
    taskId: string;
    inputTableId: string;
    inputTableName: string;
    outputTableId: string;
    outputTableName: string;
    outputPhysicalTableName: string;
    columns: DataAutomationColumnSnapshot[];
    generated: GeneratedDataTaskWorkflow;
  }): Promise<GeneratedWorkflowCandidateValidation> {
    const contractDiagnostics = normalizeWorkflowFailureDiagnostics(
      validateGeneratedWorkflowGenerationContract(input.generated, input.columns),
      {
        failureStage: 'generation_contract',
        commandErrorCode: 'VALIDATION_FAILED',
        repairClass: 'none',
      }
    );
    if (diagnosticsWithSeverity(contractDiagnostics, 'error').length > 0) {
      return { diagnostics: contractDiagnostics };
    }

    let candidate: CompiledWorkflowCandidate;
    let canonicalGenerated: GeneratedDataTaskWorkflow;
    try {
      const plan = compileLoweredWorkflowToPlatformNodes({
        semantics: input.generated,
        bindings: {
          inputTableId: input.inputTableId,
          inputTableName: input.inputTableName,
          outputTableId: input.outputTableId,
          outputTableName: input.outputTableName,
          outputPhysicalTableName: input.outputPhysicalTableName,
          outputMode: 'replace',
        },
      });
      const workflow = { nodes: plan.nodes, edges: plan.edges };
      canonicalGenerated = {
        ...input.generated,
        operationOrigins: plan.operationNodeOrigins,
        requiredColumns: plan.requiredColumns,
        expectedOutputSchema: plan.expectedOutputSchema,
        lineage: plan.lineage,
      };
      candidate = {
        workflow,
        diagnostics: normalizeWorkflowFailureDiagnostics(
          validateGeneratedExecutableWorkflow(workflow),
          { failureStage: 'node_validation', commandErrorCode: 'VALIDATION_FAILED' }
        ),
      };
    } catch (error) {
      return {
        diagnostics: workflowDiagnosticsFromError(error, {
          failureStage: 'workflow_lowering',
          commandErrorCode: 'VALIDATION_FAILED',
        }),
      };
    }
    const nodeDiagnostics = candidate.diagnostics;
    if (diagnosticsWithSeverity(nodeDiagnostics, 'error').length > 0) {
      return { generated: canonicalGenerated, diagnostics: nodeDiagnostics };
    }
    const compatibilityDsl = this.tryExportCompatibilityWorkflowDsl(candidate.workflow, {
      taskId: input.taskId,
    });
    try {
      const temporaryExecution = await this.store.validateTaskWorkflow(input.taskId, {
        workflow: candidate.workflow,
      });
      const temporaryRun: RunTaskResult = {
        task: temporaryExecution.task,
        preview: await this.preview.previewTaskOutput(
          input.taskId,
          temporaryExecution.task,
          20,
          candidate.workflow
        ),
        diagnostics: temporaryExecution.diagnostics,
        nodeStats: temporaryExecution.nodeStats,
      };
      const executionDiagnostics = normalizeWorkflowFailureDiagnostics(
        temporaryRun.diagnostics ?? [],
        { failureStage: 'node_execution', commandErrorCode: 'RUN_FAILED' }
      );
      const outputSchemaDiagnostics = normalizeWorkflowFailureDiagnostics(
        validateGeneratedOutputPreviewSchema(
          temporaryRun.preview,
          canonicalGenerated.expectedOutputSchema
        ).map((diagnostic) => ({
          ...diagnostic,
          severity: 'warning' as const,
          code: 'outputSchemaCalibrated',
          message: `Static output schema was calibrated from temporary run: ${diagnostic.message}`,
        })),
        {
          failureStage: 'output_validation',
          commandErrorCode: 'VALIDATION_FAILED',
          repairClass: 'none',
        }
      );
      return {
        generated: reconcileGeneratedWorkflowWithOutputPreview(
          canonicalGenerated,
          temporaryRun.preview,
          input.columns
        ),
        candidate,
        compatibilityDsl,
        diagnostics: [...nodeDiagnostics, ...executionDiagnostics, ...outputSchemaDiagnostics],
      };
    } catch (error) {
      const commandError = toCommandError(error, 'RUN_FAILED');
      return {
        generated: canonicalGenerated,
        compatibilityDsl,
        diagnostics: [
          ...nodeDiagnostics,
          ...workflowDiagnosticsFromError(commandError, {
            failureStage: 'node_execution',
            commandErrorCode: commandError.code,
          }),
        ],
      };
    } finally {
      await this.store.cleanupTemporaryTaskResources(input.taskId).catch((cleanupError) => {
        logDataCommandFallback('Failed to clean temporary validation resources', cleanupError, {
          taskId: input.taskId,
        });
      });
    }
  }

  private tryExportCompatibilityWorkflowDsl(
    workflow: WorkflowSaveShape,
    context: Record<string, unknown>
  ): string | undefined {
    try {
      const workflowDsl = (this.options.exportWorkflowDsl ?? exportPrepWorkflowDsl)(
        workflow.nodes,
        workflow.edges
      ).trim();
      return workflowDsl || undefined;
    } catch (error) {
      logDataCommandFallback(
        'Failed to export generated workflow compatibility DSL',
        error,
        context
      );
      return undefined;
    }
  }

  private recordWorkflowModelUsage(
    generationId: string,
    taskId: string,
    event: WorkflowModelUsageEvent
  ): void {
    const metadata =
      event.phase === 'repair'
        ? {
            repairStrategy: event.repairStrategy,
            attempt: event.attempt,
            functionName: event.functionName,
            failureStage: event.failureStage,
            errorCode: event.errorCode,
            operationType: event.operationType,
            repairOutcome: event.repairOutcome,
          }
        : undefined;
    this.recordOneShotUsage({
      generationId,
      feature: 'data_task_generation',
      phase: event.phase,
      taskId,
      result: event.result,
      metadata,
    });
  }

  private recordOneShotUsage(input: {
    generationId: string;
    feature: 'data_task_requirement_analysis' | 'data_task_generation';
    phase: 'requirement_analysis' | 'initial_generation' | 'repair';
    taskId?: string;
    result: WorkflowModelUsageEvent['result'];
    metadata?: Record<string, unknown>;
  }): void {
    if (!this.options.recordLlmUsage) return;
    const { usage } = input.result;
    try {
      this.options.recordLlmUsage({
        generationId: input.generationId,
        feature: input.feature,
        phase: input.phase,
        taskId: input.taskId,
        provider: input.result.provider,
        model: input.result.model,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        totalTokens: usage.totalTokens,
        costTotal: usage.cost.total,
        durationMs: input.result.durationMs,
        stopReason: input.result.stopReason,
        metadata: input.metadata,
      });
    } catch (error) {
      logDataCommandFallback('Failed to persist data-task LLM usage', error, {
        generationId: input.generationId,
        taskId: input.taskId,
        phase: input.phase,
      });
    }
  }

  private async resolveReusableGeneratedTask(
    taskId: string | null | undefined
  ): Promise<DataCleaningTask | null> {
    const normalizedTaskId = normalizeOptionalName(taskId ?? undefined);
    return normalizedTaskId ? this.store.getTaskRecord(normalizedTaskId) : null;
  }

  private async rollbackOutputTable(outputTableId: string): Promise<void> {
    await this.store.deleteDataset(outputTableId).catch((cleanupError) => {
      logDataCommandFallback('Failed to roll back generated output dataset', cleanupError, {
        outputTableId,
      });
    });
  }
}
