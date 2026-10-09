import { randomUUID } from 'crypto';
import { exportPrepWorkflowDsl, type PrepDiagnostic } from '../../shared/prep-dsl';
import type {
  DataAutomationColumnSnapshot,
  DataCleaningTask,
  DataColumnTypeInfo,
  DataInputTablePreview,
  DataWorkflowNodeInput,
} from '../../shared/contracts';
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
  stringConfigValue,
  summarizeDiagnostics,
  toCommandError,
  toWorkflowSaveShape,
  type CompiledWorkflowCandidate,
} from './data-command-utils';
import { mergeGeneratedChainAfterAnchor } from './workflow/generated-workflow-merge';
import { scopedWorkflowEntityId } from './store/workflow-model';
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
  /** Output node the generated chain feeds after an anchor merge (null when none). */
  terminalOutputNodeId?: string | null;
}

interface GenerationAnchor {
  taskId: string;
  /** Draft (or saved) workflow used as the merge base — unsaved canvas edits included. */
  workflow: WorkflowSaveShape;
  node: DataWorkflowNodeInput;
  /** Plan-inferred output schema of the anchor node; drives analysis + generation. */
  columns: Array<{ name: string; type?: string }>;
  /** True when the anchor tail is open and the generated output node survives the merge. */
  keepsGeneratedOutput: boolean;
  /** Name shown to the generator — the downstream output's name when the merge drops the generated sink. */
  promptOutputName: string;
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
    const anchor = await this.resolveGenerationAnchor(input);
    const generationColumns = anchor ? anchor.columns : preparedInput.columnsSnapshot;
    const requirementContract = this.assertAnalysisReceipt(
      input,
      preparedInput.inputTable.id,
      generationColumns
    );
    const displayInputTableName =
      normalizeOptionalName(input.source.tableName) || preparedInput.inputTable.name;
    // Anchored merges that splice into existing downstream edges (or into an
    // existing output sink) drop the generated output node — no new output
    // table is resolved/created in that case.
    const resolvedOutput =
      anchor && !anchor.keepsGeneratedOutput
        ? null
        : await this.outputResolver.resolveGeneratedOutputTable(
            input.output,
            displayInputTableName,
            input.outputConflictPolicy
          );
    const outputTable = resolvedOutput?.outputTable ?? null;
    const generationOutputName =
      outputTable?.name ??
      anchor?.promptOutputName ??
      `${displayInputTableName || '数据表'}_processed`;
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
            outputTableId: outputTable?.id,
          })
        ).task;
    } catch (error) {
      if (resolvedOutput?.created && outputTable) {
        await this.rollbackOutputTable(outputTable.id);
      }
      throw error;
    }
    if (!reusableTask) createdTaskId = task.id;
    const usageAttribution = {
      source: 'data_generate_task_from_requirement',
      analysisId: normalizeOptionalName(
        typeof input.analysisId === 'string' ? input.analysisId : undefined
      ),
      inputTableId: preparedInput.inputTable.id,
      outputTableId: outputTable?.id,
    };
    const onModelUsage = (event: WorkflowModelUsageEvent): void => {
      this.recordWorkflowModelUsage(generationId, task.id, event, usageAttribution);
    };
    try {
      return await this.locks.withKeyedLock(`task:${task.id}`, async () => {
        const repairBudget = createGeneratedWorkflowRepairBudget();
        let generated = await generateDataTaskWorkflowFromRequirement({
          inputTableId: preparedInput.inputTable.id,
          outputTableName: generationOutputName,
          requirement: processRequirement,
          columns: generationColumns,
          requirementContract,
          runtimeConfig: input.runtimeConfig,
          repairBudget,
          onModelUsage,
          signal: input.signal,
          onActivity: input.onActivity,
        });
        let validation = await this.validateGeneratedWorkflowCandidate({
          taskId: task.id,
          inputTableId: preparedInput.inputTable.id,
          inputTableName: preparedInput.inputTable.name,
          outputTableId: outputTable?.id,
          outputTableName: generationOutputName,
          outputPhysicalTableName: outputTable?.tableName,
          columns: generationColumns,
          generated,
          anchor,
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
            outputTableName: generationOutputName,
            requirement: processRequirement,
            columns: generationColumns,
            requirementContract,
            runtimeConfig: input.runtimeConfig,
            failedJavascriptSource: generated.javascriptSource,
            diagnostics: validationErrors,
            repairBudget,
            onModelUsage,
            signal: input.signal,
            onActivity: input.onActivity,
          });
          validation = await this.validateGeneratedWorkflowCandidate({
            taskId: task.id,
            inputTableId: preparedInput.inputTable.id,
            inputTableName: preparedInput.inputTable.name,
            outputTableId: outputTable?.id,
            outputTableName: generationOutputName,
            outputPhysicalTableName: outputTable?.tableName,
            columns: generationColumns,
            generated,
            anchor,
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
        // When the generated output node was dropped by the anchor merge, the
        // chain feeds an existing output sink — surface its binding instead.
        const terminalOutput = validation.terminalOutputNodeId
          ? validation.candidate.workflow.nodes.find(
              (node) => node.id === validation.terminalOutputNodeId
            )
          : undefined;
        const terminalOutputTableId =
          outputTable?.id ??
          stringConfigValue(terminalOutput?.config?.outputDatasetId) ??
          stringConfigValue(terminalOutput?.config?.outputTableId) ??
          '';
        const terminalOutputTableName =
          outputTable?.name ??
          stringConfigValue(terminalOutput?.config?.outputTableName) ??
          generationOutputName;
        return {
          taskId: task.id,
          taskName: task.name,
          outputTableId: terminalOutputTableId,
          outputTableName: terminalOutputTableName,
          ...(compatibilityDsl ? { workflowDsl: compatibilityDsl } : {}),
          workflowDslAvailable: Boolean(compatibilityDsl),
          requiredColumns: generated.requiredColumns,
          expectedOutputSchema: generated.expectedOutputSchema,
          lineage: generated.lineage,
          columnsSnapshot: generationColumns,
          sourceSummaryHash: hashColumns(generationColumns),
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
      if (resolvedOutput?.created && outputTable) await this.rollbackOutputTable(outputTable.id);
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
    const anchor = await this.resolveGenerationAnchor(input);
    const analysisColumns = anchor ? anchor.columns : preparedInput.columnsSnapshot;
    const analysis = await analyzeDataTaskRequirement({
      requirement: processRequirement,
      requirementConversation: input.requirementConversation,
      columns: analysisColumns,
      runtimeConfig: input.runtimeConfig,
      signal: input.signal,
      onActivity: input.onActivity,
      onModelUsage: (result) => {
        this.recordOneShotUsage({
          generationId,
          feature: 'data_task_requirement_analysis',
          phase: 'requirement_analysis',
          result,
          metadata: {
            source: 'data_analyze_task_requirement',
            inputTableId: preparedInput.inputTable.id,
          },
        });
      },
    });
    const result: AnalyzedTaskRequirement = {
      ...analysis,
      inputTableId: preparedInput.inputTable.id,
      inputTableName: preparedInput.inputTable.name,
      columnsSnapshot: analysisColumns,
      sourceSummaryHash: hashColumns(analysisColumns),
      capabilityProfileVersion: AI_PREP_DSL_RUNTIME_PROFILE_VERSION,
    };
    const receipt = this.analysisReceipts.create({
      authoringRequest: input.authoringRequest ?? {
        id: randomUUID(),
        source: input.source,
        reuseTaskId: input.reuseTaskId,
        startFromNodeId: input.startFromNodeId,
        workflow: input.workflow,
      },
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

  /**
   * Resolves the selected canvas node that generation continues from. When set,
   * the generated ops are spliced after this node (instead of replacing the
   * workflow) and the model sees the node's plan-inferred output schema as the
   * "input" columns.
   */
  private async resolveGenerationAnchor(
    input: Pick<GenerateTaskFromRequirementCommand, 'reuseTaskId' | 'startFromNodeId' | 'workflow'>
  ): Promise<GenerationAnchor | null> {
    const startFromNodeId = normalizeOptionalName(input.startFromNodeId ?? undefined);
    if (!startFromNodeId) return null;
    const taskId = normalizeRequiredName(
      input.reuseTaskId ?? '',
      'Anchored generation requires an existing task (reuseTaskId)'
    );
    const workflow: WorkflowSaveShape = input.workflow?.nodes?.length
      ? input.workflow
      : toWorkflowSaveShape(await this.store.getTaskWorkflow(taskId));
    const node = workflow.nodes.find((item) => item.id === startFromNodeId);
    if (!node) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Cannot find workflow node "${startFromNodeId}" to anchor generation`
      );
    }
    let columnTypes: DataColumnTypeInfo[] = [];
    try {
      columnTypes = await this.store.getWorkflowNodeColumnTypes({
        taskId,
        nodeId: node.id,
        nodeType: node.type,
        nodeConfig: node.config,
        workflow,
      });
    } catch (error) {
      logDataCommandFallback('Failed to infer anchor node columns for generation', error, {
        taskId,
        nodeId: node.id,
      });
    }
    const columns = columnTypes
      .map((column) => ({ name: column.name, type: column.storageType || column.type }))
      .filter((column) => Boolean(column.name));
    const outgoing = workflow.edges.filter(
      (edge) =>
        edge.sourceNodeId === node.id && (!edge.sourceHandle || edge.sourceHandle === 'output')
    );
    return {
      taskId,
      workflow,
      node,
      columns,
      keepsGeneratedOutput: node.type !== 'output' && outgoing.length === 0,
      promptOutputName:
        findDownstreamOutputName(workflow, node, outgoing) ??
        `${normalizeOptionalName(node.label) || 'result'}_processed`,
    };
  }

  /** Preview the specific output sink the generated chain feeds after a merge. */
  private async previewGeneratedOutput(
    taskId: string,
    task: DataCleaningTask,
    workflow: WorkflowSaveShape,
    terminalOutputNodeId: string | null
  ): Promise<DataInputTablePreview | undefined> {
    const terminalNode = terminalOutputNodeId
      ? workflow.nodes.find((node) => node.id === terminalOutputNodeId)
      : undefined;
    if (terminalNode) {
      try {
        return await this.store.previewWorkflowNode({
          taskId,
          nodeId: terminalNode.id,
          nodeType: 'output',
          nodeConfig: terminalNode.config,
          limit: 20,
        });
      } catch (error) {
        logDataCommandFallback(
          'Terminal output preview failed; falling back to task output preview',
          error,
          { taskId, nodeId: terminalNode.id }
        );
      }
    }
    return this.preview.previewTaskOutput(taskId, task, 20, workflow);
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
    outputTableId?: string;
    outputTableName: string;
    outputPhysicalTableName?: string;
    columns: DataAutomationColumnSnapshot[];
    generated: GeneratedDataTaskWorkflow;
    anchor?: GenerationAnchor | null;
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
    let terminalOutputNodeId: string | null = null;
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
      let workflow = { nodes: plan.nodes, edges: plan.edges };
      let operationNodeOrigins = plan.operationNodeOrigins;
      if (input.anchor) {
        // Anchor mode: splice the generated ops into the draft workflow at the
        // selected node — the plan's standalone input/output boundary nodes are
        // dropped or rebound inside the merge.
        const merged = mergeGeneratedChainAfterAnchor(
          input.anchor.workflow,
          input.anchor.node.id,
          { nodes: plan.nodes, edges: plan.edges },
          (id) => scopedWorkflowEntityId(input.anchor!.taskId, id)
        );
        workflow = { nodes: merged.nodes, edges: merged.edges };
        terminalOutputNodeId = merged.terminalOutputNodeId;
        operationNodeOrigins = plan.operationNodeOrigins.map((origin) => ({
          ...origin,
          nodeId: merged.nodeIdMap.get(origin.nodeId) ?? origin.nodeId,
        }));
      }
      canonicalGenerated = {
        ...input.generated,
        operationOrigins: operationNodeOrigins,
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
        preview: await this.previewGeneratedOutput(
          input.taskId,
          temporaryExecution.task,
          candidate.workflow,
          terminalOutputNodeId
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
        terminalOutputNodeId,
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
    event: WorkflowModelUsageEvent,
    attribution?: Record<string, unknown>
  ): void {
    const metadata = {
      ...attribution,
      ...(event.phase === 'repair'
        ? {
            repairStrategy: event.repairStrategy,
            attempt: event.attempt,
            functionName: event.functionName,
            failureStage: event.failureStage,
            errorCode: event.errorCode,
            operationType: event.operationType,
            repairOutcome: event.repairOutcome,
          }
        : {}),
    };
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

/** First output-sink name reachable from the anchor through `output` edges. */
function findDownstreamOutputName(
  workflow: WorkflowSaveShape,
  anchor: DataWorkflowNodeInput,
  anchorOutEdges: WorkflowSaveShape['edges']
): string | undefined {
  const nameOf = (node: DataWorkflowNodeInput | undefined) =>
    node
      ? stringConfigValue(node.config?.outputTableName) ||
        stringConfigValue(node.config?.table) ||
        stringConfigValue(node.config?.outputDatasetId)
      : '';
  if (anchor.type === 'output') return nameOf(anchor) || undefined;
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const queue = anchorOutEdges.map((edge) => edge.targetNodeId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (node.type === 'output') return nameOf(node) || undefined;
    for (const edge of workflow.edges) {
      if (
        edge.sourceNodeId === id &&
        (!edge.sourceHandle || edge.sourceHandle === 'output') &&
        !visited.has(edge.targetNodeId)
      ) {
        queue.push(edge.targetNodeId);
      }
    }
  }
  return undefined;
}
