import { loadJsonFile, saveJsonFile } from './memory-utils';

export type MemoryIngestionJobStatus = 'pending' | 'running' | 'dead';

export interface MemoryIngestionJob {
  sessionId: string;
  /** Content hash of the transcript snapshot this job should process. */
  transcriptRevision: string;
  /** Fence token captured at enqueue; stale jobs never commit. */
  generation: number;
  status: MemoryIngestionJobStatus;
  attempt: number;
  nextRetryAt: number | null;
  errorCode?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Immutable token identifying one enqueued revision. A job record is keyed by
 * session only, so a newer enqueue overwrites the record while an older run is
 * still in flight — completion/failure must be conditioned on this token so a
 * stale run can never delete or mutate the newer revision's bookkeeping.
 */
export interface MemoryIngestionJobToken {
  transcriptRevision: string;
  generation: number;
}

interface IngestionJobsFile {
  jobs?: Record<string, unknown>;
  forgottenSessions?: unknown;
  clearedGenerations?: unknown;
}

export const MAX_INGESTION_ATTEMPTS = 3;
const RETRY_BASE_MS = 5_000;
const RETRY_CAP_MS = 5 * 60_000;

export function ingestionRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), RETRY_CAP_MS);
}

function normalizeJob(item: unknown): MemoryIngestionJob | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, unknown>;
  if (typeof record.sessionId !== 'string' || !record.sessionId) {
    return null;
  }
  const status: MemoryIngestionJobStatus =
    record.status === 'running' || record.status === 'dead' ? record.status : 'pending';
  return {
    sessionId: record.sessionId,
    transcriptRevision:
      typeof record.transcriptRevision === 'string' ? record.transcriptRevision : '',
    generation:
      typeof record.generation === 'number' && Number.isFinite(record.generation)
        ? Math.floor(record.generation)
        : 0,
    // A job persisted as 'running' means the process died mid-run — it is
    // requeued as pending rather than trusted.
    status: status === 'running' ? 'pending' : status,
    attempt:
      typeof record.attempt === 'number' && Number.isFinite(record.attempt)
        ? Math.max(0, Math.floor(record.attempt))
        : 0,
    nextRetryAt:
      typeof record.nextRetryAt === 'number' && Number.isFinite(record.nextRetryAt)
        ? record.nextRetryAt
        : null,
    errorCode: typeof record.errorCode === 'string' ? record.errorCode : undefined,
    lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
    createdAt:
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
  };
}

/**
 * Durable ingestion bookkeeping. Tracks one job per session plus the set of
 * sessions whose derived memory must stay forgotten — both survive restarts so
 * a crash cannot resurrect deleted memory or lose retry state.
 */
export class MemoryIngestionJobStore {
  private readonly jobs = new Map<string, MemoryIngestionJob>();
  private readonly forgottenSessions = new Set<string>();
  /**
   * Invalidation fences written by clear operations: `core` is the generation
   * at which core memory was last cleared, `workspaces` maps a workspace key
   * to the generation at which it was last cleared. A job stamped below such
   * a fence carries pre-clear content — replaying it would resurrect cleared
   * memory, so it must be dropped rather than run. Rebuilds record nothing:
   * coverage is decided by content instead.
   */
  private coreClearedAt = 0;
  private readonly workspaceClearedAt = new Map<string, number>();

  constructor(private readonly filePath: string) {
    const raw = loadJsonFile<IngestionJobsFile>(filePath, {});
    for (const item of Object.values(raw.jobs || {})) {
      const job = normalizeJob(item);
      if (job) {
        this.jobs.set(job.sessionId, job);
      }
    }
    if (Array.isArray(raw.forgottenSessions)) {
      for (const id of raw.forgottenSessions) {
        if (typeof id === 'string' && id) {
          this.forgottenSessions.add(id);
        }
      }
    }
    const cleared = raw.clearedGenerations;
    if (cleared && typeof cleared === 'object') {
      const record = cleared as Record<string, unknown>;
      if (typeof record.core === 'number' && Number.isFinite(record.core)) {
        this.coreClearedAt = Math.max(0, Math.floor(record.core));
      }
      if (record.workspaces && typeof record.workspaces === 'object') {
        for (const [key, generation] of Object.entries(
          record.workspaces as Record<string, unknown>
        )) {
          if (typeof generation === 'number' && Number.isFinite(generation)) {
            this.workspaceClearedAt.set(key, Math.max(0, Math.floor(generation)));
          }
        }
      }
    }
  }

  getPath(): string {
    return this.filePath;
  }

  get(sessionId: string): MemoryIngestionJob | undefined {
    return this.jobs.get(sessionId);
  }

  getAll(): MemoryIngestionJob[] {
    return [...this.jobs.values()];
  }

  /** Jobs eligible to (re)run now — pending and not waiting on backoff. */
  pendingDue(now = Date.now()): MemoryIngestionJob[] {
    return this.getAll().filter(
      (job) => job.status === 'pending' && (job.nextRetryAt === null || job.nextRetryAt <= now)
    );
  }

  /** Jobs still queued (pending, including those waiting on backoff). */
  pendingCount(): number {
    return this.getAll().filter((job) => job.status === 'pending').length;
  }

  /** Jobs that exhausted retries — surfaced in diagnostics. */
  deadCount(): number {
    return this.getAll().filter((job) => job.status === 'dead').length;
  }

