import { randomUUID } from 'crypto';
import {
  AGENT_RESULT_PREVIEW_MAX_ROWS,
  formatPreviewCoverage,
  type PreviewCoverageTarget,
} from './data-tool-preview-format';
import { pendingDataPipelineRequest } from '../../shared/data-pipeline-authoring';
import type { BeforeSessionRunContext } from '../extensions/agent-runtime-extension';
import type { DataCommandService } from './data-command-service';
import type {
  ApplyOperatorDslCommand,
  ApplyWorkflowDslCommand,
  ApplyWorkflowPlanCommand,
  AnalyzePipelineRequirementResult,
  ConfigureInputOperatorCommand,
  ConfigureOutputOperatorCommand,
  CreateRawTableCommand,
  CreateRawTableWithProcessingStrategyCommand,
  CreateResultTableCommand,
  CreatePipelineCommand,
  ExportWorkflowDslCommand,
  GenerateRawTableNormalizerDraftCommand,
  GeneratePipelineFromRequirementCommand,
  GeneratePipelineFromRequirementResult,
  GetRunResultCommand,
  GetPipelineWorkflowCommand,
  GetWorkflowCapabilityManifestCommand,
  ImportCloudTableCommand,
  ListCloudProjectsCommand,
  ListCloudSpacesCommand,
  ListCloudTablesCommand,
  ListRawTableNormalizerVersionsCommand,
  ListRawTablesInput,
  PreviewTableCommand,
  PreviewRawTableNormalizerVersionCommand,
  PublishRawTableNormalizerVersionCommand,
  RunPipelineCommand,
  RunPipelineResult,
  SummarizeRawTableSourceCommand,
  UpdateRawTableCommand,
  UpdateResultTableCommand,
  UpdatePipelineCommand,
  UploadDataTableToCloudCommand,
  WorkflowNodeRunStat,
} from './data-command-types';
import type {
  AnalyzeDataPipelineRequirementToolInput,
  DataToolExecutionContext,
  DataToolPromptContext,
  DataToolResult,
  GenerateDataPipelineFromAnalysisToolInput,
} from './data-tool-types';
import { DataCommandError } from './data-command-types';
import type {
  RequirementAnalysisReceipt,
  RequirementAnalysisReceiptStore,
} from './requirement-analysis-receipt-store';
import { AI_JFLOW_RUNTIME_PROFILE_VERSION } from './workflow/jflow-capability-profile';
import { hashColumns, normalizeColumnSnapshot } from './workflow';
import { getWorkflowDslReference, type DataDslReferenceTopic } from './data-dsl-reference';
import { sliceWorkflowCapabilityManifest } from './workflow/workflow-capability-manifest';
import { createDataResourceHref, type DataResourceKind } from '../../shared/data-resource-link';
import { dataFieldTypeLabel } from '../../shared/data-field-types';
import type {
  DataPipeline,
  DataRawTable,
  DataRawTablePreview,
  DataResultTable,
  DataPipelineWorkflow,
} from '../../shared/contracts';
import type {
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../../shared/personal-analysis-types';
import { TOOL_RESULT_GUIDANCE } from '../prompts/tool-copy';

/** Resources confirmed during a session — reused across turns so resolved ids do not need re-listing. */
const SESSION_RESOURCE_KINDS = ['RawTable', 'ResultTable', 'Pipeline'] as const;
const SESSION_RESOURCE_LIMIT = 8;

interface SessionResourceEntry {
  name?: string;
  /**
   * true only when the resource was explicitly referenced by id in tool params
   * or confirmed as the single subject of a tool result. Entries that merely
   * appeared inside a list result stay candidates — listing A/B/C must not
   * silently select C as the current resource.
   */
  selected: boolean;
}

interface SessionResourceLedger {
  RawTable: Map<string, SessionResourceEntry>;
  ResultTable: Map<string, SessionResourceEntry>;
  Pipeline: Map<string, SessionResourceEntry>;
  current: Partial<Record<(typeof SESSION_RESOURCE_KINDS)[number], { id: string; name?: string }>>;
}

export class DataToolService {
  private readonly generationInFlight = new Map<string, Promise<DataToolResult>>();
  private readonly executionContexts = new Map<
    string,
    Omit<DataToolExecutionContext, 'toolCallId' | 'signal' | 'onActivity'>
  >();
  private readonly sessionResources = new Map<string, SessionResourceLedger>();

  constructor(
    private readonly commandService: DataCommandService,
    private readonly analysisReceipts: RequirementAnalysisReceiptStore
  ) {}

  updateExecutionContext(
    context: Omit<DataToolExecutionContext, 'toolCallId' | 'signal' | 'onActivity'>
  ): void {
    this.executionContexts.set(context.sessionId, context);
  }

  resolveExecutionContext(
    sessionId: string,
    toolCallId?: string,
    signal?: AbortSignal
  ): DataToolExecutionContext {
    return {
      ...(this.executionContexts.get(sessionId) ?? { sessionId }),
      sessionId,
      toolCallId,
      signal,
    };
  }

  clearConversationContext(sessionId: string): void {
    this.executionContexts.delete(sessionId);
    this.analysisReceipts.deleteForSession(sessionId);
    this.sessionResources.delete(sessionId);
  }

  hasSupportedAnalysis(sessionId: string): boolean {
    return this.analysisReceipts.hasSupportedForSession(sessionId);
  }

  hasPendingAnalysis(sessionId: string): boolean {
    return this.analysisReceipts.hasPendingForSession(sessionId);
  }

  /**
   * Record resource ids the model already resolved (tool params) or the
   * backend confirmed (result details). Later turns reuse these ids directly;
   * the server still re-validates existence and permissions at execution time.
   */
  rememberResolvedResources(
    sessionId: string | undefined,
    toolName: string,
    params: unknown,
    details: unknown
  ): void {
    if (!sessionId) return;
    const ledger = this.sessionResources.get(sessionId) ?? {
      RawTable: new Map<string, SessionResourceEntry>(),
      ResultTable: new Map<string, SessionResourceEntry>(),
      Pipeline: new Map<string, SessionResourceEntry>(),
      current: {},
    };
    this.sessionResources.set(sessionId, ledger);

    // `listed` marks candidates that only appeared in a list result — they are
    // surfaced as choices but never become the current selected resource.
    const remember = (
      kind: (typeof SESSION_RESOURCE_KINDS)[number],
      id: unknown,
      name?: unknown,
      listed = false
    ) => {
      if (typeof id !== 'string' || !id) return;
      const bucket = ledger[kind];
      const previous = bucket.get(id);
      bucket.delete(id);
      bucket.set(id, {
        name: typeof name === 'string' && name ? name : previous?.name,
        selected: previous?.selected === true || !listed,
      });
      // List order and candidate eviction must never change the current selection.
      if (!listed) ledger.current[kind] = { id, name: bucket.get(id)?.name };
      else if (ledger.current[kind]?.id === id) ledger.current[kind]!.name = bucket.get(id)?.name;
      while (bucket.size > SESSION_RESOURCE_LIMIT) {
        bucket.delete(bucket.keys().next().value as string);
      }
    };

    const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
    remember('Pipeline', record.pipelineId);
    remember('RawTable', record.rawTableId);
    remember('ResultTable', record.resultTableId);
    if (typeof record.id === 'string') {
      if (record.tableKind === 'raw' || toolName.includes('raw_table'))
        remember('RawTable', record.id);
      else if (record.tableKind === 'result' || toolName.includes('result_table'))
        remember('ResultTable', record.id);
      else if (toolName.includes('pipeline')) remember('Pipeline', record.id);
    }
    for (const id of Object.values(
      (record.inputResources as Record<string, unknown> | undefined) ?? {}
    )) {
      remember('RawTable', id);
    }

    if (details && typeof details === 'object') {
      const d = details as Record<string, unknown>;
      const entity = (value: unknown): { id?: unknown; name?: unknown } =>
        value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const pipeline = entity(
        d.pipeline ?? (d.workflow as Record<string, unknown> | undefined)?.pipeline
      );
      const rawTable = entity(d.rawTable);
      const resultTable = entity(d.resultTable);
      remember('ResultTable', d.resultTableId);
      remember('Pipeline', pipeline.id, pipeline.name);
      remember('RawTable', rawTable.id, rawTable.name);
      remember('ResultTable', resultTable.id, resultTable.name);
      const lists: Array<[(typeof SESSION_RESOURCE_KINDS)[number], unknown]> = [
        ['RawTable', d.rawTables],
        ['ResultTable', d.resultTables],
        ['Pipeline', d.pipelines],
      ];
      for (const [kind, list] of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list.slice(0, 3)) {
          const entry = entity(item);
          remember(kind, entry.id, entry.name, true);
        }
      }
    }
  }

  async resolveConversationContext(
    context: BeforeSessionRunContext
  ): Promise<DataToolPromptContext> {
    if (!this.sessionResources.has(context.session.id)) {
      for (const message of context.existingMessages) {
        if (message.role !== 'assistant') continue;
        for (const block of message.content) {
          if (block.type !== 'tool_result' || block.isError || !block.dataPipelineCompletion)
            continue;
          const result = block.dataPipelineCompletion.result;
          this.rememberResolvedResources(
            context.session.id,
            'data_generate_pipeline_from_requirement',
            {},
            {
              pipeline: { id: result.pipelineId, name: result.pipelineName },
              resultTable: { id: result.resultTableId, name: result.resultTableName },
            }
          );
        }
      }
    }
    const authoringRequest = pendingDataPipelineRequest(context.existingMessages);
    const ledger = this.sessionResources.get(context.session.id);
    const latest = (kind: (typeof SESSION_RESOURCE_KINDS)[number]) => ledger?.current[kind];
    const selectedIds = new Set(
      (['Pipeline', 'RawTable', 'ResultTable'] as const)
        .map((kind) => latest(kind)?.id)
        .filter(Boolean) as string[]
    );
    const recentResources = ledger
      ? SESSION_RESOURCE_KINDS.flatMap((kind) =>
          [...ledger[kind].entries()]
            .filter(([id]) => !selectedIds.has(id))
            .slice(-3)
            .map(([id, entry]) => ({ kind, id, name: entry.name, listed: !entry.selected }))
        ).slice(-6)
      : [];
    const attachedCloudTables = [...context.existingMessages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.content.filter((block) => block.type === 'cloud_table_attachment')
      .flatMap((block) =>
        block.tables.map((table) => ({ id: table.tableId, name: table.tableName }))
      )
      .slice(0, 4);
    const selectedPipeline = latest('Pipeline');
    const selectedInput = latest('RawTable');
    const selectedOutput = latest('ResultTable');
    return {
      sessionId: context.session.id,
      workspacePath: context.session.cwd,
      authoringRequest,
      selectedDataPipelineId: authoringRequest?.reusePipelineId ?? selectedPipeline?.id,
      selectedDataPipelineName: selectedPipeline?.name,
      selectedRawTableId: authoringRequest?.source.tableId ?? selectedInput?.id,
      selectedRawTableName: selectedInput?.name,
      selectedResultTableId: selectedOutput?.id,
      selectedResultTableName: selectedOutput?.name,
      recentResources,
      attachedCloudTables,
      capabilities: {
        canCreateRawTable: true,
        canCreateResultTable: true,
        canCreatePipeline: true,
        canRunPipeline: true,
        canImportLocalFiles: true,
      },
    };
  }

  async listRawTables(input: ListRawTablesInput): Promise<DataToolResult> {
    const result = await this.commandService.listRawTables(input);
    const lines = formatList(result.rawTables, formatRawTable);
    return toolResult(
      lines.length
        ? `Found ${result.rawTables.length} of ${result.total} input table(s):\n${lines.join('\n')}`
        : 'No input tables found.',
      result
    );
  }

  async getWorkflowDslReference(
    input: {
      topic?: DataDslReferenceTopic;
    } = {}
  ): Promise<DataToolResult> {
    const topic = input.topic ?? 'all';
    const text = getWorkflowDslReference(topic);
    return toolResult(text, { topic, text });
  }

  async createRawTable(input: CreateRawTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.createRawTable(input);
    return toolResult(
      [`Created input table: ${formatRawTable(result.rawTable)}`, formatPreview(result.preview)]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async createRawTableWithProcessingStrategy(
    input: CreateRawTableWithProcessingStrategyCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.createRawTableWithProcessingStrategy(input);
    const normalizer = result.normalizer
      ? [
          `Normalizer: artifact=${result.normalizer.artifact.id} version=${result.normalizer.publishedVersion.id} status=${result.normalizer.publishedVersion.status}`,
          formatPreview(result.normalizer.preview),
        ]
          .filter(Boolean)
          .join('\n')
      : '';
    return toolResult(
      [
        `Created input table with ${result.processingStrategy} processing: ${formatRawTable(result.rawTable)}`,
        normalizer,
        formatPreview(result.preview),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async updateRawTable(input: UpdateRawTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.updateRawTable(input);
    return toolResult(
      [`Updated input table: ${formatRawTable(result.rawTable)}`, formatPreview(result.preview)]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async summarizeRawTableSource(input: SummarizeRawTableSourceCommand): Promise<DataToolResult> {
    const result = await this.commandService.summarizeRawTableSource(input);
    return toolResult(formatRawTableSourceSummary(result.summary), result);
  }

  async generateRawTableNormalizerDraft(
    input: GenerateRawTableNormalizerDraftCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.generateRawTableNormalizerDraft(input);
    return toolResult(
      [
        `Generated normalizer draft: artifact=${result.artifact.id} version=${result.version.id} language=${result.artifact.primaryLanguage}`,
        `Source summary hash=${result.summary.hash} files=${result.summary.sampledFileCount}/${result.summary.fileCount}`,
        `Project files:\n${result.version.files.map((file) => `- ${file.path}`).join('\n')}`,
      ].join('\n'),
      result
    );
  }

  async listResultTables(input: ListRawTablesInput): Promise<DataToolResult> {
    const result = await this.commandService.listResultTables(input);
    const lines = formatList(result.resultTables, formatResultTable);
    return toolResult(
      lines.length
        ? `Found ${result.resultTables.length} of ${result.total} output table(s):\n${lines.join('\n')}`
        : 'No output tables found.',
      result
    );
  }

  async createResultTable(input: CreateResultTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.createResultTable(input);
    return toolResult(
      [
        `Created output table: ${formatResultTable(result.resultTable)}`,
        formatPreview(result.preview),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async updateResultTable(input: UpdateResultTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.updateResultTable(input);
    return toolResult(
      [
        `Updated output table: ${formatResultTable(result.resultTable)}`,
        formatPreview(result.preview),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async previewTable(
    input: PreviewTableCommand & { includeRows?: boolean }
  ): Promise<DataToolResult> {
    const { includeRows = false, ...requestedCommand } = input;
    const command = includeRows ? requestedCommand : { ...requestedCommand, limit: 1 };
    const result = await this.commandService.previewTable(command);
    return toolResult(
      `Previewed ${input.tableKind} table ${input.id}.\n\n${formatPreview(
        result.preview,
        includeRows,
        { tableKind: input.tableKind, id: input.id }
      )}`,
      result
    );
  }

  async listCloudSpaces(input: ListCloudSpacesCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudSpaces(input);
    const lines = formatList(result.spaces, formatCloudSpace);
    return toolResult(
      lines.length
        ? `Found ${result.spaces.length} cloud space(s):\n${lines.join('\n')}`
        : 'No cloud spaces found.',
      result
    );
  }

  async listCloudProjects(input: ListCloudProjectsCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudProjects(input);
    const lines = formatList(result.projects, formatCloudProject);
    return toolResult(
      lines.length
        ? `Found ${result.projects.length} cloud project(s):\n${lines.join('\n')}`
        : 'No cloud projects found.',
      result
    );
  }

  async listCloudTables(input: ListCloudTablesCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudTables(input);
    const lines = formatList(result.tables, formatCloudTable);
    return toolResult(
      lines.length
        ? `Found ${result.tables.length} cloud table(s) on page ${result.page} of ${result.total} total:\n${lines.join('\n')}`
        : 'No cloud tables found.',
      result
    );
  }

  async importCloudRawTable(input: ImportCloudTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.importCloudRawTable(input);
    return toolResult(
      [
        `Imported cloud table ${result.cloudTableId} as input table: ${formatRawTable(result.rawTable)}`,
        result.cloudTable ? `Cloud source: ${formatCloudTable(result.cloudTable)}` : '',
        formatPreview(result.preview),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async uploadDataTableToCloud(input: UploadDataTableToCloudCommand): Promise<DataToolResult> {
    const result = await this.commandService.uploadDataTableToCloud(input);
    return toolResult(
      [
        `Uploaded ${result.sourceTable.tableKind} table ${result.sourceTable.name} (${result.sourceTable.id}) to cloud table ${result.upload.tableId}.`,
        `Rows=${result.sourceTable.rowCount} columns=${result.sourceTable.columnCount} bytes=${result.csvBytes} status=${result.upload.status} importPipelineId=${result.upload.importPipelineId}`,
        result.upload.table ? `Cloud target: ${formatCloudTable(result.upload.table)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      result
    );
  }

  async previewRawTableNormalizerVersion(
    input: PreviewRawTableNormalizerVersionCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.previewRawTableNormalizerVersion(input);
    return toolResult(
      `Previewed normalizer version ${input.versionId}.\n\n${formatPreview(result.preview)}`,
      result
    );
  }

  async publishRawTableNormalizerVersion(
    input: PublishRawTableNormalizerVersionCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.publishRawTableNormalizerVersion(input);
    return toolResult(
      `Published normalizer version: artifact=${result.artifact.id} version=${result.version.id}`,
      result
    );
  }

  async listRawTableNormalizerVersions(
    input: ListRawTableNormalizerVersionsCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.listRawTableNormalizerVersions(input);
    const lines = formatList(
      result.versions,
      (version) =>
        `- v${version.version} id=${version.id} status=${version.status} files=${version.files.length} updatedAt=${version.updatedAt}`
    );
    return toolResult(
      lines.length ? `Normalizer versions:\n${lines.join('\n')}` : 'No normalizer versions found.',
      result
    );
  }

  async listPipelines(input: ListRawTablesInput): Promise<DataToolResult> {
    const result = await this.commandService.listPipelines(input);
    const lines = formatList(result.pipelines, formatPipeline);
    return toolResult(
      lines.length
        ? `Found ${result.pipelines.length} of ${result.total} data pipeline(s):\n${lines.join('\n')}`
        : 'No data pipelines found.',
      result
    );
  }

  async analyzePipelineRequirement(
    input: AnalyzeDataPipelineRequirementToolInput,
    context: DataToolExecutionContext
  ): Promise<DataToolResult> {
    const request = context.authoringRequest ?? {
      id: randomUUID(),
      source: { location: 'local' as const, tableId: input.rawTableId },
      reusePipelineId: input.reusePipelineId,
      startFromNodeId: input.startFromNodeId,
    };
    const result = await this.commandService.analyzePipelineRequirement({
      authoringRequest: request,
      source: request.source,
      reusePipelineId: request.reusePipelineId,
      startFromNodeId: request.startFromNodeId,
      workflow: request.workflow,
      processRequirement: input.processRequirement,
      requirementConversation: context.requirementConversation,
      runtimeConfig: context.runtimeConfig,
      usageTraceId: context.sessionId,
      sourceUserMessageId: context.currentUserMessageId,
      signal: context.signal,
      onActivity: context.onActivity,
    });
    const receipt = this.analysisReceipts.get(result.analysisId);
    if (!receipt) {
      throw new DataCommandError(
        'INTERNAL_ERROR',
        'Requirement analysis receipt is unavailable in the tool generation flow.'
      );
    }
    const clarified = receipt.answersClarification === true && result.status === 'supported';
    return toolResult(formatRequirementAnalysis(receipt.id, result, receipt.expiresAt, clarified), {
      analysisId: receipt.id,
      status: result.status,
      originalRequirement: receipt.processRequirement,
      items: result.items,
      rawTable: {
        id: result.rawTableId,
        name: result.rawTableName,
        schemaHash: result.sourceSummaryHash,
      },
      capabilityProfileVersion: result.capabilityProfileVersion,
      expiresAt: receipt.expiresAt,
      confirmationRequired: !clarified,
    });
  }

  async generatePipelineFromAnalysis(
    input: GenerateDataPipelineFromAnalysisToolInput,
    context: DataToolExecutionContext
  ): Promise<DataToolResult> {
    const generationKey = `${context.sessionId}:${input.analysisId}`;
    const existing = this.generationInFlight.get(generationKey);
    if (existing) return existing;
    const generation = this.generatePipelineFromAnalysisOnce(input, context).finally(() => {
      this.generationInFlight.delete(generationKey);
    });
    this.generationInFlight.set(generationKey, generation);
    return generation;
  }

  private async generatePipelineFromAnalysisOnce(
    input: GenerateDataPipelineFromAnalysisToolInput,
    context: DataToolExecutionContext
  ): Promise<DataToolResult> {
    const receipt = this.analysisReceipts.get(input.analysisId);
    if (!receipt) {
      throw new DataCommandError(
        'ANALYSIS_REQUIRED',
        'Requirement analysis was not found or has expired. Analyze the requirement again.'
      );
    }
    if (receipt.sessionId !== context.sessionId) {
      throw new DataCommandError(
        'ANALYSIS_REQUIRED',
        'Requirement analysis belongs to another conversation.'
      );
    }
    if (receipt.analysis.status !== 'supported') {
      throw new DataCommandError(
        'REQUIREMENT_NOT_SUPPORTED',
        'The requirement must be clarified and analyzed as supported before generation.'
      );
    }
    if (input.confirmed !== true) {
      throw new DataCommandError(
        'CONFIRMATION_REQUIRED',
        'Explicit user confirmation is required before generation.'
      );
    }
    // Answering the clarifying question of an earlier ambiguous analysis is the confirmation:
    // generation may proceed on that same message once the re-analysis is supported.
    const confirmedByClarification =
      receipt.answersClarification === true &&
      Boolean(context.currentUserMessageId) &&
      receipt.sourceUserMessageId === context.currentUserMessageId;
    if (
      !confirmedByClarification &&
      (!receipt.sourceUserMessageId ||
        !context.currentUserMessageId ||
        receipt.sourceUserMessageId === context.currentUserMessageId)
    ) {
      throw new DataCommandError(
        'CONFIRMATION_REQUIRED',
        'A verified later user message is required. Show the analysis to the user and wait for explicit confirmation before generation.'
      );
    }
    if (receipt.capabilityProfileVersion !== AI_JFLOW_RUNTIME_PROFILE_VERSION) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'Data-pipeline capabilities changed after analysis. Analyze the requirement again.'
      );
    }
    const currentPreview = await this.commandService.previewTable({
      tableKind: 'raw',
      id: receipt.rawTableId,
      limit: 1,
    });
    const currentSchemaHash = hashColumns(
      normalizeColumnSnapshot(currentPreview.preview.columnTypes, receipt.analysis.columnsSnapshot)
    );
    if (
      !receipt.authoringRequest.startFromNodeId &&
      currentSchemaHash !== receipt.inputSchemaHash
    ) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'The input table schema changed after analysis. Analyze the requirement again.'
      );
    }
    if (receipt.generatedResult) {
      return formatGeneratedPipelineToolResult(receipt, receipt.generatedResult);
    }
    const request = receipt.authoringRequest;
    const output = request.output ?? resolveGeneratedPipelineOutput(input);

    const result = await this.commandService.generatePipelineFromRequirement({
      source: {
        location: 'local',
        tableId: receipt.rawTableId,
        tableName: receipt.rawTableName,
        columnsSnapshot: receipt.analysis.columnsSnapshot,
      },
      processRequirement: receipt.processRequirement,
      reusePipelineId: request.reusePipelineId,
      startFromNodeId: request.startFromNodeId,
      workflow: request.workflow,
      output,
      pipelineName: input.pipelineName,
      runtimeConfig: context.runtimeConfig,
      usageTraceId: receipt.sessionId,
      analysisId: receipt.id,
      signal: context.signal,
      onActivity: context.onActivity,
      outputConflictPolicy: 'unique',
    });
    this.analysisReceipts.saveGeneratedResult(receipt.id, result);
    return formatGeneratedPipelineToolResult(receipt, result);
  }

  async createPipeline(input: CreatePipelineCommand): Promise<DataToolResult> {
    const result = await this.commandService.createPipeline(input);
    return toolResult(`Created data pipeline: ${formatPipeline(result.pipeline)}`, result);
  }

  async updatePipeline(input: UpdatePipelineCommand): Promise<DataToolResult> {
    const result = await this.commandService.updatePipeline(input);
    return toolResult(`Updated data pipeline: ${formatPipeline(result.pipeline)}`, result);
  }

  async getPipelineWorkflow(input: GetPipelineWorkflowCommand): Promise<DataToolResult> {
    const result = await this.commandService.getPipelineWorkflow(input);
    const view = input.view ?? 'summary';
    if (view === 'node') {
      const node = result.workflow.nodes.find((item) => item.id === input.nodeId);
      if (!node) {
        throw new DataCommandError(
          'RESOURCE_NOT_FOUND',
          `Node ${input.nodeId ?? '(missing)'} not found in pipeline ${input.pipelineId}`
        );
      }
      return toolResult(
        compactJson({
          pipeline: { id: result.workflow.pipeline.id, name: result.workflow.pipeline.name },
          node: { id: node.id, type: node.type, label: node.label, config: node.config },
          edges: result.workflow.edges
            .filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id)
            .map(formatWorkflowEdge),
        }),
        result
      );
    }
    if (view === 'graph') {
      return toolResult(
        compactJson({
          pipeline: { id: result.workflow.pipeline.id, name: result.workflow.pipeline.name },
          nodes: result.workflow.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            label: node.label,
            config: node.config,
          })),
          edges: result.workflow.edges.map(formatWorkflowEdge),
        }),
        result
      );
    }
    return toolResult(formatWorkflow('Read data pipeline workflow', result.workflow), result);
  }

  async applyWorkflowDsl(input: ApplyWorkflowDslCommand): Promise<DataToolResult> {
    const result = await this.commandService.applyWorkflowDsl(input);
    const hasErrors = result.diagnostics?.some((item) => item.severity === 'error') ?? false;
    const prefix = hasErrors
      ? 'Workflow DSL is invalid'
      : result.dryRun
        ? 'Validated workflow DSL'
        : 'Applied workflow DSL';
    return toolResult(
      [formatWorkflow(prefix, result.workflow), formatDiagnostics(result.diagnostics)]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async applyWorkflowPlan(input: ApplyWorkflowPlanCommand): Promise<DataToolResult> {
    const result = await this.commandService.applyWorkflowPlan(input);
    const hasErrors = result.diagnostics?.some((item) => item.severity === 'error') ?? false;
    const prefix = hasErrors
      ? 'Workflow plan is invalid'
      : result.dryRun
        ? 'Validated workflow plan'
        : 'Applied workflow plan';
    return toolResult(
      [
        formatWorkflow(prefix, result.workflow),
        result.dsl ? `Canonical DSL:\n${result.dsl}` : null,
        formatDiagnostics(result.diagnostics),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async getWorkflowCapabilityManifest(
    input: GetWorkflowCapabilityManifestCommand = {}
  ): Promise<DataToolResult> {
    const manifest = await this.commandService.getWorkflowCapabilityManifest(input);
    return toolResult(compactJson(sliceWorkflowCapabilityManifest(manifest, input)), manifest);
  }

  async exportWorkflowDsl(input: ExportWorkflowDslCommand): Promise<DataToolResult> {
    const result = await this.commandService.exportWorkflowDsl(input);
    return toolResult(
      result.text ? `Workflow DSL:\n${result.text}` : 'Workflow has no DSL.',
      result
    );
  }

  async configureInputOperator(input: ConfigureInputOperatorCommand): Promise<DataToolResult> {
    const result = await this.commandService.configureInputOperator(input);
    return toolResult(formatWorkflow('Configured input operator', result.workflow), result);
  }

  async applyOperatorDsl(input: ApplyOperatorDslCommand): Promise<DataToolResult> {
    const result = await this.commandService.applyOperatorDsl(input);
    return toolResult(
      [
        formatWorkflow(
          result.dryRun ? 'Validated operator DSL' : 'Applied operator DSL',
          result.workflow
        ),
        formatDiagnostics(result.diagnostics),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async configureOutputOperator(input: ConfigureOutputOperatorCommand): Promise<DataToolResult> {
    const result = await this.commandService.configureOutputOperator(input);
    return toolResult(formatWorkflow('Configured output operator', result.workflow), result);
  }

  async runPipeline(input: RunPipelineCommand): Promise<DataToolResult> {
    const command = withAgentResultPreviewLimit(input);
    const result = await this.commandService.runPipeline(command);
    return toolResult(
      [
        `Ran data pipeline: ${formatPipeline(result.pipeline)}`,
        formatRunEvidence(input, result),
        formatRunPipelineSafetyNotes(input),
        formatPreview(
          result.preview,
          true,
          input.mode === 'persisted' && result.resultTableId
            ? { tableKind: 'result', id: result.resultTableId }
            : undefined
        ),
        formatNodeStats(result.nodeStats),
        formatDiagnostics(result.diagnostics),
      ]
        .filter(Boolean)
        .join('\n\n'),
      { ...result, mode: input.mode ?? 'temporary', committed: input.mode === 'persisted' }
    );
  }

  async getRunResult(input: GetRunResultCommand): Promise<DataToolResult> {
    const result = await this.commandService.getRunResult(withAgentResultPreviewLimit(input));
    return toolResult(
      [
        `Run result for ${formatPipeline(result.pipeline)}`,
        formatOutputEvidence(result.pipeline, result.preview, result.resultTableId),
        formatPreview(
          result.preview,
          true,
          result.resultTableId ? { tableKind: 'result', id: result.resultTableId } : undefined
        ),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }
}

function toolResult(text: string, details: unknown): DataToolResult {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

function resolveGeneratedPipelineOutput(
  input: GenerateDataPipelineFromAnalysisToolInput
): GeneratePipelineFromRequirementCommand['output'] {
  const resultTableName = input.resultTableName?.trim();
  const resultTableId = input.resultTableId?.trim();
  if (input.outputMode === 'create') {
    if (resultTableId) {
      throw new DataCommandError(
        'INVALID_ARGUMENT',
        'resultTableId must be omitted when outputMode=create. Pass resultTableName for the new table.'
      );
    }
    return {
      location: 'local',
      writeMode: 'create',
      tableName: resultTableName || undefined,
    };
  }
  if (!resultTableId) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'resultTableId is required when outputMode=replace.'
    );
  }
  if (resultTableName) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'resultTableName must be omitted when outputMode=replace. The existing table keeps its current name.'
    );
  }
  return {
    location: 'local',
    writeMode: 'replace',
    targetTableId: resultTableId,
  };
}

function formatRequirementAnalysis(
  analysisId: string,
  result: AnalyzePipelineRequirementResult,
  expiresAt: number,
  clarified = false
): string {
  const items = result.items.map((item, index) => {
    const reason = item.reason ? ` reason=${item.reason}` : '';
    const suggestion = item.suggestedRequirement ? ` suggestion=${item.suggestedRequirement}` : '';
    const operations = item.operations.length ? ` operations=${item.operations.join(',')}` : '';
    return `${index + 1}. [${item.status}] ${item.requirement}${operations}${reason}${suggestion}`;
  });
  const nextStep =
    result.status === 'supported'
      ? clarified
        ? TOOL_RESULT_GUIDANCE.dataAnalysisClarified
        : TOOL_RESULT_GUIDANCE.dataAnalysisSupported
      : result.status === 'needs_confirmation'
        ? TOOL_RESULT_GUIDANCE.dataAnalysisNeedsConfirmation
        : TOOL_RESULT_GUIDANCE.dataAnalysisUnsupported;
  return [
    `Requirement analysis: status=${result.status} analysisId=${analysisId}`,
    `Input table: ${result.rawTableName} (${result.rawTableId})`,
    ...items,
    nextStep,
    `Analysis expires at ${new Date(expiresAt).toISOString()}.`,
  ].join('\n');
}

function formatGeneratedPipelineToolResult(
  receipt: RequirementAnalysisReceipt,
  result: GeneratePipelineFromRequirementResult
): DataToolResult {
  const pipelineLink = formatDataResourceLink('pipeline', result.pipelineId, result.pipelineName);
  const outputLink = formatDataResourceLink(
    'result_table',
    result.resultTableId,
    result.resultTableName
  );
  return toolResult(
    [
      `Generated and validated data pipeline: ${pipelineLink} (${result.pipelineId})`,
      `Input table: ${receipt.rawTableName} (${receipt.rawTableId})`,
      `Output table: ${outputLink} (${result.resultTableId})`,
      `Temporary execution validation passed. Expected output columns=${result.expectedOutputSchema.length}.`,
      TOOL_RESULT_GUIDANCE.dataPipelineSaved,
    ].join('\n'),
    {
      status: 'ready',
      dataPipelineCompletion: {
        requestId: receipt.authoringRequest.id,
        result: { ...result, workflowDsl: undefined },
      },
      analysisId: receipt.id,
      pipeline: {
        id: result.pipelineId,
        name: result.pipelineName,
        href: createDataResourceHref('pipeline', result.pipelineId),
      },
      rawTable: { id: receipt.rawTableId, name: receipt.rawTableName },
      resultTable: {
        id: result.resultTableId,
        name: result.resultTableName,
        href: createDataResourceHref('result_table', result.resultTableId),
      },
      validation: { temporaryRun: 'passed' },
      requiredColumns: result.requiredColumns,
      expectedOutputSchema: result.expectedOutputSchema,
      workflowHash: result.workflowHash,
      version: result.version,
      generatedAt: result.generatedAt,
    }
  );
}

function formatRawTable(table: DataRawTable): string {
  return `- ${formatDataResourceLink('raw_table', table.id, table.name)} (${table.id}) kind=${table.sourceKind} rows=${table.rowCount} columns=${table.columnCount}`;
}

function formatCloudSpace(space: PersonalAnalysisSpace): string {
  return `- ${space.spaceName} (${space.spaceId}) projects=${space.projectCount ?? '?'}`;
}

function formatCloudProject(project: PersonalAnalysisProject): string {
  return `- ${project.projectName} (${project.projectId}) folderId=${project.folderId} tables=${project.tableCount ?? '?'}`;
}

function formatCloudTable(table: PersonalAnalysisTable): string {
  return `- ${table.tableName} (${table.tableId}) projectId=${table.projectId} rows=${table.rowCount ?? '?'} columns=${table.columns?.length ?? '?'}`;
}

function formatRawTableSourceSummary(
  summary: Awaited<ReturnType<DataCommandService['summarizeRawTableSource']>>['summary']
): string {
  const files = summary.files
    .slice(0, 8)
    .map((file) => {
      const shape = file.sheets?.[0]
        ? ` sheets=${file.sheets.length} firstSheet=${file.sheets[0].name} rows~${file.sheets[0].rowCountEstimate} cols~${file.sheets[0].columnCountEstimate}`
        : file.sampleRows
          ? ` sampleRows=${file.sampleRows.length}`
          : '';
      return `- ${file.relativePath} kind=${file.kind} size=${file.sizeBytes}${shape}`;
    })
    .join('\n');
  return [
    `Input source summary: kind=${summary.sourceKind} hash=${summary.hash} files=${summary.sampledFileCount}/${summary.fileCount}`,
    files,
    summary.notes.length ? `Notes:\n${summary.notes.map((note) => `- ${note}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatResultTable(table: DataResultTable): string {
  const source = table.sourceRawTableId ? ` sourceInput=${table.sourceRawTableId}` : '';
  return `- ${formatDataResourceLink('result_table', table.id, table.name)} (${table.id}) table=${table.tableName} rows=${table.rowCount} columns=${table.columnCount}${source}`;
}

function formatPipeline(pipeline: DataPipeline): string {
  const rows = pipeline.rowCount === null ? 'n/a' : pipeline.rowCount;
  const columns = pipeline.columnCount === null ? 'n/a' : pipeline.columnCount;
  return `${formatDataResourceLink('pipeline', pipeline.id, pipeline.name)} (${pipeline.id}) status=${pipeline.status} nodes=${pipeline.nodeCount} rows=${rows} columns=${columns}`;
}

/**
 * Model-visible execution evidence: commit status + output identity, so a
 * successful run does not require a follow-up data_get_run_result round-trip.
 */
function formatRunEvidence(input: RunPipelineCommand, result: RunPipelineResult): string {
  // The executor treats an omitted mode as a temporary validation run — the
  // evidence must say the same thing or the model would trust a phantom commit.
  const persisted = input.mode === 'persisted';
  const lines = [
    `Run: mode=${persisted ? 'persisted' : 'temporary'} commit=${persisted ? 'committed' : 'not_committed (validation only)'}`,
  ];
  const output = formatOutputEvidence(result.pipeline, result.preview, result.resultTableId);
  if (output) lines.push(output);
  return lines.join('\n');
}

function formatOutputEvidence(
  pipeline: DataPipeline,
  preview: DataRawTablePreview | undefined,
  resultTableId?: string
): string {
  const parts: string[] = [];
  if (resultTableId) {
    parts.push(
      `resultTableId=${resultTableId} resultTable=${formatDataResourceLink('result_table', resultTableId, pipeline.resultTable || resultTableId)}`
    );
  } else if (pipeline.resultTable) {
    parts.push(`physicalTableName=${JSON.stringify(pipeline.resultTable)}`);
  }
  if (preview) {
    parts.push(`outputRows=${preview.totalRows}`);
  }
  return parts.length ? `Output: ${parts.join(' ')}` : '';
}

function formatRunPipelineSafetyNotes(input: RunPipelineCommand): string {
  const notes: string[] = [];
  if (input.mode !== 'persisted') {
    notes.push(
      'Temporary run only validates a preview; it does not update reusable output tables. Run mode=persisted and preview the output table before uploading it to cloud.'
    );
  }
  if (input.workflowDsl && input.saveWorkflow !== true) {
    notes.push(
      'The workflowDsl was used only for this run and was not saved to pipeline nodes. Save the workflow before treating this pipeline as reusable.'
    );
  }
  return notes.length ? `Run notes:\n${notes.map((note) => `- ${note}`).join('\n')}` : '';
}

function formatDataResourceLink(kind: DataResourceKind, id: string, label: string): string {
  return `[${escapeMarkdownLinkText(label)}](${createDataResourceHref(kind, id)})`;
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function formatWorkflow(title: string, workflow: DataPipelineWorkflow): string {
  const nodeLines = workflow.nodes.map(formatWorkflowNode);
  return [
    `${title}: ${formatPipeline(workflow.pipeline)}; nodes=${workflow.nodes.length}; edges=${workflow.edges.length}`,
    nodeLines.length ? `Nodes:\n${nodeLines.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function formatWorkflowEdge(edge: DataPipelineWorkflow['edges'][number]) {
  return {
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  };
}

function formatWorkflowNode(node: DataPipelineWorkflow['nodes'][number]): string {
  const config = node.config ?? {};
  const details = [
    typeof config.source === 'string' ? `source=${config.source}` : '',
    typeof config.rawTableId === 'string' ? `rawTableId=${config.rawTableId}` : '',
    typeof config.alias === 'string' ? `alias=${config.alias}` : '',
    typeof config.outputResultTableId === 'string'
      ? `resultTableId=${config.outputResultTableId}`
      : '',
    typeof config.resultTableId === 'string' && config.resultTableId !== config.outputResultTableId
      ? `resultTableId=${config.resultTableId}`
      : '',
    typeof config.table === 'string' ? `table=${config.table}` : '',
  ].filter(Boolean);
  return `- ${node.id} type=${node.type}${details.length ? ` ${details.join(' ')}` : ''}`;
}

/** Full model-readable snapshot. The runner's shared result budget keeps a
 * bounded page and a retrievable reference; never lose fields before that layer. */
function formatPreview(
  preview: DataRawTablePreview | undefined,
  includeRows = true,
  target?: PreviewCoverageTarget
): string {
  if (!preview) return '';
  const types = preview.columnTypes
    .map((column) => `${column.name}: ${dataFieldTypeLabel(column.type)}`)
    .join(', ');
  return [
    `${includeRows ? 'Preview' : 'Table schema'} totalRows=${preview.totalRows} columns=${preview.columns.join(', ') || '(none)'}${types ? ` types=${types}` : ''}`,
    includeRows && preview.rows.length ? JSON.stringify(preview.rows.slice(0, preview.limit)) : '',
    formatPreviewCoverage(preview, includeRows, target),
  ]
    .filter(Boolean)
    .join('\n');
}

function formatList<T>(items: T[], format: (item: T) => string): string[] {
  return items.map(format);
}

function withAgentResultPreviewLimit<T extends { previewRows?: number }>(input: T): T {
  return {
    ...input,
    previewRows: Math.min(
      input.previewRows ?? AGENT_RESULT_PREVIEW_MAX_ROWS,
      AGENT_RESULT_PREVIEW_MAX_ROWS
    ),
  };
}

function formatNodeStats(stats: WorkflowNodeRunStat[] | undefined): string {
  if (!stats?.length) return '';
  const lines = stats
    .slice(0, 12)
    .map((stat) => {
      const parts = [
        `${stat.nodeType}[${stat.nodeId}] ${stat.inputRows ?? '?'} -> ${stat.outputRows}`,
      ];
      if (stat.droppedRows) parts.push(`dropped ${stat.droppedRows}`);
      if (stat.rejectedRows) parts.push(`rejected ${stat.rejectedRows}`);
      return `- ${parts.join(', ')}`;
    })
    .join('\n');
  return `Node stats (in -> out):\n${lines}`;
}

function formatDiagnostics(
  diagnostics: Array<{ severity: string; message: string; code?: string }> | undefined
): string {
  if (!diagnostics?.length) {
    return '';
  }
  return `Diagnostics:\n${diagnostics
    .slice(0, 8)
    .map((item) => `- ${item.severity}: ${item.code ? `${item.code}: ` : ''}${item.message}`)
    .join('\n')}`;
}
