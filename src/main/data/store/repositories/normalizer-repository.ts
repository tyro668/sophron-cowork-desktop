/** raw-table normalizer artifact/version row access + project paths. */
import type {
  DataRawTableNormalizerArtifact,
  DataRawTableNormalizerArtifactVersion,
} from '../../../../shared/contracts';
import { DataStoreContext } from '../data-store-context';
import {
  DataRawTableNormalizerArtifactRow,
  DataRawTableNormalizerArtifactVersionRow,
  mapRawTableNormalizerArtifactRow,
  mapRawTableNormalizerArtifactVersionRow,
} from '../data-store-records';
import { sanitizeNormalizerPathSegment } from '../input-source';
import { toNumber } from '../../operators';
import { dirname, join } from 'path';

export class NormalizerRepository {
  constructor(private readonly ctx: DataStoreContext) {}
  getRawTableNormalizerStorageRoot(): string {
    return join(dirname(this.ctx.dbPath), 'raw-table-normalizers');
  }
  getRawTableNormalizerProjectDir(artifactId: string, versionId: string): string {
    return join(
      this.getRawTableNormalizerStorageRoot(),
      'projects',
      sanitizeNormalizerPathSegment(artifactId),
      sanitizeNormalizerPathSegment(versionId)
    );
  }
  getRawTableNormalizerRunRoot(): string {
    return join(this.getRawTableNormalizerStorageRoot(), 'runs');
  }
  async getRawTableNormalizerArtifact(id: string): Promise<DataRawTableNormalizerArtifact | null> {
    const rows = await this.ctx.metaQueryRows<DataRawTableNormalizerArtifactRow>(
      'SELECT * FROM data_raw_table_normalizer_artifacts WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapRawTableNormalizerArtifactRow(rows[0]) : null;
  }
  async requireRawTableNormalizerArtifact(id: string): Promise<DataRawTableNormalizerArtifact> {
    const artifact = await this.getRawTableNormalizerArtifact(id);
    if (!artifact) {
      throw new Error(`Normalizer artifact not found: ${id}`);
    }
    return artifact;
  }
  async listRawTableNormalizerArtifactVersions(
    artifactId: string
  ): Promise<DataRawTableNormalizerArtifactVersion[]> {
    const rows = await this.ctx.metaQueryRows<DataRawTableNormalizerArtifactVersionRow>(
      `
          SELECT *
          FROM data_raw_table_normalizer_artifact_versions
          WHERE artifact_id = $artifactId
          ORDER BY version DESC, created_at DESC
        `,
      { artifactId }
    );
    return rows.map(mapRawTableNormalizerArtifactVersionRow);
  }
  async getRawTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataRawTableNormalizerArtifactVersion | null> {
    const rows = await this.ctx.metaQueryRows<DataRawTableNormalizerArtifactVersionRow>(
      'SELECT * FROM data_raw_table_normalizer_artifact_versions WHERE id = $id LIMIT 1',
      { id }
    );
    return rows[0] ? mapRawTableNormalizerArtifactVersionRow(rows[0]) : null;
  }
  async requireRawTableNormalizerArtifactVersion(
    id: string
  ): Promise<DataRawTableNormalizerArtifactVersion> {
    const version = await this.getRawTableNormalizerArtifactVersion(id);
    if (!version) {
      throw new Error(`Normalizer artifact version not found: ${id}`);
    }
    return version;
  }
  async insertArtifact(row: {
    id: string;
    name: string;
    description: string | null;
    sourceKind: string;
    primaryLanguage: string;
    createdAt: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_raw_table_normalizer_artifacts (
            id, name, description, source_kind, primary_language, active_version_id,
            created_at, updated_at
          )
          VALUES (
            $id, $name, $description, $sourceKind, $primaryLanguage, NULL,
            $createdAt, $updatedAt
          )
        `,
      {
        id: row.id,
        name: row.name,
        description: row.description,
        sourceKind: row.sourceKind,
        primaryLanguage: row.primaryLanguage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    );
  }
  async updateArtifactMetadata(row: {
    id: string;
    name: string;
    description: string | null;
    sourceKind: string;
    primaryLanguage: string;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_raw_table_normalizer_artifacts
          SET name = $name,
              description = $description,
              source_kind = $sourceKind,
              primary_language = $primaryLanguage,
              updated_at = $updatedAt
          WHERE id = $id
        `,
      {
        id: row.id,
        name: row.name,
        description: row.description,
        sourceKind: row.sourceKind,
        primaryLanguage: row.primaryLanguage,
        updatedAt: row.updatedAt,
      }
    );
  }
  async touchArtifact(artifactId: string, updatedAt: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_raw_table_normalizer_artifacts
          SET updated_at = $updatedAt
          WHERE id = $artifactId
        `,
      { artifactId, updatedAt }
    );
  }
  async setArtifactActiveVersion(
    artifactId: string,
    versionId: string,
    updatedAt: number
  ): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_raw_table_normalizer_artifacts
          SET active_version_id = $versionId,
              updated_at = $updatedAt
          WHERE id = $artifactId
        `,
      { artifactId, versionId, updatedAt }
    );
  }
  async nextVersionNumber(artifactId: string): Promise<number> {
    const rows = await this.ctx.metaQueryRows<{ version: number | string }>(
      `
          SELECT coalesce(max(version), 0) + 1 AS version
          FROM data_raw_table_normalizer_artifact_versions
          WHERE artifact_id = $artifactId
        `,
      { artifactId }
    );
    return toNumber(rows[0]?.version);
  }
  async insertVersion(row: {
    id: string;
    artifactId: string;
    version: number;
    filesJson: string;
    fileTreeHash: string;
    rulePrompt: string;
    sourceSummaryHash: string | null;
    entrypointJson: string;
    dependencyPrepareJson: string | null;
    runtimeJson: string;
    dependenciesJson: string;
    dependencyLockHash: string | null;
    createdAt: number;
    updatedAt: number;
  }): Promise<void> {
    await this.ctx.metaRunSql(
      `
          INSERT INTO data_raw_table_normalizer_artifact_versions (
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
        id: row.id,
        artifactId: row.artifactId,
        version: row.version,
        filesJson: row.filesJson,
        fileTreeHash: row.fileTreeHash,
        rulePrompt: row.rulePrompt,
        sourceSummaryHash: row.sourceSummaryHash,
        entrypointJson: row.entrypointJson,
        dependencyPrepareJson: row.dependencyPrepareJson,
        runtimeJson: row.runtimeJson,
        dependenciesJson: row.dependenciesJson,
        dependencyLockHash: row.dependencyLockHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    );
  }
  async archiveOtherPublishedVersions(
    artifactId: string,
    versionId: string,
    updatedAt: number
  ): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_raw_table_normalizer_artifact_versions
          SET status = 'archived',
              updated_at = $updatedAt
          WHERE artifact_id = $artifactId
            AND status = 'published'
            AND id <> $versionId
        `,
      { artifactId, versionId, updatedAt }
    );
  }
  async markVersionPublished(versionId: string, at: number): Promise<void> {
    await this.ctx.metaRunSql(
      `
          UPDATE data_raw_table_normalizer_artifact_versions
          SET status = 'published',
              published_at = coalesce(published_at, $publishedAt),
              updated_at = $updatedAt
          WHERE id = $versionId
        `,
      { versionId, publishedAt: at, updatedAt: at }
    );
  }
  async deleteVersionRow(versionId: string): Promise<void> {
    await this.ctx.metaRunSql(
      `
          DELETE FROM data_raw_table_normalizer_artifact_versions
          WHERE id = $versionId
        `,
      { versionId }
    );
  }
}
