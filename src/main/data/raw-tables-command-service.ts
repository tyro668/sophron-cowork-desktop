import { extname } from 'path';
import { getWorkbookSheetNames } from './store/input-source';
import type { DataPipelineStore } from './data-pipeline-store';
import {
  DataCommandError,
  type CreateRawTableCommand,
  type CreateRawTableWithProcessingStrategyCommand,
  type CreateRawTableWithProcessingStrategyResult,
  type DeleteRawTableNormalizerVersionCommand,
  type DeleteRawTableNormalizerVersionResult,
  type GenerateRawTableNormalizerDraftCommand,
  type GenerateRawTableNormalizerDraftResult,
  type RawTableResult,
  type ListRawTableNormalizerVersionsCommand,
  type ListRawTableNormalizerVersionsResult,
  type ListRawTablesInput,
  type ListRawTablesResult,
  type PreviewRawTableNormalizerVersionCommand,
  type PreviewRawTableNormalizerVersionResult,
  type PublishRawTableNormalizerVersionCommand,
  type PublishRawTableNormalizerVersionResult,
  type SummarizeRawTableSourceCommand,
  type SummarizeRawTableSourceResult,
  type UpdateRawTableCommand,
  type RefreshRawSourceCommand,
  type RefreshRawSourceResult,
} from './data-command-types';
import {
  createNormalizerDependencyLockHash,
  createNormalizerFileTreeHash,
} from '../../shared/raw-table-normalizer/templates';
import type { RawTableNormalizerProjectGenerator } from './raw-table-normalizer-generator';
import type { NormalizerPreviewCheck, NormalizerPreviewFn } from './raw-table-normalizer-agent';
import { evaluatePass, expectedColumnsFromAnalysis } from '../../shared/fix-error';
import type {
  DataRawTableConfig,
  DataRawTableNormalizerArtifactVersion,
  DataRawTablePreview,
  DataRawTableProcessingConfig,
  DataRawTableSourceKind,
} from '../../shared/contracts';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_PREVIEW_LIMIT = 20;
const MAX_PREVIEW_LIMIT = 100;

export class RawTablesCommandService {
  constructor(
    private readonly store: DataPipelineStore,
    private readonly normalizerProjectGenerator: RawTableNormalizerProjectGenerator
  ) {}

  async listRawTables(input: ListRawTablesInput = {}): Promise<ListRawTablesResult> {
    const window = listWindow(input.limit, input.offset);
    const dashboard = await this.store.getDashboard({
      query: input.query,
      includeSummary: false,
      includePipelines: false,
      includeRawTables: true,
      includeResultTables: false,
      rawTableSourceKind: input.sourceKind ?? 'all',
      rawTableLimit: window.limit,
      rawTableOffset: window.offset,
    });
    return {
      rawTables: dashboard.rawTables,
      total: dashboard.totalRawTables,
      ...window,
    };
  }

  async createRawTable(input: CreateRawTableCommand): Promise<RawTableResult> {
    if (wantsSourceBuild(input)) {
      return this.createRawTablesFromSource(input);
    }
    const sourcePath = normalizeSourcePathInput(input);
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueRawTableName(name);
    }

    const sourceKind = input.folderPath
      ? input.sourceKind
      : resolveInputSourceKindForCommand(input, sourcePath);
    const config = withRequestedExcelSheet(input.config, sourceKind, sourcePath, input.sheetName);

    try {
      const rawTable = await this.store.importRawTable({
        filePath: sourcePath,
        name,
        sourceKind: input.sourceKind ?? (config?.sourceKind === 'excel' ? 'excel' : undefined),
        config,
      });
      const preview = await this.previewIfRequested(rawTable.id, input.previewRows);
      return { rawTable, preview };
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
  }