  upsert(
    sessionId: string,
    updates: Pick<MemoryIngestionJob, 'transcriptRevision' | 'generation'>
  ): MemoryIngestionJob {
    const existing = this.jobs.get(sessionId);
    const job: MemoryIngestionJob = {
      sessionId,
      transcriptRevision: updates.transcriptRevision,
      generation: updates.generation,
      // A fresh enqueue supersedes a dead-lettered or failed job: the newest
      // transcript revision always gets another chance.
      status: 'pending',
      attempt: 0,
      nextRetryAt: null,
      errorCode: undefined,
      lastError: undefined,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(sessionId, job);
    this.save();
    return job;
  }

  /** True when the stored record still represents the enqueued revision. */
  matchesToken(sessionId: string, token: MemoryIngestionJobToken): boolean {
    const job = this.jobs.get(sessionId);
    return (
      Boolean(job) &&
      job!.transcriptRevision === token.transcriptRevision &&
      job!.generation === token.generation
    );
  }

  markRunning(sessionId: string): void {
    const job = this.jobs.get(sessionId);
    if (job) {
      job.status = 'running';
      job.updatedAt = Date.now();
      this.save();
    }
  }

  /** markRunning conditioned on the token — a superseded run must not touch the newer record. */
  markRunningIfMatch(sessionId: string, token: MemoryIngestionJobToken): boolean {
    if (!this.matchesToken(sessionId, token)) {
      return false;
    }
    this.markRunning(sessionId);
    return true;
  }

  /**
   * Return a running job to pending WITHOUT consuming an attempt — used when a
   * run aborts before committing (memory disabled mid-run, storage-root or
   * generation fence). The job stays resumable rather than retry-scheduled.
   */
  markPendingIfMatch(sessionId: string, token: MemoryIngestionJobToken): boolean {
    if (!this.matchesToken(sessionId, token)) {
      return false;
    }
    const job = this.jobs.get(sessionId);
    if (job && job.status === 'running') {
      job.status = 'pending';
      job.nextRetryAt = null;
      job.updatedAt = Date.now();
      this.save();
    }
    return true;
  }

  markFailed(sessionId: string, error: unknown): MemoryIngestionJob | undefined {
    const job = this.jobs.get(sessionId);
    if (!job) {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    job.attempt += 1;
    job.lastError = message;
    job.errorCode = 'memory.ingestion.failed';
    job.updatedAt = Date.now();
    if (job.attempt >= MAX_INGESTION_ATTEMPTS) {
      job.status = 'dead';
      job.nextRetryAt = null;
    } else {
      job.status = 'pending';
      job.nextRetryAt = Date.now() + ingestionRetryDelayMs(job.attempt);
    }
    this.save();
    return job;
  }

  /** markFailed conditioned on the token — returns undefined when superseded. */
  markFailedIfMatch(
    sessionId: string,
    token: MemoryIngestionJobToken,
    error: unknown
  ): MemoryIngestionJob | undefined {
    if (!this.matchesToken(sessionId, token)) {
      return undefined;
    }
    return this.markFailed(sessionId, error);
  }

  delete(sessionId: string): void {
    if (this.jobs.delete(sessionId)) {
      this.save();
    }
  }

  /** delete conditioned on the token — a stale run never removes a newer revision's record. */
  deleteIfMatch(sessionId: string, token: MemoryIngestionJobToken): boolean {
    if (!this.matchesToken(sessionId, token)) {
      return false;
    }
    this.delete(sessionId);
    return true;
  }

  /** Record that workspace memory was cleared at this generation. */
  recordWorkspaceClearance(workspaceKey: string, generation: number): void {
    if (generation > (this.workspaceClearedAt.get(workspaceKey) || 0)) {
      this.workspaceClearedAt.set(workspaceKey, generation);
      this.save();
    }
  }

  /** Record that core memory was cleared at this generation. */
  recordCoreClearance(generation: number): void {
    if (generation > this.coreClearedAt) {
      this.coreClearedAt = generation;
      this.save();
    }
  }

  /**
   * True when a job stamped with `jobGeneration` predates the clear of
   * `workspaceKey` (or of core memory) — its transcript snapshot is pre-clear
   * content and must never be replayed.
   */
  isClearedBefore(workspaceKey: string | null, jobGeneration: number): boolean {
    const workspaceFence = workspaceKey ? this.workspaceClearedAt.get(workspaceKey) || 0 : 0;
    const fence = Math.max(this.coreClearedAt, workspaceFence);
    return fence > 0 && jobGeneration < fence;
  }

  /** Manual retry entry: dead-lettered jobs requeue as pending, attempts reset. */
  requeueDead(sessionId?: string): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== 'dead' || (sessionId && job.sessionId !== sessionId)) {
        continue;
      }
      this.jobs.set(job.sessionId, {
        ...job,
        status: 'pending',
        attempt: 0,
        nextRetryAt: null,
        errorCode: undefined,
        lastError: undefined,
        updatedAt: Date.now(),
      });
      count += 1;
    }
    if (count) {
      this.save();
    }
    return count;
  }

  /** Sessions whose memory was explicitly forgotten — persists across restarts. */
  forgetSession(sessionId: string): void {
    if (!this.forgottenSessions.has(sessionId)) {
      this.forgottenSessions.add(sessionId);
      this.jobs.delete(sessionId);
      this.save();
    }
  }

  isSessionForgotten(sessionId: string): boolean {
    return this.forgottenSessions.has(sessionId);
  }

  /** All sessions in the persistent forget-list — applied to staged rebuilds. */
  forgottenSessionIds(): string[] {
    return [...this.forgottenSessions];
  }

  save(): void {
    saveJsonFile(this.filePath, {
      jobs: Object.fromEntries(this.jobs),
      forgottenSessions: [...this.forgottenSessions],
      clearedGenerations: {
        core: this.coreClearedAt,
        workspaces: Object.fromEntries(this.workspaceClearedAt),
      },
    });
  }
}
