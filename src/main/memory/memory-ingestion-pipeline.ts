import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppConfig } from '../config/config-store';
import type { DatabaseInstance, SessionRow } from '../db/database';
import { log, logError, logWarn } from '../utils/logger';
import type { CoreMemoryExtractor } from './core-memory-extractor';
import type { CoreMemoryStore } from './core-memory-store';
import type { ExperienceMemoryExtractor } from './experience-memory-extractor';
import type { ExperienceMemoryStore } from './experience-memory-store';
import {
  GENERATED_FILE_NAMES,
  STAGING_DIR_NAME,
  clearIngestUndo,
  commitStagedGeneration,
  hasPendingCommit,
  recoverPendingGeneration,
  recoverPendingIngest,
  writeIngestUndo,
} from './memory-generation';
import { MemoryIngestionQueue } from './memory-ingestion-queue';
import type { MemoryIngestionJobStore, MemoryIngestionJobToken } from './memory-ingestion-jobs';
import type { MemoryLLMClientLike } from './memory-llm-client';
import type { MemoryManualOverlayStore } from './memory-manual-overlay-store';
import { MemorySessionStateStore } from './memory-state-store';
import {
  hashMemoryValue,
  projectTombstoneIdentity,
  type MemoryTombstoneGate,
  type MemoryTombstoneStore,
} from './memory-tombstone-store';
import type { MemoryTombstone } from './memory-types';
import type { ProjectMemoryStore } from './project-memory-store';
import { buildConfidenceSignals, normalizeConfidenceSourceType } from './memory-confidence';
import type {
  AppliedCoreMemoryAction,
  ChunkMemoryItem,
  CoreMemoryActionInput,
  ExperienceSessionExtract,
  MemoryEvidenceRef,
  MemoryExtractionOutcome,
  MemoryIngestionInput,
  MemoryOverview,
  MemoryTranscriptTurn,
} from './memory-types';
import {
  containsSensitiveContent,
  extractKeywords,
  fingerprintMessage,
  formatTimestamp,
  hashMessageFingerprints,
  hashTranscriptTurns,
  isoNow,
  messagesToTranscript,
  normalizeWorkspaceKey,
  redactSensitiveContent,
  resolveCoreCombinedKey,
  summarizeText,
} from './memory-utils';

export interface MemoryPaths {
  storageRoot: string;
  coreFilePath: string;
  projectFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  tombstoneFilePath: string;
  jobsFilePath: string;
  injectionsFilePath: string;
  overlayFilePath: string;
  artifactsDir: string;
}

/** The four file-backed stores that make up one rebuildable generation. */
export interface MemoryStoreSet {
  core: CoreMemoryStore;
  project: ProjectMemoryStore;
  experience: ExperienceMemoryStore;
  state: MemorySessionStateStore;
}

/**
 * Immutable binding captured when a job starts running: every store, path,
 * and bookkeeping handle the run touches is frozen to the storage root that
 * owned the job at dispatch. A storage-root switch mid-run can therefore
 * never mix writes across roots — the commit boundary re-checks the fence
 * before the first write.
 */
interface IngestRunBinding {
  pathsKey: string;
  paths: MemoryPaths;
  stores: MemoryStoreSet;
  jobStore: MemoryIngestionJobStore;
  overlayStore: MemoryManualOverlayStore;
  token: MemoryIngestionJobToken;
}

/**
 * 'committed' — writes landed; 'skipped' — nothing to do (no memory content,
 * forgotten session); 'aborted' — fenced off before the commit boundary
 * (disabled, root switch, superseded, transition) so the job stays resumable.
 */
type IngestOutcome = 'committed' | 'skipped' | 'aborted';

export interface ExtractionBundle {
  sessionRow: SessionRow;
  session: MemoryIngestionInput['session'];
  sourceWorkspace: string | null;
  sessionDate: string;
  fullMessages: MemoryIngestionInput['messages'];
  fullTurns: MemoryTranscriptTurn[];
  extracted: ExperienceSessionExtract;
}

/** Output of prepareExperienceWrite — pure data, applied synchronously. */
interface PreparedExperienceWrite {
  input: {
    sourceWorkspace: string | null;
    sessionId: string;
    sessionTitle?: string;
    sessionDate: string;
    sessionCreatedAt: number;
    fullTurns: MemoryTranscriptTurn[];
    extracted: ExperienceSessionExtract;
  };
  session: Parameters<ExperienceMemoryStore['replaceSession']>[1];
  chunks: Parameters<ExperienceMemoryStore['replaceSession']>[2];
}

export interface BatchRebuildResult {
  sessionCount: number;
  /**
   * Sessions actually landed in the live generation — a discarded candidate
   * commits nothing, so this is 0 whenever the rebuild is abandoned.
   */
  committedSessionCount: number;
  /** Sessions fully prepared into the candidate before it was committed or
   *  discarded — distinguishes extraction/write progress from what landed. */
  preparedSessionCount: number;
  /** @deprecated Alias of committedSessionCount — kept for contract compat. */
  succeededSessionCount: number;
  failedSessionCount: number;
  /**
   * Commit-layer failure — kept separate from session extraction stats: a
   * rebuild can extract every session cleanly yet still fail to swap the
   * staged generation in. When set, `success` is false and the journaled
   * staging dir is preserved for boot-time recovery.
   */
  commitError?: string;
}

/**
 * Manual-ledger mutations a candidate build PROVES but must not persist —
 * they are collected while building and applied to the live overlay /
 * tombstone stores only after the candidate generation commits. A failed or
 * abandoned candidate never touches human-authored records.
 */
interface CandidateChanges {
  /** `${kind}|${identity}` overlay keys a newer authoritative correction retired. */
  overlayDrops: Set<string>;
  /** Tombstones a newer explicit re-assertion lifted inside the candidate. */
  tombstoneLifts: MemoryTombstone[];
}

/**
 * Tombstone view over the live ledger for a staged candidate: lifts are
 * recorded into the changeset and hidden from subsequent matches instead of
 * writing the live file — the live ledger changes only on candidate commit.
 */
class CandidateTombstoneGate implements MemoryTombstoneGate {
  private readonly lifted = new Set<string>();

  constructor(
    private readonly base: MemoryTombstoneStore,
    private readonly changes: CandidateChanges
  ) {}

  private key(tombstone: MemoryTombstone): string {
    return `${tombstone.kind}|${tombstone.identity}|${tombstone.valueHash}`;
  }

  matches(input: Parameters<MemoryTombstoneGate['matches']>[0]): boolean {
    return Boolean(this.findMatch(input));
  }

  findMatch(input: Parameters<MemoryTombstoneGate['findMatch']>[0]): MemoryTombstone | undefined {
    const match = this.base.findMatch(input);
    return match && !this.lifted.has(this.key(match)) ? match : undefined;
  }

  remove(tombstone: MemoryTombstone): void {
    this.lifted.add(this.key(tombstone));
    this.changes.tombstoneLifts.push(tombstone);
  }
}

interface ExtractionFailure {
  session: MemoryIngestionInput['session'];
  sourceWorkspace: string | null;
  fullMessageCount: number;
  error: unknown;
}

export interface MemoryIngestionPipelineDeps {
  isEnabled: () => boolean;
  /** Fires when memory is disabled — cancels in-flight extraction/embedding. */
  getEnabledSignal: () => AbortSignal;
  getAppConfig: () => AppConfig;
  getPaths: () => MemoryPaths;
  getPathsKey: () => string;
  getGeneration: () => number;
  bumpGeneration: () => number;
  resetStores: () => void;
  getCoreStore: () => CoreMemoryStore;
  getProjectStore: () => ProjectMemoryStore;
  getExperienceStore: () => ExperienceMemoryStore;
  getStateStore: () => MemorySessionStateStore;
  getTombstoneStore: () => MemoryTombstoneStore;
  getJobStore: () => MemoryIngestionJobStore;
  getOverlayStore: () => MemoryManualOverlayStore;
  createStoreSet: (dir: string, tombstones?: MemoryTombstoneGate) => MemoryStoreSet;
  getOverview: () => MemoryOverview;
  db: DatabaseInstance;
  llmClient: MemoryLLMClientLike;
  coreExtractor: CoreMemoryExtractor;
  experienceExtractor: ExperienceMemoryExtractor;
}

