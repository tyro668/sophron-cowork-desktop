import type { BeforeSessionRunContext } from '../extensions/agent-runtime-extension';
import type { DataCommandService } from './data-command-service';
import type {
  ApplyOperatorDslCommand,
  ApplyWorkflowDslCommand,
  ConfigureInputOperatorCommand,
  ConfigureOutputOperatorCommand,
  CreateInputTableCommand,
  CreateOutputTableCommand,
  CreateTaskCommand,
  ExportWorkflowDslCommand,
  GenerateInputTableNormalizerDraftCommand,
  GetRunResultCommand,
  GetTaskWorkflowCommand,
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
} from './data-command-types';
import type { DataToolPromptContext, DataToolResult } from './data-tool-types';
import {
  getWorkflowDslReference,
  type DataDslReferenceTopic,
} from './data-dsl-reference';
import { createDataResourceHref, type DataResourceKind } from '../../shared/data-resource-link';
import type {
  DataCleaningTask,
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
  DataTaskWorkflow,
} from '../../renderer/types';

export class DataToolService {
  constructor(private readonly commandService: DataCommandService) {}

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

  async getWorkflowDslReference(input: {
    topic?: DataDslReferenceTopic;
  } = {}): Promise<DataToolResult> {
    const topic = input.topic ?? 'all';
    const text = getWorkflowDslReference(topic);
    return toolResult(text, { topic, text });
  }

  async createInputTable(input: CreateInputTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.createInputTable(input);
    return toolResult(
      [
        `Created input table: ${formatInputTable(result.inputTable)}`,
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
      [
        `Updated input table: ${formatInputTable(result.inputTable)}`,
        formatPreview(result.preview),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async summarizeInputTableSource(input: SummarizeInputTableSourceCommand): Promise<DataToolResult> {
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

  async previewTable(input: PreviewTableCommand): Promise<DataToolResult> {
    const result = await this.commandService.previewTable(input);
    return toolResult(
      `Previewed ${input.tableKind} table ${input.id}.\n\n${formatPreview(result.preview)}`,
      result
    );
  }

  async previewInputTableNormalizerVersion(
    input: PreviewInputTableNormalizerVersionCommand
  ): Promise<DataToolResult> {
    const result = await this.commandService.previewInputTableNormalizerVersion(input);
    return toolResult(`Previewed normalizer version ${input.versionId}.\n\n${formatPreview(result.preview)}`, result);
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
    return toolResult(result.text ? `Workflow DSL:\n${result.text}` : 'Workflow has no DSL.', result);
  }

  async configureInputOperator(input: ConfigureInputOperatorCommand): Promise<DataToolResult> {
    const result = await this.commandService.configureInputOperator(input);
    return toolResult(formatWorkflow('Configured input operator', result.workflow), result);
  }

  async applyOperatorDsl(input: ApplyOperatorDslCommand): Promise<DataToolResult> {
    const result = await this.commandService.applyOperatorDsl(input);
    return toolResult(
      [formatWorkflow(result.dryRun ? 'Validated operator DSL' : 'Applied operator DSL', result.workflow), formatDiagnostics(result.diagnostics)]
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
    const result = await this.commandService.runTask(input);
    return toolResult(
      [
        `Ran data task: ${formatTask(result.task)}`,
        formatPreview(result.preview),
        formatDiagnostics(result.diagnostics),
      ]
        .filter(Boolean)
        .join('\n\n'),
      result
    );
  }

  async getRunResult(input: GetRunResultCommand): Promise<DataToolResult> {
    const result = await this.commandService.getRunResult(input);
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

function formatInputTable(table: DataDataset): string {
  return `- ${formatDataResourceLink('input_table', table.id, table.name)} (${table.id}) kind=${table.sourceKind} rows=${table.rowCount} columns=${table.columnCount}`;
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

function formatPreview(preview: DataInputTablePreview | undefined): string {
  if (!preview) {
    return '';
  }
  const rows = preview.rows.slice(0, preview.limit);
  return [
    `Preview rows=${rows.length}/${preview.totalRows} columns=${preview.columns.join(', ') || '(none)'}`,
    rows.length ? JSON.stringify(rows, null, 2) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatDiagnostics(diagnostics: Array<{ severity: string; message: string; code?: string }> | undefined): string {
  if (!diagnostics?.length) {
    return '';
  }
  return `Diagnostics:\n${diagnostics
    .slice(0, 8)
    .map((item) => `- ${item.severity}: ${item.code ? `${item.code}: ` : ''}${item.message}`)
    .join('\n')}`;
}
