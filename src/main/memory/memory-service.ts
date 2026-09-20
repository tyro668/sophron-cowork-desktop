import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '../config/config-store';
import { configStore } from '../config/config-store';
import type { DatabaseInstance } from '../db/database';
import { logWarn } from '../utils/logger';
import { CoreMemoryStore } from './core-memory-store';
import { CoreMemoryExtractor } from './core-memory-extractor';
import { ExperienceMemoryExtractor } from './experience-memory-extractor';
import { ExperienceMemoryStore } from './experience-memory-store';
import {
  clearIngestUndo,
  loadGeneration,
  recoverPendingGeneration,
  recoverPendingIngest,
  writeGeneration,
  writeIngestUndo,
} from './memory-generation';
import { MemoryIngestionJobStore } from './memory-ingestion-jobs';
import type { MemoryLLMClientLike } from './memory-llm-client';
import { MemoryLLMClient } from './memory-llm-client';
import { MemoryManualOverlayStore } from './memory-manual-overlay-store';
import { MemoryNavigator } from './memory-navigator';
import { DEFAULT_MEMORY_PROMPTS, type MemoryPromptSet } from './memory-prompts';
import { MemoryRetriever } from './memory-retriever';
import { MemorySessionStateStore } from './memory-state-store';
import {
  hashMemoryValue,
  MemoryTombstoneStore,
  type MemoryTombstoneGate,
  projectTombstoneIdentity,
} from './memory-tombstone-store';
import { ProjectMemoryStore } from './project-memory-store';
import type {
  CoreMemoryEntry,
  MemoryDebugFileContent,
  MemoryDebugFileInfo,
  MemoryIngestionInput,
  MemoryInjectionRecord,
  MemoryInspectSessionResult,
  MemoryItemStatus,
  MemoryOverview,
  MemoryReadResult,
  MemorySearchParams,
  MemorySearchResult,
  MemoryToolDefinition,
  ProjectMemoryEntry,
} from './memory-types';
import {
  getFileSizeBytes,
  getFileTimestampMs,
  isSubPath,
  loadJsonFile,
  normalizeWorkspaceKey,
  saveJsonFile,
} from './memory-utils';
import { MemoryContextBuilder } from './memory-context-builder';
import {
  MemoryIngestionPipeline,
  type BatchRebuildResult,
  type MemoryPaths,
  type MemoryStoreSet,
} from './memory-ingestion-pipeline';
import { createMemoryTools } from './memory-tools';

interface MemoryEntryUpdatePayload {
  key?: string;
  value?: string;
  confidence?: number;
  status?: MemoryItemStatus;
}

function isFilesystemRootPath(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  return resolvedPath === path.parse(resolvedPath).root;
}

function resolveMaterializedPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    return fs.realpathSync(resolvedPath);
  }

  const { root } = path.parse(resolvedPath);
  const segments = path.relative(root, resolvedPath).split(path.sep).filter(Boolean);
  let existingPath = root;
  let firstMissingIndex = 0;

  for (; firstMissingIndex < segments.length; firstMissingIndex += 1) {
    const candidate = path.join(existingPath, segments[firstMissingIndex]);
    if (!fs.existsSync(candidate)) {
      break;
    }
    existingPath = candidate;
  }

  const realExistingPath = fs.realpathSync(existingPath);
  const missingRemainder = segments.slice(firstMissingIndex).join(path.sep);
  return missingRemainder ? path.join(realExistingPath, missingRemainder) : realExistingPath;
}

