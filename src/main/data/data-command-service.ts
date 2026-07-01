import type { DataTaskStore } from './data-task-store';
import {
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../shared/prep-dsl';
import { runPiAiOneShot } from '../claude/claude-sdk-one-shot';
import { getWorkflowDslQuickReference } from './data-dsl-reference';
import type {
  AgentRuntimeConfig,
  DataCleaningTask,
  DataDataset,
  DataInputTablePreview,
  DataOutputTable,
  DataRunTaskInput,
  DataTaskWorkflow,
  DataWorkflowEdge,
  DataWorkflowEdgeInput,
  DataWorkflowNode,
  DataWorkflowNodeInput,
  DataWorkflowSaveInput,
} from '../../renderer/types';
import {
  DataCommandError,
  type ApplyOperatorDslCommand,
  type ApplyWorkflowDslCommand,
  type ConfigureInputOperatorCommand,
  type ConfigureOutputOperatorCommand,
  type CreateInputTableCommand,
  type CreateInputTableWithProcessingStrategyCommand,
  type CreateInputTableWithProcessingStrategyResult,
  type CreateOutputTableCommand,
  type CreateTaskCommand,
  type DeleteInputTableNormalizerVersionCommand,
  type DeleteInputTableNormalizerVersionResult,
  type ExportWorkflowDslCommand,
  type GenerateInputTableNormalizerDraftCommand,
  type GenerateInputTableNormalizerDraftResult,
  type GenerateTaskFromRequirementCommand,
  type GenerateTaskFromRequirementResult,
  type GetRunResultCommand,
  type GetTaskWorkflowCommand,
  type InputTableResult,
  type ImportCloudTableCommand,
  type ImportCloudTableResult,
  type ListCloudProjectsCommand,
  type ListCloudProjectsResult,
  type ListCloudSpacesCommand,
  type ListCloudSpacesResult,
  type ListCloudTablesCommand,
  type ListCloudTablesResult,
  type ListInputTableNormalizerVersionsCommand,
  type ListInputTableNormalizerVersionsResult,
  type ListInputTablesInput,
  type ListInputTablesResult,
  type ListOutputTablesResult,
  type ListTasksResult,
  type OutputTableResult,
  type PreviewCloudTableCommand,
  type PreviewCloudTableResult,
  type PreviewInputTableNormalizerVersionCommand,
  type PreviewInputTableNormalizerVersionResult,
  type PreviewTableCommand,
  type PreviewTableResult,
  type PublishInputTableNormalizerVersionCommand,
  type PublishInputTableNormalizerVersionResult,
  type RunResult,
  type RunGeneratedTaskCommand,
  type RunGeneratedTaskResult,
  type RunTaskCommand,
  type RunTaskResult,
  type SearchCloudTablesCommand,
  type SearchCloudTablesResult,
  type SummarizeInputTableSourceCommand,
  type SummarizeInputTableSourceResult,
  type TaskResult,
  type TextResult,
  type UpdateInputTableCommand,
  type UpdateOutputTableCommand,
  type UpdateTaskCommand,
  type UploadDataTableToCloudCommand,
  type UploadDataTableToCloudResult,
  type WorkflowResult,
  type WorkflowSaveShape,
} from './data-command-types';
import type { InputTableNormalizerProjectGenerator } from './input-table-normalizer-generator';
import { configStore } from '../config/config-store';
import { CloudAnalysisCommandService } from './cloud-analysis-command-service';
import { InputTablesCommandService } from './input-tables-command-service';
import { OutputTablesCommandService } from './output-tables-command-service';
import type {
  PersonalAnalysisConnectionInput,
  StoredPersonalAnalysisConfig,
} from '../../shared/personal-analysis-types';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

interface WorkflowResourceBindings {
  inputTableId?: string;
  inputAlias?: string;
  outputTableId?: string;
}

interface DataCommandServiceOptions {
  onTaskCompleted?: (task: DataCleaningTask) => void;
  getPersonalAnalysisConnection?: () => PersonalAnalysisConnectionInput | null;
}

export class DataCommandService {
  private readonly inputTables: InputTablesCommandService;
  private readonly outputTables: OutputTablesCommandService;
  private readonly cloudAnalysis: CloudAnalysisCommandService;

  constructor(
    private readonly store: DataTaskStore,
    normalizerProjectGenerator: InputTableNormalizerProjectGenerator,
    getPersonalAnalysisConfig: () => StoredPersonalAnalysisConfig = () =>
      configStore.get('personalAnalysis'),
    private readonly options: DataCommandServiceOptions = {}
  ) {
    this.inputTables = new InputTablesCommandService(store, normalizerProjectGenerator);
    this.outputTables = new OutputTablesCommandService(store);
    this.cloudAnalysis = new CloudAnalysisCommandService(store, getPersonalAnalysisConfig, {
      getPersonalAnalysisConnection: options.getPersonalAnalysisConnection,
      createInputTable: (input) => this.createInputTable(input),
    });
  }

  async listInputTables(input: ListInputTablesInput = {}): Promise<ListInputTablesResult> {
    return this.inputTables.listInputTables(input);
  }

  async createInputTable(input: CreateInputTableCommand): Promise<InputTableResult> {
    return this.inputTables.createInputTable(input);
  }

  async createInputTableWithProcessingStrategy(
    input: CreateInputTableWithProcessingStrategyCommand
  ): Promise<CreateInputTableWithProcessingStrategyResult> {
    return this.inputTables.createInputTableWithProcessingStrategy(input);
  }

  async updateInputTable(input: UpdateInputTableCommand): Promise<InputTableResult> {
    return this.inputTables.updateInputTable(input);
  }

  async summarizeInputTableSource(
    input: SummarizeInputTableSourceCommand
  ): Promise<SummarizeInputTableSourceResult> {
    return this.inputTables.summarizeInputTableSource(input);
  }

  async generateInputTableNormalizerDraft(
    input: GenerateInputTableNormalizerDraftCommand
  ): Promise<GenerateInputTableNormalizerDraftResult> {
    return this.inputTables.generateInputTableNormalizerDraft(input);
  }

  async generateTaskFromRequirement(
    input: GenerateTaskFromRequirementCommand
  ): Promise<GenerateTaskFromRequirementResult> {
    const processRequirement = normalizeRequiredName(
      input.processRequirement,
      'Processing requirement is required'
    );
    const preparedInput = await this.prepareGeneratedTaskInput(input);
    const outputTable = await this.resolveGeneratedOutputTable(
      input.output,
      preparedInput.inputTable.name
    );
    const reusableTask = await this.resolveReusableGeneratedTask(input.reuseTaskId);
    const task =
      reusableTask ??
      (
        await this.createTask({
          name: await this.createUniqueTaskName(
            `${preparedInput.inputTable.name || '数据表'}_自动处理`
          ),
          sourceInputTableId: preparedInput.inputTable.id,
          outputTableId: outputTable.id,
        })
      ).task;
    const generated = await generateWorkflowDslFromRequirement({
      inputTableId: preparedInput.inputTable.id,
      outputTableName: outputTable.name,
      requirement: processRequirement,
      columns: preparedInput.columnsSnapshot,
      runtimeConfig: input.runtimeConfig,
    });
    const dryRun = await this.applyWorkflowDsl({
      taskId: task.id,
      dsl: generated.workflowDsl,
      inputTableId: preparedInput.inputTable.id,
      outputTableId: outputTable.id,
      dryRun: true,
    });
    const dryRunErrors = diagnosticsWithSeverity(dryRun.diagnostics ?? [], 'error');
    if (dryRunErrors.length > 0) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(dryRunErrors), {
        diagnostics: dryRun.diagnostics,
      });
    }
    await this.applyWorkflowDsl({
      taskId: task.id,
      dsl: generated.workflowDsl,
      inputTableId: preparedInput.inputTable.id,
      outputTableId: outputTable.id,
      dryRun: false,
    });
    return {
      taskId: task.id,
      taskName: task.name,
      outputTableId: outputTable.id,
      outputTableName: outputTable.name,
      workflowDsl: generated.workflowDsl,
      requiredColumns: generated.requiredColumns,
      columnsSnapshot: preparedInput.columnsSnapshot,
      sourceSummaryHash: hashColumns(preparedInput.columnsSnapshot),
      version: nextGeneratedTaskVersion(input.currentVersion),
      generatedAt: Date.now(),
    };
  }

  async listOutputTables(input: ListInputTablesInput = {}): Promise<ListOutputTablesResult> {
    return this.outputTables.listOutputTables(input);
  }

  async createOutputTable(input: CreateOutputTableCommand = {}): Promise<OutputTableResult> {
    return this.outputTables.createOutputTable(input);
  }

  async updateOutputTable(input: UpdateOutputTableCommand): Promise<OutputTableResult> {
    return this.outputTables.updateOutputTable(input);
  }

  async previewTable(input: PreviewTableCommand): Promise<PreviewTableResult> {
    if (input.tableKind === 'input') {
      await this.requireInputTable(input.id);
    } else {
      await this.requireOutputTable(input.id);
    }
    return {
      tableKind: input.tableKind,
      id: input.id,
      preview: await this.previewDataset(input.id, input.limit, input.offset),
    };
  }

  async listCloudSpaces(input: ListCloudSpacesCommand = {}): Promise<ListCloudSpacesResult> {
    return this.cloudAnalysis.listCloudSpaces(input);
  }

  async listCloudProjects(input: ListCloudProjectsCommand): Promise<ListCloudProjectsResult> {
    return this.cloudAnalysis.listCloudProjects(input);
  }

  async listCloudTables(input: ListCloudTablesCommand): Promise<ListCloudTablesResult> {
    return this.cloudAnalysis.listCloudTables(input);
  }

  async searchCloudTables(input: SearchCloudTablesCommand): Promise<SearchCloudTablesResult> {
    return this.cloudAnalysis.searchCloudTables(input);
  }

  async importCloudTable(input: ImportCloudTableCommand): Promise<ImportCloudTableResult> {
    return this.cloudAnalysis.importCloudTable(input);
  }

  async previewCloudTable(input: PreviewCloudTableCommand): Promise<PreviewCloudTableResult> {
    return this.cloudAnalysis.previewCloudTable(input);
  }

  async uploadDataTableToCloud(
    input: UploadDataTableToCloudCommand
  ): Promise<UploadDataTableToCloudResult> {
    return this.cloudAnalysis.uploadDataTableToCloud(input);
  }

  async previewInputTableNormalizerVersion(
    input: PreviewInputTableNormalizerVersionCommand
  ): Promise<PreviewInputTableNormalizerVersionResult> {
    return this.inputTables.previewInputTableNormalizerVersion(input);
  }

  async publishInputTableNormalizerVersion(
    input: PublishInputTableNormalizerVersionCommand
  ): Promise<PublishInputTableNormalizerVersionResult> {
    return this.inputTables.publishInputTableNormalizerVersion(input);
  }

  async deleteInputTableNormalizerVersion(
    input: DeleteInputTableNormalizerVersionCommand
  ): Promise<DeleteInputTableNormalizerVersionResult> {
    return this.inputTables.deleteInputTableNormalizerVersion(input);
  }

  async listInputTableNormalizerVersions(
    input: ListInputTableNormalizerVersionsCommand
  ): Promise<ListInputTableNormalizerVersionsResult> {
    return this.inputTables.listInputTableNormalizerVersions(input);
  }

  async listTasks(input: ListInputTablesInput = {}): Promise<ListTasksResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includeTasks: true,
      includeDatasets: false,
      includeOutputTables: false,
      taskLimit: window.limit,
      taskOffset: window.offset,
    });
    return {
      tasks: dashboard.tasks,
      total: dashboard.totalTasks,
      ...window,
    };
  }

  async createTask(input: CreateTaskCommand): Promise<TaskResult> {
    const name = normalizeRequiredName(input.name, 'Task name is required');
    await this.ensureUniqueTaskName(name);
    if (input.sourceInputTableId) {
      await this.requireInputTable(input.sourceInputTableId);
    }
    if (input.outputTableId) {
      await this.requireOutputTable(input.outputTableId);
    }
    try {
      return {
        task: await this.store.createTask({
          name,
          sourcePath: input.sourcePath,
          sourceDatasetId: input.sourceInputTableId ?? null,
          outputTableId: input.outputTableId ?? null,
        }),
      };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async updateTask(input: UpdateTaskCommand): Promise<TaskResult> {
    await this.requireTask(input.id);
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueTaskName(name, input.id);
    }
    try {
      return { task: await this.store.updateTask({ id: input.id, name }) };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async getTaskWorkflow(input: GetTaskWorkflowCommand): Promise<WorkflowResult> {
    return { workflow: await this.store.getTaskWorkflow(input.taskId) };
  }

  async applyWorkflowDsl(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    await this.requireTask(input.taskId);
    const compiled = await this.compileWorkflowDsl(input.dsl, {
      inputTableId: input.inputTableId,
      inputAlias: input.inputAlias,
      outputTableId: input.outputTableId,
    });
    const errors = diagnosticsWithSeverity(compiled.diagnostics, 'error');
    if (errors.length > 0 && !input.dryRun) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
        diagnostics: compiled.diagnostics,
      });
    }

    if (input.dryRun) {
      return {
        workflow: await this.toWorkflowPreview(input.taskId, compiled.workflow),
        diagnostics: compiled.diagnostics,
        dryRun: true,
      };
    }

    const workflow = await this.store.saveTaskWorkflow(input.taskId, compiled.workflow);
    return { workflow, diagnostics: compiled.diagnostics };
  }

  async exportWorkflowDsl(input: ExportWorkflowDslCommand): Promise<TextResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    return { text: exportPrepWorkflowDsl(workflow.nodes, workflow.edges) };
  }

  async configureInputOperator(input: ConfigureInputOperatorCommand): Promise<WorkflowResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    const inputTable = await this.requireInputTable(input.inputTableId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type !== 'input_source') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow node is not an input operator: ${input.nodeId}`
      );
    }

    const alias = sanitizeAlias(input.alias) || stringConfigValue(node.config.alias) || 'source';
    const nextWorkflow = updateWorkflowNode(workflow, input.nodeId, {
      config: {
        ...node.config,
        source: 'dataset',
        datasetId: inputTable.id,
        inputTableName: inputTable.name,
        alias,
        dsl: `input source dataset "${escapeDslString(inputTable.id)}" as ${alias}`,
      },
    });

    return this.saveOrPreview(input.taskId, nextWorkflow, Boolean(input.dryRun));
  }

  async applyOperatorDsl(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type === 'input_source' || node.type === 'output') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Use data_configure_input_operator or data_configure_output_operator for input/output nodes'
      );
    }
    if (input.operatorType && input.operatorType !== node.type) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Operator type mismatch: node is ${node.type}, request is ${input.operatorType}`
      );
    }

    const parsed = parsePrepOperatorDsl(input.dsl, node.type);
    const errors = diagnosticsWithSeverity(parsed.diagnostics, 'error');
    if ((errors.length > 0 || !parsed.operator) && !input.dryRun) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
        diagnostics: parsed.diagnostics,
      });
    }
    const nextWorkflow = parsed.operator
      ? updateWorkflowNode(workflow, input.nodeId, {
          label: parsed.operator.label ?? node.label,
          config: parsed.operator.config,
        })
      : toWorkflowSaveShape(workflow);

    return this.saveOrPreview(
      input.taskId,
      nextWorkflow,
      Boolean(input.dryRun),
      parsed.diagnostics
    );
  }

  async configureOutputOperator(input: ConfigureOutputOperatorCommand): Promise<WorkflowResult> {
    const workflow = await this.store.getTaskWorkflow(input.taskId);
    const node = findWorkflowNode(workflow, input.nodeId);
    if (node.type !== 'output') {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Workflow node is not an output operator: ${input.nodeId}`
      );
    }

    const mode = input.mode === 'append' ? 'append' : 'replace';
    let nextConfig: Record<string, unknown>;
    if (input.outputStrategy === 'auto' || (!input.outputTableId && input.outputTableName)) {
      const outputName = normalizeRequiredName(
        input.outputTableName ?? '',
        'Output table name is required for auto output'
      );
      nextConfig = {
        ...node.config,
        outputStrategy: 'auto',
        outputTableName: outputName,
        destination: 'duckdb_table',
        mode,
      };
    } else {
      const outputTableId = normalizeRequiredName(
        input.outputTableId ?? '',
        'Output table id is required'
      );
      const outputTable = await this.requireOutputTable(outputTableId);
      nextConfig = {
        ...node.config,
        outputStrategy: 'existing',
        outputDatasetId: outputTable.id,
        outputTableId: outputTable.id,
        outputTableName: outputTable.name,
        table: outputTable.tableName,
        destination: 'duckdb_table',
        mode,
      };
    }

    const nextWorkflow = updateWorkflowNode(workflow, input.nodeId, { config: nextConfig });
    return this.saveOrPreview(input.taskId, nextWorkflow, Boolean(input.dryRun));
  }

  async runTask(input: RunTaskCommand): Promise<RunTaskResult> {
    await this.requireTask(input.taskId);
    const outputMode = input.mode === 'persisted' ? 'persisted' : 'temporary';
    let compiled: { workflow: WorkflowSaveShape; diagnostics: PrepDiagnostic[] } | null = null;
    if (input.workflowDsl) {
      compiled = await this.compileWorkflowDsl(input.workflowDsl, {
        inputTableId: input.inputTableId,
        inputAlias: input.inputAlias,
        outputTableId: input.outputTableId,
      });
      const errors = diagnosticsWithSeverity(compiled.diagnostics, 'error');
      if (errors.length > 0) {
        throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(errors), {
          diagnostics: compiled.diagnostics,
        });
      }
      if (input.saveWorkflow) {
        await this.store.saveTaskWorkflow(input.taskId, compiled.workflow);
      }
    }

    const runInput: DataRunTaskInput = { outputMode };
    if (compiled && !input.saveWorkflow) {
      runInput.workflow = compiled.workflow;
    }

    try {
      const task = await this.store.runTask(input.taskId, runInput);
      this.options.onTaskCompleted?.(task);
      const preview = await this.previewTaskOutput(
        input.taskId,
        task,
        input.previewRows,
        compiled?.workflow
      );
      return {
        task,
        preview,
        diagnostics: compiled?.diagnostics,
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async runGeneratedTask(input: RunGeneratedTaskCommand): Promise<RunGeneratedTaskResult> {
    const preparedInput = await this.prepareGeneratedTaskInput({
      source: input.source,
      processRequirement: '',
      output: input.output,
    });
    validateGeneratedTaskSchema(
      preparedInput.columnsSnapshot,
      input.requiredColumns ?? [],
      input.schemaPolicy ?? 'required_subset'
    );
    const outputTable = await this.resolveGeneratedOutputTable(
      input.output,
      preparedInput.inputTable.name
    );
    const result = await this.runTask({
      taskId: input.taskId,
      mode: input.mode ?? 'persisted',
      workflowDsl: input.workflowDsl,
      saveWorkflow: false,
      inputTableId: preparedInput.inputTable.id,
      outputTableId: outputTable.id,
      previewRows: input.previewRows,
    });
    let uploaded: RunGeneratedTaskResult['uploaded'];
    if (input.output.location === 'cloud') {
      const folderId = await this.resolveCloudOutputFolderId(input);
      if (input.output.writeMode === 'create' && !folderId) {
        throw new DataCommandError(
          'INVALID_ARGUMENT',
          'Cloud output folderId is required. Please reselect the input cloud table or target project before running the automation.'
        );
      }
      uploaded = await this.uploadDataTableToCloud({
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
    }
    return {
      ...result,
      inputTableId: preparedInput.inputTable.id,
      outputTableId: outputTable.id,
      uploaded,
      tokenUsage: 0,
    };
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

  private async resolveGeneratedOutputTable(
    output: GenerateTaskFromRequirementCommand['output'],
    inputTableName: string
  ): Promise<DataOutputTable> {
    if (output.location === 'local' && output.writeMode === 'replace') {
      return this.requireOutputTable(
        normalizeRequiredName(output.targetTableId ?? '', 'Output table id is required')
      );
    }
    if (output.localOutputTableId) {
      return this.requireOutputTable(output.localOutputTableId);
    }
    const outputTableName =
      normalizeOptionalName(output.tableName) || `${inputTableName || 'processed_table'}_processed`;
    return (await this.createOutputTable({ name: outputTableName })).outputTable;
  }

  private async resolveReusableGeneratedTask(
    taskId: string | null | undefined
  ): Promise<DataCleaningTask | null> {
    const normalizedTaskId = normalizeOptionalName(taskId ?? undefined);
    if (!normalizedTaskId) return null;
    return this.store.getTaskRecord(normalizedTaskId);
  }

  async getRunResult(input: GetRunResultCommand): Promise<RunResult> {
    const task = await this.requireTask(input.taskId);
    const preview = await this.previewTaskOutput(
      input.taskId,
      task,
      input.previewRows,
      undefined,
      input.offset
    );
    return { task, preview };
  }

  private async compileWorkflowDsl(
    dsl: string,
    bindings: WorkflowResourceBindings = {}
  ): Promise<{
    workflow: WorkflowSaveShape;
    diagnostics: PrepDiagnostic[];
  }> {
    if (looksLikeJson(dsl)) {
      return {
        workflow: { nodes: [], edges: [] },
        diagnostics: [
          {
            severity: 'error',
            code: 'invalidDslFormat',
            message:
              'Workflow DSL must be text prep DSL, not JSON. Example: input source dataset "<inputTableId>" as src | derive [new_field] = expression | output table "Result" mode replace',
          },
        ],
      };
    }
    const parsed = parsePrepDsl(dsl);
    const diagnostics = [...parsed.diagnostics];
    if (!parsed.ast) {
      return { workflow: { nodes: [], edges: [] }, diagnostics };
    }
    const compiled = compilePrepWorkflowToFlow(parsed.ast);
    diagnostics.push(...compiled.diagnostics);
    const workflow = await this.applyWorkflowResourceBindings(
      {
        nodes: compiled.nodes,
        edges: compiled.edges,
      },
      bindings
    );
    return {
      workflow,
      diagnostics,
    };
  }

  private async applyWorkflowResourceBindings(
    workflow: WorkflowSaveShape,
    bindings: WorkflowResourceBindings
  ): Promise<WorkflowSaveShape> {
    let nodes = workflow.nodes.map((node) => ({ ...node, config: { ...(node.config ?? {}) } }));
    if (bindings.inputTableId) {
      const inputTable = await this.requireInputTable(bindings.inputTableId);
      const inputNode = nodes.find((node) => node.type === 'input_source');
      if (!inputNode) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Workflow has no input_source node to bind inputTableId'
        );
      }
      const alias =
        sanitizeAlias(bindings.inputAlias) || stringConfigValue(inputNode.config?.alias) || 'src';
      nodes = nodes.map((node) =>
        node.id === inputNode.id
          ? {
              ...node,
              config: {
                ...(node.config ?? {}),
                source: 'dataset',
                datasetId: inputTable.id,
                inputTableName: inputTable.name,
                alias,
                dsl: `input source dataset "${escapeDslString(inputTable.id)}" as ${alias}`,
              },
            }
          : node
      );
    }

    if (bindings.outputTableId) {
      const outputTable = await this.requireOutputTable(bindings.outputTableId);
      const outputNode = nodes.find((node) => node.type === 'output');
      if (!outputNode) {
        throw new DataCommandError(
          'VALIDATION_FAILED',
          'Workflow has no output node to bind outputTableId'
        );
      }
      const mode = stringConfigValue(outputNode.config?.mode) || 'replace';
      nodes = nodes.map((node) =>
        node.id === outputNode.id
          ? {
              ...node,
              config: {
                ...(node.config ?? {}),
                outputStrategy: 'existing',
                outputDatasetId: outputTable.id,
                outputTableId: outputTable.id,
                outputTableName: outputTable.name,
                table: outputTable.tableName,
                destination: 'duckdb_table',
                mode,
                dsl: `output table "${escapeDslString(outputTable.name)}" mode ${mode}`,
              },
            }
          : node
      );
    }

    return { nodes, edges: workflow.edges };
  }

  private async saveOrPreview(
    taskId: string,
    workflow: WorkflowSaveShape,
    dryRun: boolean,
    diagnostics: PrepDiagnostic[] = []
  ): Promise<WorkflowResult> {
    if (dryRun) {
      return {
        workflow: await this.toWorkflowPreview(taskId, workflow),
        diagnostics,
        dryRun,
      };
    }
    return {
      workflow: await this.store.saveTaskWorkflow(taskId, workflow),
      diagnostics,
    };
  }

  private async toWorkflowPreview(
    taskId: string,
    workflow: WorkflowSaveShape
  ): Promise<DataTaskWorkflow> {
    const task = await this.requireTask(taskId);
    return {
      task,
      nodes: workflow.nodes.map(
        (node): DataWorkflowNode => ({
          id: node.id,
          taskId,
          type: node.type,
          label: node.label,
          x: node.x,
          y: node.y,
          config: node.config ?? {},
          createdAt: 0,
          updatedAt: 0,
        })
      ),
      edges: workflow.edges.map(
        (edge): DataWorkflowEdge => ({
          id: edge.id,
          taskId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle ?? 'output',
          targetHandle: edge.targetHandle ?? 'input',
          createdAt: 0,
        })
      ),
    };
  }

  private async previewTaskOutput(
    taskId: string,
    task: DataCleaningTask,
    previewRows?: number,
    runtimeWorkflow?: WorkflowSaveShape,
    offset?: number
  ): Promise<DataInputTablePreview | undefined> {
    const limit = previewLimit(previewRows);
    if (task.sourceDatasetId) {
      try {
        return await this.previewDataset(task.sourceDatasetId, limit, offset);
      } catch {
        // Fall back to output node cache below.
      }
    }

    const runtimeOutputNode = runtimeWorkflow?.nodes.find((node) => node.type === 'output');
    if (runtimeOutputNode) {
      return this.store.previewWorkflowNode({
        taskId,
        nodeId: runtimeOutputNode.id,
        nodeType: runtimeOutputNode.type,
        nodeConfig: runtimeOutputNode.config,
        limit,
        offset,
      });
    }

    try {
      const workflow = await this.store.getTaskWorkflow(taskId);
      const outputNode = workflow.nodes.find((node) => node.type === 'output');
      if (outputNode) {
        return await this.store.previewWorkflowNode({
          taskId,
          nodeId: outputNode.id,
          nodeType: outputNode.type,
          nodeConfig: outputNode.config,
          limit,
          offset,
        });
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async previewDataset(
    id: string,
    limit?: number,
    offset?: number
  ): Promise<DataInputTablePreview> {
    return this.store.previewDataset({
      id,
      limit: previewLimit(limit),
      offset: previewOffset(offset),
    });
  }

  private async prepareGeneratedTaskInput(
    input: Pick<GenerateTaskFromRequirementCommand, 'source' | 'output' | 'processRequirement'>
  ): Promise<{
    inputTable: DataDataset;
    columnsSnapshot: Array<{ name: string; type?: string }>;
  }> {
    if (input.source.location === 'cloud') {
      const imported = await this.refreshAutomationCloudMirrorInputTable(input.source);
      return {
        inputTable: imported.inputTable,
        columnsSnapshot: normalizeColumnSnapshot(
          imported.preview?.columnTypes,
          input.source.columnsSnapshot
        ),
      };
    }
    const inputTable = await this.requireInputTable(
      normalizeRequiredName(input.source.tableId, 'Input table id is required')
    );
    let columnsSnapshot = normalizeColumnSnapshot(undefined, input.source.columnsSnapshot);
    if (columnsSnapshot.length === 0) {
      try {
        const preview = await this.previewDataset(inputTable.id, 20);
        columnsSnapshot = normalizeColumnSnapshot(preview.columnTypes);
      } catch {
        columnsSnapshot = [];
      }
    }
    return { inputTable, columnsSnapshot };
  }

  private async refreshAutomationCloudMirrorInputTable(
    source: GenerateTaskFromRequirementCommand['source']
  ): Promise<InputTableResult> {
    const tableId = normalizeRequiredName(source.tableId, 'Cloud table id is required');
    const mirrorName = buildAutomationCloudMirrorInputName(source.tableName, tableId);
    const downloaded = await this.cloudAnalysis.previewCloudTable({
      tableId,
      limit: 50,
    });
    const existing = await this.findInputTableByExactName(mirrorName);
    if (existing) {
      return this.updateInputTable({
        id: existing.id,
        name: mirrorName,
        sourceKind: 'csv',
        filePath: downloaded.downloadedFilePath,
        previewRows: 50,
      });
    }
    return this.createInputTable({
      name: mirrorName,
      sourceKind: 'csv',
      filePath: downloaded.downloadedFilePath,
      previewRows: 50,
    });
  }

  private async requireTask(id: string): Promise<DataCleaningTask> {
    const task = await this.store.getTaskRecord(id);
    if (!task) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Data task not found: ${id}`);
    }
    return task;
  }

  private async requireInputTable(id: string) {
    const inputTable = await this.store.getInputTableRecord(id);
    if (!inputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${id}`);
    }
    return inputTable;
  }

  private async requireOutputTable(id: string) {
    const outputTable = await this.store.getOutputTableRecord(id);
    if (!outputTable) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Output table not found: ${id}`);
    }
    return outputTable;
  }

  private async ensureUniqueTaskName(name: string, excludeId?: string): Promise<void> {
    const existing = await this.findTaskByExactName(name, excludeId);
    if (existing) {
      throw new DataCommandError('RESOURCE_ALREADY_EXISTS', `Data task already exists: ${name}`, {
        id: existing.id,
        name: existing.name,
      });
    }
  }

  private async createUniqueTaskName(baseName: string): Promise<string> {
    const base = normalizeRequiredName(baseName, 'Task name is required');
    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}_${index + 1}`;
      if (!(await this.findTaskByExactName(candidate))) {
        return candidate;
      }
    }
    return `${base}_${Date.now()}`;
  }

  private async findTaskByExactName(
    name: string,
    excludeId?: string
  ): Promise<DataCleaningTask | null> {
    const result = await this.listTasks({ query: name, limit: MAX_LIST_LIMIT });
    return (
      result.tasks.find(
        (item) => item.id !== excludeId && item.name.toLowerCase() === name.toLowerCase()
      ) ?? null
    );
  }

  private async findInputTableByExactName(name: string): Promise<DataDataset | null> {
    const result = await this.listInputTables({ query: name, limit: MAX_LIST_LIMIT });
    return (
      result.inputTables.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? null
    );
  }
}

function listWindow(
  limit: number | undefined,
  offset: number | undefined
): { limit: number; offset: number } {
  return {
    limit: clampInteger(limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT),
    offset: Math.max(0, Math.floor(Number(offset) || 0)),
  };
}

function previewLimit(limit: number | undefined): number {
  return clampInteger(limit, DEFAULT_PREVIEW_LIMIT, 1, MAX_PREVIEW_LIMIT);
}

function previewOffset(offset: number | undefined): number {
  return Math.max(0, Math.floor(Number(offset) || 0));
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

function normalizeOptionalName(name: string | undefined): string | undefined {
  const normalized = name?.trim();
  return normalized || undefined;
}

function normalizeRequiredName(name: string, message: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new DataCommandError('INVALID_ARGUMENT', message);
  }
  return normalized;
}

function buildAutomationCloudMirrorInputName(
  tableName: string | undefined,
  tableId: string
): string {
  const baseName = normalizeOptionalName(tableName) || `cloud_table_${tableId.slice(0, 8)}`;
  return `${baseName}_自动化镜像_${tableId.slice(0, 8)}`;
}

function nextGeneratedTaskVersion(currentVersion: number | null | undefined): number {
  return Number.isFinite(currentVersion) && Number(currentVersion) > 0
    ? Math.floor(Number(currentVersion)) + 1
    : 1;
}

function normalizeColumnSnapshot(
  primary?: Array<{ name?: string; type?: string }>,
  fallback?: Array<{ name?: string; type?: string }>
): Array<{ name: string; type?: string }> {
  const source = primary?.length ? primary : fallback;
  return (source ?? [])
    .map((column) => ({
      name: String(column.name ?? '').trim(),
      type: typeof column.type === 'string' ? column.type : undefined,
    }))
    .filter((column) => Boolean(column.name));
}

async function generateWorkflowDslFromRequirement({
  inputTableId,
  outputTableName,
  requirement,
  columns,
  runtimeConfig,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
}): Promise<{ workflowDsl: string; requiredColumns: Array<{ name: string; type?: string }> }> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    const response = await runPiAiOneShot(
      buildWorkflowDslGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
      }),
      buildWorkflowDslGenerationSystemPrompt(),
      config,
      { temperature: 0, maxTokens: 4_000 }
    );
    return parseGeneratedWorkflowDslResponse(response.text, columns);
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Failed to generate data task workflow: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function requireGenerationRuntimeConfig(runtimeConfig?: AgentRuntimeConfig): AgentRuntimeConfig {
  if (!runtimeConfig || !normalizeOptionalName(runtimeConfig.model)) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'Model configuration is required to generate a data task. Please select an available model and try again.'
    );
  }
  return runtimeConfig;
}

function buildWorkflowDslGenerationSystemPrompt(): string {
  return [
    'You generate reusable data-processing workflow DSL for Sophron Prep DSL.',
    'Return only strict JSON. Do not return markdown, comments, explanations, or code fences.',
    'Use only the provided input columns. Do not invent field names.',
    'The DSL must start with the provided input source dataset line and end with the provided output table line.',
    'For string values, preserve the semantic value only. For example Chinese text like "过滤掉Market为EU的数据" means value "EU", not "EU的数据".',
    'If the requirement is ambiguous, generate the safest valid DSL and include only columns actually used by transformation conditions in requiredColumns.',
  ].join('\n');
}

function buildWorkflowDslGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): string {
  return JSON.stringify(
    {
      task: 'Convert the user requirement into Sophron Prep DSL.',
      requirement: input.requirement,
      inputColumns: input.columns,
      requiredDslLines: {
        first: `input source dataset "${input.inputTableId}" as src`,
        last: `output table "${input.outputTableName}" mode replace`,
      },
      dslReference: getWorkflowDslQuickReference(),
      outputJsonSchema: {
        workflowDsl: 'complete multiline Prep DSL string',
        requiredColumns: [{ name: 'column used by filters/sorts/aggregations', type: 'optional' }],
      },
      example: {
        requirement: '过滤掉Market为EU的数据',
        workflowDsl: `input source dataset "${input.inputTableId}" as src\n  | filter [Market] <> 'EU'\n  | output table "${input.outputTableName}" mode replace`,
        requiredColumns: [{ name: 'Market' }],
      },
    },
    null,
    2
  );
}

function parseGeneratedWorkflowDslResponse(
  text: string,
  columns: Array<{ name: string; type?: string }>
): { workflowDsl: string; requiredColumns: Array<{ name: string; type?: string }> } {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isRecord(parsed) || typeof parsed.workflowDsl !== 'string') {
    throw new Error('Workflow DSL generation response must include workflowDsl');
  }
  const columnsByName = new Map(columns.map((column) => [column.name.toLowerCase(), column]));
  const unknownRequiredColumnNames: string[] = [];
  const requiredColumns = Array.isArray(parsed.requiredColumns)
    ? parsed.requiredColumns
        .map((column) => {
          const name = isRecord(column) ? String(column.name ?? '').trim() : '';
          if (!name) return null;
          const knownColumn = columnsByName.get(name.toLowerCase());
          if (!knownColumn) {
            unknownRequiredColumnNames.push(name);
            return null;
          }
          return knownColumn;
        })
        .filter((column): column is { name: string; type?: string } => Boolean(column))
    : [];
  if (unknownRequiredColumnNames.length > 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Generated workflow references unknown required column(s): ${unknownRequiredColumnNames.join(
        ', '
      )}`
    );
  }
  return {
    workflowDsl: parsed.workflowDsl.trim(),
    requiredColumns,
  };
}

