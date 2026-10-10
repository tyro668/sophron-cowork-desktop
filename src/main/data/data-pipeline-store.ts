/**
 * @module data/data-pipeline-store
 *
 * Public facade for the data workspace. Wires the infrastructure context,
 * the per-table repositories, and the application services together, then
 * exposes the same method surface the old inheritance chain provided so
 * command services and IPC handlers stay unchanged.
 *
 * Layers:
 *   DataStoreContext        — DuckDB + SQLite metadata runtime (infra)
 *   store/repositories/*    — row-level access per metadata table
 *   store/services/*        — workflow/rawTable/normalizer application logic
 */
import type {
  DataPipeline,
  DataColumnTypeInfo,
  DataCreateResultTableInput,
  DataCreatePipelineInput,
  DataDashboard,
  DataDashboardQuery,
  DataRawTable,
  DataAssignGroupInput,
  DataExportTableInput,
  DataCreateGroupInput,
  DataGroup,
  DataGroupScope,
  DataImportRawTableInput,
  DataRenameGroupInput,
  DataRawTableNormalizerArtifact,
  DataRawTableNormalizerArtifactVersion,
  DataRawTableNormalizerVersionSaveResult,
  DataRawTablePreview,
  DataRawTableSourceSummary,
  DataResultTable,
  DataPreviewRawTableSourceInput,
  DataPreviewRawTableInput,
  DataPreviewRawTableNormalizerVersionInput,
  DataPreviewWorkflowNodeInput,
  DataRunPipelineInput,
  DataSaveRawTableNormalizerDraftInput,
  DataSummarizeRawTableSourceInput,
  DataPipelineRun,
  DataPipelineWorkflow,
  DataUpdateRawTableInput,
  DataUpdateResultTableInput,
  DataUpdatePipelineInput,
  DataWorkflowSaveInput,
} from '../../shared/contracts';
import type { PrepDiagnostic } from '../../shared/prep-dsl/ast';
import type { WorkflowPlanDiagnostic } from '../../shared/workflow-plan';
import type { WorkflowNodeRunStat } from './data-command-types';
import { DataStoreContext } from './store/data-store-context';
import type { DataPipelineStoreOptions } from './store/data-store-records';
import { CacheRepository } from './store/repositories/cache-repository';
import { RawTableRepository } from './store/repositories/raw-table-repository';
import { GroupRepository } from './store/repositories/group-repository';
import { NormalizerRepository } from './store/repositories/normalizer-repository';
import { OutputCommitJournal } from './store/repositories/output-commit-journal';
import { TableCommitJournal } from './store/repositories/table-commit-journal';
import { RunStatsRepository } from './store/repositories/run-stats-repository';
import { PipelineRunsRepository } from './store/repositories/pipeline-runs-repository';
import { PipelineRepository } from './store/repositories/pipeline-repository';
import { WatermarkRepository } from './store/repositories/watermark-repository';
import { WorkflowRepository } from './store/repositories/workflow-repository';
import { DashboardService } from './store/services/dashboard-service';
import { InputSourceSummaryService } from './store/services/input-source-summary-service';
import { RawTableService } from './store/services/raw-table-service';
import { NormalizerService } from './store/services/normalizer-service';
import { OutputCommitCoordinator } from './store/services/output-commit-coordinator';
import {
  TableExportService,
  type PreparedTableExport,
} from './store/services/table-export-service';
import { PipelineService } from './store/services/pipeline-service';
import { WorkflowBindingResolver } from './store/services/workflow-binding-resolver';
import { WorkflowCompiler } from './store/services/workflow-compiler';
import { WorkflowExecutor } from './store/services/workflow-executor';
import { WorkflowNodePreviewService } from './store/services/workflow-node-preview-service';
import { WorkflowValidator } from './store/services/workflow-validator';
import type { DataRawTableCsvExport } from './store/data-store-records';

export class DataPipelineStore {
  private readonly ctx: DataStoreContext;
  private readonly pipelines: PipelineRepository;
  private readonly rawTableRepo: RawTableRepository;
  private readonly groups: GroupRepository;
  private readonly normalizers: NormalizerRepository;
  private readonly summarizer: InputSourceSummaryService;
  private readonly normalizerService: NormalizerService;
  private readonly rawTables: RawTableService;
  private readonly pipelineService: PipelineService;
  private readonly validator: WorkflowValidator;
  private readonly commitCoordinator: OutputCommitCoordinator;
  private readonly nodePreview: WorkflowNodePreviewService;
  private readonly tableExport: TableExportService;
  private readonly dashboardService: DashboardService;