function assertSafeMemoryPaths(storageRoot: string, artifactsDir: string): void {
  const resolvedStorageRoot = path.resolve(storageRoot);
  const resolvedArtifactsDir = path.resolve(artifactsDir);

  if (isFilesystemRootPath(resolvedStorageRoot)) {
    throw new Error('Memory storageRoot must not be a filesystem root');
  }
  if (isFilesystemRootPath(resolvedArtifactsDir)) {
    throw new Error('Memory evalArtifactsRoot must not be a filesystem root');
  }
  if (!isSubPath(resolvedArtifactsDir, resolvedStorageRoot)) {
    throw new Error('evalArtifactsRoot must stay inside storageRoot');
  }

  const materializedStorageRoot = resolveMaterializedPath(resolvedStorageRoot);
  const materializedArtifactsDir = resolveMaterializedPath(resolvedArtifactsDir);

  if (isFilesystemRootPath(materializedStorageRoot)) {
    throw new Error('Memory storageRoot must not be a filesystem root');
  }
  if (isFilesystemRootPath(materializedArtifactsDir)) {
    throw new Error('Memory evalArtifactsRoot must not be a filesystem root');
  }
  if (!isSubPath(materializedArtifactsDir, materializedStorageRoot)) {
    throw new Error('evalArtifactsRoot must stay inside storageRoot');
  }
}

export class MemoryService {
  private readonly llmClient: MemoryLLMClientLike;
  private readonly coreExtractor: CoreMemoryExtractor;
  private readonly experienceExtractor: ExperienceMemoryExtractor;
  private readonly navigator: MemoryNavigator;
  private readonly pipeline: MemoryIngestionPipeline;
  private readonly contextBuilder: MemoryContextBuilder;
  private readonly retriever: MemoryRetriever;
  private readonly tools: MemoryToolDefinition[];
  private currentPathsKey: string | null = null;
  private coreStore: CoreMemoryStore | null = null;
  private projectStore: ProjectMemoryStore | null = null;
  private stateStore: MemorySessionStateStore | null = null;
  private experienceStore: ExperienceMemoryStore | null = null;
  private tombstoneStore: MemoryTombstoneStore | null = null;
  private jobStore: MemoryIngestionJobStore | null = null;
  private overlayStore: MemoryManualOverlayStore | null = null;
  private generation = 0;
  private readonly storageRootOverride?: string;

  constructor(
    private readonly db: DatabaseInstance,
    options?: {
      llmClient?: MemoryLLMClientLike;
      prompts?: Partial<MemoryPromptSet>;
      /** Isolated storage root (eval harness/tests) — bypasses the configured
       *  runtime root so eval sessions can never pollute live stores. */
      storageRootOverride?: string;
    }
  ) {
    this.storageRootOverride = options?.storageRootOverride;
    this.llmClient = options?.llmClient || new MemoryLLMClient();
    const promptSet: MemoryPromptSet = {
      ...DEFAULT_MEMORY_PROMPTS,
      ...options?.prompts,
    };
    this.coreExtractor = new CoreMemoryExtractor(
      this.llmClient,
      promptSet.coreMemoryUpdateSystemPrompt
    );
    this.experienceExtractor = new ExperienceMemoryExtractor(
      this.llmClient,
      promptSet.sessionChunkExtractionPrompt
    );
    this.navigator = new MemoryNavigator(this.llmClient, promptSet.memoryNavigationPrompt);
    this.pipeline = new MemoryIngestionPipeline({
      isEnabled: () => this.isEnabled(),
      getAppConfig: () => this.getAppConfig(),
      getPaths: () => this.getPaths(),
      getPathsKey: () => this.getPathsKey(),
      getGeneration: () => this.getGeneration(),
      bumpGeneration: () => this.bumpGeneration(),
      resetStores: () => this.resetStores(),
      getCoreStore: () => this.getCoreStore(),
      getProjectStore: () => this.getProjectStore(),
      getExperienceStore: () => this.getExperienceStore(),
      getStateStore: () => this.getStateStore(),
      getTombstoneStore: () => this.getTombstoneStore(),
      getJobStore: () => this.getJobStore(),
      getOverlayStore: () => this.getOverlayStore(),
      getEnabledSignal: () => this.enabledAbort.signal,
      createStoreSet: (dir, tombstones) => this.createStoreSet(dir, tombstones),
      getOverview: () => this.getOverview(),
      db: this.db,
      llmClient: this.llmClient,
      coreExtractor: this.coreExtractor,
      experienceExtractor: this.experienceExtractor,
    });
    this.contextBuilder = new MemoryContextBuilder({
      isEnabled: () => this.isEnabled(),
      getExperienceStore: () => this.getExperienceStore(),
      listCorePromptEntries: () =>
        this.listCoreEntries()
          .filter((entry) => entry.status === 'active')
          .map((entry) => ({ key: entry.combinedKey, value: entry.value })),
      listProjectPromptEntries: (workspaceKey) =>
        this.listProjectEntries(workspaceKey)
          .filter((entry) => entry.status === 'active')
          .map((entry) => ({ key: entry.key, value: entry.value })),
      embedText: (text, signal) => this.pipeline.embedText(text, signal),
      navigator: this.navigator,
      getMaxNavSteps: () => this.getAppConfig().memoryRuntime.maxNavSteps,
      recordInjection: (record) => this.recordInjection(record),
    });
    this.retriever = new MemoryRetriever({
      getCoreEntries: () => this.getCoreStore().getEntries(),
      getCoreFilePath: () => this.getPaths().coreFilePath,
      getProjectEntries: (workspaceKey) => this.getProjectStore().getEntries(workspaceKey),
      getProjectFilePath: () => this.getPaths().projectFilePath,
      getExperienceStore: () => this.getExperienceStore(),
      getExperienceFilePath: () => this.getPaths().experienceFilePath,
      getSessionTitle: (sessionId) => this.getSessionTitle(sessionId),
    });
    this.tools = createMemoryTools(this);
  }

