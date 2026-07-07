import type { DataTaskStore } from './data-task-store';
import {
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
  type PrepOperatorAst,
} from '../../shared/prep-dsl';
import { getWorkflowDslQuickReference } from './data-dsl-reference';
import { runPiAiOneShot } from '../claude/claude-sdk-one-shot';
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
    const displayInputTableName = getGeneratedTaskDisplayInputName(
      input.source,
      preparedInput.inputTable.name
    );
    const outputTable = await this.resolveGeneratedOutputTable(input.output, displayInputTableName);
    const reusableTask = await this.resolveReusableGeneratedTask(input.reuseTaskId);
    const task =
      reusableTask ??
      (
        await this.createTask({
          name: await this.createUniqueTaskName(`${displayInputTableName || '数据表'}_自动处理`),
          sourceInputTableId: preparedInput.inputTable.id,
          outputTableId: outputTable.id,
        })
      ).task;
    let generated = await generateWorkflowDslFromRequirement({
      inputTableId: preparedInput.inputTable.id,
      outputTableName: outputTable.name,
      requirement: processRequirement,
      columns: preparedInput.columnsSnapshot,
      runtimeConfig: input.runtimeConfig,
    });
    let dryRun = await this.applyWorkflowDsl({
      taskId: task.id,
      dsl: generated.workflowDsl,
      inputTableId: preparedInput.inputTable.id,
      outputTableId: outputTable.id,
      dryRun: true,
    });
    let dryRunErrors = diagnosticsWithSeverity(dryRun.diagnostics ?? [], 'error');
    if (dryRunErrors.length > 0) {
      generated = await repairWorkflowDslFromDiagnostics({
        inputTableId: preparedInput.inputTable.id,
        outputTableName: outputTable.name,
        requirement: processRequirement,
        columns: preparedInput.columnsSnapshot,
        runtimeConfig: input.runtimeConfig,
        failedWorkflowDsl: generated.workflowDsl,
        diagnostics: dryRunErrors,
      });
      dryRun = await this.applyWorkflowDsl({
        taskId: task.id,
        dsl: generated.workflowDsl,
        inputTableId: preparedInput.inputTable.id,
        outputTableId: outputTable.id,
        dryRun: true,
      });
      dryRunErrors = diagnosticsWithSeverity(dryRun.diagnostics ?? [], 'error');
    }
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
    const outputTableName =
      normalizeOptionalName(output.tableName) || `${inputTableName || 'processed_table'}_processed`;
    if (output.localOutputTableId) {
      const existingOutputTable = await this.store.getOutputTableRecord(output.localOutputTableId);
      if (existingOutputTable && existingOutputTable.name === outputTableName) {
        return existingOutputTable;
      }
    }
    const existingOutputTable = await this.findOutputTableByExactName(outputTableName);
    if (existingOutputTable) {
      return existingOutputTable;
    }
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

  private async findOutputTableByExactName(name: string): Promise<DataOutputTable | null> {
    const result = await this.listOutputTables({ query: name, limit: MAX_LIST_LIMIT });
    return (
      result.outputTables.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? null
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

function getGeneratedTaskDisplayInputName(
  source: GenerateTaskFromRequirementCommand['source'],
  preparedInputTableName: string
): string {
  return normalizeOptionalName(source.tableName) || preparedInputTableName;
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
    try {
      return parseGeneratedWorkflowPlanResponse({
        text: response.text,
        inputTableId,
        outputTableName,
        requirement,
        columns,
      });
    } catch (parseError) {
      if (isUnsupportedGeneratedWorkflowOperationError(parseError)) {
        return await generateAdvancedWorkflowDslFromPlan({
          inputTableId,
          outputTableName,
          requirement,
          columns,
          runtimeConfig,
          generatedPlanText: response.text,
          diagnostics: diagnosticsFromGenerationError(parseError),
        });
      }
      const failedWorkflowDsl = extractWorkflowDslFromModelResponse(response.text) ?? response.text;
      return await repairWorkflowDslFromDiagnostics({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        runtimeConfig,
        failedWorkflowDsl,
        diagnostics: diagnosticsFromGenerationError(parseError),
      });
    }
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Failed to generate data task workflow: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function repairWorkflowDslFromDiagnostics({
  inputTableId,
  outputTableName,
  requirement,
  columns,
  runtimeConfig,
  failedWorkflowDsl,
  diagnostics,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  failedWorkflowDsl: string;
  diagnostics: PrepDiagnostic[];
}): Promise<{ workflowDsl: string; requiredColumns: Array<{ name: string; type?: string }> }> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    const response = await runPiAiOneShot(
      buildWorkflowDslGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        failedWorkflowDsl,
        diagnostics,
      }),
      buildWorkflowDslGenerationSystemPrompt(),
      config,
      { temperature: 0, maxTokens: 4_000 }
    );
    return parseGeneratedWorkflowPlanResponse({
      text: response.text,
      inputTableId,
      outputTableName,
      requirement,
      columns,
    });
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Failed to repair generated data task workflow: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function generateAdvancedWorkflowDslFromPlan({
  inputTableId,
  outputTableName,
  requirement,
  columns,
  runtimeConfig,
  generatedPlanText,
  diagnostics,
}: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  runtimeConfig?: AgentRuntimeConfig;
  generatedPlanText: string;
  diagnostics: PrepDiagnostic[];
}): Promise<{ workflowDsl: string; requiredColumns: Array<{ name: string; type?: string }> }> {
  const config = requireGenerationRuntimeConfig(runtimeConfig);
  try {
    const response = await runPiAiOneShot(
      buildAdvancedWorkflowDslGenerationUserPrompt({
        inputTableId,
        outputTableName,
        requirement,
        columns,
        generatedPlanText,
        diagnostics,
      }),
      buildAdvancedWorkflowDslGenerationSystemPrompt(),
      config,
      { temperature: 0, maxTokens: 6_000 }
    );
    return parseGeneratedWorkflowDslResponse(response.text, columns);
  } catch (error) {
    if (error instanceof DataCommandError) throw error;
    throw new DataCommandError(
      'GENERATION_FAILED',
      `Failed to generate advanced data task workflow: ${
        error instanceof Error ? error.message : String(error)
      }`
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
    'You convert user requirements into a structured data-processing plan for Sophron.',
    'Return only strict JSON. Do not return markdown, comments, explanations, or code fences.',
    'Use only the provided input columns. Do not invent field names.',
    'Do not write Sophron Prep DSL or SQL. Return operations only; the application compiles operations to DSL.',
    'Operation column references must use the current field name at that point in the operation list. Before a rename, use the original input column name exactly; after a rename, later operations may use the renamed field.',
    'For field-to-field filters, put the right-side field name in rightColumn. Do not put field references such as [Target Profit] in value, because value is for literal constants.',
    'Expression syntax: in operation.expression, reference fields with Prep DSL syntax only. Use [FieldName] for simple field names and [`Field Name`] for names with spaces, punctuation, Chinese characters, or other special characters.',
    "Never use SQL identifier syntax in operation.expression, including bare backticks like `Field Name`, double-quoted identifiers like \"Field Name\", or table.column references. Example: use REGEXP_EXTRACT([`Customer ID`], '\\\\d+'), not REGEXP_EXTRACT(`Customer ID`, '\\\\d+').",
    "For regex digit matching in operation.expression, prefer [0-9]+ over \\d+ to avoid JSON/DSL/SQL escaping ambiguity. Example: REGEXP_EXTRACT([`Customer ID`], '[0-9]+').",
    'For string values, preserve the semantic value only. For example Chinese text like "过滤掉Market为EU的数据" means value "EU", not "EU的数据".',
    'For money, prices, rates, percentages, and other fixed-decimal business values, use targetType "decimal" and a scale such as 2. Avoid float unless approximate binary floating point is explicitly requested.',
    'If the requirement is ambiguous, generate the safest valid operations and include only input columns actually used by the operations in requiredColumns.',
  ].join('\n');
}

function buildAdvancedWorkflowDslGenerationSystemPrompt(): string {
  return [
    'You generate advanced Sophron Prep DSL only when the stable operation compiler cannot express the user requirement.',
    'Return only strict JSON. Do not return markdown, comments, explanations, or code fences.',
    'Use only the provided input columns. Do not invent field names.',
    'The workflowDsl must start with the provided input source dataset line and end with the provided output table line.',
    'If a field name contains spaces or special characters, reference it as [`field name`].',
    'In expressions, reference fields with [field] or [`field name`]. Never use bare SQL identifier syntax such as `field name` or "field name".',
    'Prefer deterministic, readable Prep DSL. Do not use SQL syntax unless the Prep DSL reference explicitly supports it.',
  ].join('\n');
}

function buildAdvancedWorkflowDslGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  generatedPlanText: string;
  diagnostics: PrepDiagnostic[];
}): string {
  return JSON.stringify(
    {
      task: 'Generate an advanced Sophron Prep DSL workflow from a previously generated structured plan that the stable compiler could not compile.',
      requirement: input.requirement,
      inputColumns: input.columns,
      requiredDslLines: {
        first: `input source dataset "${input.inputTableId}" as src`,
        last: `output table "${input.outputTableName}" mode replace`,
      },
      previousGeneratedPlanJson: safeParseJsonForPrompt(input.generatedPlanText),
      previousDiagnostics: input.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        line: diagnostic.line,
        column: diagnostic.column,
      })),
      dslReference: getWorkflowDslQuickReference(),
      outputJsonSchema: {
        workflowDsl: 'complete multiline Prep DSL string',
        requiredColumns: [{ name: 'input column referenced by the DSL', type: 'optional' }],
        explanation: 'brief explanation of why advanced DSL was needed',
      },
    },
    null,
    2
  );
}

