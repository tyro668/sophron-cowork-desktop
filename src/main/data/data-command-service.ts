import { exportPrepWorkflowDsl } from '../../shared/prep-dsl';
import type { DataCleaningTask, DataOutputTable } from '../../shared/contracts';
import type {
  PersonalAnalysisConnectionInput,
  StoredPersonalAnalysisConfig,
} from '../../shared/personal-analysis-types';
import type { DataTaskStore } from './data-task-store';
import type { DataTaskLlmUsageRecorder } from './data-task-llm-usage-recorder';
import type { InputTableNormalizerProjectGenerator } from './input-table-normalizer-generator';
import {
  type AnalyzeTaskRequirementCommand,
  type AnalyzeTaskRequirementResult,
  type ApplyOperatorDslCommand,
  type ApplyWorkflowDslCommand,
  type ApplyWorkflowPlanCommand,
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
  type ImportCloudTableCommand,
  type ImportCloudTableResult,
  type InputTableResult,
  type ListCloudDriveFilesCommand,
  type ListCloudDriveFilesResult,
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
  type PreviewCloudDriveFileCommand,
  type PreviewCloudDriveFileResult,
  type PreviewCloudTableCommand,
  type PreviewCloudTableResult,
  type PreviewInputTableNormalizerVersionCommand,
  type PreviewInputTableNormalizerVersionResult,
  type PreviewTableCommand,
  type PreviewTableResult,
  type PublishInputTableNormalizerVersionCommand,
  type PublishInputTableNormalizerVersionResult,
  type RunGeneratedTaskCommand,
  type RunGeneratedTaskResult,
  type RunResult,
  type RunTaskCommand,
  type RunTaskResult,
  type SearchCloudTablesCommand,
  type SearchCloudTablesResult,
  type RunOutputTableCloudActionCommand,
  type RunOutputTableCloudActionResult,
  type SetOutputTableCloudActionCommand,
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
} from './data-command-types';
import { configStore } from '../config/config-store';
import { InputTablesCommandService } from './input-tables-command-service';
import { OutputTablesCommandService } from './output-tables-command-service';
import { CloudAnalysisCommandService } from './cloud-analysis-command-service';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import { WorkflowPreviewService } from './workflow-preview-service';
import { WorkflowDslCompiler } from './workflow-dsl-compiler';
import { TaskCommandService } from './task-command-service';
import { WorkflowAuthoringCommandService } from './workflow-authoring-command-service';
import { AutomationInputResolver } from './automation-input-resolver';
import { GeneratedOutputResolver } from './generated-output-resolver';
import { GeneratedTaskCommandService } from './generated-task-command-service';
import { TaskExecutionCommandService } from './task-execution-command-service';
import { RequirementAnalysisReceiptStore } from './requirement-analysis-receipt-store';

export interface DataCommandServiceOptions {
  onTaskCompleted?: (task: DataCleaningTask) => void;
  onPersonalAnalysisKeyRejected?: (connection: StoredPersonalAnalysisConfig) => void;
  getPersonalAnalysisConnection?: (
    rejectedAccessToken?: string
  ) => PersonalAnalysisConnectionInput | null | Promise<PersonalAnalysisConnectionInput | null>;
  recordLlmUsage?: DataTaskLlmUsageRecorder;
  /** Test seam and optional compatibility exporter; native nodes remain the source of truth. */
  exportWorkflowDsl?: typeof exportPrepWorkflowDsl;
  /** Shared only with the AI data-task tool chain; avoids process-global receipt state. */
  requirementAnalysisReceipts?: RequirementAnalysisReceiptStore;
}

/**
 * Stable command facade used by IPC and tools. Business logic lives in the focused services below;
 * this class intentionally preserves the existing constructor and public method contract.
 */
export class DataCommandService {
  private readonly inputTables: InputTablesCommandService;
  private readonly outputTables: OutputTablesCommandService;
  private readonly cloudAnalysis: CloudAnalysisCommandService;
  private readonly tasks: TaskCommandService;
  private readonly workflowAuthoring: WorkflowAuthoringCommandService;
  private readonly generatedTasks: GeneratedTaskCommandService;
  private readonly taskExecution: TaskExecutionCommandService;
  private readonly resources: DataCommandResources;
  private readonly preview: WorkflowPreviewService;