  isEnabled(): boolean {
    return configStore.get('memoryEnabled') !== false;
  }

  /**
   * Aborts whenever memory is disabled — in-flight extraction/embedding calls
   * get real cancellation, not just a fence at the commit boundary. A fresh
   * controller is installed on re-enable.
   */
  private enabledAbort = new AbortController();

  setEnabled(enabled: boolean): { success: boolean; enabled: boolean } {
    const wasEnabled = this.isEnabled();
    configStore.update({ memoryEnabled: enabled });
    if (!enabled && wasEnabled) {
      this.enabledAbort.abort();
    }
    // Re-enable resumes the paused backlog: jobs left pending while disabled
    // (or aborted at the commit boundary) replay immediately rather than
    // waiting for the next message to arrive.
    if (enabled && !wasEnabled) {
      this.enabledAbort = new AbortController();
      this.pipeline.replayDueJobs();
    }
    return { success: true, enabled };
  }

  getTools(): MemoryToolDefinition[] {
    return this.tools;
  }

  search(params: MemorySearchParams): MemorySearchResult[] {
    return this.retriever.search(params);
  }

  read(id: string): MemoryReadResult | null {
    return this.retriever.read(id);
  }

  getOverview(cwd?: string): MemoryOverview {
    const paths = this.getPaths();
    const coreEntries = this.getCoreStore().getEntries();
    const projectStore = this.getProjectStore();
    const experienceStore = this.getExperienceStore();
    const stateRecords = this.getStateStore().getAll();
    const currentWorkspace = normalizeWorkspaceKey(cwd);
    const topSourceWorkspaces = experienceStore.getStatsBySourceWorkspace();

    return {
      enabled: this.isEnabled(),
      storageRoot: paths.storageRoot,
      coreFilePath: paths.coreFilePath,
      projectFilePath: paths.projectFilePath,
      experienceFilePath: paths.experienceFilePath,
      stateFilePath: paths.stateFilePath,
      coreCount: coreEntries.filter((entry) => entry.status === 'active').length,
      projectCount: projectStore.getActiveEntries().length,
      experienceSessionCount: experienceStore.sessions.length,
      experienceChunkCount: experienceStore.chunks.length,
      sourceWorkspaceCount: topSourceWorkspaces.filter((item) => item.workspaceKey !== '(none)')
        .length,
      failedSessionCount: stateRecords.filter((record) => Boolean(record.lastError)).length,
      pendingJobCount: this.getJobStore().pendingCount(),
      deadJobCount: this.getJobStore().deadCount(),
      generation: this.getGeneration(),
      latestIngestionAt: stateRecords.reduce<number | null>((latest, record) => {
        if (!record.lastIngestedAt) {
          return latest;
        }
        return latest === null ? record.lastIngestedAt : Math.max(latest, record.lastIngestedAt);
      }, null),
      latestError:
        stateRecords
          .filter((record) => record.lastError)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.lastError || null,
      currentWorkspace: currentWorkspace
        ? {
            workspaceKey: currentWorkspace,
            projectCount: projectStore.getActiveEntries(currentWorkspace).length,
            experienceSessionCount: experienceStore.sessions.filter(
              (item) => item.sourceWorkspace === currentWorkspace
            ).length,
            experienceChunkCount: experienceStore.chunks.filter(
              (item) => item.sourceWorkspace === currentWorkspace
            ).length,
          }
        : undefined,
      topSourceWorkspaces,
    };
  }

