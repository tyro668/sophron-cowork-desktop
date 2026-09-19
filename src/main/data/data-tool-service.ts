import type { BeforeSessionRunContext } from '../extensions/agent-runtime-extension';
import type { DataCommandService } from './data-command-service';
import type {
  ApplyOperatorDslCommand,
  ApplyWorkflowDslCommand,
  ApplyWorkflowPlanCommand,
  AnalyzeTaskRequirementResult,
  ConfigureInputOperatorCommand,
  ConfigureOutputOperatorCommand,
  CreateInputTableCommand,
  CreateInputTableWithProcessingStrategyCommand,
  CreateOutputTableCommand,
  CreateTaskCommand,
  ExportWorkflowDslCommand,
  GenerateInputTableNormalizerDraftCommand,
  GenerateTaskFromRequirementCommand,
  GenerateTaskFromRequirementResult,
  GetRunResultCommand,
  GetTaskWorkflowCommand,
  GetWorkflowCapabilityManifestCommand,
  ImportCloudTableCommand,
  ListCloudProjectsCommand,
  ListCloudSpacesCommand,
  ListCloudTablesCommand,
  ListInputTableNormalizerVersionsCommand,
  ListInputTablesInput,
  PreviewTableCommand,
  PreviewInputTableNormalizerVersionCommand,
  PublishInputTableNormalizerVersionCommand,
  RunTaskCommand,
  RunTaskResult,
  SummarizeInputTableSourceCommand,
  UpdateInputTableCommand,
  UpdateOutputTableCommand,
  UpdateTaskCommand,
  UploadDataTableToCloudCommand,
  WorkflowNodeRunStat,
} from './data-command-types';
import type {
  AnalyzeDataTaskRequirementToolInput,
  DataToolExecutionContext,
  DataToolPromptContext,
  DataToolResult,
  GenerateDataTaskFromAnalysisToolInput,
} from './data-tool-types';
import { DataCommandError } from './data-command-types';
import type {
  RequirementAnalysisReceipt,
  RequirementAnalysisReceiptStore,
} from './requirement-analysis-receipt-store';
import { AI_PREP_DSL_RUNTIME_PROFILE_VERSION } from './workflow/prep-dsl-capability-profile';
import { hashColumns, normalizeColumnSnapshot } from './workflow';
import { getWorkflowDslReference, type DataDslReferenceTopic } from './data-dsl-reference';
import { sliceWorkflowCapabilityManifest } from './workflow/workflow-capability-manifest';
import { createDataResourceHref, type DataResourceKind } from '../../shared/data-resource-link';
import { dataFieldTypeLabel } from '../../shared/data-field-types';
import type {
  DataCleaningTask,
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
  DataTaskWorkflow,
} from '../../shared/contracts';
import type {
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../../shared/personal-analysis-types';
import { TOOL_RESULT_GUIDANCE } from '../prompts/tool-copy';

/** Resources confirmed during a session — reused across turns so resolved ids do not need re-listing. */
const SESSION_RESOURCE_KINDS = ['InputTable', 'OutputTable', 'Task'] as const;
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
  InputTable: Map<string, SessionResourceEntry>;
  OutputTable: Map<string, SessionResourceEntry>;
  Task: Map<string, SessionResourceEntry>;
}

export class DataToolService {
  private readonly generationInFlight = new Map<string, Promise<DataToolResult>>();
  private readonly executionContexts = new Map<
    string,
    Omit<DataToolExecutionContext, 'toolCallId' | 'signal'>
  >();
  private readonly sessionResources = new Map<string, SessionResourceLedger>();

  constructor(
    private readonly commandService: DataCommandService,
    private readonly analysisReceipts: RequirementAnalysisReceiptStore
  ) {}

  updateExecutionContext(context: Omit<DataToolExecutionContext, 'toolCallId' | 'signal'>): void {
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
      InputTable: new Map<string, SessionResourceEntry>(),
      OutputTable: new Map<string, SessionResourceEntry>(),
      Task: new Map<string, SessionResourceEntry>(),
    };
    this.sessionResources.set(sessionId, ledger);

