import type { DataTaskStore } from './data-task-store';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import {
  compilePrepWorkflowToFlow,
  exportPrepWorkflowDsl,
  parsePrepDsl,
  parsePrepOperatorDsl,
  type PrepDiagnostic,
} from '../../shared/prep-dsl';
import type {
  DataAutomationColumnSnapshot,
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
  type AnalyzeTaskRequirementCommand,
  type AnalyzeTaskRequirementResult,
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
import { log } from '../utils/logger';
import type {
  PersonalAnalysisConnectionInput,
  StoredPersonalAnalysisConfig,
} from '../../shared/personal-analysis-types';
import {
  GENERATED_WORKFLOW_REPAIR_ATTEMPTS,
  analyzeDataTaskRequirement,
  type GeneratedDataTaskWorkflow,
  generateDataTaskWorkflowFromRequirement,
  hashColumns,
  isRecord,
  normalizeColumnSnapshot,
  reconcileGeneratedWorkflowWithOutputPreview,
  repairGeneratedWorkflowFromDiagnostics,
  validateGeneratedOutputPreviewSchema,
  validateGeneratedTaskSchema,
  validateGeneratedWorkflowGenerationContract,
} from './workflow';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;
const WORKFLOW_CANDIDATE_CACHE_LIMIT = 100;

interface WorkflowResourceBindings {
  inputTableId?: string;
  inputAlias?: string;
  outputTableId?: string;
}

interface CompiledWorkflowCandidate {
  workflow: WorkflowSaveShape;
  diagnostics: PrepDiagnostic[];
}

interface ResolvedGeneratedOutputTable {
  outputTable: DataOutputTable;
  created: boolean;
}

interface DataCommandServiceOptions {
  onTaskCompleted?: (task: DataCleaningTask) => void;
  getPersonalAnalysisConnection?: () => PersonalAnalysisConnectionInput | null;
}

export class DataCommandService {
  private readonly inputTables: InputTablesCommandService;
  private readonly outputTables: OutputTablesCommandService;
  private readonly cloudAnalysis: CloudAnalysisCommandService;
  private readonly keyedLocks = new Map<string, Promise<void>>();
  private readonly workflowCandidateCache = new Map<string, Promise<CompiledWorkflowCandidate>>();

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
    const resolvedOutput = await this.resolveGeneratedOutputTable(
      input.output,
      displayInputTableName
    );
    const outputTable = resolvedOutput.outputTable;
    const reusableTask = await this.resolveReusableGeneratedTask(input.reuseTaskId);
    let createdTaskId: string | undefined;
    let task: DataCleaningTask;
    try {
      task =
        reusableTask ??
        (
          await this.createTask({
            name: await this.createUniqueTaskName(`${displayInputTableName || '数据表'}_自动处理`),
            sourceInputTableId: preparedInput.inputTable.id,
            outputTableId: outputTable.id,
          })
        ).task;
    } catch (error) {
      if (resolvedOutput.created) {
        await this.store.deleteDataset(outputTable.id).catch((cleanupError) => {
          logDataCommandFallback('Failed to roll back generated output dataset', cleanupError, {
            outputTableId: outputTable.id,
          });
        });
      }
      throw error;
    }
    if (!reusableTask) createdTaskId = task.id;
    try {
      return await this.withKeyedLock(`task:${task.id}`, async () => {
        let generated = await generateDataTaskWorkflowFromRequirement({
          inputTableId: preparedInput.inputTable.id,
          outputTableName: outputTable.name,
          requirement: processRequirement,
          columns: preparedInput.columnsSnapshot,
          runtimeConfig: input.runtimeConfig,
        });
        let validation = await this.validateGeneratedWorkflowCandidate({
          taskId: task.id,
          inputTableId: preparedInput.inputTable.id,
          outputTableId: outputTable.id,
          columns: preparedInput.columnsSnapshot,
          generated,
        });
        generated = validation.generated ?? generated;
        let validationErrors = diagnosticsWithSeverity(validation.diagnostics, 'error');
        for (
          let repairAttempt = 0;
          validationErrors.length > 0 &&
          validationErrors.every(isGeneratedWorkflowDiagnosticRepairable) &&
          repairAttempt < GENERATED_WORKFLOW_REPAIR_ATTEMPTS;
          repairAttempt += 1
        ) {
          if (!generated.javascriptSource) {
            throw new DataCommandError(
              'VALIDATION_FAILED',
              'Generated workflow repair requires the original JavaScript source'
            );
          }
          generated = await repairGeneratedWorkflowFromDiagnostics({
            inputTableId: preparedInput.inputTable.id,
            outputTableName: outputTable.name,
            requirement: processRequirement,
            columns: preparedInput.columnsSnapshot,
            runtimeConfig: input.runtimeConfig,
            failedJavascriptSource: generated.javascriptSource,
            diagnostics: validationErrors,
          });
          validation = await this.validateGeneratedWorkflowCandidate({
            taskId: task.id,
            inputTableId: preparedInput.inputTable.id,
            outputTableId: outputTable.id,
            columns: preparedInput.columnsSnapshot,
            generated,
          });
          generated = validation.generated ?? generated;
          validationErrors = diagnosticsWithSeverity(validation.diagnostics, 'error');
        }
        if (validationErrors.length > 0) {
          throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(validationErrors), {
            diagnostics: validation.diagnostics,
          });
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
          workflowDsl: generated.workflowDsl,
          requiredColumns: generated.requiredColumns,
          expectedOutputSchema: generated.expectedOutputSchema,
          lineage: generated.lineage,
          columnsSnapshot: preparedInput.columnsSnapshot,
          sourceSummaryHash: hashColumns(preparedInput.columnsSnapshot),
          workflowHash: hashText(generated.workflowDsl),
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
      if (resolvedOutput.created) {
        await this.store.deleteDataset(outputTable.id).catch((cleanupError) => {
          logDataCommandFallback('Failed to roll back generated output dataset', cleanupError, {
            outputTableId: outputTable.id,
          });
        });
      }
      throw error;
    }
  }

  async analyzeTaskRequirement(
    input: AnalyzeTaskRequirementCommand
  ): Promise<AnalyzeTaskRequirementResult> {
    const processRequirement = normalizeRequiredName(
      input.processRequirement,
      'Processing requirement is required'
    );
    const preparedInput = await this.prepareGeneratedTaskInput(input);
    return analyzeDataTaskRequirement({
      requirement: processRequirement,
      columns: preparedInput.columnsSnapshot,
      runtimeConfig: input.runtimeConfig,
    });
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
    return this.withKeyedLock(`task:${input.taskId}`, () => this.applyWorkflowDslUnlocked(input));
  }

  private async applyWorkflowDslUnlocked(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
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
    return this.withKeyedLock(`task:${input.taskId}`, () =>
      this.configureInputOperatorUnlocked(input)
    );
  }

  private async configureInputOperatorUnlocked(
    input: ConfigureInputOperatorCommand
  ): Promise<WorkflowResult> {
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
    return this.withKeyedLock(`task:${input.taskId}`, () => this.applyOperatorDslUnlocked(input));
  }

  private async applyOperatorDslUnlocked(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
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
    return this.withKeyedLock(`task:${input.taskId}`, () =>
      this.configureOutputOperatorUnlocked(input)
    );
  }

  private async configureOutputOperatorUnlocked(
    input: ConfigureOutputOperatorCommand
  ): Promise<WorkflowResult> {
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

  private async validateGeneratedWorkflowCandidate(input: {
    taskId: string;
    inputTableId: string;
    outputTableId: string;
    columns: DataAutomationColumnSnapshot[];
    generated: GeneratedDataTaskWorkflow;
  }): Promise<{
    diagnostics: PrepDiagnostic[];
    generated?: GeneratedDataTaskWorkflow;
    candidate?: CompiledWorkflowCandidate;
  }> {
    const contractDiagnostics = validateGeneratedWorkflowGenerationContract(
      input.generated,
      input.columns
    );
    if (diagnosticsWithSeverity(contractDiagnostics, 'error').length > 0) {
      return { diagnostics: contractDiagnostics };
    }

    const candidate = attachGeneratedOperationOrigins(
      await this.compileWorkflowDsl(input.generated.workflowDsl, {
        inputTableId: input.inputTableId,
        outputTableId: input.outputTableId,
      }),
      input.generated.operationOrigins
    );
    const dryRunDiagnostics = candidate.diagnostics;
    if (diagnosticsWithSeverity(dryRunDiagnostics, 'error').length > 0) {
      return { diagnostics: dryRunDiagnostics };
    }

    let temporaryTask: DataCleaningTask | undefined;
    try {
      const temporaryExecution = await this.store.validateTaskWorkflow(input.taskId, {
        workflow: candidate.workflow,
      });
      temporaryTask = temporaryExecution.task;
      const temporaryRun: RunTaskResult = {
        task: temporaryExecution.task,
        preview: await this.previewTaskOutput(
          input.taskId,
          temporaryExecution.task,
          20,
          candidate.workflow
        ),
        diagnostics: temporaryExecution.diagnostics,
      };
      const outputSchemaDiagnostics = validateGeneratedOutputPreviewSchema(
        temporaryRun.preview,
        input.generated.expectedOutputSchema
      ).map((diagnostic) => ({
        ...diagnostic,
        severity: 'warning' as const,
        code: 'outputSchemaCalibrated',
        message: `Static output schema was calibrated from temporary run: ${diagnostic.message}`,
      }));
      const generated = reconcileGeneratedWorkflowWithOutputPreview(
        input.generated,
        temporaryRun.preview,
        input.columns
      );
      return {
        generated,
        candidate,
        diagnostics: [
          ...dryRunDiagnostics,
          ...(temporaryRun.diagnostics ?? []),
          ...outputSchemaDiagnostics,
        ],
      };
    } catch (error) {
      const commandError = toCommandError(error, 'RUN_FAILED');
      const executionDiagnostics =
        isRecord(commandError.details) && Array.isArray(commandError.details.diagnostics)
          ? (commandError.details.diagnostics as PrepDiagnostic[])
          : [
              {
                severity: 'error' as const,
                code: commandError.code,
                message: commandError.message,
              },
            ];
      return {
        diagnostics: [...dryRunDiagnostics, ...executionDiagnostics],
      };
    } finally {
      if (temporaryTask) {
        await this.store.cleanupTemporaryTaskResources(input.taskId).catch((cleanupError) => {
          logDataCommandFallback('Failed to clean temporary validation resources', cleanupError, {
            taskId: input.taskId,
          });
        });
      }
    }
  }

  async runTask(input: RunTaskCommand): Promise<RunTaskResult> {
    return this.withKeyedLock(`task:${input.taskId}`, () => this.runTaskUnlocked(input));
  }

  private async runTaskUnlocked(input: RunTaskCommand): Promise<RunTaskResult> {
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
    }

    const runInput: DataRunTaskInput = { outputMode };
    if (compiled) {
      runInput.workflow = compiled.workflow;
    }

    let temporaryTask: DataCleaningTask | undefined;
    try {
      const execution =
        outputMode === 'temporary'
          ? await this.store.validateTaskWorkflow(input.taskId, runInput)
          : await this.store.runTaskWithDiagnostics(input.taskId, runInput);
      const task = execution.task;
      if (outputMode === 'temporary') temporaryTask = task;
      if (compiled && input.saveWorkflow) {
        await this.store.saveTaskWorkflow(input.taskId, compiled.workflow);
      }
      if (outputMode === 'persisted') {
        this.options.onTaskCompleted?.(task);
      }
      const preview = await this.previewTaskOutput(
        input.taskId,
        task,
        input.previewRows,
        compiled?.workflow
      );
      return {
        task,
        preview,
        diagnostics: [...(compiled?.diagnostics ?? []), ...execution.diagnostics],
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    } finally {
      if (temporaryTask || outputMode === 'temporary') {
        await this.store.cleanupTemporaryTaskResources(input.taskId).catch((cleanupError) => {
          logDataCommandFallback('Failed to clean temporary task resources', cleanupError, {
            taskId: input.taskId,
          });
        });
      }
    }
  }

  async runGeneratedTask(input: RunGeneratedTaskCommand): Promise<RunGeneratedTaskResult> {
    return this.withKeyedLock(`task:${input.taskId}`, () => this.runGeneratedTaskUnlocked(input));
  }

  private async runGeneratedTaskUnlocked(
    input: RunGeneratedTaskCommand
  ): Promise<RunGeneratedTaskResult> {
    const startedAt = Date.now();
    const prepareStartedAt = Date.now();
    const preparedInput = await this.prepareGeneratedTaskInput({
      source: input.source,
      processRequirement: '',
      output: input.output,
    });
    const prepareDurationMs = Date.now() - prepareStartedAt;
    validateGeneratedTaskSchema(
      preparedInput.columnsSnapshot,
      input.requiredColumns ?? [],
      input.schemaPolicy ?? 'required_subset'
    );
    const { outputTable } = await this.resolveGeneratedOutputTable(
      input.output,
      preparedInput.inputTable.name
    );
    const compileStartedAt = Date.now();
    const workflowDsl =
      normalizeOptionalName(input.workflowDsl) ??
      (await this.exportSavedTaskWorkflowDsl(input.taskId));
    const candidate = await this.compileWorkflowDsl(workflowDsl, {
      inputTableId: preparedInput.inputTable.id,
      outputTableId: outputTable.id,
    });
    const candidateErrors = diagnosticsWithSeverity(candidate.diagnostics, 'error');
    if (candidateErrors.length > 0) {
      throw new DataCommandError('DSL_PARSE_FAILED', summarizeDiagnostics(candidateErrors), {
        diagnostics: candidate.diagnostics,
      });
    }
    const compileDurationMs = Date.now() - compileStartedAt;
    const workflowHash = hashText(workflowDsl);
    const runStartedAt = Date.now();
    const temporaryExecution = await this.store.validateTaskWorkflow(input.taskId, {
      workflow: candidate.workflow,
    });
    try {
      const preview = await this.previewTaskOutput(
        input.taskId,
        temporaryExecution.task,
        input.previewRows,
        candidate.workflow
      );
      let result: RunTaskResult = {
        task: temporaryExecution.task,
        preview,
        diagnostics: [...candidate.diagnostics, ...temporaryExecution.diagnostics],
      };
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
        const committedTask = await this.store.commitValidatedTaskOutput(
          input.taskId,
          temporaryExecution.task,
          candidate.workflow
        );
        this.options.onTaskCompleted?.(committedTask);
        result = { ...result, task: committedTask };
      }
      const runDurationMs = Date.now() - runStartedAt;
      let uploaded: RunGeneratedTaskResult['uploaded'];
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
        uploadDurationMs = Date.now() - uploadStartedAt;
      }
      log('[DataCommandService] Generated data task finished', {
        taskId: input.taskId,
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
        inputTableId: preparedInput.inputTable.id,
        outputTableId: outputTable.id,
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
      await this.store.cleanupTemporaryTaskResources(input.taskId).catch((cleanupError) => {
        logDataCommandFallback('Failed to clean generated-task temporary resources', cleanupError, {
          taskId: input.taskId,
        });
      });
    }
  }

  private async exportSavedTaskWorkflowDsl(taskId: string): Promise<string> {
    const workflow = await this.store.getTaskWorkflow(taskId);
    const dsl = exportPrepWorkflowDsl(workflow.nodes, workflow.edges).trim();
    if (!dsl) {
      throw new DataCommandError(
        'VALIDATION_FAILED',
        'The referenced data task has no saved workflow to run'
      );
    }
    return dsl;
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

  private async withKeyedLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.keyedLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.keyedLocks.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.keyedLocks.get(key) === current) {
        this.keyedLocks.delete(key);
      }
    }
  }

  private async resolveGeneratedOutputTable(
    output: GenerateTaskFromRequirementCommand['output'],
    inputTableName: string
  ): Promise<ResolvedGeneratedOutputTable> {
    if (output.location === 'local' && output.writeMode === 'replace') {
      return {
        outputTable: await this.requireOutputTable(
          normalizeRequiredName(output.targetTableId ?? '', 'Output table id is required')
        ),
        created: false,
      };
    }
    const outputTableName =
      normalizeOptionalName(output.tableName) || `${inputTableName || 'processed_table'}_processed`;
    if (output.localOutputTableId) {
      const existingOutputTable = await this.store.getOutputTableRecord(output.localOutputTableId);
      if (existingOutputTable && existingOutputTable.name === outputTableName) {
        return { outputTable: existingOutputTable, created: false };
      }
    }
    const existingOutputTable = await this.findOutputTableByExactName(outputTableName);
    if (existingOutputTable) {
      return { outputTable: existingOutputTable, created: false };
    }
    return {
      outputTable: (await this.createOutputTable({ name: outputTableName })).outputTable,
      created: true,
    };
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
    const cacheKey = hashText(JSON.stringify({ dsl, bindings }));
    const cached = this.workflowCandidateCache.get(cacheKey);
    if (cached) {
      this.workflowCandidateCache.delete(cacheKey);
      this.workflowCandidateCache.set(cacheKey, cached);
      return cloneCompiledWorkflowCandidate(await cached);
    }
    const candidatePromise = this.compileWorkflowDslUncached(dsl, bindings);
    this.workflowCandidateCache.set(cacheKey, candidatePromise);
    while (this.workflowCandidateCache.size > WORKFLOW_CANDIDATE_CACHE_LIMIT) {
      const oldestKey = this.workflowCandidateCache.keys().next().value;
      if (oldestKey) this.workflowCandidateCache.delete(oldestKey);
    }
    try {
      return cloneCompiledWorkflowCandidate(await candidatePromise);
    } catch (error) {
      this.workflowCandidateCache.delete(cacheKey);
      throw error;
    }
  }

  private async compileWorkflowDslUncached(
    dsl: string,
    bindings: WorkflowResourceBindings = {}
  ): Promise<CompiledWorkflowCandidate> {
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
    const runtimeOutputNode = runtimeWorkflow?.nodes.find((node) => node.type === 'output');
    if (runtimeOutputNode) {
      try {
        return await this.store.previewWorkflowNode({
          taskId,
          nodeId: runtimeOutputNode.id,
          nodeType: runtimeOutputNode.type,
          nodeConfig: runtimeOutputNode.config,
          limit,
          offset,
        });
      } catch (error) {
        logDataCommandFallback('Runtime output preview failed; trying saved output', error, {
          taskId,
          nodeId: runtimeOutputNode.id,
        });
        // Fall back to the saved output node or source dataset below.
      }
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
    } catch (error) {
      logDataCommandFallback('Saved output preview failed; trying source dataset', error, {
        taskId,
      });
      // Fall back to source dataset below.
    }

    if (task.sourceDatasetId) {
      try {
        return await this.previewDataset(task.sourceDatasetId, limit, offset);
      } catch (error) {
        logDataCommandFallback('Source dataset preview fallback failed', error, {
          taskId,
          sourceDatasetId: task.sourceDatasetId,
        });
        return undefined;
      }
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
      } catch (error) {
        logDataCommandFallback('Failed to infer generated-task columns from local preview', error, {
          inputTableId: inputTable.id,
        });
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
    return this.withKeyedLock(`cloud-mirror:${mirrorName}`, async () => {
      const mirrorStartedAt = Date.now();
      const existing = await this.findInputTableByExactName(mirrorName);
      const sourceVersion = normalizeOptionalName(source.updatedAt);
      const existingMirror =
        existing?.inputConfig.sourceKind === 'csv' ? existing.inputConfig.cloudMirror : undefined;
      if (
        existing &&
        sourceVersion &&
        existingMirror?.tableId === tableId &&
        existingMirror.sourceVersion === sourceVersion
      ) {
        const result = await this.reuseAutomationCloudMirrorInputTable(existing);
        log('[DataCommandService] Reused unchanged cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'version_hit',
          sourceVersion,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      }
      const downloadStartedAt = Date.now();
      const downloaded = await this.cloudAnalysis.previewCloudTable({ tableId, limit: 50 });
      const downloadDurationMs = Date.now() - downloadStartedAt;
      const contentHash = source.contentHash || (await hashFile(downloaded.downloadedFilePath));
      if (
        existing &&
        existingMirror?.tableId === tableId &&
        existingMirror.contentHash === contentHash
      ) {
        const result = await this.reuseAutomationCloudMirrorInputTable(existing);
        log('[DataCommandService] Reused unchanged cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'hash_hit',
          contentHash,
          downloadDurationMs,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      }
      const mirrorConfig = {
        sourceKind: 'csv' as const,
        header: 'auto' as const,
        dataRegion: 'auto' as const,
        encoding: 'auto' as const,
        delimiter: 'auto' as const,
        cloudMirror: { tableId, sourceVersion, contentHash },
      };
      if (existing) {
        const result = await this.updateAutomationCloudMirrorInputTable(
          existing.id,
          mirrorName,
          downloaded.downloadedFilePath,
          mirrorConfig
        );
        log('[DataCommandService] Refreshed cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'update',
          downloadDurationMs,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      }
      try {
        const result = await this.createInputTable({
          name: mirrorName,
          sourceKind: 'csv',
          filePath: downloaded.downloadedFilePath,
          config: mirrorConfig,
          previewRows: 50,
        });
        log('[DataCommandService] Refreshed cloud mirror input table', {
          tableId,
          mirrorName,
          mode: 'create',
          downloadDurationMs,
          mirrorDurationMs: Date.now() - mirrorStartedAt,
        });
        return result;
      } catch (error) {
        if (isDataCommandErrorCode(error, 'RESOURCE_ALREADY_EXISTS')) {
          const conflict = await this.findInputTableByExactName(mirrorName);
          if (conflict) {
            const result = await this.updateAutomationCloudMirrorInputTable(
              conflict.id,
              mirrorName,
              downloaded.downloadedFilePath,
              mirrorConfig
            );
            log('[DataCommandService] Refreshed cloud mirror input table', {
              tableId,
              mirrorName,
              mode: 'update_after_conflict',
              downloadDurationMs,
              mirrorDurationMs: Date.now() - mirrorStartedAt,
            });
            return result;
          }
        }
        throw error;
      }
    });
  }

  private async updateAutomationCloudMirrorInputTable(
    id: string,
    name: string,
    filePath: string,
    config: Extract<DataDataset['inputConfig'], { sourceKind: 'csv' }>
  ): Promise<InputTableResult> {
    return this.updateInputTable({
      id,
      name,
      sourceKind: 'csv',
      filePath,
      config,
      previewRows: 50,
    });
  }

  private async reuseAutomationCloudMirrorInputTable(
    inputTable: DataDataset
  ): Promise<InputTableResult> {
    return {
      inputTable,
      preview: await this.previewDataset(inputTable.id, 50),
    };
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
    return this.store.findInputTableRecordByName(name);
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
  return /^[_\p{L}][_\p{L}\p{N}]*$/u.test(normalized) ? normalized : '';
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
  if (isRecord(error) && isRecord(error.workflowOrigin)) {
    const origin = error.workflowOrigin;
    return new DataCommandError(fallbackCode, message, {
      diagnostics: [
        {
          severity: 'error',
          code: fallbackCode,
          message,
          functionName: typeof origin.functionName === 'string' ? origin.functionName : undefined,
          line: typeof origin.line === 'number' ? origin.line : undefined,
          column: typeof origin.column === 'number' ? origin.column : undefined,
        },
      ],
    });
  }
  if (
    /TransactionContext|transaction is aborted|cannot start a transaction within a transaction/i.test(
      message
    )
  ) {
    return new DataCommandError('RUN_FAILED', message);
  }
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

function attachGeneratedOperationOrigins(
  candidate: CompiledWorkflowCandidate,
  origins: GeneratedDataTaskWorkflow['operationOrigins']
): CompiledWorkflowCandidate {
  if (!origins?.length) return candidate;
  const originsByIndex = new Map(origins.map((origin) => [origin.operatorIndex, origin]));
  let operatorIndex = 0;
  return {
    ...candidate,
    workflow: {
      ...candidate.workflow,
      nodes: candidate.workflow.nodes.map((node) => {
        if (node.type === 'input_source' || node.type === 'output') return node;
        const origin = originsByIndex.get(operatorIndex);
        operatorIndex += 1;
        if (!origin) return node;
        return {
          ...node,
          config: {
            ...(node.config ?? {}),
            generatedOrigin: origin,
          },
        };
      }),
    },
  };
}

function isDataCommandErrorCode(
  error: unknown,
  code: DataCommandError['code']
): error is DataCommandError {
  return (
    (error instanceof DataCommandError && error.code === code) ||
    (isRecord(error) && error.code === code)
  );
}

function isGeneratedWorkflowDiagnosticRepairable(diagnostic: PrepDiagnostic): boolean {
  const code = diagnostic.code?.toLowerCase() ?? '';
  if (
    code === 'run_failed' ||
    code.includes('authentication') ||
    code.includes('permission') ||
    code.includes('timeout') ||
    code.includes('resource_not_found') ||
    code.includes('file_access')
  ) {
    return false;
  }
  return !/(timed?\s*out|econn|network|unauthori[sz]ed|permission denied|file.*not found|no such file|disk|cancelled|aborted)/i.test(
    diagnostic.message
  );
}

function logDataCommandFallback(
  message: string,
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  const errorDetails =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };
  log(`[DataCommandService] ${message}`, { ...context, error: errorDetails });
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

function cloneCompiledWorkflowCandidate(
  candidate: CompiledWorkflowCandidate
): CompiledWorkflowCandidate {
  return {
    workflow: structuredClone(candidate.workflow),
    diagnostics: structuredClone(candidate.diagnostics),
  };
}