  listFiles(): MemoryDebugFileInfo[] {
    const paths = this.getPaths();
    const experienceStore = this.getExperienceStore();
    return [
      {
        kind: 'core',
        label: 'core_memory.json',
        filePath: paths.coreFilePath,
        exists: fs.existsSync(paths.coreFilePath),
        sizeBytes: getFileSizeBytes(paths.coreFilePath),
        updatedAt: getFileTimestampMs(paths.coreFilePath),
      },
      {
        kind: 'project',
        label: 'project_memory.json',
        filePath: paths.projectFilePath,
        exists: fs.existsSync(paths.projectFilePath),
        sizeBytes: getFileSizeBytes(paths.projectFilePath),
        updatedAt: getFileTimestampMs(paths.projectFilePath),
      },
      {
        kind: 'experience',
        label: 'experience_memory.json',
        filePath: paths.experienceFilePath,
        exists: fs.existsSync(paths.experienceFilePath),
        sizeBytes: getFileSizeBytes(paths.experienceFilePath),
        updatedAt: getFileTimestampMs(paths.experienceFilePath),
        sessionCount: experienceStore.sessions.length,
        chunkCount: experienceStore.chunks.length,
      },
      {
        kind: 'state',
        label: 'session_state.json',
        filePath: paths.stateFilePath,
        exists: fs.existsSync(paths.stateFilePath),
        sizeBytes: getFileSizeBytes(paths.stateFilePath),
        updatedAt: getFileTimestampMs(paths.stateFilePath),
      },
      {
        kind: 'artifacts',
        label: 'eval-artifacts/',
        filePath: paths.artifactsDir,
        exists: fs.existsSync(paths.artifactsDir),
        sizeBytes: getFileSizeBytes(paths.artifactsDir),
        updatedAt: getFileTimestampMs(paths.artifactsDir),
      },
    ];
  }

  readFile(filePath: string): MemoryDebugFileContent {
    const normalizedPath = this.resolveReadablePath(filePath);
    const stat = fs.statSync(normalizedPath);
    if (stat?.isDirectory()) {
      const entries = fs.readdirSync(normalizedPath).sort();
      const parsed = entries.map((name) => {
        const fullPath = path.join(normalizedPath, name);
        const child = fs.statSync(fullPath);
        return {
          name,
          path: fullPath,
          isDirectory: child.isDirectory(),
          sizeBytes: child.size,
          updatedAt: child.mtimeMs,
        };
      });
      return {
        kind: 'artifacts',
        filePath: normalizedPath,
        text: JSON.stringify(parsed, null, 2),
        parsed,
        sizeBytes: stat.size,
        updatedAt: stat.mtimeMs,
      };
    }
    const raw = stat ? fs.readFileSync(normalizedPath, 'utf8') : '';
    return {
      kind: this.resolveFileKind(normalizedPath),
      filePath: normalizedPath,
      text: raw,
      parsed: raw.trim() ? loadJsonFile(normalizedPath, null) : null,
      sizeBytes: getFileSizeBytes(normalizedPath),
      updatedAt: getFileTimestampMs(normalizedPath),
    };
  }