function safeParseJsonForPrompt(text: string): unknown {
  try {
    return JSON.parse(extractJsonObject(text));
  } catch {
    return text;
  }
}

function buildWorkflowDslGenerationUserPrompt(input: {
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
  failedWorkflowDsl?: string;
  diagnostics?: PrepDiagnostic[];
}): string {
  return JSON.stringify(
    {
      task: 'Convert the user requirement into a structured Sophron data transform plan.',
      requirement: input.requirement,
      inputColumns: input.columns,
      compilationTarget: {
        inputTableId: input.inputTableId,
        outputTableName: input.outputTableName,
      },
      supportedOperations: getGeneratedWorkflowOperationPromptSpecs(),
      outputJsonSchema: {
        operations:
          'array of supported operation objects in execution order. Put operation parameters at the top level of each object, not under a fields object.',
        requiredColumns: [{ name: 'input column referenced by the DSL', type: 'optional' }],
        changeSummary: 'brief user-facing summary of what the workflow changes',
      },
      previousFailedAttempt: input.failedWorkflowDsl
        ? {
            compiledWorkflowDsl: input.failedWorkflowDsl,
            diagnostics: (input.diagnostics ?? []).map((diagnostic) => ({
              severity: diagnostic.severity,
              code: diagnostic.code,
              message: diagnostic.message,
              line: diagnostic.line,
              column: diagnostic.column,
            })),
            instruction: 'Return corrected operations. Do not return DSL.',
          }
        : undefined,
      example: {
        requirement: '过滤掉Market为EU的数据',
        operations: [{ type: 'filter', column: 'Market', operator: '<>', value: 'EU' }],
        requiredColumns: [{ name: 'Market' }],
      },
    },
    null,
    2
  );
}

