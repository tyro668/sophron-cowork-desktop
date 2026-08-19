import type { BeforeSessionRunContext } from '../extensions/agent-runtime-extension';
import type { DataCommandService } from './data-command-service';
import type {
  ApplyOperatorDslCommand,
  ApplyWorkflowDslCommand,
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
  SummarizeInputTableSourceCommand,
  UpdateInputTableCommand,
  UpdateOutputTableCommand,
  UpdateTaskCommand,
  UploadDataTableToCloudCommand,
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
import { createDataResourceHref, type DataResourceKind } from '../../shared/data-resource-link';
import { dataFieldTypeLabel } from '../../shared/data-field-types';
import type {
  DataCleaningTask,
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
  DataTaskWorkflow,
} from '../../renderer/types';
import type {
  PersonalAnalysisProject,
  PersonalAnalysisSpace,
  PersonalAnalysisTable,
} from '../../shared/personal-analysis-types';

export class DataToolService {
  private readonly generationInFlight = new Map<string, Promise<DataToolResult>>();
  private readonly executionContexts = new Map<
    string,
    Omit<DataToolExecutionContext, 'toolCallId' | 'signal'>
  >();

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
  }

  async resolveConversationContext(
    context: BeforeSessionRunContext
  ): Promise<DataToolPromptContext> {
    return {
      sessionId: context.session.id,
      workspacePath: context.session.cwd,
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
    const lines = result.inputTables.map(formatInputTable);
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
    const lines = result.outputTables.map(formatOutputTable);
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
    const lines = result.spaces.map(formatCloudSpace);
    return toolResult(
      lines.length
        ? `Found ${result.spaces.length} cloud space(s):\n${lines.join('\n')}`
        : 'No cloud spaces found.',
      result
    );
  }

  async listCloudProjects(input: ListCloudProjectsCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudProjects(input);
    const lines = result.projects.map(formatCloudProject);
    return toolResult(
      lines.length
        ? `Found ${result.projects.length} cloud project(s):\n${lines.join('\n')}`
        : 'No cloud projects found.',
      result
    );
  }

  async listCloudTables(input: ListCloudTablesCommand): Promise<DataToolResult> {
    const result = await this.commandService.listCloudTables(input);
    const lines = result.tables.map(formatCloudTable);
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
    const lines = result.versions.map(
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
    const lines = result.tasks.map(formatTask);
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
        formatRunTaskSafetyNotes(input),
        formatPreview(result.preview),
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
      [`Run result for ${formatTask(result.task)}`, formatPreview(result.preview)]
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
      ? 'Show this plan to the user and wait for an explicit confirmation in a new user message. Then call data_generate_task_from_requirement with this analysisId.'
      : result.status === 'needs_confirmation'
        ? 'Ask the user to clarify or revise the ambiguous/unsupported items, then analyze the revised requirement again. Do not generate yet.'
        : 'Explain the unsupported capability and suggested alternatives. Do not generate this requirement.';
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
      'The reusable task is saved. Formal output has not been written; use data_run_task with mode=persisted only when the user requests it.',
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

function formatPreview(preview: DataInputTablePreview | undefined, includeRows = true): string {
  if (!preview) {
    return '';
  }
  const rows = preview.rows.slice(0, preview.limit);
  const typeSummary = preview.columnTypes.length
    ? ` types=${preview.columnTypes.map((column) => `${column.name}: ${dataFieldTypeLabel(column.type)}`).join(', ')}`
    : '';
  const summary = includeRows
    ? `Preview rows=${rows.length}/${preview.totalRows}`
    : `Table schema totalRows=${preview.totalRows}`;
  return [
    `${summary} columns=${preview.columns.join(', ') || '(none)'}${typeSummary}`,
    includeRows && rows.length ? JSON.stringify(rows, null, 2) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function withAgentResultPreviewLimit<T extends { previewRows?: number }>(input: T): T {
  return {
    ...input,
    previewRows: Math.min(input.previewRows ?? 5, 5),
  };
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
