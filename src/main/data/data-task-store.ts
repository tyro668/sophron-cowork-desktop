/**
 * @module data/data-task-store
 *
 * Public facade for the data workspace. Wires the infrastructure context,
 * the per-table repositories, and the application services together, then
 * exposes the same method surface the old inheritance chain provided so
 * command services and IPC handlers stay unchanged.
 *
 * Layers:
 *   DataStoreContext        — DuckDB + SQLite metadata runtime (infra)
 *   store/repositories/*    — row-level access per metadata table
 *   store/services/*        — workflow/dataset/normalizer application logic
 */
import type {
  DataCleaningTask,
  DataColumnTypeInfo,
  DataCreateOutputTableInput,
  DataCreateTaskInput,
  DataDashboard,
  DataDashboardQuery,
  DataDataset,
  DataImportDatasetInput,
  DataInputTableNormalizerArtifact,
  DataInputTableNormalizerArtifactVersion,
  DataInputTableNormalizerVersionSaveResult,
  DataInputTablePreview,
  DataInputTableSourceSummary,
  DataOutputTable,
  DataPreviewDatasetInput,
  DataPreviewInputTableInput,
  DataPreviewInputTableNormalizerVersionInput,
  DataPreviewWorkflowNodeInput,
  DataRunTaskInput,
  DataSaveInputTableNormalizerDraftInput,
  DataSummarizeInputTableSourceInput,
  DataTaskWorkflow,
  DataUpdateDatasetInput,
  DataUpdateOutputTableInput,
  DataUpdateTaskInput,
  DataWorkflowSaveInput,
} from '../../shared/contracts';
import type { PrepDiagnostic } from '../../shared/prep-dsl/ast';
import type { WorkflowPlanDiagnostic } from '../../shared/workflow-plan';
import type { WorkflowNodeRunStat } from './data-command-types';
import { DataStoreContext } from './store/data-store-context';
import type { DataTaskStoreOptions } from './store/data-store-records';
import { CacheRepository } from './store/repositories/cache-repository';
import { DatasetRepository } from './store/repositories/dataset-repository';
import { NormalizerRepository } from './store/repositories/normalizer-repository';
import { OutputCommitJournal } from './store/repositories/output-commit-journal';
import { RunStatsRepository } from './store/repositories/run-stats-repository';
import { TaskRepository } from './store/repositories/task-repository';
import { WatermarkRepository } from './store/repositories/watermark-repository';
import { WorkflowRepository } from './store/repositories/workflow-repository';
import { DashboardService } from './store/services/dashboard-service';
import { InputSourceSummaryService } from './store/services/input-source-summary-service';
import { InputTableService } from './store/services/input-table-service';
import { NormalizerService } from './store/services/normalizer-service';
import { OutputCommitCoordinator } from './store/services/output-commit-coordinator';
import { TaskService } from './store/services/task-service';
import { WorkflowBindingResolver } from './store/services/workflow-binding-resolver';
import { WorkflowCompiler } from './store/services/workflow-compiler';
import { WorkflowExecutor } from './store/services/workflow-executor';
import { WorkflowNodePreviewService } from './store/services/workflow-node-preview-service';
import { WorkflowValidator } from './store/services/workflow-validator';
import type { DataDatasetCsvExport } from './store/data-store-records';

export class DataTaskStore {
  private readonly ctx: DataStoreContext;
  private readonly tasks: TaskRepository;
  private readonly datasets: DatasetRepository;
  private readonly normalizers: NormalizerRepository;
  private readonly runStats: RunStatsRepository;
  private readonly summarizer: InputSourceSummaryService;
  private readonly normalizerService: NormalizerService;
  private readonly inputTables: InputTableService;
  private readonly taskService: TaskService;
  private readonly validator: WorkflowValidator;
  private readonly commitCoordinator: OutputCommitCoordinator;
  private readonly nodePreview: WorkflowNodePreviewService;
  private readonly dashboardService: DashboardService;