  inspectSession(sessionId: string, sourceWorkspace?: string): MemoryInspectSessionResult | null {
    const store = this.getExperienceStore();
    const session = store.getSession(sessionId);
    if (!session) {
      return null;
    }
    if (sourceWorkspace) {
      const normalized = normalizeWorkspaceKey(sourceWorkspace);
      if (session.sourceWorkspace !== normalized) {
        return null;
      }
    }
    return {
      sourceWorkspace: session.sourceWorkspace,
      filePath: store.getPath(),
      session,
      chunks: store.getChunksBySession(sessionId),
    };
  }

  listCoreEntries(): CoreMemoryEntry[] {
    return this.getCoreStore().getEntries();
  }

  /**
   * Wrap a manual mutation in the same persisted undo record an ingestion
   * commit uses — a crash or disk error mid-write restores the complete
   * prior state instead of leaving the overlay/tombstone ledgers split from
   * the derived files.
   */
  private async runDurableMutation<T>(fn: () => T): Promise<T> {
    // Manual writes share the commit serialization: an active rebuild/clear
    // transition must settle first, or this write would land on a generation
    // the swap is about to discard. When no transition is active the write
    // runs inline — callers that treat the returned promise as fire-and-forget
    // still see the mutation applied synchronously.
    if (this.pipeline.hasActiveTransition()) {
      await this.pipeline.waitForIdle();
    }
    const storageRoot = this.getPaths().storageRoot;
    writeIngestUndo(storageRoot);
    try {
      const result = fn();
      clearIngestUndo(storageRoot);
      return result;
    } catch (error) {
      recoverPendingIngest(storageRoot);
      this.resetStores();
      throw error;
    }
  }

  async updateCoreEntry(
    combinedKey: string,
    updates: MemoryEntryUpdatePayload
  ): Promise<CoreMemoryEntry | null> {
    return this.runDurableMutation(() => {
      const updated = this.getCoreStore().updateEntry(combinedKey, updates);
      if (updated) {
        // Manual state is persisted in the overlay layer — it is re-applied on
        // top of every rebuilt generation, so edits and confirmations survive.
        this.getOverlayStore().record({
          kind: 'core',
          identity: updated.combinedKey,
          action: 'upsert',
          value: updated.value,
          key: updated.key,
          category: updated.category,
          confidence: updated.confidence,
          status: updated.status,
          userVerified: updated.confidenceSignals.userVerified,
          verifiedValueHash: updated.confidenceSignals.verifiedValueHash,
        });
        // A key rename moves the overlay identity — drop the stale one.
        if (updated.combinedKey !== combinedKey) {
          this.getOverlayStore().remove('core', combinedKey);
        }
      }
      return updated;
    });
  }

  deleteCoreEntry(combinedKey: string): Promise<{ success: boolean }> {
    return this.runDurableMutation(() => {
      const existing = this.getCoreStore().getEntry(combinedKey);
      const result = this.getCoreStore().deleteEntry(combinedKey);
      if (result.success && existing) {
        // Explicit deletes are unconditional tombstones: the fact must not be
        // resurrected by re-extraction or rebuild while the tombstone persists.
        this.getTombstoneStore().add({
          kind: 'core',
          identity: combinedKey,
          valueHash: hashMemoryValue(existing.value),
          sourceSessionIds: [],
        });
        // The delete overlay covers any re-derived value under this key —
        // the value-hash tombstone alone would only block the same value.
        this.getOverlayStore().record({ kind: 'core', identity: combinedKey, action: 'delete' });
      }
      return result;
    });
  }

  listProjectEntries(workspaceKey?: string | null): ProjectMemoryEntry[] {
    return this.getProjectStore().getEntries(workspaceKey);
  }