function extractWorkflowDslFromModelResponse(text: string): string | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as unknown;
    if (isRecord(parsed) && typeof parsed.workflowDsl === 'string' && parsed.workflowDsl.trim()) {
      return parsed.workflowDsl.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function diagnosticsFromGenerationError(error: unknown): PrepDiagnostic[] {
  if (error instanceof DataCommandError) {
    const details = error.details;
    if (
      isRecord(details) &&
      Array.isArray(details.diagnostics) &&
      details.diagnostics.every(isPrepDiagnosticLike)
    ) {
      return details.diagnostics;
    }
    return [{ severity: 'error', code: error.code, message: error.message }];
  }
  return [
    {
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}

function isPrepDiagnosticLike(value: unknown): value is PrepDiagnostic {
  return isRecord(value) && (value.severity === 'error' || value.severity === 'warning');
}

function isUnsupportedGeneratedWorkflowOperationError(error: unknown): boolean {
  return (
    error instanceof DataCommandError &&
    error.code === 'VALIDATION_FAILED' &&
    error.message.includes('uses unsupported operation')
  );
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function parseGeneratedWorkflowPlanResponse({
  text,
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  text: string;
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): { workflowDsl: string; requiredColumns: Array<{ name: string; type?: string }> } {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.operations)) {
    throw new Error('Workflow plan generation response must include operations');
  }
  const compiled = compileGeneratedWorkflowPlan({
    operations: parsed.operations,
    inputTableId,
    outputTableName,
    requirement,
    columns,
  });
  return parseGeneratedWorkflowDslResponse(
    JSON.stringify({
      workflowDsl: compiled.workflowDsl,
      requiredColumns: compiled.requiredColumns,
    }),
    columns
  );
}

type GeneratedWorkflowRequiredColumnResolver = (
  name: unknown,
  context?: string
) => { name: string; type?: string };

interface GeneratedWorkflowColumnBinding {
  name: string;
  type?: string;
  sourceColumn?: { name: string; type?: string };
}

interface GeneratedWorkflowOperationCompileContext {
  columns: Array<{ name: string; type?: string }>;
  lines: string[];
  requirement: string;
  requireColumn: GeneratedWorkflowRequiredColumnResolver;
  normalizeExpression: (expression: string) => string;
  renameColumn: (sourceName: string, targetName: string) => void;
  upsertColumn: (name: string, sourceColumn?: { name: string; type?: string }) => void;
  removeColumn: (name: string) => void;
  keepColumns: (names: string[]) => void;
  replaceColumns: (columns: GeneratedWorkflowColumnBinding[]) => void;
}

interface GeneratedWorkflowOperationDefinition {
  promptSpec: Record<string, unknown>;
  compile: (
    operation: Record<string, unknown> & { type: string },
    context: GeneratedWorkflowOperationCompileContext
  ) => void;
}

const GENERATED_WORKFLOW_OPERATION_REGISTRY: Record<string, GeneratedWorkflowOperationDefinition> =
  {
    filter: {
      promptSpec: {
        type: 'filter',
        column:
          'current field name; use original input column unless an earlier rename created a new field name',
        operator: '= | <> | > | >= | < | <= | contains | not_contains | is_null | is_not_null',
        value: 'literal value; omit for null checks',
        rightColumn:
          'optional current field name for field-to-field comparisons, for example Profit < Target Profit. Use this instead of value when the right side is a field.',
      },
      compile(operation, context) {
        const column = context.requireColumn(columnNameFromPlan(operation), 'filter.column');
        const operator = normalizePlanFilterOperator(operation.operator);
        const field = formatDslField(column.name);
        const rightColumnName = resolvePlanFilterRightColumnName(operation);
        const rightColumn = rightColumnName
          ? context.requireColumn(rightColumnName, 'filter.rightColumn')
          : null;
        const condition =
          operator === 'is_null' || operator === 'is_not_null'
            ? `${field} ${operator === 'is_null' ? 'IS NULL' : 'IS NOT NULL'}`
            : operator === 'contains' || operator === 'not_contains'
              ? `${operator === 'not_contains' ? 'NOT ' : ''}contains(CAST(${field} AS VARCHAR), ${literalToDsl(operation.value)})`
              : rightColumn
                ? `${field} ${operator} ${formatDslField(rightColumn.name)}`
                : `${field} ${operator} ${literalToDsl(operation.value)}`;
        context.lines.push(`  | filter ${condition}`);
      },
    },
    sort: {
      promptSpec: {
        type: 'sort',
        column:
          'current field name; use original input column unless an earlier rename created a new field name',
        direction: 'asc | desc',
      },
      compile(operation, context) {
        const column = context.requireColumn(
          columnNameFromPlan(operation) ||
            inferColumnNameFromRequirement(context.requirement, context.columns, 'sort'),
          'sort.column'
        );
        const direction = normalizePlanSortDirection(operation.direction ?? operation.order);
        context.lines.push(`  | sort by ${formatDslField(column.name)} ${direction}`);
      },
    },
    convert_type: {
      promptSpec: {
        type: 'convert_type',
        column:
          'current field name to overwrite; use original input column unless an earlier rename created a new field name',
        targetType: 'text | integer | float | decimal | date | datetime | boolean',
        removePrefix: 'optional string prefix to remove before casting',
        removeChars: 'optional array of literal strings to remove before casting',
        scale: 'optional decimal scale for targetType decimal',
        onError: 'null | fail',
      },
      compile(operation, context) {
        const column = context.requireColumn(columnNameFromPlan(operation), 'convert_type.column');
        const targetType = normalizePlanTargetType(operation.targetType);
        const onError = operation.onError === 'fail' ? 'fail' : 'null';
        const removeChars = Array.isArray(operation.removeChars)
          ? operation.removeChars.filter((value): value is string => typeof value === 'string')
          : [];
        const removePrefix =
          typeof operation.removePrefix === 'string' && operation.removePrefix
            ? operation.removePrefix
            : '';
        if (removePrefix || removeChars.length > 0 || operation.scale !== undefined) {
          const expression = compilePlanTypeConversionExpression({
            columnName: column.name,
            targetType,
            removePrefix,
            removeChars,
            scale: operation.scale,
          });
          context.lines.push(`  | derive ${formatDslField(column.name)} = ${expression}`);
        } else {
          context.lines.push(
            `  | cast ${formatDslField(column.name)} as ${targetType} on_error ${onError}`
          );
        }
      },
    },
    select: {
      promptSpec: { type: 'select', columns: 'array of existing input columns to keep' },
      compile(operation, context) {
        const selected = columnListFromPlan(operation).map(
          (name) => context.requireColumn(name, 'select.columns').name
        );
        if (selected.length > 0) {
          context.lines.push(`  | select ${selected.map(formatDslField).join(', ')}`);
          context.keepColumns(selected);
        }
      },
    },
    drop: {
      promptSpec: { type: 'drop', columns: 'array of existing input columns to remove' },
      compile(operation, context) {
        const dropped = columnListFromPlan(operation).map(
          (name) => context.requireColumn(name, 'drop.columns').name
        );
        if (dropped.length > 0) {
          context.lines.push(`  | drop ${dropped.map(formatDslField).join(', ')}`);
          dropped.forEach((name) => context.removeColumn(name));
        }
      },
    },
    rename: {
      promptSpec: {
        type: 'rename',
        source: 'existing input column',
        target: 'new output column name',
      },
      compile(operation, context) {
        const source = context.requireColumn(
          operation.source ?? columnNameFromPlan(operation),
          'rename.source'
        );
        const target = normalizeRequiredName(
          typeof operation.target === 'string' ? operation.target : '',
          'Generated rename operation requires target'
        );
        context.lines.push(`  | map ${formatDslField(source.name)} to ${formatDslField(target)}`);
        context.renameColumn(source.name, target);
      },
    },
    derive: {
      promptSpec: {
        type: 'derive',
        column: 'output column name to create or overwrite',
        expression:
          'Prep scalar expression only when no structured operation can express it. Reference fields with [field] or [`field name`]. Never use bare SQL identifiers/backticks such as `field name`.',
      },
      compile(operation, context) {
        const column = normalizeRequiredName(
          typeof operation.column === 'string' ? operation.column : '',
          'Generated derive operation requires column'
        );
        const expression = normalizeRequiredName(
          typeof operation.expression === 'string' ? operation.expression : '',
          'Generated derive operation requires expression'
        );
        context.lines.push(
          `  | derive ${formatDslField(column)} = ${context.normalizeExpression(expression)}`
        );
        context.upsertColumn(column);
      },
    },
    aggregate: {
      promptSpec: {
        type: 'aggregate',
        groupBy: 'array of existing input columns',
        metrics:
          'array of { function: sum|avg|min|max|count|count_distinct, column: existing input column or "*", alias: output column name }',
      },
      compile(operation, context) {
        const groupBy = stringArrayFromPlan(operation.groupBy).map((name) =>
          context.requireColumn(name, 'aggregate.groupBy')
        );
        const metrics = Array.isArray(operation.metrics)
          ? operation.metrics
              .filter(isRecord)
              .map((metric) => compilePlanAggregateMetric(metric, context.requireColumn))
          : [];
        if (metrics.length === 0) {
          throw new DataCommandError(
            'VALIDATION_FAILED',
            'Generated aggregate operation requires metrics'
          );
        }
        context.lines.push(
          `  | aggregate ${
            groupBy.length > 0
              ? `by ${groupBy.map((column) => formatDslField(column.name)).join(', ')}`
              : 'all'
          } metrics ${metrics.map((metric) => metric.dsl).join(', ')}`
        );
        context.replaceColumns([
          ...groupBy.map((column) => ({
            name: column.name,
            type: column.type,
            sourceColumn: column,
          })),
          ...metrics.map((metric) => ({ name: metric.alias })),
        ]);
      },
    },
  };

function getGeneratedWorkflowOperationPromptSpecs(): Record<string, unknown>[] {
  return Object.values(GENERATED_WORKFLOW_OPERATION_REGISTRY).map(
    (definition) => definition.promptSpec
  );
}

function compileGeneratedWorkflowPlan({
  operations,
  inputTableId,
  outputTableName,
  requirement,
  columns,
}: {
  operations: unknown[];
  inputTableId: string;
  outputTableName: string;
  requirement: string;
  columns: Array<{ name: string; type?: string }>;
}): { workflowDsl: string; requiredColumns: Array<{ name: string; type?: string }> } {
  const columnsByName = new Map<string, GeneratedWorkflowColumnBinding>(
    columns.map((column) => [
      column.name.toLowerCase(),
      { name: column.name, type: column.type, sourceColumn: column },
    ])
  );
  const requiredColumnsByName = new Map<string, { name: string; type?: string }>();
  const requireColumn = (name: unknown, context = 'operation'): { name: string; type?: string } => {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!normalized) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated workflow plan ${context} is missing an input column`
      );
    }
    const column = normalized ? columnsByName.get(normalized.toLowerCase()) : undefined;
    if (!column) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated workflow plan ${context} references unknown input column: ${String(name)}`
      );
    }
    if (column.sourceColumn) {
      requiredColumnsByName.set(column.sourceColumn.name.toLowerCase(), column.sourceColumn);
    }
    return { name: column.name, type: column.type };
  };
  const renameColumn = (sourceName: string, targetName: string) => {
    const source = columnsByName.get(sourceName.toLowerCase());
    if (!source) return;
    columnsByName.delete(sourceName.toLowerCase());
    columnsByName.set(targetName.toLowerCase(), {
      name: targetName,
      type: source.type,
      sourceColumn: source.sourceColumn,
    });
  };
  const upsertColumn = (name: string, sourceColumn?: { name: string; type?: string }) => {
    columnsByName.set(name.toLowerCase(), {
      name,
      type: sourceColumn?.type,
      sourceColumn,
    });
  };
  const removeColumn = (name: string) => {
    columnsByName.delete(name.toLowerCase());
  };
  const keepColumns = (names: string[]) => {
    const kept = new Map<string, GeneratedWorkflowColumnBinding>();
    for (const name of names) {
      const column = columnsByName.get(name.toLowerCase());
      if (column) kept.set(column.name.toLowerCase(), column);
    }
    columnsByName.clear();
    for (const [key, column] of kept) {
      columnsByName.set(key, column);
    }
  };
  const replaceColumns = (columns: GeneratedWorkflowColumnBinding[]) => {
    columnsByName.clear();
    for (const column of columns) {
      columnsByName.set(column.name.toLowerCase(), column);
    }
  };
  const lines = [`input source dataset "${escapeDslString(inputTableId)}" as src`];
  const context: GeneratedWorkflowOperationCompileContext = {
    columns,
    lines,
    requirement,
    requireColumn,
    normalizeExpression: (expression) =>
      normalizeGeneratedPlanExpression(expression, columnsByName),
    renameColumn,
    upsertColumn,
    removeColumn,
    keepColumns,
    replaceColumns,
  };
  for (const rawOperationInput of operations) {
    const rawOperation = normalizeGeneratedWorkflowOperation(rawOperationInput);
    const compiler = GENERATED_WORKFLOW_OPERATION_REGISTRY[rawOperation.type];
    if (!compiler) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated workflow plan uses unsupported operation: ${rawOperation.type}`
      );
    }
    compiler.compile(rawOperation, context);
  }
  lines.push(`  | output table "${escapeDslString(outputTableName)}" mode replace`);
  return {
    workflowDsl: lines.join('\n'),
    requiredColumns: [...requiredColumnsByName.values()],
  };
}

function normalizeGeneratedWorkflowOperation(operation: unknown): Record<string, unknown> & {
  type: string;
} {
  if (!isRecord(operation) || typeof operation.type !== 'string' || !operation.type.trim()) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow plan has invalid operation'
    );
  }
  const fields = isRecord(operation.fields) ? operation.fields : {};
  return {
    ...fields,
    ...operation,
    type: operation.type.trim().toLowerCase(),
  };
}

function normalizeGeneratedPlanExpression(
  expression: string,
  columnsByName: Map<string, GeneratedWorkflowColumnBinding>
): string {
  let normalized = '';
  let index = 0;
  let quote: '"' | "'" | null = null;

  while (index < expression.length) {
    const char = expression[index];
    if (quote) {
      if (char === '\\') {
        const next = expression[index + 1];
        if (next !== undefined) {
          const following = expression[index + 2];
          if (next === '\\' && following === 'd') {
            normalized += '[0-9]';
            index += 3;
            continue;
          }
          normalized += normalizeGeneratedRegexEscape(next);
          index += 2;
          continue;
        }
      }
      normalized += char;
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      normalized += char;
      index += 1;
      continue;
    }

    if (char === '[' && expression[index + 1] === '`') {
      const fieldEnd = findDslBacktickFieldEnd(expression, index + 2);
      if (fieldEnd !== null) {
        normalized += expression.slice(index, fieldEnd + 1);
        index = fieldEnd + 1;
        continue;
      }
    }

    if (char === '[') {
      const parsed = readBracketFieldToken(expression, index);
      if (parsed) {
        const column = columnsByName.get(parsed.value.toLowerCase());
        normalized += column ? formatDslField(column.name) : parsed.raw;
        index = parsed.end;
        continue;
      }
    }

    if (char === '`') {
      const parsed = readBacktickToken(expression, index);
      if (parsed) {
        const column = columnsByName.get(parsed.value.toLowerCase());
        normalized += column ? formatDslField(column.name) : parsed.raw;
        index = parsed.end;
        continue;
      }
    }

    normalized += char;
    index += 1;
  }

  return normalized;
}