  constructor(dbPath: string, options: DataTaskStoreOptions = {}) {
    this.ctx = new DataStoreContext(dbPath, options);

    const tasks = new TaskRepository(this.ctx);
    const datasets = new DatasetRepository(this.ctx);
    const normalizers = new NormalizerRepository(this.ctx);
    const workflows = new WorkflowRepository(this.ctx);
    const runStats = new RunStatsRepository(this.ctx);
    const caches = new CacheRepository(this.ctx);
    const watermarks = new WatermarkRepository(this.ctx);
    const journal = new OutputCommitJournal(this.ctx);

    const summarizer = new InputSourceSummaryService(this.ctx);
    const normalizerService = new NormalizerService(this.ctx, normalizers, summarizer);
    const inputTables = new InputTableService(this.ctx, datasets, normalizerService);
    const binding = new WorkflowBindingResolver(datasets);
    const compiler = new WorkflowCompiler(this.ctx, datasets, caches);
    const validator = new WorkflowValidator(this.ctx, tasks, compiler, binding);
    const executor = new WorkflowExecutor(
      this.ctx,
      tasks,
      datasets,
      caches,
      watermarks,
      workflows,
      validator,
      compiler,
      binding
    );
    const nodePreview = new WorkflowNodePreviewService(this.ctx, tasks, datasets, caches, compiler);
    const commitCoordinator = new OutputCommitCoordinator(
      this.ctx,
      tasks,
      datasets,
      runStats,
      watermarks,
      journal,
      binding
    );
    const taskService = new TaskService(
      this.ctx,
      tasks,
      datasets,
      workflows,
      caches,
      runStats,
      executor,
      validator,
      commitCoordinator,
      binding
    );

    this.ctx.setMigrationHooks({
      cleanupOutputTableMetadata: () => datasets.cleanupOutputTableMetadata(),
    });
    this.ctx.registerPostReadyHook(() => commitCoordinator.recoverPendingOutputCommits());

    this.tasks = tasks;
    this.datasets = datasets;
    this.normalizers = normalizers;
    this.runStats = runStats;
    this.summarizer = summarizer;
    this.normalizerService = normalizerService;
    this.inputTables = inputTables;
    this.taskService = taskService;
    this.validator = validator;
    this.commitCoordinator = commitCoordinator;
    this.nodePreview = nodePreview;
    this.dashboardService = new DashboardService(this.ctx, datasets);
  }

  close(): void {
    this.ctx.close();
  }

  // ---- datasets / input & output tables ----
  importDataset(input: DataImportDatasetInput): Promise<DataDataset> {
    return this.inputTables.importDataset(input);
  }
  updateDataset(input: DataUpdateDatasetInput): Promise<DataDataset> {
    return this.inputTables.updateDataset(input);
  }
  deleteDataset(id: string): Promise<boolean> {
    return this.inputTables.deleteDataset(id);
  }
  previewDataset(input: DataPreviewDatasetInput): Promise<DataInputTablePreview> {
    return this.inputTables.previewDataset(input);
  }
  previewInputTable(input: DataPreviewInputTableInput): Promise<DataInputTablePreview> {
    return this.inputTables.previewInputTable(input);
  }
  exportDatasetCsv(input: {
    tableKind: 'input' | 'output';
    id: string;
    maxRows?: number;
  }): Promise<DataDatasetCsvExport> {
    return this.inputTables.exportDatasetCsv(input);
  }
  summarizeInputTableSource(
    input: DataSummarizeInputTableSourceInput
  ): Promise<DataInputTableSourceSummary> {
    return this.summarizer.summarizeInputTableSource(input);
  }
  createOutputTable(input: DataCreateOutputTableInput = {}): Promise<DataOutputTable> {
    return this.datasets.createOutputTable(input);
  }
  updateOutputTable(input: DataUpdateOutputTableInput): Promise<DataOutputTable> {
    return this.inputTables.updateOutputTable(input);
  }
  getInputTableRecord(id: string): Promise<DataDataset | null> {
    return this.datasets.getInputTableRecord(id);
  }
  findInputTableRecordByName(name: string): Promise<DataDataset | null> {
    return this.datasets.findInputTableRecordByName(name);
  }
  getOutputTableRecord(id: string): Promise<DataOutputTable | null> {
    return this.datasets.getOutputTableRecord(id);
  }