  constructor(
    store: DataTaskStore,
    normalizerProjectGenerator: InputTableNormalizerProjectGenerator,
    getPersonalAnalysisConfig: () => StoredPersonalAnalysisConfig = () =>
      configStore.get('personalAnalysis'),
    options: DataCommandServiceOptions = {}
  ) {
    this.inputTables = new InputTablesCommandService(store, normalizerProjectGenerator);
    this.outputTables = new OutputTablesCommandService(store);
    this.cloudAnalysis = new CloudAnalysisCommandService(store, getPersonalAnalysisConfig, {
      getPersonalAnalysisConnection: options.getPersonalAnalysisConnection,
      onPersonalAnalysisKeyRejected: options.onPersonalAnalysisKeyRejected,
      createInputTable: (input) => this.createInputTable(input),
    });
    store.setOutputCommitListener((outputDatasetIds) =>
      this.cloudAnalysis.runCommittedOutputActions(outputDatasetIds)
    );
    void this.cloudAnalysis.ensureActionTimersArmed();

    const locks = new DataCommandLockCoordinator();
    this.resources = new DataCommandResources(store);
    this.preview = new WorkflowPreviewService(store, this.resources);
    const compiler = new WorkflowDslCompiler(this.resources);
    this.tasks = new TaskCommandService(store, this.resources);
    const requirementAnalysisReceipts =
      options.requirementAnalysisReceipts ?? new RequirementAnalysisReceiptStore();
    const inputResolver = new AutomationInputResolver(
      this.resources,
      locks,
      this.preview,
      {
        createInputTable: (input) => this.createInputTable(input),
        updateInputTable: (input) => this.updateInputTable(input),
      },
      this.cloudAnalysis
    );
    const outputResolver = new GeneratedOutputResolver(store, this.resources, {
      createOutputTable: (input) => this.createOutputTable(input),
    });
    this.workflowAuthoring = new WorkflowAuthoringCommandService(
      store,
      this.resources,
      locks,
      compiler,
      this.preview
    );
    this.generatedTasks = new GeneratedTaskCommandService(
      store,
      this.resources,
      locks,
      inputResolver,
      outputResolver,
      this.tasks,
      this.preview,
      requirementAnalysisReceipts,
      {
        recordLlmUsage: options.recordLlmUsage,
        exportWorkflowDsl: options.exportWorkflowDsl,
      }
    );
    this.taskExecution = new TaskExecutionCommandService(
      store,
      this.resources,
      locks,
      compiler,
      this.preview,
      inputResolver,
      outputResolver,
      this.cloudAnalysis,
      {
        onTaskCompleted: options.onTaskCompleted,
        uploadDataTableToCloud: (input) => this.uploadDataTableToCloud(input),
      }
    );
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

  async generateTaskFromRequirement(
    input: GenerateTaskFromRequirementCommand
  ): Promise<GenerateTaskFromRequirementResult> {
    return this.generatedTasks.generateTaskFromRequirement(input);
  }

  async analyzeTaskRequirement(
    input: AnalyzeTaskRequirementCommand
  ): Promise<AnalyzeTaskRequirementResult> {
    return this.generatedTasks.analyzeTaskRequirement(input);
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
    if (input.tableKind === 'input') await this.resources.requireInputTable(input.id);
    else await this.resources.requireOutputTable(input.id);
    return {
      tableKind: input.tableKind,
      id: input.id,
      preview: await this.preview.previewDataset(input.id, input.limit, input.offset),
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

  async listCloudDriveFiles(input: ListCloudDriveFilesCommand): Promise<ListCloudDriveFilesResult> {
    return this.cloudAnalysis.listCloudDriveFiles(input);
  }

  async previewCloudDriveFile(
    input: PreviewCloudDriveFileCommand
  ): Promise<PreviewCloudDriveFileResult> {
    return this.cloudAnalysis.previewCloudDriveFile(input);
  }

  async setOutputTableCloudAction(
    input: SetOutputTableCloudActionCommand
  ): Promise<{ outputTable: DataOutputTable }> {
    return this.cloudAnalysis.setOutputTableCloudAction(input);
  }

  async runOutputTableCloudAction(
    input: RunOutputTableCloudActionCommand
  ): Promise<RunOutputTableCloudActionResult> {
    return this.cloudAnalysis.runOutputTableCloudAction(input);
  }

  async listTasks(input: ListInputTablesInput = {}): Promise<ListTasksResult> {
    return this.tasks.listTasks(input);
  }

  async createTask(input: CreateTaskCommand): Promise<TaskResult> {
    return this.tasks.createTask(input);
  }

  async updateTask(input: UpdateTaskCommand): Promise<TaskResult> {
    return this.tasks.updateTask(input);
  }

  async getTaskWorkflow(input: GetTaskWorkflowCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.getTaskWorkflow(input);
  }

  async applyWorkflowDsl(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.applyWorkflowDsl(input);
  }

  async applyWorkflowPlan(input: ApplyWorkflowPlanCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.applyWorkflowPlan(input);
  }

  async getWorkflowCapabilityManifest(
    input: { inputTableIds?: string[]; outputTableIds?: string[] } = {}
  ) {
    return this.workflowAuthoring.getWorkflowCapabilityManifest(input);
  }

  async exportWorkflowDsl(input: ExportWorkflowDslCommand): Promise<TextResult> {
    return this.workflowAuthoring.exportWorkflowDsl(input);
  }

  async configureInputOperator(input: ConfigureInputOperatorCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.configureInputOperator(input);
  }

  async applyOperatorDsl(input: ApplyOperatorDslCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.applyOperatorDsl(input);
  }

  async configureOutputOperator(input: ConfigureOutputOperatorCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.configureOutputOperator(input);
  }

  async runTask(input: RunTaskCommand): Promise<RunTaskResult> {
    return this.taskExecution.runTask(input);
  }

  async runGeneratedTask(input: RunGeneratedTaskCommand): Promise<RunGeneratedTaskResult> {
    return this.taskExecution.runGeneratedTask(input);
  }

  async getRunResult(input: GetRunResultCommand): Promise<RunResult> {
    return this.taskExecution.getRunResult(input);
  }
}