function normalizeGeneratedRegexEscape(char: string): string {
  return char === 'd' ? '[0-9]' : `\\${char}`;
}

function readBacktickToken(
  expression: string,
  start: number
): { raw: string; value: string; end: number } | null {
  let raw = '`';
  let value = '';
  for (let index = start + 1; index < expression.length; index += 1) {
    const char = expression[index];
    raw += char;
    if (char === '\\') {
      const next = expression[index + 1];
      if (next !== undefined) {
        raw += next;
        value += next;
        index += 1;
      }
      continue;
    }
    if (char === '`') {
      return { raw, value, end: index + 1 };
    }
    value += char;
  }
  return null;
}

function readBracketFieldToken(
  expression: string,
  start: number
): { raw: string; value: string; end: number } | null {
  let raw = '[';
  let value = '';
  for (let index = start + 1; index < expression.length; index += 1) {
    const char = expression[index];
    raw += char;
    if (char === ']') {
      return { raw, value: value.trim(), end: index + 1 };
    }
    value += char;
  }
  return null;
}

function normalizePlanFilterOperator(operator: unknown): string {
  switch (operator) {
    case '=':
    case '<>':
    case '>':
    case '>=':
    case '<':
    case '<=':
    case 'contains':
    case 'not_contains':
    case 'is_null':
    case 'is_not_null':
      return operator;
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated filter operation uses unsupported operator: ${String(operator)}`
      );
  }
}

function resolvePlanFilterRightColumnName(operation: Record<string, unknown>): string {
  for (const key of ['rightColumn', 'compareColumn', 'rightField', 'fieldValue']) {
    const value = operation[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return parseDslFieldRefName(operation.value);
}

function parseDslFieldRefName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const backtickMatch = /^\[\s*`((?:[^`\\]|\\.)*)`\s*\]$/u.exec(trimmed);
  if (backtickMatch?.[1]) {
    return unescapeDslBacktickField(backtickMatch[1]);
  }
  const simpleMatch = /^\[\s*([\p{L}_][\p{L}\p{N}_]*)\s*\]$/u.exec(trimmed);
  if (simpleMatch?.[1]) return simpleMatch[1];
  const looseMatch = /^\[\s*([^\]]+?)\s*\]$/u.exec(trimmed);
  return looseMatch?.[1]?.trim() ?? '';
}

function normalizePlanSortDirection(direction: unknown): 'asc' | 'desc' {
  const normalized = typeof direction === 'string' ? direction.toLowerCase().trim() : '';
  return normalized === 'desc' || normalized === 'descending' ? 'desc' : 'asc';
}

function normalizePlanTargetType(targetType: unknown): string {
  switch (targetType) {
    case 'text':
    case 'integer':
    case 'float':
    case 'decimal':
    case 'date':
    case 'datetime':
    case 'boolean':
      return targetType;
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated convert_type operation uses unsupported targetType: ${String(targetType)}`
      );
  }
}

function compilePlanTypeConversionExpression({
  columnName,
  targetType,
  removePrefix,
  removeChars,
  scale,
}: {
  columnName: string;
  targetType: string;
  removePrefix: string;
  removeChars: string[];
  scale: unknown;
}): string {
  let expression = `CAST(${formatDslField(columnName)} AS VARCHAR)`;
  for (const value of [removePrefix, ...removeChars].filter(Boolean)) {
    expression = `REPLACE(${expression}, ${literalToDsl(value)}, '')`;
  }
  if (targetType === 'text') return expression;
  const storageType =
    targetType === 'decimal'
      ? `DECIMAL(18,${normalizeDecimalScale(scale)})`
      : targetType.toUpperCase();
  return `CAST(${expression} AS ${storageType})`;
}

function normalizeDecimalScale(scale: unknown): number {
  const numericScale = Number(scale);
  if (Number.isFinite(numericScale) && numericScale >= 0 && numericScale <= 12) {
    return Math.floor(numericScale);
  }
  return 2;
}

function compilePlanAggregateMetric(
  metric: Record<string, unknown>,
  requireColumn: (name: unknown, context?: string) => { name: string; type?: string }
): { dsl: string; alias: string } {
  const fn = normalizePlanAggregateFunction(metric.function);
  const column =
    metric.column === '*'
      ? '*'
      : formatDslField(
          requireColumn(metric.column ?? metric.expression, 'aggregate.metrics.column').name
        );
  const alias = normalizeRequiredName(
    typeof metric.alias === 'string' ? metric.alias : `${fn}_${String(metric.column ?? 'all')}`,
    'Generated aggregate metric requires alias'
  );
  const metricFunction = fn === 'count_distinct' ? 'count_distinct' : fn;
  return { dsl: `${metricFunction}(${column}) as ${formatDslField(alias)}`, alias };
}

function normalizePlanAggregateFunction(fn: unknown): string {
  switch (fn) {
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
    case 'count':
    case 'count_distinct':
      return fn;
    default:
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated aggregate operation uses unsupported function: ${String(fn)}`
      );
  }
}

function stringArrayFromPlan(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function columnListFromPlan(operation: Record<string, unknown>): string[] {
  const fromColumns = stringArrayFromPlan(operation.columns);
  if (fromColumns.length > 0) return fromColumns;
  const singleColumn = columnNameFromPlan(operation);
  return singleColumn ? [singleColumn] : [];
}

function columnNameFromPlan(operation: Record<string, unknown>): string {
  for (const key of ['column', 'field', 'by', 'sortBy', 'orderBy', 'name']) {
    const value = operation[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const key of ['columns', 'fields']) {
    const value = stringArrayFromPlan(operation[key]);
    if (value.length > 0) return value[0];
  }
  if (isRecord(operation.target) && typeof operation.target.column === 'string') {
    return operation.target.column.trim();
  }
  return '';
}

function inferColumnNameFromRequirement(
  requirement: string,
  columns: Array<{ name: string; type?: string }>,
  _operationType: string
): string {
  const normalizedRequirement = normalizeColumnMatchText(requirement);
  const matched = columns
    .filter((column) => {
      const normalizedColumnName = normalizeColumnMatchText(column.name);
      return (
        normalizedColumnName &&
        normalizedRequirementContainsColumnName(normalizedRequirement, normalizedColumnName)
      );
    })
    .sort((left, right) => right.name.length - left.name.length);
  return matched[0]?.name ?? '';
}

function normalizeColumnMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function normalizedRequirementContainsColumnName(
  normalizedRequirement: string,
  normalizedColumnName: string
): boolean {
  if (!/^[a-z0-9_]+$/i.test(normalizedColumnName)) {
    return normalizedRequirement.includes(normalizedColumnName);
  }
  const escapedName = normalizedColumnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${escapedName}($|[^a-z0-9_])`, 'i').test(normalizedRequirement);
}

function formatDslField(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)
    ? `[${name}]`
    : `[\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\`]`;
}

function literalToDsl(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function parseGeneratedWorkflowDslResponse(
  text: string,
  columns: Array<{ name: string; type?: string }>
): { workflowDsl: string; requiredColumns: Array<{ name: string; type?: string }> } {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isRecord(parsed) || typeof parsed.workflowDsl !== 'string') {
    throw new Error('Workflow DSL generation response must include workflowDsl');
  }
  const workflowDsl = parsed.workflowDsl.trim();
  validateGeneratedWorkflowDslText(workflowDsl);
  const parsedDsl = parsePrepDsl(workflowDsl);
  const parseErrors = diagnosticsWithSeverity(parsedDsl.diagnostics, 'error');
  if (!parsedDsl.ast || parseErrors.length > 0) {
    throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(parseErrors), {
      diagnostics: parsedDsl.diagnostics,
    });
  }
  if (parsedDsl.ast.sources.length === 0 || !parsedDsl.ast.output) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow must include an input source and an output table'
    );
  }
  validateGeneratedWorkflowAst(parsedDsl.ast.operators);

  const columnsByName = new Map(columns.map((column) => [column.name.toLowerCase(), column]));
  const modelRequiredColumns = Array.isArray(parsed.requiredColumns)
    ? parsed.requiredColumns
        .map((column) => {
          const name = isRecord(column) ? String(column.name ?? '').trim() : '';
          if (!name) return null;
          return columnsByName.get(name.toLowerCase()) ?? null;
        })
        .filter((column): column is { name: string; type?: string } => Boolean(column))
    : [];
  const extractedColumns = resolveRequiredInputColumnsFromWorkflow(
    parsedDsl.ast.operators,
    columns
  );
  const requiredColumnsByName = new Map<string, { name: string; type?: string }>();
  for (const column of modelRequiredColumns) {
    requiredColumnsByName.set(column.name.toLowerCase(), column);
  }
  for (const column of extractedColumns) {
    requiredColumnsByName.set(column.name.toLowerCase(), column);
  }
  return {
    workflowDsl,
    requiredColumns: [...requiredColumnsByName.values()],
  };
}

function validateGeneratedWorkflowDslText(workflowDsl: string): void {
  const invalidQuotedFieldRef = /\[\s*['"]/.exec(workflowDsl);
  if (invalidQuotedFieldRef) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow uses invalid quoted field syntax. Use [`field name`] for fields with spaces.'
    );
  }
  if (hasBareBacktickOutsideString(workflowDsl)) {
    throw new DataCommandError(
      'VALIDATION_FAILED',
      'Generated workflow uses invalid bare backtick field syntax. Use [`field name`] inside expressions.'
    );
  }
}

function hasBareBacktickOutsideString(value: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[' && value[index + 1] === '`') {
      const fieldEnd = findDslBacktickFieldEnd(value, index + 2);
      if (fieldEnd !== null) {
        index = fieldEnd;
        continue;
      }
    }
    if (char === '`') {
      return true;
    }
  }
  return false;
}

