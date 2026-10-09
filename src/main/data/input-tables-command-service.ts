import { extname } from 'path';
import type { DataTaskStore } from './data-task-store';
import {
  DataCommandError,
  type CreateInputTableCommand,
  type CreateInputTableWithProcessingStrategyCommand,
  type CreateInputTableWithProcessingStrategyResult,
  type DeleteInputTableNormalizerVersionCommand,
  type DeleteInputTableNormalizerVersionResult,
  type GenerateInputTableNormalizerDraftCommand,
  type GenerateInputTableNormalizerDraftResult,
  type InputTableResult,
  type ListInputTableNormalizerVersionsCommand,
  type ListInputTableNormalizerVersionsResult,
  type ListInputTablesInput,
  type ListInputTablesResult,
  type PreviewInputTableNormalizerVersionCommand,
  type PreviewInputTableNormalizerVersionResult,
  type PublishInputTableNormalizerVersionCommand,
  type PublishInputTableNormalizerVersionResult,
  type SummarizeInputTableSourceCommand,
  type SummarizeInputTableSourceResult,
  type UpdateInputTableCommand,
} from './data-command-types';
import {
  createNormalizerDependencyLockHash,
  createNormalizerFileTreeHash,
} from '../../shared/input-table-normalizer/templates';
import type { InputTableNormalizerProjectGenerator } from './input-table-normalizer-generator';
import type {
  DataInputTableConfig,
  DataInputTablePreview,
  DataInputTableProcessingConfig,
  DataInputTableSourceKind,
} from '../../shared/contracts';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

export class InputTablesCommandService {
  constructor(
    private readonly store: DataTaskStore,
    private readonly normalizerProjectGenerator: InputTableNormalizerProjectGenerator
  ) {}

