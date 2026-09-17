/** Normalizer artifact lifecycle: drafts, publish, delete, preview, import runs. */
import type {
  DataInputTableConfig,
  DataInputTableNormalizerVersionSaveResult,
  DataInputTablePreview,
  DataInputTableSourceKind,
  DataPreviewInputTableNormalizerVersionInput,
  DataSaveInputTableNormalizerDraftInput,
} from '../../../../shared/contracts';
import { runInputTableNormalizerProject } from '../../input-table-normalizer-runner';
import { quoteIdentifier, toNumber } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import {
  normalizeImportSourcePath,
  normalizeInputTableConfig,
  normalizeInputTableSourceKind,
  normalizePreviewLimit,
  normalizePreviewOffset,
  normalizePreviewRow,
  PreparedInputTableImport,
  PreparedInputTableNormalizerSourceContext,
  prepareInputTableNormalizerSources,
  readNormalizerOutputRelationForPath,
  writeInputTableNormalizerProjectFiles,
} from '../input-source';
import { NormalizerRepository } from '../repositories/normalizer-repository';
import { InputSourceSummaryService } from './input-source-summary-service';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export class NormalizerService {
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly normalizers: NormalizerRepository,
    private readonly summarizer: InputSourceSummaryService
  ) {}
  async saveInputTableNormalizerDraft(
    input: DataSaveInputTableNormalizerDraftInput
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    await this.ctx.ensureMetadataReady();
    const name = input.name.trim();
    const rulePrompt = input.rulePrompt.trim();
    const files = input.files.filter(
      (file) => file.path.trim().length > 0 && file.content !== undefined
    );
    if (!name) {
      throw new Error('Normalizer artifact name is required');
    }
    if (!rulePrompt) {
      throw new Error('Normalizer rule prompt is required');
    }
    if (files.length === 0) {
      throw new Error('Normalizer project files are required');
    }
    if (!input.fileTreeHash.trim()) {
      throw new Error('Normalizer file tree hash is required');
    }

    const now = this.ctx.now();
    const artifactId = input.artifactId?.trim() || uuidv4();
    const existingArtifact = input.artifactId
      ? await this.normalizers.getInputTableNormalizerArtifact(artifactId)
      : null;
    if (input.artifactId && !existingArtifact) {
      throw new Error(`Normalizer artifact not found: ${artifactId}`);
    }

    if (existingArtifact) {
      await this.normalizers.updateArtifactMetadata({
        id: artifactId,
        name,
        description: input.description ?? null,
        sourceKind: input.sourceKind,
        primaryLanguage: input.primaryLanguage,
        updatedAt: now,
      });
    } else {
      await this.normalizers.insertArtifact({
        id: artifactId,
        name,
        description: input.description ?? null,
        sourceKind: input.sourceKind,
        primaryLanguage: input.primaryLanguage,
        createdAt: now,
        updatedAt: now,
      });
    }

    const versionNumber = await this.normalizers.nextVersionNumber(artifactId);
    const versionId = uuidv4();
    const projectDir = this.normalizers.getInputTableNormalizerProjectDir(artifactId, versionId);
    try {
      writeInputTableNormalizerProjectFiles(projectDir, files);
      await this.normalizers.insertVersion({
        id: versionId,
        artifactId,
        version: versionNumber,
        filesJson: JSON.stringify(files),
        fileTreeHash: input.fileTreeHash.trim(),
        rulePrompt,
        sourceSummaryHash: input.sourceSummaryHash ?? null,
        entrypointJson: JSON.stringify(input.entrypoint),
        dependencyPrepareJson: input.dependencyPrepare
          ? JSON.stringify(input.dependencyPrepare)
          : null,
        runtimeJson: JSON.stringify(input.runtime),
        dependenciesJson: JSON.stringify(input.dependencies ?? []),
        dependencyLockHash: input.dependencyLockHash ?? null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      throw error;
    }

    return {
      artifact: await this.normalizers.requireInputTableNormalizerArtifact(artifactId),
      version: await this.normalizers.requireInputTableNormalizerArtifactVersion(versionId),
    };
  }
  async publishInputTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    await this.ctx.ensureMetadataReady();
    const version = await this.normalizers.requireInputTableNormalizerArtifactVersion(versionId);
    const artifact = await this.normalizers.requireInputTableNormalizerArtifact(version.artifactId);
    const now = this.ctx.now();
    await this.normalizers.archiveOtherPublishedVersions(artifact.id, versionId, now);
    await this.normalizers.markVersionPublished(versionId, now);
    await this.normalizers.setArtifactActiveVersion(artifact.id, versionId, now);
    return {
      artifact: await this.normalizers.requireInputTableNormalizerArtifact(artifact.id),
      version: await this.normalizers.requireInputTableNormalizerArtifactVersion(versionId),
    };
  }
  async deleteInputTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<{ success: boolean }> {
    await this.ctx.ensureMetadataReady();
    const version = await this.normalizers.requireInputTableNormalizerArtifactVersion(versionId);
    if (version.status === 'published') {
      throw new Error('Published normalizer versions cannot be deleted');
    }
    const now = this.ctx.now();
    await this.normalizers.deleteVersionRow(versionId);
    await this.normalizers.touchArtifact(version.artifactId, now);
    fs.rmSync(this.normalizers.getInputTableNormalizerProjectDir(version.artifactId, version.id), {
      recursive: true,
      force: true,
    });
    return { success: true };
  }
  async previewInputTableNormalizerVersion(
    input: DataPreviewInputTableNormalizerVersionInput
  ): Promise<DataInputTablePreview> {
    // Runs the normalizer project and materializes a TEMP table on the shared
    // connection — serialize with commits through the exclusive section.
    return this.ctx.runExclusive(
      () => this.previewInputTableNormalizerVersionUnsafe(input),
      `previewInputTableNormalizerVersion:${input.versionId}`
    );
  }
  private async previewInputTableNormalizerVersionUnsafe(
    input: DataPreviewInputTableNormalizerVersionInput
  ): Promise<DataInputTablePreview> {
    await this.ctx.ensureReady();
    const version = await this.normalizers.requireInputTableNormalizerArtifactVersion(
      input.versionId
    );
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const summary = await this.summarizer.summarizeInputTableSource({
      sourcePath,
      sourceKind,
      config,
    });
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const tempTable = tableNameFromId('normalizer_preview', uuidv4());
    let workDir: string | null = null;
    let cleanupWorkDir = true;
    let preparedSources: PreparedInputTableNormalizerSourceContext | null = null;
    try {
      preparedSources = prepareInputTableNormalizerSources({
        sourcePath,
        sourceKind,
        config,
        summary,
      });
      const result = await runInputTableNormalizerProject({
        version,
        prepareDependencies: input.prepareDependencies === true,
        projectRoot: this.normalizers.getInputTableNormalizerProjectDir(
          version.artifactId,
          version.id
        ),
        workspaceRoot: this.normalizers.getInputTableNormalizerRunRoot(),
        context: {
          sourcePath,
          sourceKind,
          config,
          sourceSummary: summary,
          preparedSources,
        },
      });
      workDir = result.workDir;
      cleanupWorkDir = result.cleanupWorkDir;
      const relation = readNormalizerOutputRelationForPath(
        result.manifest.output,
        'normalizerOutputPath'
      );
      await this.ctx.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tempTable)} AS SELECT * FROM ${relation}`,
        {
          normalizerOutputPath: result.manifest.output,
        }
      );
      const countRows = await this.ctx.queryRows<{ count: number | string }>(
        `SELECT count(*) AS count FROM ${quoteIdentifier(tempTable)}`
      );
      const rows = await this.ctx.queryRows<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(tempTable)} LIMIT ${limit} OFFSET ${offset}`
      );
      return {
        columns: await this.ctx.getTableColumns(tempTable),
        columnTypes: await this.ctx.inferTableColumnTypes(tempTable),
        rows: rows.map(normalizePreviewRow),
        fileCount: summary.fileCount,
        limit,
        offset,
        totalRows: toNumber(countRows[0]?.count),
      };
    } finally {
      await this.ctx.dropTableIfExists(tempTable).catch(() => undefined);
      if (workDir && cleanupWorkDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      if (preparedSources) {
        fs.rmSync(preparedSources.directory, { recursive: true, force: true });
      }
    }
  }
  async previewPublishedInputTableNormalizerVersion(input: {
    sourcePath: string;
    sourceKind: DataInputTableSourceKind;
    config: DataInputTableConfig;
    limit: number;
    offset: number;
  }): Promise<DataInputTablePreview> {
    const processing = input.config.dataProcessing;
    if (processing?.strategy !== 'customize' || !processing.artifactVersionId) {
      throw new Error('Published normalizer version is required for custom input table preview');
    }
    if (processing.artifactVersionStatus !== 'published') {
      throw new Error('Custom input table normalizer must be published before standard preview');
    }
    return this.previewInputTableNormalizerVersion({
      versionId: processing.artifactVersionId,
      sourcePath: input.sourcePath,
      sourceKind: input.sourceKind,
      config: input.config,
      prepareDependencies: false,
      limit: input.limit,
      offset: input.offset,
    });
  }
  async createDatasetTableFromPublishedNormalizer(
    tableName: string,
    sourcePath: string,
    sourceKind: DataInputTableSourceKind,
    config: DataInputTableConfig
  ): Promise<PreparedInputTableImport> {
    const processing = config.dataProcessing;
    if (processing?.strategy !== 'customize' || !processing.artifactVersionId) {
      throw new Error('Published normalizer version is required for custom input table import');
    }
    if (processing.artifactVersionStatus !== 'published') {
      throw new Error('Custom input table normalizer must be published before import');
    }
    const version = await this.normalizers.requireInputTableNormalizerArtifactVersion(
      processing.artifactVersionId
    );
    if (version.status !== 'published') {
      throw new Error('Custom input table normalizer version is not published');
    }
    const summary = await this.summarizer.summarizeInputTableSource({
      sourcePath,
      sourceKind,
      config,
    });
    let workDir: string | null = null;
    let cleanupWorkDir = true;
    let preparedSources: PreparedInputTableNormalizerSourceContext | null = null;
    const tempTable = tableNameFromId('normalizer_import', uuidv4());
    try {
      preparedSources = prepareInputTableNormalizerSources({
        sourcePath,
        sourceKind,
        config,
        summary,
      });
      const result = await runInputTableNormalizerProject({
        version,
        prepareDependencies: false,
        projectRoot: this.normalizers.getInputTableNormalizerProjectDir(
          version.artifactId,
          version.id
        ),
        workspaceRoot: this.normalizers.getInputTableNormalizerRunRoot(),
        context: {
          sourcePath,
          sourceKind,
          config,
          sourceSummary: summary,
          preparedSources,
        },
      });
      workDir = result.workDir;
      cleanupWorkDir = result.cleanupWorkDir;
      const relation = readNormalizerOutputRelationForPath(
        result.manifest.output,
        'normalizerImportOutputPath'
      );
      await this.ctx.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tempTable)} AS SELECT * FROM ${relation}`,
        {
          normalizerImportOutputPath: result.manifest.output,
        }
      );
      await this.ctx.createTypedTableFromRelation(tableName, tempTable);
      return {
        rowCount: await this.ctx.countRows(tableName),
        columnCount: (await this.ctx.getTableColumns(tableName)).length,
        fileCount: summary.fileCount,
        config,
      };
    } finally {
      if (workDir && cleanupWorkDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      await this.ctx.dropTableIfExists(tempTable).catch(() => undefined);
      if (preparedSources) {
        fs.rmSync(preparedSources.directory, { recursive: true, force: true });
      }
    }
  }
}