function findDslBacktickFieldEnd(value: string, start: number): number | null {
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '`') {
      return value[index + 1] === ']' ? index + 1 : null;
    }
  }
  return null;
}

function validateGeneratedWorkflowAst(operators: PrepOperatorAst[]): void {
  for (const operator of operators) {
    if (
      operator.type === 'calculate_field' &&
      objectArray(operator.config.calculations).length === 0
    ) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'Generated derive operator has no valid calculations'
      );
    }
  }
}

function resolveRequiredInputColumnsFromWorkflow(
  operators: PrepOperatorAst[],
  columns: Array<{ name: string; type?: string }>
): Array<{ name: string; type?: string }> {
  const availableColumns = new Map<string, GeneratedWorkflowColumnBinding>(
    columns.map((column) => [
      column.name.toLowerCase(),
      { name: column.name, type: column.type, sourceColumn: column },
    ])
  );
  const requiredColumnsByName = new Map<string, { name: string; type?: string }>();
  const requireName = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const name = stripQualifiedFieldName(value.trim());
    const column = availableColumns.get(name.toLowerCase());
    if (!column) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        `Generated workflow references unknown input column(s): ${name}`
      );
    }
    if (column.sourceColumn) {
      requiredColumnsByName.set(column.sourceColumn.name.toLowerCase(), column.sourceColumn);
    }
    return column;
  };
  const requireNames = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value
      .map(requireName)
      .filter((column): column is GeneratedWorkflowColumnBinding => Boolean(column));
  };
  const requireExpression = (value: unknown) => {
    if (typeof value !== 'string') return;
    extractFieldNamesFromExpression(value).forEach((name) => requireName(name));
  };
  const removeName = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    availableColumns.delete(stripQualifiedFieldName(value.trim()).toLowerCase());
  };
  const upsertName = (name: unknown, source?: GeneratedWorkflowColumnBinding | null) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const normalized = stripQualifiedFieldName(name.trim());
    availableColumns.set(normalized.toLowerCase(), {
      name: normalized,
      type: source?.type,
      sourceColumn: source?.sourceColumn,
    });
  };
  const keepNames = (names: unknown) => {
    if (!Array.isArray(names)) return;
    const kept = new Map<string, GeneratedWorkflowColumnBinding>();
    for (const item of names) {
      const column = requireName(item);
      if (column) kept.set(column.name.toLowerCase(), column);
    }
    availableColumns.clear();
    for (const [key, column] of kept) {
      availableColumns.set(key, column);
    }
  };

  for (const operator of operators) {
    const config = operator.config ?? {};
    switch (operator.type) {
      case 'field_select':
        if (config.mode === 'exclude') {
          requireNames(config.columns);
          if (Array.isArray(config.columns)) config.columns.forEach(removeName);
        } else {
          keepNames(config.columns);
        }
        break;
      case 'field_mapping':
        objectArray(config.mappings).forEach((mapping) => {
          const source = requireName(mapping.source);
          removeName(mapping.source);
          upsertName(mapping.target, source);
        });
        break;
      case 'filter':
        requireExpression(config.condition);
        break;
      case 'deduplicate':
        requireNames(config.columns);
        objectArray(config.orderBy).forEach((key) => requireName(key.field));
        break;
      case 'missing_value':
        requireNames(config.columns);
        objectArray(config.rules).forEach((rule) => requireName(rule.column));
        break;
      case 'type_convert':
        objectArray(config.conversions).forEach((conversion) => requireName(conversion.column));
        break;
      case 'sort':
        objectArray(config.keys).forEach((key) => requireName(key.field));
        break;
      case 'aggregate':
        requireNames(config.groupBy);
        objectArray(config.metrics).forEach((metric) => {
          if (metric.expression !== '*') requireExpression(metric.expression);
        });
        break;
      case 'calculate_field':
        objectArray(config.calculations).forEach((calculation) =>
          requireExpression(calculation.expression)
        );
        objectArray(config.calculations).forEach((calculation) => upsertName(calculation.field));
        break;
      case 'pivot':
        requireNames(config.on);
        requireNames(config.groupBy);
        objectArray(config.using).forEach((metric) => {
          if (metric.expression !== '*') requireExpression(metric.expression);
        });
        break;
      case 'unpivot':
        requireNames(config.columns);
        break;
      case 'unnest':
        requireName(config.column);
        break;
      case 'join':
        objectArray(config.conditions).forEach((condition) => {
          requireName(condition.left);
          requireName(condition.right);
        });
        if (isRecord(config.asof)) {
          requireName(config.asof.leftTime);
          requireName(config.asof.rightTime);
          objectArray(config.asof.by).forEach((condition) => {
            requireName(condition.left);
            requireName(condition.right);
          });
        }
        objectArray(config.keep).forEach((item) => requireName(item.source));
        break;
      default:
        break;
    }
  }
  return [...requiredColumnsByName.values()];
}