  /** 1:N creation: several sheets, merged sheets, or a folder build mode. */
  private async createRawTablesFromSource(input: CreateRawTableCommand): Promise<RawTableResult> {
    const sourcePath = normalizeSourcePathInput(input);
    const name = normalizeOptionalName(input.name);
    const sheets = (input.sheetNames ?? []).map((sheet) => sheet.trim()).filter(Boolean);
    const isFolder = Boolean(input.folderPath) || input.sourceKind === 'folder';
    const buildMode = isFolder
      ? input.folderMode === 'per_file'
        ? 'folder_per_file'
        : 'folder_merge'
      : input.mergeSheets
        ? 'excel_merge_sheets'
        : sheets.length > 1
          ? 'excel_per_sheet'
          : 'excel_single';
    if (!isFolder && sheets.length === 0) {
      throw new DataCommandError('INVALID_ARGUMENT', 'sheetNames must list at least one sheet');
    }
    try {
      const result = await this.store.createRawSource({
        sourcePath,
        buildMode,
        sheets: isFolder ? undefined : sheets,
        // Only the requested sheets: without members per-sheet mode would import every sheet.
        members:
          buildMode === 'excel_single'
            ? [{ key: sheets[0], name: name ?? undefined }]
            : buildMode === 'excel_per_sheet'
              ? sheets.map((key) => ({ key }))
              : undefined,
        tableName: name ?? undefined,
        sheetSelector: input.sheetSelector,
      });
      const first = result.tables[0];
      const preview = first
        ? await this.previewIfRequested(first.id, input.previewRows)
        : undefined;
      return {
        rawTable: first,
        rawTables: result.tables,
        source: result.source,
        skipped: result.skipped,
        preview,
      };
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
  }

  /** Re-import every table of a source (sheets / files), adding new members when enabled. */
  async refreshRawSource(input: RefreshRawSourceCommand): Promise<RefreshRawSourceResult> {
    const id = input.id?.trim();
    if (!id) throw new DataCommandError('INVALID_ARGUMENT', 'id is required');
    let sourceId = (await this.store.getRawSource(id))?.id;
    if (!sourceId) {
      const table = await this.store.getRawTableRecord(id);
      sourceId = table?.sourceId ?? undefined;
    }
    if (!sourceId) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Raw table or source not found: ${id}`);
    }
    try {
      return await this.store.refreshRawSource(sourceId);
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
  }

  async createRawTableWithProcessingStrategy(
    input: CreateRawTableWithProcessingStrategyCommand
  ): Promise<CreateRawTableWithProcessingStrategyResult> {
    const sourcePath = normalizeSourcePathInput(input);
    const sourceKind = resolveInputSourceKindForCommand(input, sourcePath);
    const requestedConfig = withRequestedExcelSheet(
      input.config,
      sourceKind,
      sourcePath,
      input.sheetName
    );
    const baseConfig = withRawTableDataProcessing(requestedConfig, sourceKind, {
      strategy: 'auto',
    });

    if (input.processingStrategy.strategy === 'auto') {
      const result = await this.createRawTable({
        ...input,
        sourceKind,
        filePath: input.folderPath ? undefined : sourcePath,
        folderPath: input.folderPath ? sourcePath : undefined,
        sheetName: undefined,
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
      await this.ensureUniqueRawTableName(input.name);
    }

    const draft = await this.generateRawTableNormalizerDraft({
      artifactId: input.processingStrategy.artifactId,
      name: artifactName,
      description: input.processingStrategy.artifactDescription,
      sourcePath,
      sourceKind,
      config: baseConfig,
      rulePrompt,
      primaryLanguage: input.processingStrategy.primaryLanguage,
    });
    const normalizerPreview = await this.previewRawTableNormalizerVersion({
      versionId: draft.version.id,
      sourcePath,
      sourceKind,
      config: baseConfig,
      prepareDependencies: input.processingStrategy.prepareDependencies,
      limit: input.previewRows,
    });
    const published = await this.publishRawTableNormalizerVersion({
      versionId: draft.version.id,
    });
    const customConfig = withRawTableDataProcessing(requestedConfig, sourceKind, {
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
      sourceSummaryHash: published.version.sourceSummaryHash ?? undefined,
    });
    const result = await this.createRawTable({
      ...input,
      sourceKind,
      filePath: input.folderPath ? undefined : sourcePath,
      folderPath: input.folderPath ? sourcePath : undefined,
      sheetName: undefined,
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

  async deleteRawTableCreatedByAgent(id: string): Promise<{ name: string }> {
    const existing = await this.store.getRawTableRecord(id);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${id}`);
    }
    const dashboard = await this.store.getDashboard({
      includeSummary: false,
      includePipelines: false,
      includeRawTables: true,
      includeResultTables: false,
      rawTableSourceKind: 'all',
      rawTableLimit: 1000,
      rawTableOffset: 0,
    });
    const related =
      dashboard.rawTables.find((table) => table.id === id)?.relatedPipelineNames ??
      existing.relatedPipelineNames;
    if (related.length > 0) {
      throw new DataCommandError(
        'INVALID_ARGUMENT',
        `Input table ${existing.name} is used by data pipeline(s): ${related.join(', ')}; it cannot be deleted by the agent`
      );
    }
    await this.store.deleteRawTable(id);
    return { name: existing.name };
  }

  async updateRawTable(input: UpdateRawTableCommand): Promise<RawTableResult> {
    const existing = await this.store.getRawTableRecord(input.id);
    if (!existing) {
      throw new DataCommandError('RESOURCE_NOT_FOUND', `Input table not found: ${input.id}`);
    }
    const name = normalizeOptionalName(input.name);
    if (name) {
      await this.ensureUniqueRawTableName(name, input.id);
    }
    const sourcePath = input.filePath || input.folderPath;
    const effectivePath = sourcePath || existing.sourcePath;
    const effectiveKind = input.sourceKind ?? existing.sourceKind;
    const requestedSheet = requestedExcelSheet(input.config, input.sheetName);
    const config = requestedSheet
      ? withRequestedExcelSheet(
          input.config ??
            (existing.inputConfig?.sourceKind === 'excel' ? existing.inputConfig : undefined),
          effectiveKind,
          effectivePath,
          requestedSheet
        )
      : input.config;
    try {
      const rawTable = await this.store.updateRawTable({
        id: input.id,
        name,
        filePath: sourcePath ?? (requestedSheet ? existing.sourcePath : undefined),
        sourceKind: input.sourceKind ?? (requestedSheet ? effectiveKind : undefined),
        config,
      });
      const preview = await this.previewIfRequested(rawTable.id, input.previewRows);
      return { rawTable, preview };
    } catch (error) {
      throw toCommandError(error, sourcePath ? 'FILE_ACCESS_DENIED' : 'INVALID_ARGUMENT');
    }
  }

  async summarizeRawTableSource(
    input: SummarizeRawTableSourceCommand
  ): Promise<SummarizeRawTableSourceResult> {
    try {
      return {
        summary: await this.store.summarizeRawTableSource(input),
      };
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
  }

  async generateRawTableNormalizerDraft(
    input: GenerateRawTableNormalizerDraftCommand
  ): Promise<GenerateRawTableNormalizerDraftResult> {
    const name = normalizeRequiredName(input.name, 'Normalizer artifact name is required');
    const rulePrompt = normalizeRequiredName(
      input.rulePrompt,
      'Normalizer rule prompt is required'
    );
    const primaryLanguage = input.primaryLanguage === 'node' ? 'node' : 'python';
    if (input.fix) return this.fixRawTableNormalizerDraft(input, name, rulePrompt);
    let summary: SummarizeRawTableSourceResult['summary'];
    try {
      input.onProgress?.({
        phase: 'source_summary',
        kind: 'message',
        text: '正在读取文件/文件夹信息，并抽取前 20 行左右样本用于结构分析。',
      });
      summary = await this.store.summarizeRawTableSource({
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
      // Self-test: preview the generated draft on the real source; a failing preview goes to the
      // agent, which edits and previews until it passes (or hits its limits).
      const preview = this.normalizerPreviewFn(input, template);
      input.onProgress?.({ phase: 'verify', kind: 'message', text: '预览自测…' });
      let check = await preview(template.files);
      input.onProgress?.({ phase: 'verify', kind: 'message', text: previewLine(check) });
      if (!check.passed && this.normalizerProjectGenerator.refine) {
        input.signal?.throwIfAborted();
        const refined = await this.normalizerProjectGenerator.refine({
          name,
          primaryLanguage,
          rulePrompt,
          files: template.files,
          failure: check.reason ?? '预览失败',
          sourceSummary: summary,
          runtimeConfig: input.runtimeConfig,
          onProgress: input.onProgress,
          preview,
          signal: input.signal,
        });
        template.files = refined.files;
        check = await preview(template.files);
        input.onProgress?.({ phase: 'verify', kind: 'message', text: previewLine(check) });
      }
      input.signal?.throwIfAborted();
      input.onProgress?.({
        phase: 'saving',
        kind: 'message',
        text: '正在写入项目文件和版本记录。',
      });
      const result = await this.store.saveRawTableNormalizerDraft({
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

  /**
   * 交给 AI 修复: a follow-up turn on the current draft. Reads the draft's files and the preview
   * failure, lets the model change only what is needed, and saves the result to the AI 修复
   * draft (overwritten on later fixes). Rule-based generation above stays from scratch.
   */
  private async fixRawTableNormalizerDraft(
    input: GenerateRawTableNormalizerDraftCommand,
    name: string,
    rulePrompt: string
  ): Promise<GenerateRawTableNormalizerDraftResult> {
    const fix = input.fix!;
    const generator = this.normalizerProjectGenerator;
    if (!generator.fix) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Normalizer generator cannot fix drafts');
    }
    let base: NonNullable<
      Awaited<ReturnType<DataPipelineStore['getRawTableNormalizerArtifactVersion']>>
    >;
    let summary: SummarizeRawTableSourceResult['summary'];
    try {
      input.onProgress?.({
        phase: 'source_summary',
        kind: 'message',
        text: '读取报错、当前草稿的项目文件和输入样本。',
      });
      const found = await this.store.getRawTableNormalizerArtifactVersion(fix.baseVersionId);
      if (!found) {
        throw new DataCommandError(
          'INVALID_ARGUMENT',
          `Normalizer version not found: ${fix.baseVersionId}`
        );
      }
      base = found;
      if (input.artifactId && base.artifactId !== input.artifactId) {
        throw new DataCommandError(
          'INVALID_ARGUMENT',
          'Fix base version belongs to another artifact'
        );
      }
      summary = await this.store.summarizeRawTableSource({
        sourcePath: input.sourcePath,
        sourceKind: input.sourceKind,
        config: input.config,
        maxFiles: 8,
        maxSheetsPerFile: 12,
        maxRowsPerSheet: 20,
        maxColumnsPerRow: 80,
      });
    } catch (error) {
      throw toCommandError(error, 'FILE_ACCESS_DENIED');
    }
    try {
      const result = await generator.fix({
        name,
        primaryLanguage: base.runtime.language === 'node' ? 'node' : 'python',
        rulePrompt: base.rulePrompt || rulePrompt,
        files: base.files.filter((file) => file.path !== '.gitignore'),
        baseLabel: `v${base.version} ${base.status === 'published' ? '已发布' : '草稿'}`,
        request: {
          error: fix.error,
          note: fix.note,
          durationMs: fix.durationMs,
          round: fix.round,
          maxRounds: fix.maxRounds,
          previousAttempts: fix.previousAttempts,
        },
        sourceSummary: summary,
        runtimeConfig: input.runtimeConfig,
        onProgress: input.onProgress,
        preview: this.normalizerPreviewFn(input, base),
        signal: input.signal,
      });
      input.onProgress?.({
        phase: 'saving',
        kind: 'message',
        text: `修改 ${result.changedFiles.join('、')}，写入 AI 修复草稿。`,
      });
      const saved = await this.store.saveRawTableNormalizerFixDraft({
        baseVersionId: base.id,
        files: result.files,
        reason: [
          result.summary,
          `报错：${result.payload.error}`,
          fix.note ? `补充：${fix.note}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      input.onProgress?.({
        phase: 'complete',
        kind: 'message',
        text: `${saved.replaced ? '已覆盖' : '已保存'} v${saved.version.version} AI 修复草稿。`,
      });
      return {
        artifact: saved.artifact,
        version: saved.version,
        summary,
        changedFiles: result.changedFiles,
        fixSummary: result.summary || result.analysis,
        replaced: saved.replaced,
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

  /** Preview unsaved project files on the generation input, judged by evaluatePass. */
  private normalizerPreviewFn(
    input: GenerateRawTableNormalizerDraftCommand,
    meta: Pick<
      DataRawTableNormalizerArtifactVersion,
      'entrypoint' | 'runtime' | 'dependencyPrepare'
    >
  ): NormalizerPreviewFn {
    return async (files) => {
      const startedAt = Date.now();
      try {
        const preview = await this.store.previewRawTableNormalizerFiles({
          files,
          entrypoint: meta.entrypoint,
          runtime: meta.runtime,
          dependencyPrepare: meta.dependencyPrepare,
          sourcePath: input.sourcePath,
          sourceKind: input.sourceKind,
          config: input.config,
          prepareDependencies: true,
          limit: 50,
          offset: 0,
        });
        const verdict = evaluatePass({
          ok: true,
          columns: preview.columns,
          rows: preview.rows,
          totalRows: preview.totalRows,
          expectedColumns: expectedColumnsFromAnalysis(
            files.find((file) => file.path === 'docs/source-structure-analysis.json')?.content
          ),
        });
        const sample = [
          preview.columns.join(','),
          ...preview.rows
            .slice(0, 5)
            .map((row) => preview.columns.map((column) => String(row[column] ?? '')).join(',')),
        ].join('\n');
        return {
          passed: verdict.ok,
          ...(verdict.reason ? { reason: verdict.reason } : {}),
          rows: preview.totalRows,
          columns: preview.columns,
          sample,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        return {
          passed: false,
          reason: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        };
      }
    };
  }

  async previewRawTableNormalizerVersion(
    input: PreviewRawTableNormalizerVersionCommand
  ): Promise<PreviewRawTableNormalizerVersionResult> {
    try {
      return {
        preview: await this.store.previewRawTableNormalizerVersion(input),
      };
    } catch (error) {
      throw toCommandError(error, 'RUN_FAILED');
    }
  }

  async publishRawTableNormalizerVersion(
    input: PublishRawTableNormalizerVersionCommand
  ): Promise<PublishRawTableNormalizerVersionResult> {
    if (!input.versionId.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Normalizer version id is required');
    }
    try {
      return await this.store.publishRawTableNormalizerArtifactVersion(input.versionId);
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async deleteRawTableNormalizerVersion(
    input: DeleteRawTableNormalizerVersionCommand
  ): Promise<DeleteRawTableNormalizerVersionResult> {
    if (!input.versionId.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Normalizer version id is required');
    }
    try {
      return await this.store.deleteRawTableNormalizerArtifactVersion(input.versionId);
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  async listRawTableNormalizerVersions(
    input: ListRawTableNormalizerVersionsCommand
  ): Promise<ListRawTableNormalizerVersionsResult> {
    if (!input.artifactId.trim()) {
      throw new DataCommandError('INVALID_ARGUMENT', 'Normalizer artifact id is required');
    }
    try {
      return {
        versions: await this.store.listRawTableNormalizerArtifactVersions(input.artifactId),
      };
    } catch (error) {
      throw toCommandError(error, 'INVALID_ARGUMENT');
    }
  }

  private async previewIfRequested(
    id: string,
    previewRows?: number
  ): Promise<DataRawTablePreview | undefined> {
    if (!previewRows || previewRows <= 0) {
      return undefined;
    }
    return this.previewRawTable(id, previewRows);
  }

  private async previewRawTable(
    id: string,
    limit?: number,
    offset?: number
  ): Promise<DataRawTablePreview> {
    return this.store.previewRawTable({
      id,
      limit: previewLimit(limit),
      offset: previewOffset(offset),
    });
  }

  private async ensureUniqueRawTableName(name: string, excludeId?: string): Promise<void> {
    const existing = await this.store.findRawTableRecordByName(name);
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

function normalizeSourcePathInput(input: CreateRawTableCommand): string {
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
  input: Pick<CreateRawTableCommand, 'sourceKind' | 'folderPath'>,
  sourcePath: string
): DataRawTableSourceKind {
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

function requestedExcelSheet(
  config: DataRawTableConfig | undefined,
  sheetName: string | undefined
): string | undefined {
  const direct = typeof sheetName === 'string' ? sheetName.trim() : '';
  if (direct) return direct;
  const record = config as { sourceKind?: unknown; sheetName?: unknown } | undefined;
  if (record && (record.sourceKind === undefined || record.sourceKind === 'excel')) {
    const fromConfig = typeof record.sheetName === 'string' ? record.sheetName.trim() : '';
    if (fromConfig) return fromConfig;
  }
  return undefined;
}

/**
 * Agents often pass `{ sheetName }` without `sourceKind`, or a top-level sheetName.
 * Normalize both into an explicit excel config and fail loudly (listing the
 * workbook's sheets) when the sheet does not exist instead of importing sheet 1.
 */
export function withRequestedExcelSheet(
  config: DataRawTableConfig | undefined,
  sourceKind: DataRawTableSourceKind | undefined,
  sourcePath: string,
  sheetName: string | undefined
): DataRawTableConfig | undefined {
  const requested = requestedExcelSheet(config, sheetName);
  if (!requested) return config;
  if (sourceKind !== 'excel') {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      `sheetName "${requested}" only applies to Excel sources (source kind: ${sourceKind ?? 'unknown'})`
    );
  }
  let sheetNames: string[] = [];
  try {
    sheetNames = getWorkbookSheetNames(sourcePath);
  } catch (error) {
    throw toCommandError(error, 'FILE_ACCESS_DENIED');
  }
  if (!sheetNames.includes(requested)) {
    throw new DataCommandError(
      'INVALID_ARGUMENT',
      `Sheet "${requested}" not found in ${sourcePath}. Available sheets: ${sheetNames.join(', ') || '(none)'}`
    );
  }
  const base = (config ?? {}) as Record<string, unknown>;
  return {
    ...base,
    sourceKind: 'excel',
    sheetName: requested,
    sheetNames,
  } as DataRawTableConfig;
}

function withRawTableDataProcessing(
  config: DataRawTableConfig | undefined,
  sourceKind: DataRawTableSourceKind,
  dataProcessing: DataRawTableProcessingConfig
): DataRawTableConfig {
  if (sourceKind === 'excel') {
    const loose = config as { sourceKind?: unknown } | undefined;
    const excelConfig =
      config && (loose?.sourceKind === 'excel' || loose?.sourceKind === undefined)
        ? (config as Extract<DataRawTableConfig, { sourceKind: 'excel' }>)
        : undefined;
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

function wantsSourceBuild(input: CreateRawTableCommand): boolean {
  return (
    (input.sheetNames?.length ?? 0) > 0 ||
    Boolean(input.mergeSheets) ||
    Boolean(input.folderMode) ||
    Boolean(input.sheetSelector)
  );
}

function previewLine(check: NormalizerPreviewCheck): string {
  return check.passed
    ? `✓ 预览通过：${check.rows ?? 0} 行 · ${check.columns?.length ?? 0} 列`
    : `✕ 预览未通过：${check.reason ?? ''}`;
}