  constructor(
    public readonly dbPath: string,
    options: DataPipelineStoreOptions = {}
  ) {
    this.ctx = new DataStoreContext(dbPath, options);

    const pipelines = new PipelineRepository(this.ctx);
    const rawTableRepo = new RawTableRepository(this.ctx);
    const groups = new GroupRepository(this.ctx);
    const normalizers = new NormalizerRepository(this.ctx);
    const workflows = new WorkflowRepository(this.ctx);
    const runStats = new RunStatsRepository(this.ctx);
    const pipelineRuns = new PipelineRunsRepository(this.ctx);
    const caches = new CacheRepository(this.ctx);
    const watermarks = new WatermarkRepository(this.ctx);
    const journal = new OutputCommitJournal(this.ctx);
    const tableCommits = new TableCommitJournal(this.ctx);

    const summarizer = new InputSourceSummaryService(this.ctx);
    const normalizerService = new NormalizerService(this.ctx, normalizers, summarizer);
    const rawTables = new RawTableService(this.ctx, rawTableRepo, normalizerService, tableCommits);
    const binding = new WorkflowBindingResolver(rawTableRepo);
    const compiler = new WorkflowCompiler(this.ctx, rawTableRepo, caches);
    const validator = new WorkflowValidator(this.ctx, pipelines, compiler, binding);
    const executor = new WorkflowExecutor(
      this.ctx,
      pipelines,
      rawTableRepo,
      caches,
      watermarks,
      workflows,
      validator,
      compiler,
      binding
    );
    const nodePreview = new WorkflowNodePreviewService(
      this.ctx,
      pipelines,
      rawTableRepo,
      caches,
      compiler,
      workflows,
      journal
    );
    const commitCoordinator = new OutputCommitCoordinator(
      this.ctx,
      pipelines,
      rawTableRepo,
      runStats,
      watermarks,
      journal,
      binding
    );
    const pipelineService = new PipelineService(
      this.ctx,
      pipelines,
      rawTableRepo,
      workflows,
      caches,
      runStats,
      pipelineRuns,
      executor,
      validator,
      commitCoordinator,
      binding
    );
    const tableExport = new TableExportService(
      this.ctx,
      rawTableRepo,
      pipelines,
      workflows,
      pipelineRuns
    );

    this.ctx.registerPostReadyHook(() => commitCoordinator.recoverPendingOutputCommits());
    this.ctx.registerPostReadyHook(() => rawTables.recoverPendingTableCommits());

    this.pipelines = pipelines;
    this.rawTableRepo = rawTableRepo;
    this.groups = groups;
    this.normalizers = normalizers;
    this.summarizer = summarizer;
    this.normalizerService = normalizerService;
    this.rawTables = rawTables;
    this.pipelineService = pipelineService;
    this.validator = validator;
    this.commitCoordinator = commitCoordinator;
    this.nodePreview = nodePreview;
    this.tableExport = tableExport;
    this.dashboardService = new DashboardService(this.ctx);
  }

  close(): void {
    this.ctx.close();
  }

