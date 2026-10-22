import { randomUUID } from 'crypto';
import type { WorkflowDiagnostic } from '../../shared/workflow-diagnostics';
import type {
  DataAutomationColumnSnapshot,
  DataPipeline,
  DataColumnTypeInfo,
  DataRawTablePreview,
  DataWorkflowNodeInput,
} from '../../shared/contracts';
import type { DataPipelineStore } from './data-pipeline-store';
import type { DataPipelineLlmUsageRecorder } from './data-pipeline-llm-usage-recorder';
import {
  DataCommandError,
  type AnalyzedPipelineRequirement,
  type AnalyzePipelineRequirementCommand,
  type AnalyzePipelineRequirementResult,
  type GeneratePipelineFromRequirementCommand,
  type GeneratePipelineFromRequirementResult,
  type RunPipelineResult,
  type WorkflowSaveShape,
} from './data-command-types';
import { AutomationInputResolver } from './automation-input-resolver';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import { GeneratedOutputResolver } from './generated-output-resolver';
import { PipelineCommandService } from './pipeline-command-service';
import { WorkflowPreviewService } from './workflow-preview-service';
import {
  diagnosticsWithSeverity,
  hashWorkflowGraph,
  logDataCommandFallback,
  nextGeneratedPipelineVersion,
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
  analyzeDataPipelineRequirement,
  generateJflowProgram,
  hashColumns,
  JFLOW_GENERATION_REPAIR_ATTEMPTS,
  normalizeWorkflowFailureDiagnostics,
  outputSchemaFromPreview,
  toAutomationColumnSnapshot,
  type GeneratedJflowProgram,
  type WorkflowModelUsageEvent,
  validateGeneratedExecutableWorkflow,
  workflowCommandCodeForDiagnostics,
  workflowDiagnosticsFromError,
} from './workflow';
import { AI_JFLOW_RUNTIME_PROFILE_VERSION } from './workflow/jflow-capability-profile';
import {
  createRequirementCapabilityContract,
  getRequirementCapabilityContractOperationTypes,
  type RequirementCapabilityContract,
} from './workflow/requirement-capability-registry';
import { compileJflowAgainstStore } from './jflow-catalog';
import { toWorkflowDiagnostic } from './workflow-dsl-compiler';
import { deriveWorkflowLineage } from './workflow/workflow-lineage';
import { RequirementAnalysisReceiptStore } from './requirement-analysis-receipt-store';

interface GeneratedWorkflowCandidateValidation {
  diagnostics: WorkflowDiagnostic[];
  candidate?: CompiledWorkflowCandidate;
  /** Columns of the temporary-run output preview. */
  outputSchema?: DataAutomationColumnSnapshot[];
  /** Output node the generated chain feeds after an anchor merge (null when none). */
  terminalOutputNodeId?: string | null;
}

interface GenerationAnchor {
  pipelineId: string;
  /** Draft (or saved) workflow used as the merge base — unsaved canvas edits included. */
  workflow: WorkflowSaveShape;
  node: DataWorkflowNodeInput;
  /** Plan-inferred output schema of the anchor node; drives analysis + generation. */
  columns: Array<{ name: string; type?: string }>;
  /** True when the anchor tail is open and the generated output node survives the merge. */
  keepsGeneratedOutput: boolean;
  /** Name shown to the generator — the downstream output's name when the merge drops the generated sink. */
  promptOutputName: string;
  /** `local:result/<id>` of the downstream output the merge keeps, when it is bound. */
  promptOutputUri?: string;
}

export interface GeneratedPipelineCommandServiceOptions {
  recordLlmUsage?: DataPipelineLlmUsageRecorder;
}

export class GeneratedPipelineCommandService {
  constructor(
    private readonly store: DataPipelineStore,
    private readonly resources: DataCommandResources,
    private readonly locks: DataCommandLockCoordinator,
    private readonly inputResolver: AutomationInputResolver,
    private readonly outputResolver: GeneratedOutputResolver,
    private readonly pipelines: PipelineCommandService,
    private readonly preview: WorkflowPreviewService,
    private readonly analysisReceipts: RequirementAnalysisReceiptStore,
    private readonly options: GeneratedPipelineCommandServiceOptions = {}
  ) {}