  // ---- normalizer artifacts ----
  saveInputTableNormalizerDraft(
    input: DataSaveInputTableNormalizerDraftInput
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    return this.normalizerService.saveInputTableNormalizerDraft(input);
  }
  publishInputTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    return this.normalizerService.publishInputTableNormalizerArtifactVersion(versionId);
  }
  deleteInputTableNormalizerArtifactVersion(versionId: string): Promise<{ success: boolean }> {
    return this.normalizerService.deleteInputTableNormalizerArtifactVersion(versionId);
  }
  previewInputTableNormalizerVersion(
    input: DataPreviewInputTableNormalizerVersionInput
  ): Promise<DataInputTablePreview> {
    return this.normalizerService.previewInputTableNormalizerVersion(input);
  }
  getInputTableNormalizerArtifact(id: string): Promise<DataInputTableNormalizerArtifact | null> {
    return this.normalizers.getInputTableNormalizerArtifact(id);
  }
  listInputTableNormalizerArtifactVersions(
    artifactId: string
  ): Promise<DataInputTableNormalizerArtifactVersion[]> {
    return this.normalizers.listInputTableNormalizerArtifactVersions(artifactId);
  }
  getInputTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataInputTableNormalizerArtifactVersion | null> {
    return this.normalizers.getInputTableNormalizerArtifactVersion(id);
  }

  // ---- tasks ----
  createTask(input: DataCreateTaskInput): Promise<DataCleaningTask> {
    return this.taskService.createTask(input);
  }
  updateTask(input: DataUpdateTaskInput): Promise<DataCleaningTask> {
    return this.taskService.updateTask(input);
  }
  getTask(id: string): Promise<DataCleaningTask | null> {
    return this.tasks.getTask(id);
  }
  getTaskRecord(id: string): Promise<DataCleaningTask | null> {
    return this.taskService.getTaskRecord(id);
  }
  deleteTask(id: string): Promise<boolean> {
    return this.taskService.deleteTask(id);
  }
  deleteTaskMetadataOnly(id: string): Promise<boolean> {
    return this.taskService.deleteTaskMetadataOnly(id);
  }
  runTask(id: string, input: DataRunTaskInput = {}): Promise<DataCleaningTask> {
    return this.taskService.runTask(id, input);
  }
  runTaskWithDiagnostics(
    id: string,
    input: DataRunTaskInput = {}
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
  }> {
    return this.taskService.runTaskWithDiagnostics(id, input);
  }
  validateTaskWorkflow(
    id: string,
    input: DataRunTaskInput
  ): Promise<{
    task: DataCleaningTask;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    return this.taskService.validateTaskWorkflow(id, input);
  }
  validateWorkflowPlanForTask(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<WorkflowPlanDiagnostic[]> {
    return this.validator.validateWorkflowPlanForTask(id, input);
  }
  commitValidatedTaskOutput(
    id: string,
    temporaryTask: DataCleaningTask,
    workflow: DataWorkflowSaveInput,
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>,
    nodeStats?: WorkflowNodeRunStat[],
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>
  ): Promise<DataCleaningTask> {
    return this.commitCoordinator.commitValidatedTaskOutput(
      id,
      temporaryTask,
      workflow,
      watermarkUpdates,
      nodeStats,
      stagedSinks
    );
  }
  discardTemporaryTaskOutput(task: DataCleaningTask): Promise<void> {
    return this.taskService.discardTemporaryTaskOutput(task);
  }
  cleanupTemporaryTaskResources(taskId: string): Promise<void> {
    return this.taskService.cleanupTemporaryTaskResources(taskId);
  }
  getTaskWorkflow(id: string): Promise<DataTaskWorkflow> {
    return this.taskService.getTaskWorkflow(id);
  }
  saveTaskWorkflow(id: string, input: DataWorkflowSaveInput): Promise<DataTaskWorkflow> {
    return this.taskService.saveTaskWorkflow(id, input);
  }
  getTaskNodeStats(taskId: string): Promise<WorkflowNodeRunStat[]> {
    return this.runStats.getTaskNodeStats(taskId);
  }

  // ---- workflow node previews ----
  previewWorkflowNode(input: DataPreviewWorkflowNodeInput): Promise<DataInputTablePreview> {
    return this.nodePreview.previewWorkflowNode(input);
  }
  getWorkflowNodeColumns(input: DataPreviewWorkflowNodeInput): Promise<string[]> {
    return this.nodePreview.getWorkflowNodeColumns(input);
  }
  getWorkflowNodeColumnTypes(input: DataPreviewWorkflowNodeInput): Promise<DataColumnTypeInfo[]> {
    return this.nodePreview.getWorkflowNodeColumnTypes(input);
  }
  getWorkflowNodeColumnValues(
    input: DataPreviewWorkflowNodeInput & { column: string }
  ): Promise<string[]> {
    return this.nodePreview.getWorkflowNodeColumnValues(input);
  }
  getWorkflowNodeRowCount(input: DataPreviewWorkflowNodeInput): Promise<number> {
    return this.nodePreview.getWorkflowNodeRowCount(input);
  }

  // ---- misc ----
  getTableColumnSnapshot(tableName: string): Promise<DataColumnTypeInfo[]> {
    return this.ctx.getTableColumnSnapshot(tableName);
  }
  getDashboard(query: DataDashboardQuery = {}): Promise<DataDashboard> {
    return this.dashboardService.getDashboard(query);
  }
}

export function createDataTaskStore(dbPath: string, options?: DataTaskStoreOptions): DataTaskStore {
  return new DataTaskStore(dbPath, options);
}

export type { DataDatasetCsvExport };