  updateProjectEntry(
    id: string,
    updates: MemoryEntryUpdatePayload
  ): Promise<ProjectMemoryEntry | null> {
    return this.runDurableMutation(() => {
      const existing = this.getProjectStore().getEntry(id);
      const updated = this.getProjectStore().updateEntry(id, updates);
      if (updated) {
        // Project overlays key on workspace + normalized key — the random entry
        // id is not stable across rebuilds and is never recorded.
        this.getOverlayStore().record({
          kind: 'project',
          identity: projectTombstoneIdentity(updated.workspaceKey, updated.key),
          action: 'upsert',
          value: updated.value,
          key: updated.key,
          workspaceKey: updated.workspaceKey,
          workspaceLabel: updated.workspaceLabel,
          confidence: updated.confidence,
          status: updated.status,
          userVerified: updated.confidenceSignals.userVerified,
          verifiedValueHash: updated.confidenceSignals.verifiedValueHash,
        });
        if (existing && existing.key !== updated.key) {
          this.getOverlayStore().remove(
            'project',
            projectTombstoneIdentity(existing.workspaceKey, existing.key)
          );
        }
      }
      return updated;
    });
  }

  deleteProjectEntry(id: string): Promise<{ success: boolean }> {
    return this.runDurableMutation(() => {
      const existing = this.getProjectStore().getEntry(id);
      const result = this.getProjectStore().deleteEntry(id);
      if (result.success && existing) {
        this.getTombstoneStore().add({
          kind: 'project',
          identity: projectTombstoneIdentity(existing.workspaceKey, existing.key),
          valueHash: hashMemoryValue(existing.value),
          sourceSessionIds: [],
        });
        this.getOverlayStore().record({
          kind: 'project',
          identity: projectTombstoneIdentity(existing.workspaceKey, existing.key),
          action: 'delete',
          key: existing.key,
          workspaceKey: existing.workspaceKey,
        });
      }
      return result;
    });
  }

  async buildPromptPrefix(
    session: { cwd?: string },
    prompt: string,
    signal?: AbortSignal
  ): Promise<string> {
    return this.contextBuilder.build(session, prompt, signal);
  }

  enqueueIngestion(input: MemoryIngestionInput): Promise<void> {
    return this.pipeline.enqueueIngestion(input);
  }

  /** Waits for all queued ingestion work — used on shutdown and before clears. */
  async drain(): Promise<void> {
    await this.pipeline.drain();
  }

  /** Manual retry entry: dead-lettered ingestion jobs requeue and replay. */
  retryIngestionJobs(sessionId?: string): number {
    return this.pipeline.retryIngestionJobs(sessionId);
  }

  async rebuildWorkspace(
    cwd: string
  ): Promise<{ success: boolean; workspaceKey: string } & BatchRebuildResult> {
    return this.pipeline.rebuildWorkspace(cwd);
  }

  async rebuildAll(): Promise<{ success: boolean; workspaceCount: number } & BatchRebuildResult> {
    return this.pipeline.rebuildAll();
  }

  async clearWorkspace(cwd: string): Promise<{ success: boolean; workspaceKey: string }> {
    return this.pipeline.clearWorkspace(cwd);
  }

  async clearCoreMemory(): Promise<{ success: boolean }> {
    return this.pipeline.clearCoreMemory();
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.pipeline.deleteSession(sessionId);
  }

  private getSessionTitle(sessionId: string): string | undefined {
    return this.db.sessions.get(sessionId)?.title || undefined;
  }

  private getAppConfig(): AppConfig {
    return configStore.getAll();
  }

