/** Normalizer artifact lifecycle: drafts, publish, delete, preview, import runs. */
import type {
  DataRawTableConfig,
  DataRawTableNormalizerVersionSaveResult,
  DataRawTablePreview,
  DataRawTableSourceKind,
  DataPreviewRawTableNormalizerVersionInput,
  DataSaveRawTableNormalizerDraftInput,
} from '../../../../shared/contracts';
import { runRawTableNormalizerProject } from '../../raw-table-normalizer-runner';
import { quoteIdentifier, toNumber } from '../../operators';
import { DataStoreContext } from '../data-store-context';
import { tableNameFromId } from '../data-store-records';
import {
  normalizeImportSourcePath,
  normalizeRawTableConfig,
  normalizeRawTableSourceKind,
  normalizePreviewLimit,
  normalizePreviewOffset,
  normalizePreviewRow,
  PreparedRawTableImport,
  PreparedRawTableNormalizerSourceContext,
  prepareRawTableNormalizerSources,
  readNormalizerOutputRelationForPath,
} from '../input-source';
import { findReusableDraft, PUBLISHED_TAG } from '../../../versioning/git-repo';
import { getSecretStore, normalizerSecretScope } from '../../../exec-guard/secret-store';
import type { DataRawTableNormalizerArtifactVersion } from '../../../../shared/contracts';
import { NormalizerRepository } from '../repositories/normalizer-repository';
import { InputSourceSummaryService } from './input-source-summary-service';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export class NormalizerService {
  /** Per-artifact queue: a save writes the repo's working tree, a sync reads it. */
  private readonly repoLocks = new Map<string, Promise<unknown>>();
  private withRepoLock<T>(artifactId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.repoLocks.get(artifactId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.repoLocks.set(artifactId, next);
    void next
      .finally(() => {
        if (this.repoLocks.get(artifactId) === next) this.repoLocks.delete(artifactId);
      })
      .catch(() => undefined);
    return next;
  }
  constructor(
    private readonly ctx: DataStoreContext,
    private readonly normalizers: NormalizerRepository,
    private readonly summarizer: InputSourceSummaryService
  ) {}
  async saveRawTableNormalizerDraft(
    input: DataSaveRawTableNormalizerDraftInput
  ): Promise<DataRawTableNormalizerVersionSaveResult> {
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
      ? await this.normalizers.getRawTableNormalizerArtifact(artifactId)
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

    return this.withRepoLock(artifactId, () =>
      this.commitDraft(input, artifactId, files, rulePrompt, now)
    );
  }

  private async commitDraft(
    input: DataSaveRawTableNormalizerDraftInput,
    artifactId: string,
    files: DataSaveRawTableNormalizerDraftInput['files'],
    rulePrompt: string,
    now: number
  ): Promise<DataRawTableNormalizerVersionSaveResult> {
    const versionNumber = await this.normalizers.nextVersionNumber(artifactId);
    const versionId = uuidv4();
    // The code goes into the artifact's git repo as a new commit; the row references it.
    const repo = this.normalizers.repo(artifactId);
    await repo.ensure();
    await repo.writeFiles(files);
    const commit =
      (await repo.commitAll(`v${versionNumber} 规则生成\n\n${rulePrompt.slice(0, 2000)}`)) ??
      (await repo.head());
    if (!commit) throw new Error('Normalizer project files could not be committed');
    await this.normalizers.insertVersion({
      id: versionId,
      artifactId,
      version: versionNumber,
      commit,
      source: 'rule',
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

    return {
      artifact: await this.normalizers.requireRawTableNormalizerArtifact(artifactId),
      version: await this.normalizers.requireRawTableNormalizerArtifactVersion(versionId),
    };
  }

  /**
   * Save an AI 修复 turn: the base version's files with the model's changes applied. Repeated
   * fixes overwrite the same AI 修复 draft (findReusableDraft); a new draft is created only when
   * the newest version is not an unpublished AI 修复 draft.
   */
  async saveRawTableNormalizerFixDraft(input: {
    baseVersionId: string;
    files: DataSaveRawTableNormalizerDraftInput['files'];
    reason: string;
  }): Promise<DataRawTableNormalizerVersionSaveResult & { replaced: boolean }> {
    await this.ctx.ensureMetadataReady();
    const base = await this.normalizers.requireRawTableNormalizerArtifactVersion(
      input.baseVersionId
    );
    const artifactId = base.artifactId;
    const files = input.files.filter(
      (file) => file.path.trim() && typeof file.content === 'string'
    );
    if (files.length === 0) throw new Error('Normalizer project files are required');
    return this.withRepoLock(artifactId, async () => {
      await this.syncManualEdits(artifactId);
      const records = await this.normalizers.listVersionRecords(artifactId);
      const latest = records.at(-1);
      if (!latest) throw new Error(`Normalizer artifact has no versions: ${artifactId}`);
      const reusable = findReusableDraft(records, 'ai_repair');
      const versionNumber = reusable?.version ?? latest.version + 1;
      const repo = this.normalizers.repo(artifactId);
      await repo.ensure();
      // The repo HEAD may be another version; write the full tree we want to commit.
      await repo.writeFiles(files);
      const reason = input.reason.trim().slice(0, 2000);
      const commit = await repo.commitAll(
        `v${versionNumber} AI 修复${reason ? `\n\n${reason}` : ''}`,
        reusable ? { replace: reusable.commit } : {}
      );
      const now = this.ctx.now();
      if (!commit) {
        // Same tree as HEAD: the fix changed nothing relative to the newest commit.
        if (reusable) {
          await this.normalizers.updateDraftVersion({
            id: reusable.id,
            commit: reusable.commit,
            fileTreeHash: reusable.fileTreeHash,
            rulePrompt: reusable.rulePrompt,
            updatedAt: now,
          });
          return {
            artifact: await this.normalizers.requireRawTableNormalizerArtifact(artifactId),
            version: await this.normalizers.requireRawTableNormalizerArtifactVersion(reusable.id),
            replaced: true,
          };
        }
        throw new Error('AI 修复没有改动任何文件');
      }
      let versionId: string;
      if (reusable) {
        versionId = reusable.id;
        await this.normalizers.updateDraftVersion({
          id: reusable.id,
          commit,
          fileTreeHash: commit,
          rulePrompt: base.rulePrompt,
          updatedAt: now,
        });
      } else {
        versionId = uuidv4();
        await this.normalizers.insertVersion({
          id: versionId,
          artifactId,
          version: versionNumber,
          commit,
          source: 'ai_repair',
          fileTreeHash: commit,
          rulePrompt: base.rulePrompt,
          sourceSummaryHash: base.sourceSummaryHash ?? null,
          entrypointJson: JSON.stringify(base.entrypoint),
          dependencyPrepareJson: base.dependencyPrepare
            ? JSON.stringify(base.dependencyPrepare)
            : null,
          runtimeJson: JSON.stringify(base.runtime),
          dependenciesJson: JSON.stringify(base.dependencies ?? []),
          dependencyLockHash: base.dependencyLockHash ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
      await this.normalizers.touchArtifact(artifactId, now);
      return {
        artifact: await this.normalizers.requireRawTableNormalizerArtifact(artifactId),
        version: await this.normalizers.requireRawTableNormalizerArtifactVersion(versionId),
        replaced: Boolean(reusable),
      };
    });
  }

  /** Versions newest first, read from git; edits made in the repo folder become a 手动修改 draft. */
  async listRawTableNormalizerArtifactVersions(
    artifactId: string
  ): Promise<DataRawTableNormalizerArtifactVersion[]> {
    await this.ctx.ensureMetadataReady();
    await this.withRepoLock(artifactId, () => this.syncManualEdits(artifactId));
    return this.normalizers.listRawTableNormalizerArtifactVersions(artifactId);
  }

  /** Folder edits (statusMatrix vs HEAD) are saved as a manual draft, overwriting the last one. */
  private async syncManualEdits(artifactId: string): Promise<void> {
    const repo = this.normalizers.repo(artifactId);
    if (!repo.exists) return;
    if ((await repo.changedPaths()).length === 0) return;
    const records = await this.normalizers.listVersionRecords(artifactId);
    const latest = records.at(-1);
    if (!latest) return;
    const reusable = findReusableDraft(records, 'manual');
    const versionNumber = reusable?.version ?? latest.version + 1;
    const commit = await repo.commitAll(
      `v${versionNumber} 手动修改`,
      reusable ? { replace: reusable.commit } : {}
    );
    if (!commit) return;
    const now = this.ctx.now();
    if (reusable) {
      await this.normalizers.updateDraftVersion({
        id: reusable.id,
        commit,
        fileTreeHash: commit,
        rulePrompt: reusable.rulePrompt,
        updatedAt: now,
      });
    } else {
      await this.normalizers.insertVersion({
        id: uuidv4(),
        artifactId,
        version: versionNumber,
        commit,
        source: 'manual',
        fileTreeHash: commit,
        rulePrompt: latest.rulePrompt,
        sourceSummaryHash: latest.sourceSummaryHash ?? null,
        entrypointJson: JSON.stringify(latest.entrypoint),
        dependencyPrepareJson: latest.dependencyPrepare
          ? JSON.stringify(latest.dependencyPrepare)
          : null,
        runtimeJson: JSON.stringify(latest.runtime),
        dependenciesJson: JSON.stringify(latest.dependencies ?? []),
        dependencyLockHash: latest.dependencyLockHash ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.normalizers.touchArtifact(artifactId, now);
  }

  /** Check a version's commit out where it runs (deps env kept across checkouts). */
  private async checkoutForRun(version: DataRawTableNormalizerArtifactVersion): Promise<string> {
    const dir = this.normalizers.getRawTableNormalizerProjectDir(
      version.artifactId,
      version.version
    );
    await this.normalizers.repo(version.artifactId).checkoutTree(version.commit, dir);
    return dir;
  }

  /** The version the artifact's `published` tag points at (what imports run). */
  private async requirePublishedVersion(
    artifactId: string
  ): Promise<DataRawTableNormalizerArtifactVersion> {
    const published = (await this.normalizers.listVersionRecords(artifactId)).find(
      (version) => version.status === 'published'
    );
    if (!published) throw new Error('Custom input table normalizer has no published version');
    const tagged = await this.normalizers.repo(artifactId).resolveTag(PUBLISHED_TAG);
    if (tagged && tagged !== published.commit) {
      throw new Error('Normalizer published tag does not match the published version');
    }
    return this.normalizers.requireRawTableNormalizerArtifactVersion(published.id);
  }

  async publishRawTableNormalizerArtifactVersion(
    versionId: string
  ): Promise<DataRawTableNormalizerVersionSaveResult> {
    await this.ctx.ensureMetadataReady();
    const version = await this.normalizers.requireRawTableNormalizerArtifactVersion(versionId);
    const artifact = await this.normalizers.requireRawTableNormalizerArtifact(version.artifactId);
    const now = this.ctx.now();
    // Publishing tags the commit vN and moves `published`; an older version = rollback.
    await this.normalizers.repo(artifact.id).publishTag(version.version, version.commit);
    await this.normalizers.archiveOtherPublishedVersions(artifact.id, versionId);
    await this.normalizers.markVersionPublished(versionId, now);
    await this.normalizers.setArtifactActiveVersion(artifact.id, versionId, now);
    return {
      artifact: await this.normalizers.requireRawTableNormalizerArtifact(artifact.id),
      version: await this.normalizers.requireRawTableNormalizerArtifactVersion(versionId),
    };
  }
  async deleteRawTableNormalizerArtifactVersion(versionId: string): Promise<{ success: boolean }> {
    await this.ctx.ensureMetadataReady();
    const version = await this.normalizers.requireRawTableNormalizerArtifactVersion(versionId);
    if (version.status === 'published') {
      throw new Error('Published normalizer versions cannot be deleted');
    }
    const now = this.ctx.now();
    await this.normalizers.deleteVersionRow(versionId);
    await this.normalizers.touchArtifact(version.artifactId, now);
    // The commit stays in history; only its run checkout is removed.
    fs.rmSync(
      this.normalizers.getRawTableNormalizerProjectDir(version.artifactId, version.version),
      { recursive: true, force: true }
    );
    return { success: true };
  }
  async previewRawTableNormalizerVersion(
    input: DataPreviewRawTableNormalizerVersionInput
  ): Promise<DataRawTablePreview> {
    // Runs the normalizer project and materializes a TEMP table on the shared
    // connection — serialize with commits through the exclusive section.
    return this.ctx.runExclusive(
      () => this.previewRawTableNormalizerVersionUnsafe(input),
      `previewRawTableNormalizerVersion:${input.versionId}`
    );
  }
  private async previewRawTableNormalizerVersionUnsafe(
    input: DataPreviewRawTableNormalizerVersionInput
  ): Promise<DataRawTablePreview> {
    await this.ctx.ensureReady();
    const version = await this.normalizers.requireRawTableNormalizerArtifactVersion(
      input.versionId
    );
    return this.previewNormalizerProjectUnsafe(version, input, {
      projectRoot: await this.checkoutForRun(version),
      workspaceRoot: this.normalizers.getRawTableNormalizerRunRoot(version.artifactId),
    });
  }

  /**
   * Preview unsaved project files (an editor agent's self-test): same run and table
   * materialisation as a version preview, in throwaway folders.
   */
  async previewRawTableNormalizerFiles(
    input: Omit<DataPreviewRawTableNormalizerVersionInput, 'versionId'> & {
      files: DataRawTableNormalizerArtifactVersion['files'];
      entrypoint: DataRawTableNormalizerArtifactVersion['entrypoint'];
      runtime: DataRawTableNormalizerArtifactVersion['runtime'];
      dependencyPrepare?: DataRawTableNormalizerArtifactVersion['dependencyPrepare'];
    }
  ): Promise<DataRawTablePreview> {
    const now = Date.now();
    const version: DataRawTableNormalizerArtifactVersion = {
      id: `agent-preview-${uuidv4()}`,
      artifactId: 'agent-preview',
      version: 0,
      status: 'draft',
      source: 'rule',
      commit: '',
      files: input.files,
      tree: {},
      fileTreeHash: '',
      rulePrompt: '',
      entrypoint: input.entrypoint,
      dependencyPrepare: input.dependencyPrepare,
      runtime: input.runtime,
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    };
    return this.ctx.runExclusive(async () => {
      await this.ctx.ensureReady();
      return this.previewNormalizerProjectUnsafe(version, { ...input, versionId: version.id }, {});
    }, 'previewRawTableNormalizerFiles');
  }

  private async previewNormalizerProjectUnsafe(
    version: DataRawTableNormalizerArtifactVersion,
    input: DataPreviewRawTableNormalizerVersionInput,
    run: { projectRoot?: string; workspaceRoot?: string }
  ): Promise<DataRawTablePreview> {
    const sourcePath = normalizeImportSourcePath(input.sourcePath);
    const sourceKind = normalizeRawTableSourceKind(input.sourceKind, sourcePath);
    const config = normalizeRawTableConfig(input.config, sourceKind, sourcePath);
    const summary = await this.summarizer.summarizeRawTableSource({
      sourcePath,
      sourceKind,
      config,
    });
    const limit = normalizePreviewLimit(input.limit);
    const offset = normalizePreviewOffset(input.offset);
    const tempTable = tableNameFromId('normalizer_preview', uuidv4());
    let workDir: string | null = null;
    let cleanupWorkDir = true;
    let preparedSources: PreparedRawTableNormalizerSourceContext | null = null;
    try {
      preparedSources = prepareRawTableNormalizerSources({
        sourcePath,
        sourceKind,
        config,
        summary,
      });
      const result = await runRawTableNormalizerProject({
        version,
        prepareDependencies: input.prepareDependencies === true,
        projectRoot: run.projectRoot,
        workspaceRoot: run.workspaceRoot,
        secrets: normalizerSecrets(config, version.artifactId),
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
  async previewPublishedRawTableNormalizerVersion(input: {
    sourcePath: string;
    sourceKind: DataRawTableSourceKind;
    config: DataRawTableConfig;
    limit: number;
    offset: number;
  }): Promise<DataRawTablePreview> {
    const processing = input.config.dataProcessing;
    const artifactId = await this.artifactIdOf(processing);
    if (!artifactId) {
      throw new Error('Published normalizer version is required for custom input table preview');
    }
    const published = await this.requirePublishedVersion(artifactId);
    return this.previewRawTableNormalizerVersion({
      versionId: published.id,
      sourcePath: input.sourcePath,
      sourceKind: input.sourceKind,
      config: input.config,
      prepareDependencies: false,
      limit: input.limit,
      offset: input.offset,
    });
  }
  async createRawTableTableFromPublishedNormalizer(
    tableName: string,
    sourcePath: string,
    sourceKind: DataRawTableSourceKind,
    config: DataRawTableConfig
  ): Promise<PreparedRawTableImport> {
    const processing = config.dataProcessing;
    const artifactId = await this.artifactIdOf(processing);
    if (!artifactId) {
      throw new Error('Published normalizer version is required for custom input table import');
    }
    // Imports follow the artifact's published tag, so a rollback changes the table data.
    const version = await this.requirePublishedVersion(artifactId);
    const summary = await this.summarizer.summarizeRawTableSource({
      sourcePath,
      sourceKind,
      config,
    });
    let workDir: string | null = null;
    let cleanupWorkDir = true;
    let preparedSources: PreparedRawTableNormalizerSourceContext | null = null;
    const tempTable = tableNameFromId('normalizer_import', uuidv4());
    try {
      preparedSources = prepareRawTableNormalizerSources({
        sourcePath,
        sourceKind,
        config,
        summary,
      });
      const result = await runRawTableNormalizerProject({
        version,
        prepareDependencies: false,
        projectRoot: await this.checkoutForRun(version),
        workspaceRoot: this.normalizers.getRawTableNormalizerRunRoot(version.artifactId),
        secrets: normalizerSecrets(config, version.artifactId),
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

  private async artifactIdOf(
    processing: DataRawTableConfig['dataProcessing']
  ): Promise<string | undefined> {
    if (processing?.strategy !== 'customize') return undefined;
    if (processing.artifactId) return processing.artifactId;
    if (!processing.artifactVersionId) return undefined;
    return (
      await this.normalizers.getRawTableNormalizerArtifactVersion(processing.artifactVersionId)
    )?.artifactId;
  }
}

/** Strategy secrets of the artifact (env vars for the normalizer). */
function normalizerSecrets(config: DataRawTableConfig, artifactId: string): Record<string, string> {
  const processing = config.dataProcessing;
  const id =
    processing?.strategy === 'customize' && processing.artifactId
      ? processing.artifactId
      : artifactId;
  if (!id || id === 'agent-preview') return {};
  return getSecretStore()?.env(normalizerSecretScope(id)) ?? {};
}