  // ---- rawTables / input & output tables ----
  importRawTable(input: DataImportRawTableInput): Promise<DataRawTable> {
    return this.rawTables.importRawTable(input);
  }
  updateRawTable(input: DataUpdateRawTableInput): Promise<DataRawTable> {
    return this.rawTables.updateRawTable(input);
  }
  deleteRawTable(id: string): Promise<boolean> {
    return this.rawTables.deleteRawTable(id);
  }
  previewRawTable(input: DataPreviewRawTableInput): Promise<DataRawTablePreview> {
    return this.rawTables.previewRawTable(input);
  }
  previewRawTableSource(input: DataPreviewRawTableSourceInput): Promise<DataRawTablePreview> {
    return this.rawTables.previewRawTableSource(input);
  }
  exportRawTableCsv(input: {
    tableKind: 'raw' | 'result';
    id: string;
    maxRows?: number;
  }): Promise<DataRawTableCsvExport> {
    return this.rawTables.exportRawTableCsv(input);
  }
  /** Builds an export file payload (csv/xlsx/html report) — the IPC layer owns dialogs + writes. */
  buildTableExport(input: DataExportTableInput): Promise<PreparedTableExport> {
    return this.tableExport.buildTableExport(input);
  }
  summarizeRawTableSource(
    input: DataSummarizeRawTableSourceInput
  ): Promise<DataRawTableSourceSummary> {
    return this.summarizer.summarizeRawTableSource(input);
  }
  createResultTable(input: DataCreateResultTableInput = {}): Promise<DataResultTable> {
    return this.rawTableRepo.createResultTable(input);
  }
  async updateResultTable(input: DataUpdateResultTableInput): Promise<DataResultTable> {
    const previous = await this.rawTableRepo.getResultTableRecord(input.id);
    const updated = await this.rawTables.updateResultTable(input);
    if (updated.sourceRawTableId && updated.sourceRawTableId !== previous?.sourceRawTableId) {
      try {
        this.commitCoordinator.onOutputsCommitted?.([updated.id]);
      } catch {
        // Listener errors must never fail the update.
      }
    }
    return updated;
  }
  setOutputCommitListener(listener: (outputResultTableIds: string[]) => void): void {
    this.commitCoordinator.onOutputsCommitted = listener;
  }
  findRawTableByAutomationSyncKey(syncKey: string): Promise<DataRawTable | null> {
    return this.rawTableRepo.findRawTableByAutomationSyncKey(syncKey);
  }
  getRawTableRecord(id: string): Promise<DataRawTable | null> {
    return this.rawTableRepo.getRawTableRecord(id);
  }
  findRawTableRecordByName(name: string): Promise<DataRawTable | null> {
    return this.rawTableRepo.findRawTableRecordByName(name);
  }
  getResultTableRecord(id: string): Promise<DataResultTable | null> {
    return this.rawTableRepo.getResultTableRecord(id);
  }
  findResultTableByPhysicalName(tableName: string): Promise<DataResultTable | null> {
    return this.rawTableRepo.findResultTableByPhysicalName(tableName);
  }

  // ---- normalizer artifacts ----
  saveRawTableNormalizerDraft(
    input: DataSaveRawTableNormalizerDraftInput
  ): Promise<DataRawTableNormalizerVersionSaveResult> {
    return this.normalizerService.saveRawTableNormalizerDraft(input);
  }
  publishRawTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<DataRawTableNormalizerVersionSaveResult> {
    return this.normalizerService.publishRawTableNormalizerArtifactVersion(versionId);
  }
  deleteRawTableNormalizerArtifactVersion(versionId: string): Promise<{ success: boolean }> {
    return this.normalizerService.deleteRawTableNormalizerArtifactVersion(versionId);
  }
  previewRawTableNormalizerVersion(
    input: DataPreviewRawTableNormalizerVersionInput
  ): Promise<DataRawTablePreview> {
    return this.normalizerService.previewRawTableNormalizerVersion(input);
  }
  getRawTableNormalizerArtifact(id: string): Promise<DataRawTableNormalizerArtifact | null> {
    return this.normalizers.getRawTableNormalizerArtifact(id);
  }
  listRawTableNormalizerArtifactVersions(
    artifactId: string
  ): Promise<DataRawTableNormalizerArtifactVersion[]> {
    return this.normalizers.listRawTableNormalizerArtifactVersions(artifactId);
  }
  getRawTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataRawTableNormalizerArtifactVersion | null> {
    return this.normalizers.getRawTableNormalizerArtifactVersion(id);
  }