  async generatePipelineFromRequirement(
    input: GeneratePipelineFromRequirementCommand
  ): Promise<GeneratePipelineFromRequirementResult> {
    const generationId = normalizeOptionalName(input.usageTraceId) ?? randomUUID();
    const processRequirement = normalizeRequiredName(
      input.processRequirement,
      'Processing requirement is required'
    );
    const preparedInput = await this.inputResolver.prepareGeneratedPipelineInput(input);
    const anchor = await this.resolveGenerationAnchor(input);
    const generationColumns = anchor ? anchor.columns : preparedInput.columnsSnapshot;
    const requirementContract = this.assertAnalysisReceipt(
      input,
      preparedInput.rawTable.id,
      generationColumns
    );
    const displayRawTableName =
      normalizeOptionalName(input.source.tableName) || preparedInput.rawTable.name;
    // Anchored merges that splice into existing downstream edges (or into an
    // existing output sink) drop the generated output node — no new output
    // table is resolved/created in that case.
    const resolvedOutput =
      anchor && !anchor.keepsGeneratedOutput
        ? null
        : await this.outputResolver.resolveGeneratedResultTable(
            input.output,
            displayRawTableName,
            input.outputConflictPolicy
          );
    const resultTable = resolvedOutput?.resultTable ?? null;
    const generationOutputName =
      resultTable?.name ??
      anchor?.promptOutputName ??
      `${displayRawTableName || '数据表'}_processed`;
    const reusablePipeline = await this.resolveReusableGeneratedPipeline(input.reusePipelineId);
    let createdPipelineId: string | undefined;
    let pipeline: DataPipeline;
    try {
      pipeline =
        reusablePipeline ??
        (
          await this.pipelines.createPipeline({
            name: await this.resources.createUniquePipelineName(
              normalizeOptionalName(input.pipelineName) ??
                `${displayRawTableName || '数据表'}_自动处理`
            ),
            sourceRawTableId: preparedInput.rawTable.id,
            resultTableId: resultTable?.id,
          })
        ).pipeline;
    } catch (error) {
      if (resolvedOutput?.created && resultTable) {
        await this.rollbackResultTable(resultTable.id);
      }
      throw error;
    }
    if (!reusablePipeline) createdPipelineId = pipeline.id;
    const usageAttribution = {
      source: 'data_generate_pipeline_from_requirement',
      analysisId: normalizeOptionalName(
        typeof input.analysisId === 'string' ? input.analysisId : undefined
      ),
      rawTableId: preparedInput.rawTable.id,
      resultTableId: resultTable?.id,
    };
    const onModelUsage = (event: WorkflowModelUsageEvent): void => {
      this.recordWorkflowModelUsage(generationId, pipeline.id, event, usageAttribution);
    };
    try {
      return await this.locks.withKeyedLock(`pipeline:${pipeline.id}`, async () => {
        const rawTableUri = `local:raw/${preparedInput.rawTable.id}`;
        const generationRequest = {
          rawTableUri,
          resultTableName: generationOutputName,
          ...(resultTable
            ? { resultTableUri: `local:result/${resultTable.id}` }
            : anchor?.promptOutputUri
              ? { resultTableUri: anchor.promptOutputUri }
              : {}),
          requirement: processRequirement,
          columns: generationColumns,
          requirementContract,
          runtimeConfig: input.runtimeConfig,
          onModelUsage,
          signal: input.signal,
          onActivity: input.onActivity,
        };
        const validate = (program: GeneratedJflowProgram) =>
          this.validateGeneratedWorkflowCandidate({
            pipelineId: pipeline.id,
            rawTableId: preparedInput.rawTable.id,
            rawTableName: preparedInput.rawTable.name,
            resultTableId: resultTable?.id,
            columns: generationColumns,
            program,
            anchor,
          });
        let generated = await generateJflowProgram(generationRequest);
        let validation = await validate(generated);
        let validationErrors = diagnosticsWithSeverity(validation.diagnostics, 'error');
        for (
          let attempt = 1;
          validationErrors.length > 0 && attempt <= JFLOW_GENERATION_REPAIR_ATTEMPTS;
          attempt += 1
        ) {
          input.signal?.throwIfAborted();
          generated = await generateJflowProgram({
            ...generationRequest,
            previous: { text: generated.text, diagnostics: validationErrors, attempt },
          });
          validation = await validate(generated);
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
        await this.store.savePipelineWorkflow(pipeline.id, validation.candidate.workflow);
        // When the generated output node was dropped by the anchor merge, the
        // chain feeds an existing output sink — surface its binding instead.
        const terminalOutput = validation.terminalOutputNodeId
          ? validation.candidate.workflow.nodes.find(
              (node) => node.id === validation.terminalOutputNodeId
            )
          : undefined;
        const terminalResultTableId =
          resultTable?.id ??
          stringConfigValue(terminalOutput?.config?.outputResultTableId) ??
          stringConfigValue(terminalOutput?.config?.resultTableId) ??
          '';
        const terminalResultTableName =
          resultTable?.name ??
          stringConfigValue(terminalOutput?.config?.resultTableName) ??
          generationOutputName;
        return {
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          resultTableId: terminalResultTableId,
          resultTableName: terminalResultTableName,
          workflowDsl: generated.text,
          workflowDslAvailable: true,
          ...(generated.summary ? { changeSummary: generated.summary } : {}),
          requiredColumns: referencedColumns(generated.text, generationColumns),
          expectedOutputSchema: validation.outputSchema ?? [],
          lineage: deriveWorkflowLineage(
            validation.candidate.workflow,
            validation.outputSchema ?? [],
            (node) =>
              stringConfigValue(node.config?.rawTableId) === preparedInput.rawTable.id
                ? preparedInput.columnsSnapshot
                : [],
            validation.terminalOutputNodeId
          ),
          columnsSnapshot: generationColumns,
          sourceSummaryHash: hashColumns(generationColumns),
          workflowHash: hashWorkflowGraph(validation.candidate.workflow),
          version: nextGeneratedPipelineVersion(input.currentVersion),
          generatedAt: Date.now(),
        };
      });
    } catch (error) {
      if (createdPipelineId) {
        await this.store.deletePipelineMetadataOnly(createdPipelineId).catch((cleanupError) => {
          logDataCommandFallback('Failed to roll back generated pipeline metadata', cleanupError, {
            pipelineId: createdPipelineId,
          });
        });
      }
      if (resolvedOutput?.created && resultTable) await this.rollbackResultTable(resultTable.id);
      throw error;
    }
  }

  async analyzePipelineRequirement(
    input: AnalyzePipelineRequirementCommand
  ): Promise<AnalyzePipelineRequirementResult> {
    const generationId = normalizeOptionalName(input.usageTraceId) ?? randomUUID();
    const processRequirement = normalizeRequiredName(
      input.processRequirement,
      'Processing requirement is required'
    );
    const preparedInput = await this.inputResolver.prepareGeneratedPipelineInput(input);
    const anchor = await this.resolveGenerationAnchor(input);
    const analysisColumns = anchor ? anchor.columns : preparedInput.columnsSnapshot;
    const analysis = await analyzeDataPipelineRequirement({
      requirement: processRequirement,
      requirementConversation: input.requirementConversation,
      columns: analysisColumns,
      runtimeConfig: input.runtimeConfig,
      signal: input.signal,
      onActivity: input.onActivity,
      onModelUsage: (result) => {
        this.recordOneShotUsage({
          generationId,
          feature: 'data_pipeline_requirement_analysis',
          phase: 'requirement_analysis',
          result,
          metadata: {
            source: 'data_analyze_pipeline_requirement',
            rawTableId: preparedInput.rawTable.id,
          },
        });
      },
    });
    const result: AnalyzedPipelineRequirement = {
      ...analysis,
      rawTableId: preparedInput.rawTable.id,
      rawTableName: preparedInput.rawTable.name,
      columnsSnapshot: analysisColumns,
      sourceSummaryHash: hashColumns(analysisColumns),
      capabilityProfileVersion: AI_JFLOW_RUNTIME_PROFILE_VERSION,
    };
    const receipt = this.analysisReceipts.create({
      authoringRequest: input.authoringRequest ?? {
        id: randomUUID(),
        source: input.source,
        reusePipelineId: input.reusePipelineId,
        startFromNodeId: input.startFromNodeId,
        workflow: input.workflow,
      },
      sessionId: generationId,
      sourceUserMessageId: normalizeOptionalName(input.sourceUserMessageId),
      rawTableId: result.rawTableId,
      rawTableName: result.rawTableName,
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
    input: Pick<
      GeneratePipelineFromRequirementCommand,
      'reusePipelineId' | 'startFromNodeId' | 'workflow'
    >
  ): Promise<GenerationAnchor | null> {
    const startFromNodeId = normalizeOptionalName(input.startFromNodeId ?? undefined);
    if (!startFromNodeId) return null;
    const pipelineId = normalizeRequiredName(
      input.reusePipelineId ?? '',
      'Anchored generation requires an existing pipeline (reusePipelineId)'
    );
    const workflow: WorkflowSaveShape = input.workflow?.nodes?.length
      ? input.workflow
      : toWorkflowSaveShape(await this.store.getPipelineWorkflow(pipelineId));
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
        pipelineId,
        nodeId: node.id,
        nodeType: node.type,
        nodeConfig: node.config,
        workflow,
      });
    } catch (error) {
      logDataCommandFallback('Failed to infer anchor node columns for generation', error, {
        pipelineId,
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
    const downstreamOutput = findDownstreamOutputNode(workflow, node, outgoing);
    const downstreamResultId =
      stringConfigValue(downstreamOutput?.config?.outputResultTableId) ??
      stringConfigValue(downstreamOutput?.config?.resultTableId);
    return {
      pipelineId,
      workflow,
      node,
      columns,
      keepsGeneratedOutput: node.type !== 'output' && outgoing.length === 0,
      promptOutputName:
        outputNameOf(downstreamOutput) ??
        `${normalizeOptionalName(node.label) || 'result'}_processed`,
      ...(downstreamResultId ? { promptOutputUri: `local:result/${downstreamResultId}` } : {}),
    };
  }

  /** Preview the specific output sink the generated chain feeds after a merge. */
  private async previewGeneratedOutput(
    pipelineId: string,
    pipeline: DataPipeline,
    workflow: WorkflowSaveShape,
    terminalOutputNodeId: string | null
  ): Promise<DataRawTablePreview | undefined> {
    const terminalNode = terminalOutputNodeId
      ? workflow.nodes.find((node) => node.id === terminalOutputNodeId)
      : undefined;
    if (terminalNode) {
      try {
        return await this.store.previewWorkflowNode({
          pipelineId,
          nodeId: terminalNode.id,
          nodeType: 'output',
          nodeConfig: terminalNode.config,
          limit: 20,
        });
      } catch (error) {
        logDataCommandFallback(
          'Terminal output preview failed; falling back to pipeline output preview',
          error,
          { pipelineId, nodeId: terminalNode.id }
        );
      }
    }
    return this.preview.previewPipelineOutput(pipelineId, pipeline, 20, workflow);
  }

  private assertAnalysisReceipt(
    input: GeneratePipelineFromRequirementCommand,
    rawTableId: string,
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
    if (receipt.capabilityProfileVersion !== AI_JFLOW_RUNTIME_PROFILE_VERSION) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'Data-pipeline capabilities changed after analysis. Analyze the requirement again.'
      );
    }
    if (receipt.rawTableId !== rawTableId || receipt.inputSchemaHash !== hashColumns(columns)) {
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
    pipelineId: string;
    rawTableId: string;
    rawTableName: string;
    resultTableId?: string;
    columns: DataAutomationColumnSnapshot[];
    program: GeneratedJflowProgram;
    anchor?: GenerationAnchor | null;
  }): Promise<GeneratedWorkflowCandidateValidation> {
    const text = input.program.text;
    let workflow: WorkflowSaveShape;
    let terminalOutputNodeId: string | null = null;
    try {
      const compiled = await compileJflowAgainstStore(this.store, text, '', [
        {
          id: input.rawTableId,
          name: input.rawTableName,
          kind: 'raw',
          columns: input.columns.map((column) => ({
            name: column.name,
            type: column.type ?? 'VARCHAR',
          })),
        },
      ]);
      const compileDiagnostics = compiled.diagnostics.map(toWorkflowDiagnostic(text));
      if (diagnosticsWithSeverity(compileDiagnostics, 'error').length > 0) {
        return { diagnostics: compileDiagnostics };
      }
      const shapeDiagnostics = generatedShapeDiagnostics(
        compiled.nodes as DataWorkflowNodeInput[],
        input.rawTableId
      );
      if (shapeDiagnostics.length > 0) return { diagnostics: shapeDiagnostics };
      workflow = {
        nodes: await this.bindGeneratedOutput(
          compiled.nodes as DataWorkflowNodeInput[],
          input.resultTableId
        ),
        edges: compiled.edges,
      };
      if (input.anchor) {
        // Anchor mode: splice the generated steps into the draft workflow at the selected node —
        // the standalone input/output boundary nodes are dropped or rebound inside the merge.
        const merged = mergeGeneratedChainAfterAnchor(
          input.anchor.workflow,
          input.anchor.node.id,
          workflow,
          (id) => scopedWorkflowEntityId(input.anchor!.pipelineId, id)
        );
        workflow = { nodes: merged.nodes, edges: merged.edges };
        terminalOutputNodeId = merged.terminalOutputNodeId;
      }
    } catch (error) {
      return {
        diagnostics: workflowDiagnosticsFromError(error, {
          failureStage: 'workflow_lowering',
          commandErrorCode: 'VALIDATION_FAILED',
        }),
      };
    }
    const candidate: CompiledWorkflowCandidate = {
      workflow,
      diagnostics: normalizeWorkflowFailureDiagnostics(
        validateGeneratedExecutableWorkflow(workflow),
        { failureStage: 'node_validation', commandErrorCode: 'VALIDATION_FAILED' }
      ),
    };
    if (diagnosticsWithSeverity(candidate.diagnostics, 'error').length > 0) {
      return { diagnostics: candidate.diagnostics };
    }
    try {
      const temporaryExecution = await this.store.validatePipelineWorkflow(input.pipelineId, {
        workflow: candidate.workflow,
      });
      const temporaryRun: RunPipelineResult = {
        pipeline: temporaryExecution.pipeline,
        preview: await this.previewGeneratedOutput(
          input.pipelineId,
          temporaryExecution.pipeline,
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
      return {
        candidate,
        outputSchema: outputSchemaFromPreview(temporaryRun.preview),
        terminalOutputNodeId,
        diagnostics: [...candidate.diagnostics, ...executionDiagnostics],
      };
    } catch (error) {
      const commandError = toCommandError(error, 'RUN_FAILED');
      return {
        diagnostics: [
          ...candidate.diagnostics,
          ...workflowDiagnosticsFromError(commandError, {
            failureStage: 'node_execution',
            commandErrorCode: commandError.code,
          }),
        ],
      };
    } finally {
      await this.store.cleanupTemporaryPipelineResources(input.pipelineId).catch((cleanupError) => {
        logDataCommandFallback('Failed to clean temporary validation resources', cleanupError, {
          pipelineId: input.pipelineId,
        });
      });
    }
  }

  /** Rebinds the program's `write @new(...)` to the resolved result table. */
  private async bindGeneratedOutput(
    nodes: DataWorkflowNodeInput[],
    resultTableId: string | undefined
  ): Promise<DataWorkflowNodeInput[]> {
    if (!resultTableId) return nodes;
    const resultTable = await this.resources.requireResultTable(resultTableId);
    return nodes.map((node) =>
      node.type === 'output'
        ? {
            ...node,
            config: {
              ...(node.config ?? {}),
              outputStrategy: 'existing',
              outputResultTableId: resultTable.id,
              resultTableId: resultTable.id,
              resultTableName: resultTable.name,
              table: resultTable.tableName,
              destination: 'duckdb_table',
              mode: 'replace',
              intent: 'bound',
              ref: { uri: `local:result/${resultTable.id}`, name: resultTable.name },
            },
          }
        : node
    );
  }

  private recordWorkflowModelUsage(
    generationId: string,
    pipelineId: string,
    event: WorkflowModelUsageEvent,
    attribution?: Record<string, unknown>
  ): void {
    const metadata = {
      ...attribution,
      ...(event.phase === 'repair'
        ? {
            attempt: event.attempt,
            errorCode: event.errorCode,
          }
        : {}),
    };
    this.recordOneShotUsage({
      generationId,
      feature: 'data_pipeline_generation',
      phase: event.phase,
      pipelineId,
      result: event.result,
      metadata,
    });
  }

  private recordOneShotUsage(input: {
    generationId: string;
    feature: 'data_pipeline_requirement_analysis' | 'data_pipeline_generation';
    phase: 'requirement_analysis' | 'initial_generation' | 'repair';
    pipelineId?: string;
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
        pipelineId: input.pipelineId,
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
      logDataCommandFallback('Failed to persist data-pipeline LLM usage', error, {
        generationId: input.generationId,
        pipelineId: input.pipelineId,
        phase: input.phase,
      });
    }
  }

  private async resolveReusableGeneratedPipeline(
    pipelineId: string | null | undefined
  ): Promise<DataPipeline | null> {
    const normalizedPipelineId = normalizeOptionalName(pipelineId ?? undefined);
    return normalizedPipelineId ? this.store.getPipelineRecord(normalizedPipelineId) : null;
  }

  private async rollbackResultTable(resultTableId: string): Promise<void> {
    await this.store.deleteRawTable(resultTableId).catch((cleanupError) => {
      logDataCommandFallback('Failed to roll back generated output rawTable', cleanupError, {
        resultTableId,
      });
    });
  }
}

/** First output-sink name reachable from the anchor through `output` edges. */
function outputNameOf(node: DataWorkflowNodeInput | undefined): string | undefined {
  if (!node) return undefined;
  return (
    stringConfigValue(node.config?.resultTableName) ||
    stringConfigValue(node.config?.table) ||
    stringConfigValue(node.config?.outputResultTableId) ||
    undefined
  );
}

function findDownstreamOutputNode(
  workflow: WorkflowSaveShape,
  anchor: DataWorkflowNodeInput,
  anchorOutEdges: WorkflowSaveShape['edges']
): DataWorkflowNodeInput | undefined {
  if (anchor.type === 'output') return anchor;
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const queue = anchorOutEdges.map((edge) => edge.targetNodeId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (node.type === 'output') return node;
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

/** Generated programs read exactly the analysed raw table and write exactly once. */
function generatedShapeDiagnostics(
  nodes: DataWorkflowNodeInput[],
  rawTableId: string
): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];
  const inputs = nodes.filter((node) => node.type === 'input');
  const outputs = nodes.filter((node) => node.type === 'output');
  const foreign = inputs.filter(
    (node) => stringConfigValue(node.config?.rawTableId) !== rawTableId
  );
  if (inputs.length !== 1 || foreign.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'E_GEN_SOURCE',
      message: `The program must declare exactly one source: source src = @id('local:raw/${rawTableId}')`,
    });
  }
  if (outputs.length !== 1) {
    diagnostics.push({
      severity: 'error',
      code: 'E_GEN_WRITE',
      message: 'The program must end with exactly one write @new(...)',
    });
  }
  return diagnostics;
}

/** Input columns the program references as [field] tokens. */
function referencedColumns(
  text: string,
  columns: DataAutomationColumnSnapshot[]
): DataAutomationColumnSnapshot[] {
  const referenced = new Set(
    [...text.matchAll(/\[((?:[^\]]|\]\])+)\]/g)].map((match) => match[1].replace(/\]\]/g, ']'))
  );
  return columns.filter((column) => referenced.has(column.name)).map(toAutomationColumnSnapshot);
}