function hashColumns(columns: Array<{ name: string; type?: string }>): string {
  const value = JSON.stringify(
    columns.map((column) => ({ name: column.name, type: column.type ?? null }))
  );
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `columns_${Math.abs(hash).toString(16)}`;
}

function validateGeneratedTaskSchema(
  actualColumns: Array<{ name: string; type?: string }>,
  requiredColumns: Array<{ name: string; type?: string }>,
  policy: 'strict' | 'required_subset'
): void {
  const actualByName = new Map(actualColumns.map((column) => [column.name.toLowerCase(), column]));
  const missing = requiredColumns.filter((column) => !actualByName.has(column.name.toLowerCase()));
  if (missing.length > 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Input schema drift detected. Missing required column(s): ${missing
        .map((column) => column.name)
        .join(', ')}`
    );
  }
  const incompatible = requiredColumns.filter((column) => {
    if (!column.type) return false;
    const actual = actualByName.get(column.name.toLowerCase());
    return Boolean(
      actual?.type && normalizeColumnType(actual.type) !== normalizeColumnType(column.type)
    );
  });
  if (incompatible.length > 0) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      `Input schema drift detected. Incompatible required column type(s): ${incompatible
        .map((column) => {
          const actual = actualByName.get(column.name.toLowerCase());
          return `${column.name} expected ${column.type}, got ${actual?.type}`;
        })
        .join(', ')}`
    );
  }
  if (policy === 'strict' && actualColumns.length !== requiredColumns.length) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Input schema drift detected. Strict schema policy requires the same column set.'
    );
  }
}

function normalizeColumnType(type: string): string {
  return type.trim().toLowerCase();
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const content = fenced[1].trim();
    if (content.startsWith('{') && content.endsWith('}')) return content;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('No JSON object found in LLM response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findWorkflowNode(workflow: DataTaskWorkflow, nodeId: string): DataWorkflowNode {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) {
    const available = workflow.nodes.map((item) => `${item.id} (${item.type})`).join(', ');
    throw new DataCommandError(
      'RESOURCE_NOT_FOUND',
      `Workflow node not found: ${nodeId}${
        available ? `. Available nodes: ${available}` : '. The workflow has no saved nodes.'
      }`
    );
  }
  return node;
}

function updateWorkflowNode(
  workflow: DataTaskWorkflow,
  nodeId: string,
  updates: Partial<Pick<DataWorkflowNodeInput, 'label' | 'config'>>
): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: updates.label && node.id === nodeId ? updates.label : node.label,
      x: node.x,
      y: node.y,
      config: node.id === nodeId ? (updates.config ?? node.config) : node.config,
    })),
    edges: workflow.edges.map(toWorkflowEdgeInput),
  };
}

function toWorkflowSaveShape(workflow: DataTaskWorkflow): DataWorkflowSaveInput {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      x: node.x,
      y: node.y,
      config: node.config,
    })),
    edges: workflow.edges.map(toWorkflowEdgeInput),
  };
}

function toWorkflowEdgeInput(edge: DataWorkflowEdge): DataWorkflowEdgeInput {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}

function diagnosticsWithSeverity(
  diagnostics: PrepDiagnostic[],
  severity: PrepDiagnostic['severity']
): PrepDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity);
}

function summarizeDiagnostics(diagnostics: PrepDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'DSL validation failed';
  }
  return diagnostics
    .slice(0, 3)
    .map((diagnostic) => {
      const location =
        diagnostic.line || diagnostic.column
          ? ` at ${diagnostic.line ?? '?'}:${diagnostic.column ?? '?'}`
          : '';
      return `${diagnostic.code ?? diagnostic.severity}${location}: ${diagnostic.message}`;
    })
    .join('\n');
}

function sanitizeAlias(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) ? normalized : '';
}

function escapeDslString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stringConfigValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function toCommandError(error: unknown, fallbackCode: DataCommandError['code']): DataCommandError {
  if (error instanceof DataCommandError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    /source|file|folder|path|unsupported|does not exist/i.test(message) &&
    fallbackCode === 'FILE_ACCESS_DENIED'
  ) {
    return new DataCommandError('FILE_ACCESS_DENIED', message);
  }
  if (/not found|does not exist|not exist/i.test(message)) {
    return new DataCommandError('RESOURCE_NOT_FOUND', message);
  }
  return new DataCommandError(fallbackCode, message || 'Data command failed');
}