  async listInputTables(input: ListInputTablesInput = {}): Promise<ListInputTablesResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includeTasks: false,
      includeDatasets: true,
      includeOutputTables: false,
      datasetSourceKind: input.sourceKind ?? 'all',
      datasetLimit: window.limit,
      datasetOffset: window.offset,
    });
    return {
      inputTables: dashboard.datasets,
      total: dashboard.totalDatasets,
      ...window,
    };
  }

  async createInputTable(input: CreateInputTableCommand): Promise<InputTableResult> {
    const sourcePath = normalizeSourcePathInput(input);
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueInputTableName(name);
    }

    try {
      const inputTable = await this.store.importDataset({
        filePath: sourcePath,
        name,
        sourceKind: input.sourceKind,
        config: input.config,
      });
      const preview = await this.previewIfRequested(inputTable.id, input.previewRows);
      return { inputTable, preview };
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
  }

  async createInputTableWithProcessingStrategy(
    input: CreateInputTableWithProcessingStrategyCommand
  ): Promise<CreateInputTableWithProcessingStrategyResult> {
    const sourcePath = normalizeSourcePathInput(input);
    const sourceKind = resolveInputSourceKindForCommand(input, sourcePath);
    const baseConfig = withInputTableDataProcessing(input.config, sourceKind, { strategy: 'auto' });

    if (input.processingStrategy.strategy === 'auto') {
      const result = await this.createInputTable({
        ...input,
        sourceKind,
        filePath: input.folderPath ? undefined : sourcePath,
        folderPath: input.folderPath ? sourcePath : undefined,
        config: baseConfig,
      });
      return {
        ...result,
        processingStrategy: 'auto',
      };
    }

    const rulePrompt = normalizeRequiredName(
      input.processingStrategy.rulePrompt,
      'Normalizer rule prompt is required for custom processing'
    );
    const artifactName =
      normalizeOptionalName(input.processingStrategy.artifactName) ||
      `${normalizeOptionalName(input.name) || 'input table'} normalizer`;

    if (input.name) {
      await this.ensureUniqueInputTableName(input.name);
    }

    const draft = await this.generateInputTableNormalizerDraft({
      artifactId: input.processingStrategy.artifactId,
      name: artifactName,
      description: input.processingStrategy.artifactDescription,
      sourcePath,
      sourceKind,
      config: baseConfig,
      rulePrompt,
      primaryLanguage: input.processingStrategy.primaryLanguage,
    });
    const normalizerPreview = await this.previewInputTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath,
      sourceKind,
      config: baseConfig,
      prepareDependencies: input.processingStrategy.prepareDependencies,
      limit: input.previewRows,
    });
    const published = await this.publishInputTableNormalizerVersion({
      versionId: draft.version.id,
    });
    const customConfig = withInputTableDataProcessing(input.config, sourceKind, {
      strategy: 'customize',
      rulePrompt,
      artifactId: published.artifact.id,
      artifactVersionId: published.version.id,
      artifactVersionStatus: published.version.status,
      fileTreeHash: published.version.fileTreeHash,
      dependencyLockHash: published.version.dependencyLockHash ?? undefined,
      runtime: published.version.runtime,
      entrypoint: published.version.entrypoint,
      dependencyPrepare: published.version.dependencyPrepare,
      projectFiles: published.version.files,
      sourceSummaryHash: published.version.sourceSummaryHash ?? undefined,
    });
    const result = await this.createInputTable({
      ...input,
      sourceKind,
      filePath: input.folderPath ? undefined : sourcePath,
      folderPath: input.folderPath ? sourcePath : undefined,
      config: customConfig,
    });
    return {
      ...result,
      processingStrategy: 'customize',
      normalizer: {
        artifact: published.artifact,
        draftVersion: draft.version,
        publishedVersion: published.version,
        sourceSummary: draft.summary,
        preview: normalizerPreview.preview,
      },
    };
  }

  async updateInputTable(input: UpdateInputTableCommand): Promise<InputTableResult> {
    const existing = await this.store.getInputTableRecord(input.id);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${input.id}`);
    }
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueInputTableName(name, input.id);
    }
    const sourcePath = input.filePath || input.folderPath;
    try {
      const inputTable = await this.store.updateDataset({
        id: input.id,
        name,
        filePath: sourcePath,
        sourceKind: input.sourceKind,
        config: input.config,
      });
      const preview = await this.previewIfRequested(inputTable.id, input.previewRows);
      return { inputTable, preview };
    } catch (error) {
      throw toCommandError(error, sourcePath ? 'FILE_ACCESS_DENIED' : 'INVALID_ARGUMENT');
    }
  }

  async summarizeInputTableSource(
    input: SummarizeInputTableSourceCommand
  ): Promise<SummarizeInputTableSourceResult> {
    try {
      return {
        summary: await this.store.summarizeInputTableSource(input),
      };
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
  }

  async generateInputTableNormalizerDraft(
    input: GenerateInputTableNormalizerDraftCommand
  ): Promise<GenerateInputTableNormalizerDraftResult> {
    const name = normalizeRequiredName(input.name, 'Normalizer artifact name is required');
    const rulePrompt = normalizeRequiredName(
      input.rulePrompt,
      'Normalizer rule prompt is required'
    );
    const primaryLanguage = input.primaryLanguage === 'node' ? 'node' : 'python';
    let summary: SummarizeInputTableSourceResult['summary'];
    try {
      input.onProgress?.({
        phase: 'source_summary',
        kind: 'message',
        text: '正在读取文件/文件夹信息，并抽取前 20 行左右样本用于结构分析。',
      });
      summary = await this.store.summarizeInputTableSource({
        sourcePath: input.sourcePath,
        sourceKind: input.sourceKind,
        config: input.config,
        maxFiles: 8,
        maxSheetsPerFile: 12,
        maxRowsPerSheet: 20,
        maxColumnsPerRow: 80,
      });
      input.onProgress?.({
        phase: 'source_summary',
        kind: 'message',
        text: `已完成源文件摘要：${summary.fileCount} 个文件，hash ${summary.hash}。`,
      });
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
    try {
      const template = await this.normalizerProjectGenerator.generate({
        name,
        primaryLanguage,
        rulePrompt,
        selectedSkillNames: input.selectedSkillNames,
        sourceSummary: summary,
        runtimeConfig: input.runtimeConfig,
        onProgress: input.onProgress,
      });
      input.onProgress?.({
        phase: 'saving',
        kind: 'message',
        text: '正在写入项目文件和版本记录。',
      });
      const result = await this.store.saveInputTableNormalizerDraft({
        artifactId: input.artifactId,
        name,
        description: input.description,
        sourceKind: summary.sourceKind,
        primaryLanguage: template.primaryLanguage,
        rulePrompt,
        files: template.files,
        fileTreeHash: createNormalizerFileTreeHash(template.files),
        sourceSummaryHash: summary.hash,
        entrypoint: template.entrypoint,
        dependencyPrepare: template.dependencyPrepare,
        runtime: template.runtime,
        dependencies: template.dependencies,
        dependencyLockHash: createNormalizerDependencyLockHash(template.files),
      });
      input.onProgress?.({
        phase: 'complete',
        kind: 'message',
        text: `草稿已保存：v${result.version.version}，共 ${result.version.files.length} 个项目文件。`,
      });
      return {
        ...result,
        summary,
      };
    } catch (error) {
      input.onProgress?.({
        phase: 'error',
        kind: 'message',
        text: error instanceof Error ? error.message : String(error),
      });
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async previewInputTableNormalizerVersion(
    input: PreviewInputTableNormalizerVersionCommand
  ): Promise<PreviewInputTableNormalizerVersionResult> {
    try {
      return {
        preview: await this.store.previewInputTableNormalizerVersion(input),
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async publishInputTableNormalizerVersion(
    input: PublishInputTableNormalizerVersionCommand
  ): Promise<PublishInputTableNormalizerVersionResult> {
    if (!input.versionId.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Normalizer version id is required');
    }
    try {
      return await this.store.publishInputTableNormalizerArtifactVersion(input.versionId);
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async deleteInputTableNormalizerVersion(
    input: DeleteInputTableNormalizerVersionCommand
  ): Promise<DeleteInputTableNormalizerVersionResult> {
    if (!input.versionId.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Normalizer version id is required');
    }
    try {
      return await this.store.deleteInputTableNormalizerArtifactVersion(input.versionId);
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async listInputTableNormalizerVersions(
    input: ListInputTableNormalizerVersionsCommand
  ): Promise<ListInputTableNormalizerVersionsResult> {
    if (!input.artifactId.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Normalizer artifact id is required');
    }
    try {
      return {
        versions: await this.store.listInputTableNormalizerArtifactVersions(input.artifactId),
      };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  private async previewIfRequested(
    id: string,
    previewRows?: number
  ): Promise<DataInputTablePreview | undefined> {
    if (!previewRows || previewRows <= 0) {
      return undefined;
    }
    return this.previewDataset(id, previewRows);
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

  private async ensureUniqueInputTableName(name: string, excludeId?: string): Promise<void> {
    const existing = await this.store.findInputTableRecordByName(name);
    if (existing) {
      if (existing.id === excludeId) return;
      throw new DataCommandError('RESOURCE_ALREADY_EXISTS', `Input table already exists: ${name}`, {
        id: existing.id,
        name: existing.name,
      });
    }
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

function normalizeSourcePathInput(input: CreateInputTableCommand): string {
  const sourcePath = input.filePath || input.folderPath;
  if (!sourcePath?.trim()) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      'filePath or folderPath is required to create an input table'
    );
  }
  return sourcePath.trim();
}

function resolveInputSourceKindForCommand(
  input: Pick<CreateInputTableCommand, 'sourceKind' | 'folderPath'>,
  sourcePath: string
): DataInputTableSourceKind {
  if (
    input.sourceKind === 'excel' ||
    input.sourceKind === 'csv' ||
    input.sourceKind === 'folder' ||
    input.sourceKind === 'cloud'
  ) {
    return input.sourceKind;
  }
  if (input.folderPath) {
    return 'folder';
  }
  const extension = extname(sourcePath).toLowerCase();
  return extension === '.xlsx' ||
    extension === '.xls' ||
    extension === '.xlsm' ||
    extension === '.xlsb'
    ? 'excel'
    : 'csv';
}

function withInputTableDataProcessing(
  config: DataInputTableConfig | undefined,
  sourceKind: DataInputTableSourceKind,
  dataProcessing: DataInputTableProcessingConfig
): DataInputTableConfig {
  if (sourceKind === 'excel') {
    const excelConfig = config?.sourceKind === 'excel' ? config : undefined;
    return {
      sourceKind: 'excel',
      sheetName: excelConfig?.sheetName ?? null,
      sheetNames: excelConfig?.sheetNames ?? [],
      headerMode: excelConfig?.headerMode === 'manual' ? 'manual' : 'auto',
      headerRow: excelConfig?.headerRow ?? 1,
      dataProcessing,
    };
  }

  if (sourceKind === 'folder') {
    const folderConfig = config?.sourceKind === 'folder' ? config : undefined;
    return {
      sourceKind: 'folder',
      mergeMode: 'append_same_schema',
      schemaStrategy: 'align_by_name',
      fileRange: folderConfig?.fileRange ?? 'excel_csv',
      skipEmptyFiles: folderConfig?.skipEmptyFiles !== false,
      keepSourceFileName: folderConfig?.keepSourceFileName !== false,
      dataProcessing,
    };
  }

  if (sourceKind === 'cloud' && config?.sourceKind === 'cloud') {
    return { ...config, dataProcessing };
  }

  const csvConfig = config?.sourceKind === 'csv' ? config : undefined;
  return {
    sourceKind: 'csv',
    header: 'auto',
    dataRegion: 'auto',
    encoding: 'auto',
    delimiter: 'auto',
    ...csvConfig,
    dataProcessing,
  };
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

function toCommandError(error: unknown, fallbackCode: DataCommandError['code']): DataCommandError {
  if (error instanceof DataCommandError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
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
