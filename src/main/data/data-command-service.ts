import type {
  CloudInputSyncConfig,
  CloudOutputSyncConfig,
} from '../../shared/automation/cloud-sync';
import { dirname, join } from 'path';
import { exportPrepWorkflowDsl } from '../../shared/prep-dsl';
import type { DataPipeline } from '../../shared/contracts';
import type {
  PersonalAnalysisConnectionInput,
  StoredPersonalAnalysisConfig,
} from '../../shared/personal-analysis-types';
import type { DataPipelineStore } from './data-pipeline-store';
import type { DataPipelineLlmUsageRecorder } from './data-pipeline-llm-usage-recorder';
import type { RawTableNormalizerProjectGenerator } from './raw-table-normalizer-generator';
import {
  type AnalyzePipelineRequirementCommand,
  type AnalyzePipelineRequirementResult,
  type ApplyOperatorDslCommand,
  type ApplyWorkflowDslCommand,
  type ApplyWorkflowPlanCommand,
  type ConfigureInputOperatorCommand,
  type ConfigureOutputOperatorCommand,
  type CreateRawTableCommand,
  type CreateRawTableWithProcessingStrategyCommand,
  type CreateRawTableWithProcessingStrategyResult,
  type CreateResultTableCommand,
  type CreatePipelineCommand,
  type DeleteRawTableNormalizerVersionCommand,
  type DeleteRawTableNormalizerVersionResult,
  type ExportWorkflowDslCommand,
  type GenerateRawTableNormalizerDraftCommand,
  type GenerateRawTableNormalizerDraftResult,
  type GeneratePipelineFromRequirementCommand,
  type GeneratePipelineFromRequirementResult,
  type GetRunResultCommand,
  type GetPipelineWorkflowCommand,
  type ImportCloudTableCommand,
  type ImportCloudTableResult,
  type RawTableResult,
  type ListCloudDriveFilesCommand,
  type ListCloudDriveFilesResult,
  type ListCloudProjectsCommand,
  type ListCloudProjectsResult,
  type ListCloudSpacesCommand,
  type ListCloudSpacesResult,
  type ListCloudTablesCommand,
  type ListCloudTablesResult,
  type ListRawTableNormalizerVersionsCommand,
  type ListRawTableNormalizerVersionsResult,
  type ListRawTablesInput,
  type ListRawTablesResult,
  type ListResultTablesResult,
  type ListPipelinesResult,
  type ResultTableResult,
  type PreviewCloudDriveFileCommand,
  type PreviewCloudDriveFileResult,
  type PreviewCloudTableCommand,
  type PreviewCloudTableResult,
  type PreviewRawTableNormalizerVersionCommand,
  type PreviewRawTableNormalizerVersionResult,
  type PreviewTableCommand,
  type PreviewTableResult,
  type RefreshCloudRawTableCommand,
  type RefreshCloudRawTableResult,
  type PublishRawTableNormalizerVersionCommand,
  type PublishRawTableNormalizerVersionResult,
  type RunGeneratedPipelineCommand,
  type RunGeneratedPipelineResult,
  type RunResult,
  type RunPipelineCommand,
  type RunPipelineResult,
  type SearchCloudTablesCommand,
  type SearchCloudTablesResult,
  type SummarizeRawTableSourceCommand,
  type SummarizeRawTableSourceResult,
  type PipelineResult,
  type TextResult,
  type UpdateRawTableCommand,
  type UpdateResultTableCommand,
  type UpdatePipelineCommand,
  type UploadDataTableToCloudCommand,
  type UploadDataTableToCloudResult,
  type WorkflowResult,
} from './data-command-types';
import { configStore } from '../config/config-store';
import { RawTablesCommandService } from './raw-tables-command-service';
import { ResultTablesCommandService } from './result-tables-command-service';
import { CloudAnalysisCommandService } from './cloud-analysis-command-service';
import { DataCommandLockCoordinator } from './data-command-lock-coordinator';
import { DataCommandResources } from './data-command-resources';
import { WorkflowPreviewService } from './workflow-preview-service';
import { WorkflowDslCompiler } from './workflow-dsl-compiler';
import { PipelineCommandService } from './pipeline-command-service';
import { WorkflowAuthoringCommandService } from './workflow-authoring-command-service';
import { AutomationInputResolver } from './automation-input-resolver';
import { GeneratedOutputResolver } from './generated-output-resolver';
import { GeneratedPipelineCommandService } from './generated-pipeline-command-service';
import { PipelineExecutionCommandService } from './pipeline-execution-command-service';
import { RequirementAnalysisReceiptStore } from './requirement-analysis-receipt-store';