/**
 * Ingestion + lifecycle pipeline: queue coalescing, persisted job bookkeeping
 * with retry/dead-letter, revision-aware extraction, generation-fenced staged
 * rebuilds, and forgetting (clear/delete) semantics. All store access goes
 * through deps so the pipeline can act on either the live generation or a
 * staged candidate.
 */
export class MemoryIngestionPipeline {
  private readonly queue: MemoryIngestionQueue;
  private readonly pendingInputs = new Map<
    string,
    { input: MemoryIngestionInput; pathsKey: string }
  >();
  /**
   * Generation-transition coordination. `transitionCount` increments every
   * time a rebuild/clear bumps the generation; `transitionActive` is set for
   * the whole build+commit window. Ingestion jobs wait for an active
   * transition to settle and requeue themselves when one interleaved with
   * their run — their writes would otherwise land in a discarded generation.
   */
  private transitionCount = 0;
  private transitionActive = false;
  private readonly transitionWaiters: Array<() => void> = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Serializes rebuild/clear transitions: two overlapping rebuilds would race
   * on the shared staging dir, so each transition chains behind the previous.
   */
  private transitionTail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: MemoryIngestionPipelineDeps) {
    this.queue = new MemoryIngestionQueue(
      () => deps.getAppConfig().memoryRuntime.ingestionConcurrency || 1
    );
  }

  enqueueIngestion(input: MemoryIngestionInput): Promise<void> {
    if (!this.deps.isEnabled() || !input.session.memoryEnabled || !input.messages.length) {
      return Promise.resolve();
    }
    const sessionId = input.session.id;
    if (this.deps.getJobStore().isSessionForgotten(sessionId)) {
      return Promise.resolve();
    }
    const transcriptRevision = hashTranscriptTurns(messagesToTranscript(input.messages));
    this.deps.getJobStore().upsert(sessionId, {
      transcriptRevision,
      generation: this.deps.getGeneration(),
    });
    // Snapshot coalescing: the queued task reads the latest input at run time,
    // so rapid enqueues collapse to the newest transcript revision.
    this.pendingInputs.set(sessionId, { input, pathsKey: this.deps.getPathsKey() });
    // Opportunistically requeue jobs whose backoff expired (crash-safe retry).
    this.replayDueJobs();
    return this.queue.enqueue(sessionId, async () => {
      const pending = this.pendingInputs.get(sessionId);
      if (!pending) {
        return;
      }
      this.pendingInputs.delete(sessionId);
      await this.runIngestionJob(sessionId, pending.input, pending.pathsKey);
    });
  }

  /**
   * Waits for all queued ingestion work and cancels the retry wake-up timer —
   * used on shutdown and before clears. A post-transition `replayDueJobs`
   * re-arms the timer for any backoff-waiting jobs.
   */
  async drain(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.queue.drain();
  }

  private transitionIdle(): Promise<void> {
    if (!this.transitionActive) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.transitionWaiters.push(resolve);
    });
  }

  /**
   * Public fence for mutations that live outside the job queue (manual
   * edits/deletes): they must wait out an active rebuild/clear so a write can
   * never land between the candidate build and the live swap — where it would
   * silently die with the discarded generation.
   */
  waitForIdle(): Promise<void> {
    return this.transitionIdle();
  }

  /** True while a rebuild/clear holds the transition — mutations must defer. */
  hasActiveTransition(): boolean {
    return this.transitionActive;
  }

  private beginTransition(): void {
    // Bump first: if persisting the manifest fails, no transition was ever
    // claimed and fenced jobs are not left waiting forever.
    this.deps.bumpGeneration();
    this.transitionActive = true;
    this.transitionCount += 1;
  }

  private endTransition(): void {
    this.transitionActive = false;
    const waiters = this.transitionWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  /**
   * Run `fn` holding the transition exclusively: drains in-flight work, bumps
   * the generation, lets fenced jobs wait out the swap, then reopens the live
   * stores and replays due jobs — in that order, for every transition.
   */
  private async runInTransition<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.transitionTail.then(async () => {
      await this.queue.drain();
      this.beginTransition();
      try {
        return await fn();
      } finally {
        // Re-open stores before resuming fenced jobs so they see the
        // generation that actually survived (committed candidate or rolled
        // back live).
        this.deps.resetStores();
        this.endTransition();
        this.replayDueJobs();
      }
    });
    this.transitionTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  replayDueJobs(): void {
    // Memory disabled is a global pause: persisted jobs stay pending and
    // resume on re-enable — pausing must not be conflated with forgetting.
    if (!this.deps.isEnabled()) {
      return;
    }
    for (const job of this.deps.getJobStore().pendingDue()) {
      if (this.pendingInputs.has(job.sessionId)) {
        // Already scheduled with a (possibly newer) input snapshot.
        continue;
      }
      // Stale-generation jobs stay stamped: runIngestionJob reconciles them
      // against clearance fences and the surviving generation's cursor.
      this.queue.enqueue(job.sessionId, async () => {
        const current = this.deps.getJobStore().get(job.sessionId);
        if (!current || current.status !== 'pending') {
          return;
        }
        const input = this.buildInputFromStore(job.sessionId);
        if (!input) {
          this.deps.getJobStore().delete(job.sessionId);
          this.deps.getJobStore().forgetSession(job.sessionId);
          return;
        }
        await this.runIngestionJob(job.sessionId, input, this.deps.getPathsKey());
      });
    }
    // Backoff-waiting jobs need a wake-up even when nothing else enqueues.
    this.scheduleRetryWakeup();
  }

  /**
   * Manual retry: dead-lettered jobs requeue as pending and replay
   * immediately. Returns how many jobs were requeued.
   */
  retryIngestionJobs(sessionId?: string): number {
    const requeued = this.deps.getJobStore().requeueDead(sessionId);
    if (requeued) {
      this.replayDueJobs();
    }
    return requeued;
  }

  /** Arm a one-shot timer for the nearest backoff expiry. */
  private scheduleRetryWakeup(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // Disabled memory never arms a retry wake-up — a timer armed before the
    // toggle still fires but hits the replayDueJobs guard and no-ops.
    if (!this.deps.isEnabled()) {
      return;
    }
    const waiting = this.deps
      .getJobStore()
      .getAll()
      .filter((job) => job.status === 'pending' && job.nextRetryAt !== null);
    if (!waiting.length) {
      return;
    }
    const nextAt = Math.min(...waiting.map((job) => job.nextRetryAt as number));
    const delay = Math.max(0, nextAt - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.replayDueJobs();
    }, delay);
    this.retryTimer.unref?.();
  }

  private buildInputFromStore(sessionId: string): MemoryIngestionInput | null {
    const row = this.deps.db.sessions.get(sessionId);
    if (!row || row.memory_enabled !== 1) {
      return null;
    }
    const session = this.sessionRowToSession(row);
    const messages = this.getMessagesForSession(sessionId);
    if (!messages.length) {
      return null;
    }
    return { session, prompt: '', messages };
  }

  private async runIngestionJob(
    sessionId: string,
    input: MemoryIngestionInput,
    expectedPathsKey: string
  ): Promise<void> {
    // A generation transition swaps the live store set — wait it out so this
    // job's writes land in the surviving generation, not a discarded one.
    await this.transitionIdle();
    // Disabled is a pause, not a delete: the record stays pending and replays
    // when memory is re-enabled (any store access re-triggers replayDueJobs).
    if (!this.deps.isEnabled()) {
      return;
    }
    const jobStore = this.deps.getJobStore();
    if (jobStore.isSessionForgotten(sessionId)) {
      jobStore.delete(sessionId);
      return;
    }
    const job = jobStore.get(sessionId);
    if (!job) {
      return;
    }
    // Immutable token for this run: every completion/failure is conditioned on
    // it, so a stale run can never delete or fail a newer revision's record.
    let token: MemoryIngestionJobToken = {
      transcriptRevision: job.transcriptRevision,
      generation: job.generation,
    };
    try {
      // Paths fence: this job was enqueued under a different storage root.
      // Its record lives in that root's jobs file — leave it alone (it will
      // replay if that root becomes current again). Deleting here could kill
      // an unrelated record for the same session in the CURRENT root.
      if (this.deps.getPathsKey() !== expectedPathsKey) {
        return;
      }
      if (this.deps.getGeneration() !== job.generation) {
        // A generation transition (clear/rebuild) landed while this job was
        // queued. Reconcile rather than blindly drop or blindly run:
        // - a clearance fence covers jobs carrying pre-clear content — replay
        //   would resurrect memory the user explicitly wiped;
        // - a surviving cursor covering this exact transcript means the rebuild
        //   already processed it — the job is redundant;
        // - otherwise it is re-stamped onto the new generation and processed.
        if (!jobStore.matchesToken(sessionId, token)) {
          return; // superseded mid-wait — the newer record runs on its own task
        }
        const workspaceKey = normalizeWorkspaceKey(input.session.cwd);
        const inputRevision = hashTranscriptTurns(messagesToTranscript(input.messages));
        const covered = this.deps.getStateStore().get(sessionId)?.lastTranscriptHash;
        if (jobStore.isClearedBefore(workspaceKey, job.generation) || covered === inputRevision) {
          jobStore.deleteIfMatch(sessionId, token);
          return;
        }
        const generation = this.deps.getGeneration();
        jobStore.upsert(sessionId, { transcriptRevision: inputRevision, generation });
        token = { transcriptRevision: inputRevision, generation };
      }
      jobStore.markRunningIfMatch(sessionId, token);
      const transitionAtStart = this.transitionCount;
      // Bind the run to the storage root that owned the job: every write goes
      // through this snapshot, so a config switch mid-extraction can never mix
      // stores from two roots. The commit boundary re-checks the fence.
      const bound: IngestRunBinding = {
        pathsKey: expectedPathsKey,
        paths: this.deps.getPaths(),
        stores: this.liveStoreSet(),
        jobStore,
        overlayStore: this.deps.getOverlayStore(),
        token,
      };
      const outcome = await this.ingest(input, bound);
      if (this.transitionCount !== transitionAtStart) {
        // A transition interleaved with this run: the writes just landed in
        // the discarded generation (or the run aborted at the boundary).
        // Requeue the newest known revision so it re-ingests into the
        // surviving one — if a newer input is already pending in memory, its
        // revision takes precedence.
        const pending = this.pendingInputs.get(sessionId);
        const transcriptRevision = pending
          ? hashTranscriptTurns(messagesToTranscript(pending.input.messages))
          : token.transcriptRevision;
        if (jobStore.matchesToken(sessionId, token)) {
          jobStore.upsert(sessionId, {
            transcriptRevision,
            generation: this.deps.getGeneration(),
          });
        }
        this.replayDueJobs();
        return;
      }
      if (outcome === 'aborted') {
        // Fenced at the commit boundary (disabled, root switch, superseded):
        // hand the record back to pending without consuming an attempt.
        jobStore.markPendingIfMatch(sessionId, token);
        return;
      }
      // Conditional completion: when a newer revision was enqueued mid-run,
      // its record stays and its queued task runs on its own schedule.
      jobStore.deleteIfMatch(sessionId, token);
    } catch (error) {
      // ingest() records the session-state error itself; the job layer only
      // needs the failure for retry/dead-letter bookkeeping and must not
      // reject — callers never saw ingest failures before either. A stale
      // token leaves the newer revision's record untouched.
      if (jobStore.markFailedIfMatch(sessionId, token, error)) {
        this.scheduleRetryWakeup();
      }
    }
  }

  async rebuildWorkspace(cwd: string): Promise<
    {
      success: boolean;
      workspaceKey: string;
    } & BatchRebuildResult
  > {
    const workspaceKey = normalizeWorkspaceKey(cwd);
    if (!workspaceKey) {
      throw new Error('Workspace path is required');
    }

    // A rebuild forgets the workspace WITHOUT writing tombstones — they would
    // permanently block re-extraction from the still-present sessions.
    return this.runInTransition(async () => {
      const paths = this.deps.getPaths();

      // Stage the candidate generation: seed from the live files, purge this
      // workspace's slice, re-ingest its sessions, then swap atomically. The
      // tombstone gate diverts lifts into the candidate changeset — the live
      // ledger only changes if the candidate commits.
      const stagingDir = this.prepareStagingDir(paths.storageRoot, { seedFromLive: true });
      const changes = this.createCandidateChanges();
      const stores = this.deps.createStoreSet(
        stagingDir,
        new CandidateTombstoneGate(this.deps.getTombstoneStore(), changes)
      );
      this.purgeStoreSet(stores, workspaceKey);
      const sessionRows = this.deps.db.sessions
        .getAll()
        .filter(
          (session) =>
            normalizeWorkspaceKey(session.cwd) === workspaceKey && session.memory_enabled === 1
        )
        .sort((a, b) => a.created_at - b.created_at);

      const result = await this.buildAndCommitGeneration(
        sessionRows,
        stores,
        stagingDir,
        paths,
        changes
      );
      return {
        ...result,
        success: !result.failedSessionCount && !result.commitError,
        workspaceKey,
      };
    });
  }

  async rebuildAll(): Promise<{ success: boolean; workspaceCount: number } & BatchRebuildResult> {
    return this.runInTransition(async () => {
      const paths = this.deps.getPaths();

      const stagingDir = this.prepareStagingDir(paths.storageRoot, { seedFromLive: false });
      const changes = this.createCandidateChanges();
      const stores = this.deps.createStoreSet(
        stagingDir,
        new CandidateTombstoneGate(this.deps.getTombstoneStore(), changes)
      );
      const sessionRows = this.deps.db.sessions
        .getAll()
        .filter((session) => session.memory_enabled === 1)
        .sort((a, b) => a.created_at - b.created_at);
      const result = await this.buildAndCommitGeneration(
        sessionRows,
        stores,
        stagingDir,
        paths,
        changes
      );
      const succeeded = !result.failedSessionCount && !result.commitError;
      if (succeeded) {
        fs.rmSync(paths.artifactsDir, { recursive: true, force: true });
      }
      const overview = this.deps.getOverview();
      return {
        ...result,
        success: succeeded,
        workspaceCount: overview.sourceWorkspaceCount,
      };
    });
  }

  /**
   * Build a complete candidate generation in `stagingDir`, then swap it live.
   * Extraction failures and commit failures are reported on separate fields —
   * a clean sweep of extractions can still fail to land, and vice versa.
   * Any failure leaves the previous generation intact.
   */
  private createCandidateChanges(): CandidateChanges {
    return { overlayDrops: new Set(), tombstoneLifts: [] };
  }

  /**
   * Persist the supersede/lift decisions a committed candidate proved — runs
   * only after the candidate generation has actually swapped in.
   */
  private applyCandidateChanges(changes: CandidateChanges): void {
    if (changes.overlayDrops.size) {
      const overlays = this.deps.getOverlayStore();
      overlays.removeAll(
        [...changes.overlayDrops].map((entry) => {
          const separator = entry.indexOf('|');
          return {
            kind: entry.slice(0, separator) as 'core' | 'project',
            identity: entry.slice(separator + 1),
          };
        })
      );
    }
    if (changes.tombstoneLifts.length) {
      this.deps.getTombstoneStore().removeAll(changes.tombstoneLifts);
    }
  }

  private async buildAndCommitGeneration(
    sessionRows: SessionRow[],
    stores: MemoryStoreSet,
    stagingDir: string,
    paths: MemoryPaths,
    changes: CandidateChanges
  ): Promise<BatchRebuildResult> {
    const { bundles, failures } = await this.extractExperienceBundles(sessionRows);
    for (const failure of failures) {
      this.recordRebuildFailure(failure);
    }
    const result: BatchRebuildResult = {
      sessionCount: sessionRows.length,
      preparedSessionCount: 0,
      committedSessionCount: 0,
      succeededSessionCount: 0,
      failedSessionCount: failures.length,
    };
    // An incomplete candidate is never committed — the previous generation
    // stays live instead of being replaced by partial memory.
    if (failures.length) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return result;
    }

    const sortedBundles = [...bundles].sort((a, b) => a.session.createdAt - b.session.createdAt);
    try {
      for (const bundle of sortedBundles) {
        await this.ingestExtractedBundle(bundle, stores, changes);
        result.preparedSessionCount += 1;
      }
    } catch (error) {
      // Mid-build write failure — unmarked staging has no journal and is
      // discardable; the live generation AND the live manual ledgers were
      // never touched (supersede decisions live in `changes` until commit).
      fs.rmSync(stagingDir, { recursive: true, force: true });
      const failed = sortedBundles[result.preparedSessionCount];
      if (failed) {
        this.recordRebuildFailure({
          session: failed.session,
          sourceWorkspace: failed.sourceWorkspace,
          fullMessageCount: failed.fullMessages.length,
          error,
        });
      }
      result.failedSessionCount = result.sessionCount - result.preparedSessionCount;
      return result;
    }

    // The manual layer and the forget-list outrank re-derived data — apply
    // both to the candidate before it is committed. Overlays the candidate
    // proved superseded are excluded from the replay.
    this.applyManualOverlays(stores, this.deps.getOverlayStore(), changes.overlayDrops);
    this.applyForgottenSessions(stores);

    // Commit fences: a storage-root switch mid-build means this candidate
    // belongs to a different root; a disable mid-build must not land writes
    // the user already turned off. Either way the candidate is discarded and
    // the previous generation stays live.
    if (this.deps.getPaths().storageRoot !== paths.storageRoot) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      result.commitError = 'memory.commit.storageRootChanged';
      return result;
    }
    if (!this.deps.isEnabled()) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      result.commitError = 'memory.disabled';
      return result;
    }

    try {
      commitStagedGeneration(paths.storageRoot, this.deps.getGeneration());
      this.deps.resetStores();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A journaled commit is resumable — attempt recovery immediately so the
      // honest outcome (landed vs rolled back) is known before reporting.
      let recovered: ReturnType<typeof recoverPendingGeneration> = 'none';
      try {
        recovered = recoverPendingGeneration(paths.storageRoot);
      } catch (recoverError) {
        logWarn(
          '[MemoryService] Commit recovery failed; journaled staging preserved for restart:',
          recoverError
        );
      }
      this.deps.resetStores();
      if (recovered !== 'committed') {
        // 'rolled_back' → the previous generation was restored; a recovery
        // throw leaves the journal in place for boot-time recovery. Either
        // way the caller must see the commit failure distinctly.
        result.commitError = message;
      }
    }
    if (!result.commitError) {
      // The candidate is now live — its proven supersede decisions land on
      // the manual ledgers as the second half of the same logical commit.
      result.committedSessionCount = result.preparedSessionCount;
      result.succeededSessionCount = result.committedSessionCount;
      this.applyCandidateChanges(changes);
    }
    return result;
  }

  /** Human-authored edits/confirmations/deletes survive every rebuild. */
  private applyManualOverlays(
    stores: MemoryStoreSet,
    overlayStore: MemoryManualOverlayStore = this.deps.getOverlayStore(),
    exclude?: Set<string>
  ): void {
    for (const overlay of overlayStore.getAll()) {
      if (exclude?.has(`${overlay.kind}|${overlay.identity}`)) {
        // Proven superseded by a newer authoritative correction inside this
        // candidate — replaying it would restore the stale manual value.
        continue;
      }
      if (overlay.kind === 'core') {
        stores.core.applyManualOverride(overlay);
      } else {
        stores.project.applyManualOverride(overlay);
      }
    }
  }

  /** Sessions on the persistent forget-list stay absent in every generation. */
  private applyForgottenSessions(stores: MemoryStoreSet): void {
    let changed = false;
    for (const sessionId of this.deps.getJobStore().forgottenSessionIds()) {
      if (stores.experience.getSession(sessionId)) {
        stores.experience.removeSession(sessionId);
        changed = true;
      }
      stores.core.removeEvidenceWhere((item) => item.sessionId === sessionId);
      stores.project.removeEvidenceWhere((item) => item.sessionId === sessionId);
      stores.state.delete(sessionId);
    }
    if (changed) {
      stores.experience.save();
    }
  }

  private prepareStagingDir(storageRoot: string, options: { seedFromLive: boolean }): string {
    const stagingDir = path.join(storageRoot, STAGING_DIR_NAME);
    // A preserved journal means a previous commit's rollback could not
    // finish — the staging dir holds the only recovery materials. Try to
    // settle it first; if it is still unresolved, refuse to start a new
    // transition rather than destroy the evidence.
    if (hasPendingCommit(storageRoot)) {
      const outcome = recoverPendingGeneration(storageRoot);
      if (outcome === 'unresolved') {
        throw new Error('memory.commit.pendingRecovery');
      }
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    if (options.seedFromLive) {
      for (const name of GENERATED_FILE_NAMES) {
        const live = path.join(storageRoot, name);
        if (fs.existsSync(live)) {
          fs.copyFileSync(live, path.join(stagingDir, name));
        }
      }
    }
    return stagingDir;
  }

  private purgeStoreSet(stores: MemoryStoreSet, workspaceKey: string): void {
    stores.project.removeByWorkspace(workspaceKey);
    stores.experience.removeBySourceWorkspace(workspaceKey);
    stores.experience.save();
    stores.core.removeEvidenceWhere((item) => item.sourceWorkspace === workspaceKey);
    stores.state.deleteBySourceWorkspace(workspaceKey);
  }

  async clearWorkspace(cwd: string): Promise<{ success: boolean; workspaceKey: string }> {
    const workspaceKey = normalizeWorkspaceKey(cwd);
    if (!workspaceKey) {
      throw new Error('Workspace path is required');
    }
    // Wait out in-flight writes, then fence off queued jobs of the old
    // generation so nothing resurrects cleared memory afterwards.
    return this.runInTransition(async () =>
      this.runDurableSection(this.deps.getPaths().storageRoot, () => {
        // Pending jobs for cleared sessions must not replay post-clear: their
        // state cursor is about to be purged, so the content check would find
        // them "not covered" and resurrect cleared memory. The clearance fence
        // additionally drops any stale record that survives a crash image.
        const jobStore = this.deps.getJobStore();
        jobStore.recordWorkspaceClearance(workspaceKey, this.deps.getGeneration());
        for (const session of this.deps.db.sessions.getAll()) {
          if (normalizeWorkspaceKey(session.cwd) === workspaceKey) {
            jobStore.delete(session.id);
            this.pendingInputs.delete(session.id);
          }
        }
        const projectStore = this.deps.getProjectStore();
        const tombstones = this.deps.getTombstoneStore();
        for (const entry of projectStore.getEntries(workspaceKey)) {
          tombstones.add({
            kind: 'project',
            identity: projectTombstoneIdentity(entry.workspaceKey, entry.key),
            valueHash: hashMemoryValue(entry.value),
            sourceSessionIds: entry.evidence.map((item) => item.sessionId).filter(Boolean),
          });
        }
        // Revoke core evidence produced by this workspace; entries left without any
        // evidence (and not user-verified) are forgotten with scoped tombstones so
        // a rebuild cannot resurrect them from the same sessions.
        const removedCore = this.deps
          .getCoreStore()
          .removeEvidenceWhere((item) => item.sourceWorkspace === workspaceKey);
        for (const entry of removedCore) {
          tombstones.add({
            kind: 'core',
            identity: entry.combinedKey,
            valueHash: hashMemoryValue(entry.value),
            sourceSessionIds: entry.evidence.map((item) => item.sessionId).filter(Boolean),
          });
        }
        this.purgeStoreSet(this.liveStoreSet(), workspaceKey);
        // Explicit clears outrank saved manual state: the workspace's project
        // overlays are dropped so a later rebuild cannot resurrect them.
        const overlays = this.deps.getOverlayStore();
        for (const overlay of overlays.getAll()) {
          if (overlay.kind === 'project' && overlay.workspaceKey === workspaceKey) {
            overlays.remove('project', overlay.identity);
          }
        }
        return { success: true, workspaceKey };
      })
    );
  }

  private liveStoreSet(): MemoryStoreSet {
    return {
      core: this.deps.getCoreStore(),
      project: this.deps.getProjectStore(),
      experience: this.deps.getExperienceStore(),
      state: this.deps.getStateStore(),
    };
  }

  async clearCoreMemory(): Promise<{ success: boolean }> {
    return this.runInTransition(async () =>
      this.runDurableSection(this.deps.getPaths().storageRoot, () => {
        const coreStore = this.deps.getCoreStore();
        const tombstones = this.deps.getTombstoneStore();
        for (const entry of coreStore.getEntries()) {
          tombstones.add({
            kind: 'core',
            identity: entry.combinedKey,
            valueHash: hashMemoryValue(entry.value),
            sourceSessionIds: entry.evidence.map((item) => item.sessionId).filter(Boolean),
          });
        }
        coreStore.clear();
        // A replayed job would re-derive the just-cleared core, so every pending
        // ingestion record dies with the cleared memory — and a persisted fence
        // drops any stale record that survives a crash image.
        this.deps.getJobStore().recordCoreClearance(this.deps.getGeneration());
        for (const job of this.deps.getJobStore().getAll()) {
          this.deps.getJobStore().delete(job.sessionId);
        }
        this.pendingInputs.clear();
        // All core overlays die with the memory they modified — otherwise a
        // rebuild would resurrect entries the user explicitly cleared.
        const overlays = this.deps.getOverlayStore();
        for (const overlay of overlays.getAll()) {
          if (overlay.kind === 'core') {
            overlays.remove('core', overlay.identity);
          }
        }
        return { success: true };
      })
    );
  }

  deleteSession(sessionId: string): Promise<void> {
    // Persisted forget-marker: queued jobs and post-restart replays for this
    // session are dropped, and its derived evidence is revoked below.
    this.deps.getJobStore().forgetSession(sessionId);
    return this.queue.enqueue(sessionId, async () => {
      // Wait out an in-flight rebuild — evidence revocation must land on the
      // surviving generation (the rebuild also re-applies the forget-list at
      // commit, so this is belt and suspenders).
      await this.transitionIdle();
      this.runDurableSection(this.deps.getPaths().storageRoot, () => {
        const store = this.deps.getExperienceStore();
        if (store.getSession(sessionId)) {
          store.removeSession(sessionId);
          store.save();
        }
        // Forgetting a session also revokes the facts it evidenced: strip its
        // evidence from core and project entries; entries left without evidence
        // (and not user-verified) are forgotten with a session-scoped tombstone.
        const tombstones = this.deps.getTombstoneStore();
        const removedCore = this.deps
          .getCoreStore()
          .removeEvidenceWhere((item) => item.sessionId === sessionId);
        const removedProject = this.deps
          .getProjectStore()
          .removeEvidenceWhere((item) => item.sessionId === sessionId);
        for (const entry of removedCore) {
          tombstones.add({
            kind: 'core',
            identity: entry.combinedKey,
            valueHash: hashMemoryValue(entry.value),
            sourceSessionIds: entry.evidence.map((item) => item.sessionId).filter(Boolean),
          });
        }
        for (const entry of removedProject) {
          tombstones.add({
            kind: 'project',
            identity: projectTombstoneIdentity(entry.workspaceKey, entry.key),
            valueHash: hashMemoryValue(entry.value),
            sourceSessionIds: entry.evidence.map((item) => item.sessionId).filter(Boolean),
          });
        }
        this.deps.getStateStore().delete(sessionId);
      });
    });
  }

  private async ingest(
    input: MemoryIngestionInput,
    bound: IngestRunBinding
  ): Promise<IngestOutcome> {
    const { session, messages } = input;
    if (!session.memoryEnabled || !messages.length) {
      return 'skipped';
    }

    const { jobStore, stores } = bound;
    const stateStore = stores.state;
    if (jobStore.isSessionForgotten(session.id)) {
      stateStore.delete(session.id);
      return 'skipped';
    }

    const sourceWorkspace = normalizeWorkspaceKey(session.cwd);
    const previousState = stateStore.get(session.id);
    const lastProcessedMessageCount = previousState?.lastProcessedMessageCount || 0;

    const fullTurns = messagesToTranscript(messages);
    const transcriptHash = hashTranscriptTurns(fullTurns);
    const messageIds = messages.map((message) => message.id);
    const currentPrints = messages.map((message) => fingerprintMessage(message));

    // The cursor is the processed transcript revision (content hash), not just
    // a message count: identical revisions are skipped, while edits or history
    // forks reprocess from the divergence point.
    if (previousState?.lastTranscriptHash === transcriptHash) {
      return 'skipped';
    }

    let deltaStart: number;
    const previousPrints = previousState?.lastMessageFingerprints;
    if (previousPrints?.length) {
      // Fingerprints carry content, so in-place edits are localized exactly —
      // id-prefix comparisons cannot see them. The window covers the tail;
      // the prefix hash guards everything before it.
      const prevOffset = Math.max(0, lastProcessedMessageCount - previousPrints.length);
      deltaStart = -1;
      if (prevOffset > 0) {
        const head = currentPrints.slice(0, Math.min(prevOffset, currentPrints.length));
        if (
          currentPrints.length < prevOffset ||
          hashMessageFingerprints(head) !== previousState?.lastMessagePrefixHash
        ) {
          deltaStart = 0;
        }
      }
      if (deltaStart < 0) {
        const bound = Math.min(lastProcessedMessageCount, currentPrints.length);
        deltaStart = bound;
        for (let i = prevOffset; i < bound; i += 1) {
          const prev = previousPrints[i - prevOffset];
          const cur = currentPrints[i];
          if (!prev || !cur || prev.id !== cur.id || prev.hash !== cur.hash) {
            deltaStart = i;
            break;
          }
        }
      }
    } else {
      // Legacy cursor (ids only) — same-prefix detection; content edits to
      // same-id messages resolve via the full-reprocess fallback below.
      const previousIds = previousState?.lastMessageIds || [];
      if (previousIds.length && messages.length) {
        let divergence = 0;
        const bound = Math.min(previousIds.length, messages.length);
        while (divergence < bound && previousIds[divergence] === messages[divergence].id) {
          divergence += 1;
        }
        deltaStart = divergence;
      } else {
        deltaStart = Math.min(lastProcessedMessageCount, messages.length);
      }
    }
    if (deltaStart >= messages.length) {
      // The transcript hash changed but no in-window divergence exists (tail
      // deletion or an edit before the fingerprint window): the divergence
      // cannot be localized, so the full transcript is reprocessed.
      deltaStart = 0;
    }
    const deltaTurns = messagesToTranscript(messages.slice(deltaStart));
    const sessionDate = this.resolveSessionDate(session, messages);

    // Set when the commit phase tore and was rolled back — the bound state
    // store may then hold mutated in-memory cursor state, so the error must
    // be recorded through a fresh store reading the restored file.
    let commitRolledBack = false;
    try {
      // Extraction phase — every LLM call is validated BEFORE any store is
      // touched, so an invalid response can never commit a partial result.
      const coreOutcome = await this.extractCoreActions(
        session.id,
        sessionDate,
        deltaTurns,
        stores.core.toPromptBlock()
      );
      if (coreOutcome.kind === 'failure') {
        throw new Error(coreOutcome.reason);
      }
      if (jobStore.isSessionForgotten(session.id)) {
        stateStore.delete(session.id);
        return 'skipped';
      }
      let experienceOutcome: MemoryExtractionOutcome<ExperienceSessionExtract> = {
        kind: 'no_memory',
      };
      if (fullTurns.length) {
        experienceOutcome = await this.deps.experienceExtractor.extractSession({
          sessionId: session.id,
          sessionDate,
          turns: fullTurns,
          signal: this.deps.getEnabledSignal(),
        });
        if (experienceOutcome.kind === 'failure') {
          throw new Error(experienceOutcome.reason);
        }
        if (jobStore.isSessionForgotten(session.id)) {
          stateStore.delete(session.id);
          return 'skipped';
        }
      }

      // All remaining awaits live here — embeddings are part of the
      // PREPARATION phase so the commit section below is fully synchronous.
      // A concurrent task can never interleave inside a synchronous section,
      // so a rollback restores exactly the state this commit saw, never a
      // neighbour's committed work.
      const preparedExperience =
        experienceOutcome.kind === 'success' && fullTurns.length
          ? await this.prepareExperienceWrite(
              {
                sourceWorkspace,
                sessionId: session.id,
                sessionTitle: session.title,
                sessionDate,
                sessionCreatedAt: session.createdAt,
                fullTurns,
                extracted: experienceOutcome.value,
              },
              stores
            )
          : null;

      // Commit boundary — re-checked inside the synchronous commit section
      // itself: a storage-root switch, an interleaved rebuild/clear
      // transition, a superseding enqueue, a generation bump, or a disabled
      // flag (flipped during an embedding wait) all fence the run — nothing
      // commits, and the job record returns to pending.
      if (
        this.deps.getPathsKey() !== bound.pathsKey ||
        this.transitionActive ||
        this.deps.getGeneration() !== bound.token.generation ||
        !jobStore.matchesToken(session.id, bound.token) ||
        !this.deps.isEnabled()
      ) {
        return 'aborted';
      }

      // Durable commit: the pre-commit bytes of every touched file are
      // persisted BEFORE the first mutation (write-ahead undo record), so a
      // crash mid-commit is recovered at the next store open. A mid-commit
      // error restores the complete previous state the same way.
      writeIngestUndo(bound.paths.storageRoot);
      try {
        const supportTimeOf = this.supportTimeResolver(deltaTurns);
        if (coreOutcome.kind === 'success') {
          const applied = this.applyCoreActions(
            stores.core,
            coreOutcome.value,
            {
              sessionId: session.id,
              sourceWorkspace,
              sourceTurns: deltaTurns.map((_turn, index) => index + 1),
              messageIds: deltaTurns
                .map((turn) => turn.messageId)
                .filter((id): id is string => Boolean(id)),
              excerpt: summarizeText(
                deltaTurns.map((turn) => `${turn.role}: ${turn.content}`).join('\n'),
                260
              ),
              createdAt: sessionDate,
            },
            supportTimeOf
          );
          // Explicit corrections proven NEWER than a manual overlay retire it —
          // inside the same journaled commit, so a torn commit restores the
          // overlay file together with the derived layers.
          for (const drop of this.collectSupersededOverlayDrops(
            coreOutcome.value,
            applied,
            bound.overlayStore,
            supportTimeOf
          )) {
            bound.overlayStore.remove(drop.kind, drop.identity);
          }
        }
        if (preparedExperience) {
          this.applyExperienceWrite(preparedExperience, stores);
        }
        // A 'no_memory' outcome only means the extractor produced nothing —
        // the previously stored record is intentionally left untouched.

        // The manual layer outranks every derived write — the same overlay
        // replay a rebuild applies runs on each normal commit, so a deleted
        // fact cannot reappear under a different wording, and a manual edit
        // stays authoritative over inferred values.
        this.applyManualOverlays(stores, bound.overlayStore);

        stateStore.set({
          sessionId: session.id,
          sourceWorkspace,
          lastProcessedMessageCount: messages.length,
          lastMessageIds: messageIds.slice(-500),
          lastMessageFingerprints: currentPrints.slice(-500),
          lastMessagePrefixHash:
            currentPrints.length > 500
              ? hashMessageFingerprints(currentPrints.slice(0, -500))
              : undefined,
          lastTranscriptHash: transcriptHash,
          lastIngestedAt: Date.now(),
          lastError: null,
          createdAt: previousState?.createdAt || Date.now(),
          updatedAt: Date.now(),
        });
        clearIngestUndo(bound.paths.storageRoot);
      } catch (commitError) {
        commitRolledBack = true;
        // Replay the undo record — restores every file the commit touched.
        recoverPendingIngest(bound.paths.storageRoot);
        // Bound store objects may now diverge from the restored files —
        // force the next access to reload from disk.
        this.deps.resetStores();
        throw commitError;
      }
      log('[MemoryService] Ingested memory for session:', session.id);
      return 'committed';
    } catch (error) {
      // A disable-aborted provider call is not an ingestion failure: the job
      // returns to pending untouched — no attempt burned, no error cursor —
      // and replays from scratch when memory is re-enabled.
      if (!this.deps.isEnabled()) {
        return 'aborted';
      }
      const message = error instanceof Error ? error.message : String(error);
      logError('[MemoryService] Failed to ingest memory:', error);
      // After a rolled-back commit the bound state store's in-memory cursor
      // may already reflect the torn write — a fresh store reads the restored
      // file so the error record cannot smuggle the advanced cursor back in.
      const errorStore = commitRolledBack
        ? new MemorySessionStateStore(bound.paths.stateFilePath)
        : stateStore;
      try {
        // The cursor fields are preserved verbatim — a failed extraction must
        // never advance the revision, so the next run retries the same span.
        errorStore.set({
          sessionId: session.id,
          sourceWorkspace,
          lastProcessedMessageCount,
          lastMessageIds: previousState?.lastMessageIds,
          lastMessageFingerprints: previousState?.lastMessageFingerprints,
          lastMessagePrefixHash: previousState?.lastMessagePrefixHash,
          lastTranscriptHash: previousState?.lastTranscriptHash,
          lastIngestedAt: previousState?.lastIngestedAt || null,
          lastError: message,
          createdAt: previousState?.createdAt || Date.now(),
          updatedAt: Date.now(),
        });
      } catch (stateError) {
        logWarn('[MemoryService] Failed to record ingestion error state:', stateError);
      }
      // Rethrow so the job layer can record attempts/backoff; runIngestionJob
      // swallows it, preserving the historical never-rejecting enqueue API.
      throw error;
    }
  }

  /**
   * Epoch-ms of the user turn that supports an action — derived from the
   * action's own verified `sourceTurns`, never from the session's tail. An
   * action with no user-role supporting turn has no proven support time and
   * returns undefined, so it can never masquerade as a fresh correction.
   */
  private supportTimeResolver(
    turns: MemoryTranscriptTurn[]
  ): (action: CoreMemoryActionInput) => number | undefined {
    return (action) => {
      if (!action.sourceTurns?.length) {
        return undefined;
      }
      let latest: number | undefined;
      for (const index of action.sourceTurns) {
        const turn = turns[index - 1];
        if (turn?.role !== 'user' || typeof turn.timestamp !== 'number') {
          continue;
        }
        latest = latest === undefined ? turn.timestamp : Math.max(latest, turn.timestamp);
      }
      return latest;
    };
  }

  /**
   * Collect the manual overlays a fresh authoritative correction supersedes —
   * a pure decision, no writes. The caller decides when the drops land:
   * normal ingest applies them inside the journaled commit, a rebuild
   * accumulates them into the candidate changeset that only reaches the live
   * ledger once the candidate commits.
   *
   * A correction retires an overlay only when its SUPPORTING user turn is
   * newer than the overlay — the session tail's timestamp would let an old
   * statement piggy-back on an unrelated later message.
   */
  private collectSupersededOverlayDrops(
    actions: CoreMemoryActionInput[],
    applied: AppliedCoreMemoryAction[],
    overlayStore: MemoryManualOverlayStore,
    supportTimeOf: (action: CoreMemoryActionInput) => number | undefined
  ): Array<{ kind: 'core'; identity: string }> {
    const appliedKeys = new Set(
      applied.filter((item) => item.op !== 'delete').map((item) => item.combinedKey)
    );
    if (!appliedKeys.size) {
      return [];
    }
    const drops: Array<{ kind: 'core'; identity: string }> = [];
    for (const action of actions) {
      if (action.op === 'delete') {
        continue;
      }
      const sourceType = normalizeConfidenceSourceType(action.sourceType);
      if (sourceType !== 'explicit_user_statement' && sourceType !== 'manual_edit') {
        continue;
      }
      const combinedKey = resolveCoreCombinedKey(action.category, action.key);
      if (!combinedKey || !appliedKeys.has(combinedKey)) {
        continue;
      }
      const overlay = overlayStore.get('core', combinedKey);
      if (!overlay) {
        continue;
      }
      const supportAt = supportTimeOf(action);
      if (supportAt === undefined) {
        continue;
      }
      const overlayAt = Date.parse(overlay.updatedAt);
      if (Number.isFinite(overlayAt) && overlayAt >= supportAt) {
        continue;
      }
      drops.push({ kind: 'core', identity: combinedKey });
    }
    return drops;
  }

  /**
   * Run a synchronous mutation section under the same durable undo record an
   * ordinary ingest commit uses — clears/deletes write several live files and
   * must restore the complete pre-mutation state on a mid-write failure.
   */
  private runDurableSection<T>(storageRoot: string, fn: () => T): T {
    writeIngestUndo(storageRoot);
    try {
      const result = fn();
      clearIngestUndo(storageRoot);
      return result;
    } catch (error) {
      recoverPendingIngest(storageRoot);
      this.deps.resetStores();
      throw error;
    }
  }

  private async ingestExtractedBundle(
    bundle: ExtractionBundle,
    stores: MemoryStoreSet,
    changes: CandidateChanges
  ): Promise<void> {
    // The bundle's experience extraction already ran; the core extraction
    // happens here against the STAGED store's prompt block.
    const coreOutcome = await this.extractCoreActions(
      bundle.session.id,
      bundle.sessionDate,
      bundle.fullTurns,
      stores.core.toPromptBlock()
    );
    if (coreOutcome.kind === 'failure') {
      throw new Error(coreOutcome.reason);
    }
    if (coreOutcome.kind === 'success') {
      const supportTimeOf = this.supportTimeResolver(bundle.fullTurns);
      const applied = this.applyCoreActions(
        stores.core,
        coreOutcome.value,
        {
          sessionId: bundle.session.id,
          sourceWorkspace: bundle.sourceWorkspace,
          sourceTurns: bundle.fullTurns.map((_turn, index) => index + 1),
          messageIds: bundle.fullTurns
            .map((turn) => turn.messageId)
            .filter((id): id is string => Boolean(id)),
          excerpt: summarizeText(
            bundle.fullTurns.map((turn) => `${turn.role}: ${turn.content}`).join('\n'),
            260
          ),
          createdAt: bundle.sessionDate,
        },
        supportTimeOf
      );
      // An explicit correction re-derived from the transcript supersedes the
      // overlay recorded before it — recorded into the candidate changeset,
      // NOT the live ledger: a failed rebuild must leave every manual record
      // byte-identical. The drops land only if the candidate commits.
      for (const drop of this.collectSupersededOverlayDrops(
        coreOutcome.value,
        applied,
        this.deps.getOverlayStore(),
        supportTimeOf
      )) {
        changes.overlayDrops.add(`${drop.kind}|${drop.identity}`);
      }
    }
    if (bundle.fullTurns.length && bundle.extracted.sessionSummary.trim()) {
      const prepared = await this.prepareExperienceWrite(
        {
          sourceWorkspace: bundle.sourceWorkspace,
          sessionId: bundle.session.id,
          sessionTitle: bundle.session.title,
          sessionDate: bundle.sessionDate,
          sessionCreatedAt: bundle.session.createdAt,
          fullTurns: bundle.fullTurns,
          extracted: bundle.extracted,
        },
        stores
      );
      if (prepared) {
        this.applyExperienceWrite(prepared, stores);
      }
    }
    const prints = bundle.fullMessages.map((message) => fingerprintMessage(message));
    stores.state.set({
      sessionId: bundle.session.id,
      sourceWorkspace: bundle.sourceWorkspace,
      lastProcessedMessageCount: bundle.fullMessages.length,
      lastMessageIds: bundle.fullMessages.map((message) => message.id).slice(-500),
      lastMessageFingerprints: prints.slice(-500),
      lastMessagePrefixHash:
        prints.length > 500 ? hashMessageFingerprints(prints.slice(0, -500)) : undefined,
      lastTranscriptHash: hashTranscriptTurns(bundle.fullTurns),
      lastIngestedAt: Date.now(),
      lastError: null,
      createdAt: bundle.session.createdAt,
      updatedAt: Date.now(),
    });
  }

  private async extractExperienceBundles(
    sessionRows: SessionRow[]
  ): Promise<{ bundles: ExtractionBundle[]; failures: ExtractionFailure[] }> {
    const concurrency = Math.max(
      1,
      this.deps.getAppConfig().memoryRuntime.ingestionConcurrency || 1
    );
    const tasks = sessionRows.map((sessionRow) => async () => {
      const session = this.sessionRowToSession(sessionRow);
      const fullMessages = this.getMessagesForSession(sessionRow.id);
      const fullTurns = messagesToTranscript(fullMessages);
      const sessionDate = this.resolveSessionDate(session, fullMessages);
      const sourceWorkspace = normalizeWorkspaceKey(session.cwd);
      const outcome = fullTurns.length
        ? await this.deps.experienceExtractor.extractSession({
            sessionId: session.id,
            sessionDate,
            turns: fullTurns,
            signal: this.deps.getEnabledSignal(),
          })
        : ({ kind: 'no_memory' } as const);
      if (outcome.kind === 'failure') {
        throw new Error(outcome.reason);
      }
      const extracted: ExperienceSessionExtract =
        outcome.kind === 'success'
          ? outcome.value
          : { sessionSummary: '', sessionKeywords: [], chunks: [] };
      return {
        sessionRow,
        session,
        sourceWorkspace,
        sessionDate,
        fullMessages,
        fullTurns,
        extracted,
      } satisfies ExtractionBundle;
    });

    const bundles: ExtractionBundle[] = [];
    const failures: ExtractionFailure[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        try {
          bundles[index] = await tasks[index]();
        } catch (error) {
          const session = this.sessionRowToSession(sessionRows[index]);
          const fullMessages = this.getMessagesForSession(sessionRows[index].id);
          failures.push({
            session,
            sourceWorkspace: normalizeWorkspaceKey(session.cwd),
            fullMessageCount: fullMessages.length,
            error,
          });
        }
      }
    });
    await Promise.all(workers);
    return {
      bundles: bundles.filter(Boolean),
      failures,
    };
  }

  private recordRebuildFailure(input: ExtractionFailure): void {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    logError(
      '[MemoryService] Failed to rebuild memory for session:',
      input.session.id,
      input.error
    );
    const previousState = this.deps.getStateStore().get(input.session.id);
    this.deps.getStateStore().set({
      sessionId: input.session.id,
      sourceWorkspace: input.sourceWorkspace,
      lastProcessedMessageCount: previousState?.lastProcessedMessageCount || 0,
      // Preserve the previous cursor verbatim — a failed rebuild must not
      // advance or erase the processed revision.
      lastMessageIds: previousState?.lastMessageIds,
      lastMessageFingerprints: previousState?.lastMessageFingerprints,
      lastMessagePrefixHash: previousState?.lastMessagePrefixHash,
      lastTranscriptHash: previousState?.lastTranscriptHash,
      lastIngestedAt: previousState?.lastIngestedAt || null,
      lastError: message,
      createdAt: previousState?.createdAt || input.session.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * Extraction half of the core-memory update — the LLM call and its
   * validation. Kept separate from `applyCoreActions` so `ingest` can run all
   * extractions before committing anything.
   */
  private async extractCoreActions(
    sessionId: string,
    sessionDate: string,
    turns: MemoryTranscriptTurn[],
    existingCorePromptBlock: string
  ): Promise<MemoryExtractionOutcome<CoreMemoryActionInput[]>> {
    if (!turns.length) {
      return { kind: 'no_memory' };
    }
    return this.deps.coreExtractor.extract({
      sessionId,
      sessionDate,
      turns,
      existingCorePromptBlock,
      // Disabling memory aborts the provider call itself — the request does
      // not run to completion against a store the user already switched off.
      signal: this.deps.getEnabledSignal(),
    });
  }

  /** Commit half — applies validated actions with their provenance evidence. */
  private applyCoreActions(
    coreStore: CoreMemoryStore,
    actions: CoreMemoryActionInput[],
    evidence: MemoryEvidenceRef,
    supportTimeOf?: (action: CoreMemoryActionInput) => number | undefined
  ): AppliedCoreMemoryAction[] {
    return coreStore.applyActions(actions, [evidence], { supportTimeOf });
  }

  /**
   * Everything the experience write needs that is NOT a store mutation —
   * the embedding calls. Runs in the preparation phase so the commit
   * section that applies the result stays fully synchronous.
   */
  private async prepareExperienceWrite(
    input: {
      sourceWorkspace: string | null;
      sessionId: string;
      sessionTitle?: string;
      sessionDate: string;
      sessionCreatedAt: number;
      fullTurns: MemoryTranscriptTurn[];
      extracted: ExperienceSessionExtract;
    },
    stores: Pick<MemoryStoreSet, 'experience' | 'project'>
  ): Promise<PreparedExperienceWrite | null> {
    if (!input.extracted.sessionSummary.trim() || input.extracted.sessionConfidence === undefined) {
      return null;
    }
    const existing = stores.experience.getSession(input.sessionId);
    const ingestedAt = isoNow();
    const sourceWorkspaceLabel = this.resolveWorkspaceLabel(input.sourceWorkspace);

    const chunkInputs: Array<
      Omit<ChunkMemoryItem, 'id' | 'confidence' | 'confidenceSignals' | 'status' | 'supersededBy'> &
        Partial<Pick<ChunkMemoryItem, 'confidence' | 'confidenceSignals' | 'status'>>
    > = [];
    for (const chunk of input.extracted.chunks) {
      if (chunk.confidence === undefined) {
        continue;
      }
      // Skip chunks whose summary is essentially a credential — redaction
      // alone is not enough since the raw excerpt is also stored.
      if (containsSensitiveContent(chunk.summary) || containsSensitiveContent(chunk.details)) {
        continue;
      }
      const rawText = redactSensitiveContent(
        this.extractRawText(input.fullTurns, chunk.sourceTurns)
      );
      const searchableText = [chunk.summary, chunk.details, ...chunk.keywords].join(' ').trim();
      const chunkEmbedding = await this.embedText(searchableText);
      chunkInputs.push({
        sessionId: input.sessionId,
        sourceWorkspace: input.sourceWorkspace,
        sourceWorkspaceLabel,
        sourceSessionId: input.sessionId,
        sourceSessionTitle: input.sessionTitle,
        sourceSessionDate: input.sessionDate,
        summary: chunk.summary,
        details: chunk.details,
        keywords: chunk.keywords.length ? chunk.keywords : extractKeywords(searchableText),
        sourceTurns: chunk.sourceTurns,
        rawText,
        sessionDate: input.sessionDate,
        createdAt: existing?.createdAt || new Date(input.sessionCreatedAt).toISOString(),
        ingestedAt,
        embedding: chunkEmbedding?.vector ?? [],
        embeddingModel: chunkEmbedding?.model,
        confidence: chunk.confidence,
        confidenceSignals: buildConfidenceSignals({
          sourceType: 'conversation_summary',
          extractionConfidence: chunk.confidence,
          evidenceCount: chunk.sourceTurns.length ? 1 : 0,
          reason: 'Extracted from session chunk summary',
        }),
        status: 'active',
      });
    }

    const sessionSearchable = [input.extracted.sessionSummary, ...input.extracted.sessionKeywords]
      .join(' ')
      .trim();
    const sessionEmbedding = await this.embedText(sessionSearchable);
    return {
      input,
      session: {
        sessionId: input.sessionId,
        sourceWorkspace: input.sourceWorkspace,
        sourceWorkspaceLabel,
        sourceSessionId: input.sessionId,
        sourceSessionTitle: input.sessionTitle,
        sourceSessionDate: input.sessionDate,
        summary: input.extracted.sessionSummary,
        keywords: input.extracted.sessionKeywords.length
          ? input.extracted.sessionKeywords
          : extractKeywords(sessionSearchable),
        chunkIds: [],
        rawSession: input.fullTurns,
        sessionDate: input.sessionDate,
        createdAt: existing?.createdAt || new Date(input.sessionCreatedAt).toISOString(),
        ingestedAt,
        embedding: sessionEmbedding?.vector ?? [],
        embeddingModel: sessionEmbedding?.model,
        confidence: input.extracted.sessionConfidence,
        confidenceSignals: buildConfidenceSignals({
          sourceType: 'conversation_summary',
          extractionConfidence: input.extracted.sessionConfidence,
          evidenceCount: input.extracted.chunks.length,
          reason: 'Extracted from session summary',
        }),
        status: 'active',
      },
      chunks: chunkInputs,
    };
  }

  /** Synchronous apply half of an experience write — commit section only. */
  private applyExperienceWrite(
    prepared: PreparedExperienceWrite,
    stores: Pick<MemoryStoreSet, 'experience' | 'project'>
  ): void {
    const { input } = prepared;
    stores.experience.replaceSession(input.sessionId, prepared.session, prepared.chunks);
    stores.experience.save();
    stores.project.upsertFromExperience({
      workspaceKey: input.sourceWorkspace,
      workspaceLabel: this.resolveWorkspaceLabel(input.sourceWorkspace),
      sessionId: input.sessionId,
      sessionTitle: input.sessionTitle,
      summary: input.extracted.sessionSummary,
      keywords: input.extracted.sessionKeywords,
      sourceTurns: input.extracted.chunks.flatMap((chunk) => chunk.sourceTurns),
      messageIds: input.fullTurns
        .map((turn) => turn.messageId)
        .filter((id): id is string => Boolean(id)),
      extractionConfidence: input.extracted.sessionConfidence,
    });
  }

  async embedText(
    text: string,
    signal?: AbortSignal
  ): Promise<{ vector: number[]; model: string } | null> {
    const runtime = this.deps.getAppConfig().memoryRuntime;
    // The global toggle gates EVERY model call, including embeddings — a
    // disable mid-run must stop subsequent calls, not only the next job.
    if (!runtime.useEmbedding || !text.trim() || !this.deps.isEnabled()) {
      return null;
    }
    const merged = this.mergeSignals(signal, this.deps.getEnabledSignal());
    if (merged.aborted) {
      return null;
    }
    try {
      const vector = await this.deps.llmClient.embed(text, merged);
      return vector.length ? { vector, model: runtime.embedding.model || 'unknown' } : null;
    } catch (error) {
      logWarn('[MemoryService] Embedding failed, falling back to lexical retrieval:', error);
      return null;
    }
  }

  /** A signal that aborts when ANY input aborts — links caller cancellation
   *  with the memory-disabled switch for in-flight provider calls. */
  private mergeSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (!signal) {
        continue;
      }
      if (signal.aborted) {
        controller.abort();
        break;
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
  }

  private extractRawText(turns: MemoryTranscriptTurn[], sourceTurns: number[]): string {
    return [...sourceTurns]
      .sort((a, b) => a - b)
      .map((turnNumber) => turns[turnNumber - 1])
      .filter((turn): turn is MemoryTranscriptTurn => Boolean(turn))
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');
  }

  private resolveSessionDate(
    session: MemoryIngestionInput['session'],
    messages: MemoryIngestionInput['messages']
  ): string {
    const timestamp =
      messages[messages.length - 1]?.timestamp || session.updatedAt || session.createdAt;
    return formatTimestamp(timestamp);
  }

  private resolveWorkspaceLabel(sourceWorkspace: string | null): string | undefined {
    if (!sourceWorkspace) {
      return undefined;
    }
    const basename = path.basename(sourceWorkspace);
    return basename || sourceWorkspace;
  }

  private sessionRowToSession(row: SessionRow): MemoryIngestionInput['session'] {
    return {
      id: row.id,
      title: row.title,
      status: row.status as MemoryIngestionInput['session']['status'],
      cwd: row.cwd || undefined,
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: row.memory_enabled === 1,
      model: row.model || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      agentSessionId: row.agent_session_id || undefined,
      openaiThreadId: row.openai_thread_id || undefined,
    };
  }

  private getMessagesForSession(sessionId: string): MemoryIngestionInput['messages'] {
    return this.deps.db.messages.getBySessionId(sessionId).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as MemoryIngestionInput['messages'][number]['role'],
      content: this.safeParseContent(row.content),
      timestamp: row.timestamp,
      executionTimeMs: row.execution_time_ms || undefined,
    }));
  }

  private safeParseContent(raw: string) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [{ type: 'text', text: String(parsed) }];
    } catch {
      return [{ type: 'text', text: raw }];
    }
  }
}