  private getPaths(): MemoryPaths {
    const configuredRoot =
      this.storageRootOverride?.trim() || this.getAppConfig().memoryRuntime.storageRoot?.trim();
    const configuredArtifactsRoot = this.getAppConfig().memoryRuntime.evalArtifactsRoot?.trim();
    const storageRoot = path.resolve(
      configuredRoot || path.join(app.getPath('userData'), 'memory')
    );
    const safeArtifactsDir = path.join(storageRoot, 'eval-artifacts');
    const artifactsDir = path.resolve(configuredArtifactsRoot || safeArtifactsDir);

    assertSafeMemoryPaths(storageRoot, artifactsDir);

    return {
      storageRoot,
      coreFilePath: path.join(storageRoot, 'core_memory.json'),
      projectFilePath: path.join(storageRoot, 'project_memory.json'),
      experienceFilePath: path.join(storageRoot, 'experience_memory.json'),
      stateFilePath: path.join(storageRoot, 'session_state.json'),
      tombstoneFilePath: path.join(storageRoot, 'memory_tombstones.json'),
      jobsFilePath: path.join(storageRoot, 'memory_ingestion_jobs.json'),
      injectionsFilePath: path.join(storageRoot, 'memory_injections.json'),
      overlayFilePath: path.join(storageRoot, 'memory_manual_overlays.json'),
      artifactsDir,
    };
  }

  private getPathsKey(): string {
    const paths = this.getPaths();
    return `${paths.storageRoot}::${paths.artifactsDir}`;
  }

  private ensureStores(): void {
    const paths = this.getPaths();
    const pathsKey = `${paths.storageRoot}::${paths.artifactsDir}`;
    if (
      this.currentPathsKey === pathsKey &&
      this.coreStore &&
      this.projectStore &&
      this.stateStore &&
      this.experienceStore &&
      this.tombstoneStore &&
      this.jobStore &&
      this.overlayStore
    ) {
      return;
    }
    fs.mkdirSync(paths.storageRoot, { recursive: true });
    fs.mkdirSync(paths.artifactsDir, { recursive: true });
    assertSafeMemoryPaths(paths.storageRoot, paths.artifactsDir);
    // Finish or discard a crashed staged commit before opening stores, then
    // replay a torn ordinary-ingest commit's undo record — the pre-commit
    // state is restored before any store reads the files.
    recoverPendingGeneration(paths.storageRoot);
    const ingestRecovery = recoverPendingIngest(paths.storageRoot);
    if (ingestRecovery === 'unresolved') {
      logWarn(
        '[MemoryService] A torn ingestion commit could not be fully restored; ' +
          'the undo record is preserved for the next recovery attempt'
      );
    }
    this.currentPathsKey = pathsKey;
    this.generation = loadGeneration(paths.storageRoot);
    this.tombstoneStore = new MemoryTombstoneStore(paths.tombstoneFilePath);
    this.jobStore = new MemoryIngestionJobStore(paths.jobsFilePath);
    this.overlayStore = new MemoryManualOverlayStore(paths.overlayFilePath);
    this.coreStore = new CoreMemoryStore(paths.coreFilePath, 24, this.tombstoneStore);
    this.projectStore = new ProjectMemoryStore(paths.projectFilePath, this.tombstoneStore);
    this.stateStore = new MemorySessionStateStore(paths.stateFilePath);
    this.experienceStore = new ExperienceMemoryStore(paths.experienceFilePath);
    // Crash-safe resume: jobs persisted as pending/running are replayed once
    // the stores for this generation are open.
    this.pipeline.replayDueJobs();
  }

  private injectionsCache: MemoryInjectionRecord[] | null = null;

  private loadInjections(): MemoryInjectionRecord[] {
    if (this.injectionsCache) {
      return this.injectionsCache;
    }
    const raw = loadJsonFile<{ records?: MemoryInjectionRecord[] }>(
      this.getPaths().injectionsFilePath,
      { records: [] }
    );
    this.injectionsCache = Array.isArray(raw.records) ? raw.records.slice(-50) : [];
    return this.injectionsCache;
  }

  /** Newest-first audit trail of what memory injected into prompts. */
  listInjections(limit = 20): MemoryInjectionRecord[] {
    return [...this.loadInjections()].reverse().slice(0, Math.max(1, limit));
  }