  // ---- pipelines ----
  createPipeline(input: DataCreatePipelineInput): Promise<DataPipeline> {
    return this.pipelineService.createPipeline(input);
  }
  updatePipeline(input: DataUpdatePipelineInput): Promise<DataPipeline> {
    return this.pipelineService.updatePipeline(input);
  }
  getPipeline(id: string): Promise<DataPipeline | null> {
    return this.pipelines.getPipeline(id);
  }
  getPipelineRecord(id: string): Promise<DataPipeline | null> {
    return this.pipelineService.getPipelineRecord(id);
  }
  deletePipeline(id: string): Promise<boolean> {
    return this.pipelineService.deletePipeline(id);
  }
  deletePipelineMetadataOnly(id: string): Promise<boolean> {
    return this.pipelineService.deletePipelineMetadataOnly(id);
  }
  runPipeline(id: string, input: DataRunPipelineInput = {}): Promise<DataPipeline> {
    return this.pipelineService.runPipeline(id, input);
  }
  runPipelineWithDiagnostics(
    id: string,
    input: DataRunPipelineInput = {}
  ): Promise<{
    pipeline: DataPipeline;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    failure?: { message: string };
  }> {
    return this.pipelineService.runPipelineWithDiagnostics(id, input);
  }
  validatePipelineWorkflow(
    id: string,
    input: DataRunPipelineInput
  ): Promise<{
    pipeline: DataPipeline;
    diagnostics: PrepDiagnostic[];
    nodeStats?: WorkflowNodeRunStat[];
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>;
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>;
  }> {
    return this.pipelineService.validatePipelineWorkflow(id, input);
  }
  validateWorkflowPlanForPipeline(
    id: string,
    input: DataWorkflowSaveInput
  ): Promise<WorkflowPlanDiagnostic[]> {
    return this.validator.validateWorkflowPlanForPipeline(id, input);
  }
  commitValidatedPipelineOutput(
    id: string,
    temporaryPipeline: DataPipeline,
    workflow: DataWorkflowSaveInput,
    watermarkUpdates?: Array<{ nodeId: string; column: string; value: string }>,
    nodeStats?: WorkflowNodeRunStat[],
    stagedSinks?: Array<{ nodeId: string; stagingTable: string }>,
    runId?: string
  ): Promise<DataPipeline> {
    return this.commitCoordinator.commitValidatedPipelineOutput(
      id,
      temporaryPipeline,
      workflow,
      watermarkUpdates,
      nodeStats,
      stagedSinks,
      runId
    );
  }
  discardTemporaryPipelineOutput(pipeline: DataPipeline): Promise<void> {
    return this.pipelineService.discardTemporaryPipelineOutput(pipeline);
  }
  cleanupTemporaryPipelineResources(pipelineId: string): Promise<void> {
    return this.pipelineService.cleanupTemporaryPipelineResources(pipelineId);
  }
  getPipelineWorkflow(id: string): Promise<DataPipelineWorkflow> {
    return this.pipelineService.getPipelineWorkflow(id);
  }
  savePipelineWorkflow(id: string, input: DataWorkflowSaveInput): Promise<DataPipelineWorkflow> {
    return this.pipelineService.savePipelineWorkflow(id, input);
  }
  getPipelineNodeStats(pipelineId: string): Promise<WorkflowNodeRunStat[]> {
    return this.pipelineService.getPipelineNodeStats(pipelineId);
  }
  listPipelineRuns(pipelineId: string, limit?: number): Promise<DataPipelineRun[]> {
    return this.pipelineService.listPipelineRuns(pipelineId, limit);
  }
  getPipelineRunNodeStats(pipelineId: string, runId: string): Promise<WorkflowNodeRunStat[]> {
    return this.pipelineService.getPipelineRunNodeStats(pipelineId, runId);
  }

  // ---- workflow node previews ----
  previewWorkflowNode(input: DataPreviewWorkflowNodeInput): Promise<DataRawTablePreview> {
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

  // ---- groups ----
  async listGroups(scope: DataGroupScope): Promise<DataGroup[]> {
    await this.ctx.ensureMetadataReady();
    return this.groups.listGroups(scope);
  }
  async createGroup(input: DataCreateGroupInput): Promise<DataGroup> {
    await this.ctx.ensureMetadataReady();
    return this.groups.createGroup(input.scope, input.name);
  }
  async renameGroup(input: DataRenameGroupInput): Promise<void> {
    await this.ctx.ensureMetadataReady();
    return this.groups.renameGroup(input.id, input.name);
  }
  async deleteGroup(id: string): Promise<void> {
    await this.ctx.ensureMetadataReady();
    return this.groups.deleteGroup(id);
  }
  async assignGroup(input: DataAssignGroupInput): Promise<void> {
    await this.ctx.ensureMetadataReady();
    return this.groups.assignToGroup(input.scope, input.ids, input.groupId);
  }
}

export function createDataPipelineStore(
  dbPath: string,
  options?: DataPipelineStoreOptions
): DataPipelineStore {
  return new DataPipelineStore(dbPath, options);
}

export type { DataRawTableCsvExport };