    // `listed` marks candidates that only appeared in a list result — they are
    // surfaced as choices but never become the current selected resource.
    const remember = (
      kind: keyof SessionResourceLedger,
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
      while (bucket.size > SESSION_RESOURCE_LIMIT) {
        bucket.delete(bucket.keys().next().value as string);
      }
    };

    const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
    remember('Task', record.taskId);
    remember('InputTable', record.inputTableId);
    remember('OutputTable', record.outputTableId);
    if (typeof record.id === 'string') {
      if (record.tableKind === 'input' || toolName.includes('input_table'))
        remember('InputTable', record.id);
      else if (record.tableKind === 'output' || toolName.includes('output_table'))
        remember('OutputTable', record.id);
      else if (toolName.includes('task')) remember('Task', record.id);
    }
    for (const id of Object.values(
      (record.inputResources as Record<string, unknown> | undefined) ?? {}
    )) {
      remember('InputTable', id);
    }

    if (details && typeof details === 'object') {
      const d = details as Record<string, unknown>;
      const entity = (value: unknown): { id?: unknown; name?: unknown } =>
        value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const task = entity(d.task ?? (d.workflow as Record<string, unknown> | undefined)?.task);
      const inputTable = entity(d.inputTable);
      const outputTable = entity(d.outputTable);
      remember('Task', task.id, task.name);
      remember('InputTable', inputTable.id, inputTable.name);
      remember('OutputTable', outputTable.id, outputTable.name);
      const lists: Array<[keyof SessionResourceLedger, unknown]> = [
        ['InputTable', d.inputTables],
        ['OutputTable', d.outputTables],
        ['Task', d.tasks],
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
    const ledger = this.sessionResources.get(context.session.id);
    const latest = (kind: keyof SessionResourceLedger) => {
      const entries = ledger ? [...ledger[kind].entries()] : [];
      const last = entries.filter(([, entry]) => entry.selected).pop();
      return last ? { id: last[0], name: last[1].name } : undefined;
    };
    const selectedIds = new Set(
      (['Task', 'InputTable', 'OutputTable'] as const)
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
    const selectedTask = latest('Task');
    const selectedInput = latest('InputTable');
    const selectedOutput = latest('OutputTable');
    return {
      sessionId: context.session.id,
      workspacePath: context.session.cwd,
      selectedDataTaskId: selectedTask?.id,
      selectedDataTaskName: selectedTask?.name,
      selectedInputTableId: selectedInput?.id,
      selectedInputTableName: selectedInput?.name,
      selectedOutputTableId: selectedOutput?.id,
      selectedOutputTableName: selectedOutput?.name,
      recentResources,
      attachedCloudTables,
      capabilities: {
        canCreateInputTable: true,
        canCreateOutputTable: true,
        canCreateTask: true,
        canRunTask: true,
        canImportLocalFiles: true,
      },
    };
  }

  async listInputTables(input: ListInputTablesInput): Promise<DataToolResult> {
    const result = await this.commandService.listInputTables(input);
    const lines = formatBoundedList(result.inputTables, formatInputTable);
    return toolResult(
      lines.length
        ? `Found ${result.inputTables.length} of ${result.total} input table(s):\n${lines.join('\n')}`
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

  async createInputTable(input: CreateInputTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.createInputTable(input);
    return toolResult(
      [`Created input table: ${formatInputTable(result.inputTable)}`, formatPreview(result.preview)]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async createInputTableWithProcessingStrategy(
    input: CreateInputTableWithProcessingStrategyCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.createInputTableWithProcessingStrategy(input);
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
        `Created input table with ${result.processingStrategy} processing: ${formatInputTable(result.inputTable)}`,
        normalizer,
        formatPreview(result.preview),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async updateInputTable(input: UpdateInputTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.updateInputTable(input);
    return toolResult(
      [`Updated input table: ${formatInputTable(result.inputTable)}`, formatPreview(result.preview)]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async summarizeInputTableSource(
    input: SummarizeInputTableSourceCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.summarizeInputTableSource(input);
    return toolResult(formatInputTableSourceSummary(result.summary), result);
  }

  async generateInputTableNormalizerDraft(
    input: GenerateInputTableNormalizerDraftCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.generateInputTableNormalizerDraft(input);
    return toolResult(
      [
        `Generated normalizer draft: artifact=${result.artifact.id} version=${result.version.id} language=${result.artifact.primaryLanguage}`,
        `Source summary hash=${result.summary.hash} files=${result.summary.sampledFileCount}/${result.summary.fileCount}`,
        `Project files:\n${result.version.files.map((file) => `- ${file.path}`).join('\n')}`,
      ].join('\n'),
      result
    );
  }

  async listOutputTables(input: ListInputTablesInput): Promise<DataToolResult> {
    const result = await this.commandService.listOutputTables(input);
    const lines = formatBoundedList(result.outputTables, formatOutputTable);
    return toolResult(
      lines.length
        ? `Found ${result.outputTables.length} of ${result.total} output table(s):\n${lines.join('\n')}`
        : 'No output tables found.',
      result
    );
  }

  async createOutputTable(input: CreateOutputTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.createOutputTable(input);
    return toolResult(
      [
        `Created output table: ${formatOutputTable(result.outputTable)}`,
        formatPreview(result.preview),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async updateOutputTable(input: UpdateOutputTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.updateOutputTable(input);
    return toolResult(
      [
        `Updated output table: ${formatOutputTable(result.outputTable)}`,
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
        includeRows
      )}`,
      result
    );
  }

  async listCloudSpaces(input: ListCloudSpacesCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudSpaces(input);
    const lines = formatBoundedList(result.spaces, formatCloudSpace);
    return toolResult(
      lines.length
        ? `Found ${result.spaces.length} cloud space(s):\n${lines.join('\n')}`
        : 'No cloud spaces found.',
      result
    );
  }

  async listCloudProjects(input: ListCloudProjectsCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudProjects(input);
    const lines = formatBoundedList(result.projects, formatCloudProject);
    return toolResult(
      lines.length
        ? `Found ${result.projects.length} cloud project(s):\n${lines.join('\n')}`
        : 'No cloud projects found.',
      result
    );
  }

  async listCloudTables(input: ListCloudTablesCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudTables(input);
    const lines = formatBoundedList(result.tables, formatCloudTable);
    return toolResult(
      lines.length
        ? `Found ${result.tables.length} cloud table(s) on page ${result.page} of ${result.total} total:\n${lines.join('\n')}`
        : 'No cloud tables found.',
      result
    );
  }

  async importCloudTable(input: ImportCloudTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.importCloudTable(input);
    return toolResult(
      [
        `Imported cloud table ${result.cloudTableId} as input table: ${formatInputTable(result.inputTable)}`,
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
        `Rows=${result.sourceTable.rowCount} columns=${result.sourceTable.columnCount} bytes=${result.csvBytes} status=${result.upload.status} importTaskId=${result.upload.importTaskId}`,
        result.upload.table ? `Cloud target: ${formatCloudTable(result.upload.table)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      result
    );
  }

  async previewInputTableNormalizerVersion(
    input: PreviewInputTableNormalizerVersionCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.previewInputTableNormalizerVersion(input);
    return toolResult(
      `Previewed normalizer version ${input.versionId}.\n\n${formatPreview(result.preview)}`,
      result
    );
  }

  async publishInputTableNormalizerVersion(
    input: PublishInputTableNormalizerVersionCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.publishInputTableNormalizerVersion(input);
    return toolResult(
      `Published normalizer version: artifact=${result.artifact.id} version=${result.version.id}`,
      result
    );
  }

  async listInputTableNormalizerVersions(
    input: ListInputTableNormalizerVersionsCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.listInputTableNormalizerVersions(input);
    const lines = formatBoundedList(
      result.versions,
      (version) =>
        `- v${version.version} id=${version.id} status=${version.status} files=${version.files.length} updatedAt=${version.updatedAt}`
    );
    return toolResult(
      lines.length ? `Normalizer versions:\n${lines.join('\n')}` : 'No normalizer versions found.',
      result
    );
  }

  async listTasks(input: ListInputTablesInput): Promise<DataToolResult> {
    const result = await this.commandService.listTasks(input);
    const lines = formatBoundedList(result.tasks, formatTask);
    return toolResult(
      lines.length
        ? `Found ${result.tasks.length} of ${result.total} data task(s):\n${lines.join('\n')}`
        : 'No data tasks found.',
      result
    );
  }

  async analyzeTaskRequirement(
    input: AnalyzeDataTaskRequirementToolInput,
    context: DataToolExecutionContext
  ): Promise<DataToolResult> {
    const result = await this.commandService.analyzeTaskRequirement({
      source: { location: 'local', tableId: input.inputTableId },
      processRequirement: input.processRequirement,
      runtimeConfig: context.runtimeConfig,
      usageTraceId: context.sessionId,
      sourceUserMessageId: context.currentUserMessageId,
      signal: context.signal,
    });
    const receipt = this.analysisReceipts.get(result.analysisId);
    if (!receipt) {
      throw new DataCommandError(
        'INTERNAL_ERROR',
        'Requirement analysis receipt is unavailable in the tool generation flow.'
      );
    }
    return toolResult(formatRequirementAnalysis(receipt.id, result, receipt.expiresAt), {
      analysisId: receipt.id,
      status: result.status,
      originalRequirement: receipt.processRequirement,
      items: result.items,
      inputTable: {
        id: result.inputTableId,
        name: result.inputTableName,
        schemaHash: result.sourceSummaryHash,
      },
      capabilityProfileVersion: result.capabilityProfileVersion,
      expiresAt: receipt.expiresAt,
      confirmationRequired: true,
    });
  }

  async generateTaskFromAnalysis(
    input: GenerateDataTaskFromAnalysisToolInput,
    context: DataToolExecutionContext
  ): Promise<DataToolResult> {
    const generationKey = `${context.sessionId}:${input.analysisId}`;
    const existing = this.generationInFlight.get(generationKey);
    if (existing) return existing;
    const generation = this.generateTaskFromAnalysisOnce(input, context).finally(() => {
      this.generationInFlight.delete(generationKey);
    });
    this.generationInFlight.set(generationKey, generation);
    return generation;
  }

  private async generateTaskFromAnalysisOnce(
    input: GenerateDataTaskFromAnalysisToolInput,
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
    if (
      !receipt.sourceUserMessageId ||
      !context.currentUserMessageId ||
      receipt.sourceUserMessageId === context.currentUserMessageId
    ) {
      throw new DataCommandError(
        'CONFIRMATION_REQUIRED',
        'A verified later user message is required. Show the analysis to the user and wait for explicit confirmation before generation.'
      );
    }
    if (receipt.capabilityProfileVersion !== AI_PREP_DSL_RUNTIME_PROFILE_VERSION) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'Data-task capabilities changed after analysis. Analyze the requirement again.'
      );
    }
    const currentPreview = await this.commandService.previewTable({
      tableKind: 'input',
      id: receipt.inputTableId,
      limit: 1,
    });
    const currentSchemaHash = hashColumns(
      normalizeColumnSnapshot(currentPreview.preview.columnTypes, receipt.analysis.columnsSnapshot)
    );
    if (currentSchemaHash !== receipt.inputSchemaHash) {
      throw new DataCommandError(
        'ANALYSIS_STALE',
        'The input table schema changed after analysis. Analyze the requirement again.'
      );
    }
    if (receipt.generatedResult) {
      return formatGeneratedTaskToolResult(receipt, receipt.generatedResult);
    }
    const output = resolveGeneratedTaskOutput(input);

    const result = await this.commandService.generateTaskFromRequirement({
      source: {
        location: 'local',
        tableId: receipt.inputTableId,
        tableName: receipt.inputTableName,
        columnsSnapshot: receipt.analysis.columnsSnapshot,
      },
      processRequirement: receipt.processRequirement,
      output,
      taskName: input.taskName,
      runtimeConfig: context.runtimeConfig,
      usageTraceId: receipt.sessionId,
      analysisId: receipt.id,
      signal: context.signal,
      outputConflictPolicy: 'unique',
    });
    this.analysisReceipts.saveGeneratedResult(receipt.id, result);
    return formatGeneratedTaskToolResult(receipt, result);
  }

  async createTask(input: CreateTaskCommand): Promise<DataToolResult> {
    const result = await this.commandService.createTask(input);
    return toolResult(`Created data task: ${formatTask(result.task)}`, result);
  }

  async updateTask(input: UpdateTaskCommand): Promise<DataToolResult> {
    const result = await this.commandService.updateTask(input);
    return toolResult(`Updated data task: ${formatTask(result.task)}`, result);
  }

  async getTaskWorkflow(input: GetTaskWorkflowCommand): Promise<DataToolResult> {
    const result = await this.commandService.getTaskWorkflow(input);
    const view = input.view ?? 'summary';
    if (view === 'node') {
      const node = result.workflow.nodes.find((item) => item.id === input.nodeId);
      if (!node) {
        throw new DataCommandError(
          'RESOURCE_NOT_FOUND',
          `Node ${input.nodeId ?? '(missing)'} not found in task ${input.taskId}`
        );
      }
      return toolResult(
        compactJson({
          task: { id: result.workflow.task.id, name: result.workflow.task.name },
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
          task: { id: result.workflow.task.id, name: result.workflow.task.name },
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
    return toolResult(formatWorkflow('Read data task workflow', result.workflow), result);
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

  async runTask(input: RunTaskCommand): Promise<DataToolResult> {
    const command = withAgentResultPreviewLimit(input);
    const result = await this.commandService.runTask(command);
    return toolResult(
      [
        `Ran data task: ${formatTask(result.task)}`,
        formatRunEvidence(input, result),
        formatRunTaskSafetyNotes(input),
        formatPreview(result.preview),
        formatNodeStats(result.nodeStats),
        formatDiagnostics(result.diagnostics),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async getRunResult(input: GetRunResultCommand): Promise<DataToolResult> {
    const result = await this.commandService.getRunResult(withAgentResultPreviewLimit(input));
    return toolResult(
      [
        `Run result for ${formatTask(result.task)}`,
        formatOutputEvidence(result.task, result.preview),
        formatPreview(result.preview),
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

function resolveGeneratedTaskOutput(
  input: GenerateDataTaskFromAnalysisToolInput
): GenerateTaskFromRequirementCommand['output'] {
  const outputTableName = input.outputTableName?.trim();
  const outputTableId = input.outputTableId?.trim();
  if (input.outputMode === 'create') {
    if (outputTableId) {
      throw new DataCommandError(
        'INVALID_ARGUMENT',
        'outputTableId must be omitted when outputMode=create. Pass outputTableName for the new table.'
      );
    }
    return {
      location: 'local',
      writeMode: 'create',
      tableName: outputTableName || undefined,
    };
  }
  if (!outputTableId) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'outputTableId is required when outputMode=replace.'
    );
  }
  if (outputTableName) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'outputTableName must be omitted when outputMode=replace. The existing table keeps its current name.'
    );
  }
  return {
    location: 'local',
    writeMode: 'replace',
    targetTableId: outputTableId,
  };
}

function formatRequirementAnalysis(
  analysisId: string,
  result: AnalyzeTaskRequirementResult,
  expiresAt: number
): string {
  const items = result.items.map((item, index) => {
    const reason = item.reason ? ` reason=${item.reason}` : '';
    const suggestion = item.suggestedRequirement ? ` suggestion=${item.suggestedRequirement}` : '';
    const operations = item.operations.length ? ` operations=${item.operations.join(',')}` : '';
    return `${index + 1}. [${item.status}] ${item.requirement}${operations}${reason}${suggestion}`;
  });
  const nextStep =
    result.status === 'supported'
      ? TOOL_RESULT_GUIDANCE.dataAnalysisSupported
      : result.status === 'needs_confirmation'
        ? TOOL_RESULT_GUIDANCE.dataAnalysisNeedsConfirmation
        : TOOL_RESULT_GUIDANCE.dataAnalysisUnsupported;
  return [
    `Requirement analysis: status=${result.status} analysisId=${analysisId}`,
    `Input table: ${result.inputTableName} (${result.inputTableId})`,
    ...items,
    nextStep,
    `Analysis expires at ${new Date(expiresAt).toISOString()}.`,
  ].join('\n');
}

function formatGeneratedTaskToolResult(
  receipt: RequirementAnalysisReceipt,
  result: GenerateTaskFromRequirementResult
): DataToolResult {
  const taskLink = formatDataResourceLink('task', result.taskId, result.taskName);
  const outputLink = formatDataResourceLink(
    'output_table',
    result.outputTableId,
    result.outputTableName
  );
  return toolResult(
    [
      `Generated and validated data task: ${taskLink} (${result.taskId})`,
      `Input table: ${receipt.inputTableName} (${receipt.inputTableId})`,
      `Output table: ${outputLink} (${result.outputTableId})`,
      `Temporary execution validation passed. Expected output columns=${result.expectedOutputSchema.length}.`,
      TOOL_RESULT_GUIDANCE.dataTaskSaved,
    ].join('\n'),
    {
      status: 'ready',
      analysisId: receipt.id,
      task: {
        id: result.taskId,
        name: result.taskName,
        href: createDataResourceHref('task', result.taskId),
      },
      inputTable: { id: receipt.inputTableId, name: receipt.inputTableName },
      outputTable: {
        id: result.outputTableId,
        name: result.outputTableName,
        href: createDataResourceHref('output_table', result.outputTableId),
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

function formatInputTable(table: DataDataset): string {
  return `- ${formatDataResourceLink('input_table', table.id, table.name)} (${table.id}) kind=${table.sourceKind} rows=${table.rowCount} columns=${table.columnCount}`;
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

function formatInputTableSourceSummary(
  summary: Awaited<ReturnType<DataCommandService['summarizeInputTableSource']>>['summary']
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

function formatOutputTable(table: DataOutputTable): string {
  const source = table.sourceDatasetId ? ` sourceInput=${table.sourceDatasetId}` : '';
  return `- ${formatDataResourceLink('output_table', table.id, table.name)} (${table.id}) table=${table.tableName} rows=${table.rowCount} columns=${table.columnCount}${source}`;
}

function formatTask(task: DataCleaningTask): string {
  const rows = task.rowCount === null ? 'n/a' : task.rowCount;
  const columns = task.columnCount === null ? 'n/a' : task.columnCount;
  return `${formatDataResourceLink('task', task.id, task.name)} (${task.id}) status=${task.status} nodes=${task.nodeCount} rows=${rows} columns=${columns}`;
}

/**
 * Model-visible execution evidence: commit status + output identity, so a
 * successful run does not require a follow-up data_get_run_result round-trip.
 */
function formatRunEvidence(input: RunTaskCommand, result: RunTaskResult): string {
  // The executor treats an omitted mode as a temporary validation run — the
  // evidence must say the same thing or the model would trust a phantom commit.
  const persisted = input.mode === 'persisted';
  const lines = [
    `Run: mode=${persisted ? 'persisted' : 'temporary'} commit=${persisted ? 'committed' : 'not_committed (validation only)'}`,
  ];
  const output = formatOutputEvidence(result.task, result.preview);
  if (output) lines.push(output);
  return lines.join('\n');
}

function formatOutputEvidence(
  task: DataCleaningTask,
  preview: DataInputTablePreview | undefined
): string {
  const parts: string[] = [];
  if (task.outputTable) {
    parts.push(
      `outputTable=${formatDataResourceLink('output_table', task.outputTable, task.outputTable)}`
    );
  }
  if (preview) {
    parts.push(`outputRows=${preview.totalRows}`);
  }
  return parts.length ? `Output: ${parts.join(' ')}` : '';
}

function formatRunTaskSafetyNotes(input: RunTaskCommand): string {
  const notes: string[] = [];
  if (input.mode !== 'persisted') {
    notes.push(
      'Temporary run only validates a preview; it does not update reusable output tables. Run mode=persisted and preview the output table before uploading it to cloud.'
    );
  }
  if (input.workflowDsl && input.saveWorkflow !== true) {
    notes.push(
      'The workflowDsl was used only for this run and was not saved to task nodes. Save the workflow before treating this task as reusable.'
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

function formatWorkflow(title: string, workflow: DataTaskWorkflow): string {
  const nodeLines = workflow.nodes.map(formatWorkflowNode);
  return [
    `${title}: ${formatTask(workflow.task)}; nodes=${workflow.nodes.length}; edges=${workflow.edges.length}`,
    nodeLines.length ? `Nodes:\n${nodeLines.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function formatWorkflowEdge(edge: DataTaskWorkflow['edges'][number]) {
  return {
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  };
}

function formatWorkflowNode(node: DataTaskWorkflow['nodes'][number]): string {
  const config = node.config ?? {};
  const details = [
    typeof config.source === 'string' ? `source=${config.source}` : '',
    typeof config.datasetId === 'string' ? `datasetId=${config.datasetId}` : '',
    typeof config.alias === 'string' ? `alias=${config.alias}` : '',
    typeof config.outputDatasetId === 'string' ? `outputTableId=${config.outputDatasetId}` : '',
    typeof config.outputTableId === 'string' && config.outputTableId !== config.outputDatasetId
      ? `outputTableId=${config.outputTableId}`
      : '',
    typeof config.table === 'string' ? `table=${config.table}` : '',
  ].filter(Boolean);
  return `- ${node.id} type=${node.type}${details.length ? ` ${details.join(' ')}` : ''}`;
}

const MAX_PREVIEW_CELL_CHARS = 160;
const MAX_PREVIEW_COLUMNS = 16;
const MAX_PREVIEW_ROWS_CHARS = 4000;

function truncateCellValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_PREVIEW_CELL_CHARS) {
    return `${value.slice(0, MAX_PREVIEW_CELL_CHARS)}…[+${value.length - MAX_PREVIEW_CELL_CHARS} chars]`;
  }
  if (Array.isArray(value)) {
    const serialized = JSON.stringify(value);
    return serialized.length > MAX_PREVIEW_CELL_CHARS
      ? `${serialized.slice(0, MAX_PREVIEW_CELL_CHARS)}…[+${serialized.length - MAX_PREVIEW_CELL_CHARS} chars]`
      : value;
  }
  return value;
}

/**
 * Bounded model-visible preview: caps columns, per-cell text and the total
 * serialized row payload, then reports what was truncated. The details payload
 * still carries the full preview for the UI — this only bounds `content`.
 */
function formatPreview(preview: DataInputTablePreview | undefined, includeRows = true): string {
  if (!preview) {
    return '';
  }
  const shownColumns = preview.columns.slice(0, MAX_PREVIEW_COLUMNS);
  const shownColumnSet = new Set(shownColumns);
  const omittedColumns = preview.columns.length - shownColumns.length;
  const requestedRows = includeRows ? preview.rows.slice(0, preview.limit) : [];
  const rows: Record<string, unknown>[] = [];
  let rowsChars = 0;
  for (const row of requestedRows) {
    const bounded = Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => shownColumnSet.has(key))
        .map(([key, value]) => [key, truncateCellValue(value)])
    );
    const serialized = JSON.stringify(bounded);
    if (rows.length > 0 && rowsChars + serialized.length > MAX_PREVIEW_ROWS_CHARS) break;
    rows.push(bounded);
    rowsChars += serialized.length;
  }
  const truncation: string[] = [];
  if (requestedRows.length > rows.length) {
    truncation.push(`${requestedRows.length - rows.length} row(s) omitted by size budget`);
  }
  if (omittedColumns > 0) {
    truncation.push(`${omittedColumns} column(s) omitted`);
  }
  const typeSummary = preview.columnTypes.length
    ? ` types=${preview.columnTypes
        .slice(0, MAX_PREVIEW_COLUMNS)
        .map((column) => `${column.name}: ${dataFieldTypeLabel(column.type)}`)
        .join(', ')}`
    : '';
  const summary = includeRows
    ? `Preview rows=${rows.length}/${preview.totalRows}`
    : `Table schema totalRows=${preview.totalRows}`;
  return [
    `${summary} columns=${shownColumns.join(', ') || '(none)'}${typeSummary}`,
    truncation.length ? `Truncated: ${truncation.join('; ')}.` : '',
    includeRows && rows.length ? JSON.stringify(rows) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const MAX_LIST_LINES = 20;

/** Renders at most MAX_LIST_LINES entries plus an explicit "+N more" tail. */
function formatBoundedList<T>(items: T[], format: (item: T) => string): string[] {
  const lines = items.slice(0, MAX_LIST_LINES).map(format);
  if (items.length > MAX_LIST_LINES) {
    lines.push(`- … +${items.length - MAX_LIST_LINES} more (narrow the query or paginate)`);
  }
  return lines;
}

function withAgentResultPreviewLimit<T extends { previewRows?: number }>(input: T): T {
  return {
    ...input,
    previewRows: Math.min(input.previewRows ?? 5, 5),
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