  private recordInjection(record: MemoryInjectionRecord): void {
    try {
      const records = this.loadInjections();
      records.push(record);
      this.injectionsCache = records.slice(-50);
      saveJsonFile(this.getPaths().injectionsFilePath, { records: this.injectionsCache });
    } catch (error) {
      logWarn('[MemoryService] Failed to persist injection record:', error);
    }
  }

  private resetStores(): void {
    this.currentPathsKey = null;
    this.injectionsCache = null;
    this.coreStore = null;
    this.projectStore = null;
    this.stateStore = null;
    this.experienceStore = null;
    this.tombstoneStore = null;
    this.jobStore = null;
    this.overlayStore = null;
    this.generation = 0;
  }

  private getCoreStore(): CoreMemoryStore {
    this.ensureStores();
    return this.coreStore!;
  }

  private getProjectStore(): ProjectMemoryStore {
    this.ensureStores();
    return this.projectStore!;
  }

  private getStateStore(): MemorySessionStateStore {
    this.ensureStores();
    return this.stateStore!;
  }

  private getExperienceStore(): ExperienceMemoryStore {
    this.ensureStores();
    return this.experienceStore!;
  }

  private getTombstoneStore(): MemoryTombstoneStore {
    this.ensureStores();
    return this.tombstoneStore!;
  }

  private getJobStore(): MemoryIngestionJobStore {
    this.ensureStores();
    return this.jobStore!;
  }

  private getOverlayStore(): MemoryManualOverlayStore {
    this.ensureStores();
    return this.overlayStore!;
  }

  private getGeneration(): number {
    this.ensureStores();
    return this.generation;
  }

  private bumpGeneration(): number {
    this.ensureStores();
    this.generation += 1;
    writeGeneration(this.getPaths().storageRoot, this.generation);
    return this.generation;
  }

  /** Fresh store set rooted at `dir` — used to build a staging generation. */
  private createStoreSet(dir: string, tombstoneGate?: MemoryTombstoneGate): MemoryStoreSet {
    const tombstones = tombstoneGate ?? this.getTombstoneStore();
    return {
      core: new CoreMemoryStore(path.join(dir, 'core_memory.json'), 24, tombstones),
      project: new ProjectMemoryStore(path.join(dir, 'project_memory.json'), tombstones),
      experience: new ExperienceMemoryStore(path.join(dir, 'experience_memory.json')),
      state: new MemorySessionStateStore(path.join(dir, 'session_state.json')),
    };
  }

  private resolveFileKind(filePath: string): MemoryDebugFileInfo['kind'] {
    const paths = this.getPaths();
    if (filePath === paths.coreFilePath) {
      return 'core';
    }
    if (filePath === paths.projectFilePath) {
      return 'project';
    }
    if (filePath === paths.experienceFilePath) {
      return 'experience';
    }
    if (filePath === paths.stateFilePath) {
      return 'state';
    }
    return 'artifacts';
  }

  private resolveReadablePath(filePath: string): string {
    const paths = this.getPaths();
    assertSafeMemoryPaths(paths.storageRoot, paths.artifactsDir);
    const requestedPath = path.resolve(filePath);
    if (!fs.existsSync(requestedPath)) {
      throw new Error('Requested file does not exist');
    }

    const normalizedPath = fs.realpathSync(requestedPath);
    const allowedFiles = new Set(
      [paths.coreFilePath, paths.projectFilePath, paths.experienceFilePath, paths.stateFilePath]
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => fs.realpathSync(candidate))
    );
    const artifactsRoot = fs.existsSync(paths.artifactsDir)
      ? fs.realpathSync(paths.artifactsDir)
      : path.resolve(paths.artifactsDir);

    if (!allowedFiles.has(normalizedPath) && !isSubPath(normalizedPath, artifactsRoot)) {
      throw new Error('Requested file is outside allowed memory files');
    }

    return normalizedPath;
  }
}
