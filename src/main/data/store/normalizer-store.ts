import * as fs from 'fs';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  DataInputTableConfig,
  DataInputTableNormalizerArtifact,
  DataInputTableNormalizerArtifactVersion,
  DataInputTableNormalizerVersionSaveResult,
  DataInputTablePreview,
  DataInputTableSourceKind,
  DataPreviewInputTableNormalizerVersionInput,
  DataSaveInputTableNormalizerDraftInput,
} from '../../../shared/contracts';
import { runInputTableNormalizerProject } from '../input-table-normalizer-runner';
import { quoteIdentifier, toNumber } from '../operators';
import {
  DataInputTableNormalizerArtifactRow,
  DataInputTableNormalizerArtifactVersionRow,
  mapInputTableNormalizerArtifactRow,
  mapInputTableNormalizerArtifactVersionRow,
  tableNameFromId,
} from './data-store-records';
import { DataStoreRuntime } from './data-store-runtime';
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
  sanitizeNormalizerPathSegment,
  writeInputTableNormalizerProjectFiles,
} from './input-source';

export abstract class NormalizerStore extends DataStoreRuntime {
  protected getInputTableNormalizerStorageRoot(): string {
    return join(dirname(this.dbPath), 'input-table-normalizers');
  }

  protected getInputTableNormalizerProjectDir(artifactId: string, versionId: string): string {
    return join(
      this.getInputTableNormalizerStorageRoot(),
      'projects',
      sanitizeNormalizerPathSegment(artifactId),
      sanitizeNormalizerPathSegment(versionId)
    );
  }

  protected getInputTableNormalizerRunRoot(): string {
    return join(this.getInputTableNormalizerStorageRoot(), 'runs');
  }

  async saveInputTableNormalizerDraft(
    input: DataSaveInputTableNormalizerDraftInput
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    await this.ensureMetadataReady();
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

    const now = this.now();
    const artifactId = input.artifactId?.trim() || uuidv4();
    const existingArtifact = input.artifactId
      ? await this.getInputTableNormalizerArtifact(artifactId)
      : null;
    if (input.artifactId && !existingArtifact) {
      throw new Error(`Normalizer artifact not found: ${artifactId}`);
    }

    if (existingArtifact) {
      await this.metaRunSql(
        `
            UPDATE data_input_table_normalizer_artifacts
            SET name = $name,
                description = $description,
                source_kind = $sourceKind,
                primary_language = $primaryLanguage,
                updated_at = $updatedAt
            WHERE id = $id
          `,
        {
          id: artifactId,
          name,
          description: input.description ?? null,
          sourceKind: input.sourceKind,
          primaryLanguage: input.primaryLanguage,
          updatedAt: now,
        }
      );
    } else {
      await this.metaRunSql(
        `
            INSERT INTO data_input_table_normalizer_artifacts (
              id, name, description, source_kind, primary_language, active_version_id,
              created_at, updated_at
            )
            VALUES (
              $id, $name, $description, $sourceKind, $primaryLanguage, NULL,
              $createdAt, $updatedAt
            )
          `,
        {
          id: artifactId,
          name,
          description: input.description ?? null,
          sourceKind: input.sourceKind,
          primaryLanguage: input.primaryLanguage,
          createdAt: now,
          updatedAt: now,
        }
      );
    }

    const nextVersionRows = await this.metaQueryRows<{ version: number | string }>(
      `
          SELECT coalesce(max(version), 0) + 1 AS version
          FROM data_input_table_normalizer_artifact_versions
          WHERE artifact_id = $artifactId
        `,
      { artifactId }
    );
    const versionNumber = toNumber(nextVersionRows[0]?.version);
    const versionId = uuidv4();
    const projectDir = this.getInputTableNormalizerProjectDir(artifactId, versionId);
    try {
      writeInputTableNormalizerProjectFiles(projectDir, files);
      await this.metaRunSql(
        `
            INSERT INTO data_input_table_normalizer_artifact_versions (
              id, artifact_id, version, status, files_json, file_tree_hash, rule_prompt,
              source_summary_hash, entrypoint_json, dependency_prepare_json, runtime_json,
              dependencies_json, dependency_lock_hash, created_at, updated_at, published_at
            )
            VALUES (
              $id, $artifactId, $version, 'draft', $filesJson, $fileTreeHash, $rulePrompt,
              $sourceSummaryHash, $entrypointJson, $dependencyPrepareJson, $runtimeJson,
              $dependenciesJson, $dependencyLockHash, $createdAt, $updatedAt, NULL
            )
          `,
        {
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
        }
      );
    } catch (error) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      throw error;
    }