export interface DataCommandServiceOptions {
  onPipelineCompleted?: (pipeline: DataPipeline) => void;
  onPersonalAnalysisKeyRejected?: (connection: StoredPersonalAnalysisConfig) => void;
  getPersonalAnalysisConnection?: (
    rejectedAccessToken?: string
  ) => PersonalAnalysisConnectionInput | null | Promise<PersonalAnalysisConnectionInput | null>;
  recordLlmUsage?: DataPipelineLlmUsageRecorder;
  /** Test seam and optional compatibility exporter; native nodes remain the source of truth. */
  exportWorkflowDsl?: typeof exportPrepWorkflowDsl;
  /** Shared only with the AI data-pipeline tool chain; avoids process-global receipt state. */
  requirementAnalysisReceipts?: RequirementAnalysisReceiptStore;
}

/**
 * Stable command facade used by IPC and tools. Business logic lives in the focused services below;
 * this class intentionally preserves the existing constructor and public method contract.
 */
export class DataCommandService {
  private readonly rawTables: RawTablesCommandService;
  private readonly resultTables: ResultTablesCommandService;
  private readonly cloudAnalysis: CloudAnalysisCommandService;
  private readonly pipelines: PipelineCommandService;
  private readonly workflowAuthoring: WorkflowAuthoringCommandService;
  private readonly generatedPipelines: GeneratedPipelineCommandService;
  private readonly pipelineExecution: PipelineExecutionCommandService;
  private readonly resources: DataCommandResources;
  private readonly preview: WorkflowPreviewService;

  constructor(
    store: DataPipelineStore,
    normalizerProjectGenerator: RawTableNormalizerProjectGenerator,
    getPersonalAnalysisConfig: () => StoredPersonalAnalysisConfig = () =>
      configStore.get('personalAnalysis'),
    options: DataCommandServiceOptions = {}
  ) {
    this.rawTables = new RawTablesCommandService(store, normalizerProjectGenerator);
    this.resultTables = new ResultTablesCommandService(store);
    this.cloudAnalysis = new CloudAnalysisCommandService(store, getPersonalAnalysisConfig, {
      getPersonalAnalysisConnection: options.getPersonalAnalysisConnection,
      onPersonalAnalysisKeyRejected: options.onPersonalAnalysisKeyRejected,
      createRawTable: (input) => this.createRawTable(input),
      updateRawTable: (input) => this.updateRawTable(input),
      // Keep downloaded cloud snapshots next to the store so sourcePath stays
      // valid across restarts and OS temp cleanup (see cloudMirror provenance).
      cloudImportDir:
        store.dbPath === ':memory:' ? undefined : join(dirname(store.dbPath), 'cloud-imports'),
    });
    const locks = new DataCommandLockCoordinator();
    this.resources = new DataCommandResources(store);
    this.preview = new WorkflowPreviewService(store, this.resources);
    const compiler = new WorkflowDslCompiler(this.resources);
    this.pipelines = new PipelineCommandService(store, this.resources);
    const requirementAnalysisReceipts =
      options.requirementAnalysisReceipts ?? new RequirementAnalysisReceiptStore();
    const inputResolver = new AutomationInputResolver(
      this.resources,
      locks,
      this.preview,
      {
        createRawTable: (input) => this.createRawTable(input),
        updateRawTable: (input) => this.updateRawTable(input),
      },
      this.cloudAnalysis
    );
    const outputResolver = new GeneratedOutputResolver(store, this.resources, {
      createResultTable: (input) => this.createResultTable(input),
    });
    this.workflowAuthoring = new WorkflowAuthoringCommandService(
      store,
      this.resources,
      locks,
      compiler,
      this.preview
    );
    this.generatedPipelines = new GeneratedPipelineCommandService(
      store,
      this.resources,
      locks,
      inputResolver,
      outputResolver,
      this.pipelines,
      this.preview,
      requirementAnalysisReceipts,
      {
        recordLlmUsage: options.recordLlmUsage,
        exportWorkflowDsl: options.exportWorkflowDsl,
      }
    );
    this.pipelineExecution = new PipelineExecutionCommandService(
      store,
      this.resources,
      locks,
      compiler,
      this.preview,
      inputResolver,
      outputResolver,
      this.cloudAnalysis,
      {
        onPipelineCompleted: options.onPipelineCompleted,
        uploadDataTableToCloud: (input) => this.uploadDataTableToCloud(input),
      }
    );
  }

  async listRawTables(input: ListRawTablesInput = {}): Promise<ListRawTablesResult> {
    return this.rawTables.listRawTables(input);
  }

  async createRawTable(input: CreateRawTableCommand): Promise<RawTableResult> {
    return this.rawTables.createRawTable(input);
  }

  async createRawTableWithProcessingStrategy(
    input: CreateRawTableWithProcessingStrategyCommand
  ): Promise<CreateRawTableWithProcessingStrategyResult> {
    return this.rawTables.createRawTableWithProcessingStrategy(input);
  }

  async updateRawTable(input: UpdateRawTableCommand): Promise<RawTableResult> {
    return this.rawTables.updateRawTable(input);
  }

  async summarizeRawTableSource(
    input: SummarizeRawTableSourceCommand
  ): Promise<SummarizeRawTableSourceResult> {
    return this.rawTables.summarizeRawTableSource(input);
  }