const DSL_FIELD_REF_TOKEN_PATTERN = '\\[(?:`((?:[^`\\\\]|\\\\.)*)`|([\\p{L}_][\\p{L}\\p{N}_]*))\\]';
const DSL_FIELD_REF_PATTERN = new RegExp(
  `${DSL_FIELD_REF_TOKEN_PATTERN}(?:\\.${DSL_FIELD_REF_TOKEN_PATTERN})?`,
  'gu'
);
const DSL_STRING_LITERAL_PATTERN = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

function extractFieldNamesFromExpression(expression: string): string[] {
  const withoutStrings = expression.replace(DSL_STRING_LITERAL_PATTERN, '');
  const names: string[] = [];
  for (const match of withoutStrings.matchAll(DSL_FIELD_REF_PATTERN)) {
    const first = match[1] ?? match[2] ?? '';
    const second = match[3] ?? match[4] ?? '';
    const name = unescapeDslBacktickField(second || first);
    if (name) names.push(name);
  }
  return names;
}

function stripQualifiedFieldName(name: string): string {
  const separatorIndex = name.lastIndexOf('.');
  return separatorIndex >= 0 ? name.slice(separatorIndex + 1) : name;
}

function unescapeDslBacktickField(name: string): string {
  return name.replace(/\\`/g, '`').replace(/\\\\/g, '\\');
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