    return {
      artifact: await this.requireInputTableNormalizerArtifact(artifactId),
      version: await this.requireInputTableNormalizerArtifactVersion(versionId),
    };
  }

  async publishInputTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<DataInputTableNormalizerVersionSaveResult> {
    await this.ensureMetadataReady();
    const version = await this.requireInputTableNormalizerArtifactVersion(versionId);
    const artifact = await this.requireInputTableNormalizerArtifact(version.artifactId);
    const now = this.now();
    await this.metaRunSql(
      `
          UPDATE data_input_table_normalizer_artifact_versions
          SET status = 'archived',
              updated_at = $updatedAt
          WHERE artifact_id = $artifactId
            AND status = 'published'
            AND id <> $versionId
        `,
      { artifactId: artifact.id, versionId, updatedAt: now }
    );
    await this.metaRunSql(
      `
          UPDATE data_input_table_normalizer_artifact_versions
          SET status = 'published',
              published_at = coalesce(published_at, $publishedAt),
              updated_at = $updatedAt
          WHERE id = $versionId
        `,
      { versionId, publishedAt: now, updatedAt: now }
    );
    await this.metaRunSql(
      `
          UPDATE data_input_table_normalizer_artifacts
          SET active_version_id = $versionId,
              updated_at = $updatedAt
          WHERE id = $artifactId
        `,
      { artifactId: artifact.id, versionId, updatedAt: now }
    );
    return {
      artifact: await this.requireInputTableNormalizerArtifact(artifact.id),
      version: await this.requireInputTableNormalizerArtifactVersion(versionId),
    };
  }

  async deleteInputTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<{ success: boolean }> {
    await this.ensureMetadataReady();
    const version = await this.requireInputTableNormalizerArtifactVersion(versionId);
    if (version.status === 'published') {
      throw new Error('Published normalizer versions cannot be deleted');
    }
    const now = this.now();
    await this.metaRunSql(
      `
          DELETE FROM data_input_table_normalizer_artifact_versions
          WHERE id = $versionId
        `,
      { versionId }
    );
    await this.metaRunSql(
      `
          UPDATE data_input_table_normalizer_artifacts
          SET updated_at = $updatedAt
          WHERE id = $artifactId
        `,
      { artifactId: version.artifactId, updatedAt: now }
    );
    fs.rmSync(this.getInputTableNormalizerProjectDir(version.artifactId, version.id), {
      recursive: true,
      force: true,
    });
    return { success: true };
  }

  async previewInputTableNormalizerVersion(
    input: DataPreviewInputTableNormalizerVersionInput
  ): Promise<DataInputTablePreview> {
    await this.ensureReady();
    const version = await this.requireInputTableNormalizerArtifactVersion(input.versionId);
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const sourceKind = normalizeInputTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeInputTableConfig(input.config, sourceKind, sourcePath);
    const summary = await this.summarizeInputTableSource({
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
        projectRoot: this.getInputTableNormalizerProjectDir(version.artifactId, version.id),
        workspaceRoot: this.getInputTableNormalizerRunRoot(),
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
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tempTable)} AS SELECT * FROM ${relation}`,
        {
          normalizerOutputPath: result.manifest.output,
        }
      );
      const countRows = await this.queryRows<{ count: number | string }>(
        `SELECT count(*) AS count FROM ${quoteIdentifier(tempTable)}`
      );
      const rows = await this.queryRows<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdentifier(tempTable)} LIMIT ${limit} OFFSET ${offset}`
      );
      return {
        columns: await this.getTableColumns(tempTable),
        columnTypes: await this.inferTableColumnTypes(tempTable),
        rows: rows.map(normalizePreviewRow),
        fileCount: summary.fileCount,
        limit,
        offset,
        totalRows: toNumber(countRows[0]?.count),
      };
    } finally {
      await this.dropTableIfExists(tempTable).catch(() => undefined);
      if (workDir && cleanupWorkDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      if (preparedSources) {
        fs.rmSync(preparedSources.directory, { recursive: true, force: true });
      }
    }
  }

  protected async previewPublishedInputTableNormalizerVersion(input: {
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

  async getInputTableNormalizerArtifact(
    id: string
  ): Promise<DataInputTableNormalizerArtifact | null> {
    const rows = await this.metaQueryRows<DataInputTableNormalizerArtifactRow>(
      'SELECT * FROM data_input_table_normalizer_artifacts WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapInputTableNormalizerArtifactRow(rows[0]) : null;
  }

  protected async requireInputTableNormalizerArtifact(
    id: string
  ): Promise<DataInputTableNormalizerArtifact> {
    const artifact = await this.getInputTableNormalizerArtifact(id);
    if (!artifact) {
      throw new Error(`Normalizer artifact not found: ${id}`);
    }
    return artifact;
  }

  async listInputTableNormalizerArtifactVersions(
    artifactId: string
  ): Promise<DataInputTableNormalizerArtifactVersion[]> {
    const rows = await this.metaQueryRows<DataInputTableNormalizerArtifactVersionRow>(
      `
          SELECT *
          FROM data_input_table_normalizer_artifact_versions
          WHERE artifact_id = $artifactId
          ORDER BY version DESC, created_at DESC
        `,
      { artifactId }
    );
    return rows.map(mapInputTableNormalizerArtifactVersionRow);
  }

  async getInputTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataInputTableNormalizerArtifactVersion | null> {
    const rows = await this.metaQueryRows<DataInputTableNormalizerArtifactVersionRow>(
      'SELECT * FROM data_input_table_normalizer_artifact_versions WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapInputTableNormalizerArtifactVersionRow(rows[0]) : null;
  }

  protected async requireInputTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataInputTableNormalizerArtifactVersion> {
    const version = await this.getInputTableNormalizerArtifactVersion(id);
    if (!version) {
      throw new Error(`Normalizer artifact version not found: ${id}`);
    }
    return version;
  }

  protected async createDatasetTableFromPublishedNormalizer(
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
    const version = await this.requireInputTableNormalizerArtifactVersion(
      processing.artifactVersionId
    );
    if (version.status !== 'published') {
      throw new Error('Custom input table normalizer version is not published');
    }
    const summary = await this.summarizeInputTableSource({
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
        projectRoot: this.getInputTableNormalizerProjectDir(version.artifactId, version.id),
        workspaceRoot: this.getInputTableNormalizerRunRoot(),
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
      await this.runSql(
        `CREATE TEMP TABLE ${quoteIdentifier(tempTable)} AS SELECT * FROM ${relation}`,
        {
          normalizerImportOutputPath: result.manifest.output,
        }
      );
      await this.createTypedTableFromRelation(tableName, tempTable);
      return {
        rowCount: await this.countRows(tableName),
        columnCount: (await this.getTableColumns(tableName)).length,
        fileCount: summary.fileCount,
        config,
      };
    } finally {
      if (workDir && cleanupWorkDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      await this.dropTableIfExists(tempTable).catch(() => undefined);
      if (preparedSources) {
        fs.rmSync(preparedSources.directory, { recursive: true, force: true });
      }
    }
  }
}