  async generateRawTableNormalizerDraft(
    input: GenerateRawTableNormalizerDraftCommand
  ): Promise<GenerateRawTableNormalizerDraftResult> {
    return this.rawTables.generateRawTableNormalizerDraft(input);
  }

  async previewRawTableNormalizerVersion(
    input: PreviewRawTableNormalizerVersionCommand
  ): Promise<PreviewRawTableNormalizerVersionResult> {
    return this.rawTables.previewRawTableNormalizerVersion(input);
  }

  async publishRawTableNormalizerVersion(
    input: PublishRawTableNormalizerVersionCommand
  ): Promise<PublishRawTableNormalizerVersionResult> {
    return this.rawTables.publishRawTableNormalizerVersion(input);
  }

  async deleteRawTableNormalizerVersion(
    input: DeleteRawTableNormalizerVersionCommand
  ): Promise<DeleteRawTableNormalizerVersionResult> {
    return this.rawTables.deleteRawTableNormalizerVersion(input);
  }

  async listRawTableNormalizerVersions(
    input: ListRawTableNormalizerVersionsCommand
  ): Promise<ListRawTableNormalizerVersionsResult> {
    return this.rawTables.listRawTableNormalizerVersions(input);
  }

  async generatePipelineFromRequirement(
    input: GeneratePipelineFromRequirementCommand
  ): Promise<GeneratePipelineFromRequirementResult> {
    return this.generatedPipelines.generatePipelineFromRequirement(input);
  }

  async analyzePipelineRequirement(
    input: AnalyzePipelineRequirementCommand
  ): Promise<AnalyzePipelineRequirementResult> {
    return this.generatedPipelines.analyzePipelineRequirement(input);
  }

  async listResultTables(input: ListRawTablesInput = {}): Promise<ListResultTablesResult> {
    return this.resultTables.listResultTables(input);
  }

  async createResultTable(input: CreateResultTableCommand = {}): Promise<ResultTableResult> {
    return this.resultTables.createResultTable(input);
  }

  async updateResultTable(input: UpdateResultTableCommand): Promise<ResultTableResult> {
    return this.resultTables.updateResultTable(input);
  }

  async previewTable(input: PreviewTableCommand): Promise<PreviewTableResult> {
    if (input.tableKind === 'raw') await this.resources.requireRawTable(input.id);
    else await this.resources.requireResultTable(input.id);
    return {
      tableKind: input.tableKind,
      id: input.id,
      preview: await this.preview.previewRawTable(input.id, input.limit, input.offset),
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

  async importCloudRawTable(input: ImportCloudTableCommand): Promise<ImportCloudTableResult> {
    return this.cloudAnalysis.importCloudRawTable(input);
  }

  async refreshCloudRawTable(
    input: RefreshCloudRawTableCommand
  ): Promise<RefreshCloudRawTableResult> {
    return this.cloudAnalysis.refreshCloudRawTable(input);
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

  syncRawTableFromCloud(config: CloudInputSyncConfig, syncKey: string) {
    return this.cloudAnalysis.syncRawTableFromCloud(config, syncKey);
  }

  syncResultTableToCloud(
    resultTableId: string,
    config: CloudOutputSyncConfig,
    syncKey?: string,
    beforeWrite?: (version: number) => void
  ) {
    return this.cloudAnalysis.syncResultTableToCloud(resultTableId, config, syncKey, beforeWrite);
  }

  async listPipelines(input: ListRawTablesInput = {}): Promise<ListPipelinesResult> {
    return this.pipelines.listPipelines(input);
  }

  async createPipeline(input: CreatePipelineCommand): Promise<PipelineResult> {
    return this.pipelines.createPipeline(input);
  }

  async updatePipeline(input: UpdatePipelineCommand): Promise<PipelineResult> {
    return this.pipelines.updatePipeline(input);
  }

  async getPipelineWorkflow(input: GetPipelineWorkflowCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.getPipelineWorkflow(input);
  }

  async applyWorkflowDsl(input: ApplyWorkflowDslCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.applyWorkflowDsl(input);
  }

  async applyWorkflowPlan(input: ApplyWorkflowPlanCommand): Promise<WorkflowResult> {
    return this.workflowAuthoring.applyWorkflowPlan(input);
  }

  async getWorkflowCapabilityManifest(
    input: { rawTableIds?: string[]; resultTableIds?: string[] } = {}
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

  async runPipeline(input: RunPipelineCommand): Promise<RunPipelineResult> {
    return this.pipelineExecution.runPipeline(input);
  }

  async runGeneratedPipeline(
    input: RunGeneratedPipelineCommand
  ): Promise<RunGeneratedPipelineResult> {
    return this.pipelineExecution.runGeneratedPipeline(input);
  }

  async getRunResult(input: GetRunResultCommand): Promise<RunResult> {
    return this.pipelineExecution.getRunResult(input);
  }
}
