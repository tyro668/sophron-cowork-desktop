import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logWarn } from '../utils/logger';
import { isoNow, loadJsonFile, saveJsonFile } from './memory-utils';

/**
 * Generation fencing + staged rebuild commit for the JSON memory stores.
 *
 * Rebuilds assemble a full candidate generation under `.staging-rebuild/` and
 * only swap it into place once every session extracted and stored cleanly —
 * a failed rebuild therefore leaves the previous generation intact.
 *
 * Commit protocol (idempotent, crash-safe):
 * 1. A commit journal is written inside the staging dir BEFORE any live file
 *    is touched. It records the exact per-file plan: which files the new
 *    generation commits (with their staged sha1) and which it deletes.
 * 2. Each file's swap is journaled individually: `done` is flipped only after
 *    the file's staged→live rename completed. Because the staged sha1 is
 *    recorded, replay can distinguish "swap finished, journal write crashed"
 *    (live content already matches) from "swap never ran".
 * 3. Recovery either finishes the journal (complete new generation) or rolls
 *    the completed entries back from `.backup-rebuild/` (complete old
 *    generation). A torn half-generation is never left behind.
 */

export const STAGING_DIR_NAME = '.staging-rebuild';
export const BACKUP_DIR_NAME = '.backup-rebuild';
const COMMIT_JOURNAL_NAME = 'commit_journal.json';
const MANIFEST_FILE_NAME = 'memory_manifest.json';

/** Rebuilt file basenames, in commit order. Tombstones/jobs are never rebuilt. */
export const GENERATED_FILE_NAMES = [
  'core_memory.json',
  'project_memory.json',
  'experience_memory.json',
  'session_state.json',
] as const;

export interface MemoryManifest {
  generation: number;
  updatedAt: string;
}

interface CommitJournalEntry {
  name: string;
  /** 'commit' swaps staged→live; 'delete' removes a file the new generation dropped. */
  action: 'commit' | 'delete';
  /** sha1 of the staged file — lets recovery detect an already-completed swap. */
  sha1?: string;
  /** Whether the file existed in the previous generation, and its sha1 if so. */
  oldExists?: boolean;
  oldHash?: string;
  done: boolean;
  /**
   * Rollback progress, persisted per file — a crash mid-rollback resumes the
   * same direction instead of treating `done` entries as committed again.
   */
  rolledBack?: boolean;
}

interface CommitJournal {
  generation: number;
  /**
   * 'commit' while forward-applying; persisted as 'rollback' the moment the
   * first rollback step runs. Once a journal is in 'rollback', later recovery
   * MUST continue the rollback — resuming forward after a partial restore
   * would certify a mixed old/new generation as committed.
   * Legacy journals without the field are read as 'commit'.
   */
  phase?: 'commit' | 'rollback';
  entries: CommitJournalEntry[];
}

export function manifestPathFor(storageRoot: string): string {
  return path.join(storageRoot, MANIFEST_FILE_NAME);
}

export function loadGeneration(storageRoot: string): number {
  const manifest = loadJsonFile<Partial<MemoryManifest>>(
    manifestPathFor(storageRoot),
    {} as Partial<MemoryManifest>
  );
  return typeof manifest.generation === 'number' && Number.isFinite(manifest.generation)
    ? Math.max(0, Math.floor(manifest.generation))
    : 0;
}

export function writeGeneration(storageRoot: string, generation: number): void {
  saveJsonFile(manifestPathFor(storageRoot), {
    generation,
    updatedAt: isoNow(),
  } satisfies MemoryManifest);
}

function sha1OfFile(filePath: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function journalPathFor(stagingDir: string): string {
  return path.join(stagingDir, COMMIT_JOURNAL_NAME);
}

function writeJournal(stagingDir: string, journal: CommitJournal): void {
  saveJsonFile(journalPathFor(stagingDir), journal);
}

function readJournal(stagingDir: string): CommitJournal | null {
  const raw = loadJsonFile<{ generation?: unknown; entries?: unknown }>(
    journalPathFor(stagingDir),
    {}
  );
  if (
    typeof raw.generation !== 'number' ||
    !Number.isFinite(raw.generation) ||
    !Array.isArray(raw.entries)
  ) {
    return null;
  }
  const entries = raw.entries
    .map((item): CommitJournalEntry | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      if (typeof record.name !== 'string' || !GENERATED_FILE_NAMES.includes(record.name as never)) {
        return null;
      }
      if (record.action !== 'commit' && record.action !== 'delete') {
        return null;
      }
      return {
        name: record.name,
        action: record.action,
        sha1: typeof record.sha1 === 'string' ? record.sha1 : undefined,
        // Tri-state: journals written before this field existed leave it
        // undefined — "unknown" must not be treated as "did not exist".
        oldExists:
          record.oldExists === true ? true : record.oldExists === false ? false : undefined,
        oldHash: typeof record.oldHash === 'string' ? record.oldHash : undefined,
        done: record.done === true,
        rolledBack: record.rolledBack === true,
      };
    })
    .filter((item): item is CommitJournalEntry => Boolean(item));
  const phase = (raw as { phase?: unknown }).phase;
  return {
    generation: raw.generation,
    phase: phase === 'rollback' ? 'rollback' : 'commit',
    entries,
  };
}

/**
 * Apply one journal entry's staged→live move, then flip its `done` flag.
 * Assumes the staged file exists for 'commit' entries — callers verify first.
 */
function applyJournalEntry(
  storageRoot: string,
  stagingDir: string,
  backupDir: string,
  journal: CommitJournal,
  entry: CommitJournalEntry
): void {
  const staged = path.join(stagingDir, entry.name);
  const live = path.join(storageRoot, entry.name);
  const backup = path.join(backupDir, entry.name);
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(live)) {
    if (fs.existsSync(backup)) {
      fs.rmSync(backup, { force: true });
    }
    fs.renameSync(live, backup);
  }
  if (entry.action === 'commit') {
    fs.renameSync(staged, live);
  }
  entry.done = true;
  writeJournal(stagingDir, journal);
}

/**
 * Swap a fully-built staging directory into the live storage root.
 * Writes the commit journal first, then applies each file move with
 * per-entry progress — safe to re-run after a crash mid-commit.
 */
export function commitStagedGeneration(storageRoot: string, generation: number): void {
  const stagingDir = path.join(storageRoot, STAGING_DIR_NAME);
  const backupDir = path.join(storageRoot, BACKUP_DIR_NAME);
  const journal: CommitJournal = {
    generation,
    phase: 'commit',
    entries: GENERATED_FILE_NAMES.map((name) => {
      const staged = path.join(stagingDir, name);
      const live = path.join(storageRoot, name);
      const liveExists = fs.existsSync(live);
      // The pre-commit existence and hash are recorded up front — rollback
      // must never infer "the old file did not exist" from content equality.
      const preState = {
        oldExists: liveExists,
        oldHash: liveExists ? sha1OfFile(live) : undefined,
      };
      return fs.existsSync(staged)
        ? { name, action: 'commit' as const, sha1: sha1OfFile(staged), ...preState, done: false }
        : { name, action: 'delete' as const, ...preState, done: false };
    }),
  };
  // The journal exists before any live file moves — it is what makes a crash
  // mid-swap resumable rather than ambiguous.
  writeJournal(stagingDir, journal);
  runJournal(storageRoot, stagingDir, backupDir, journal);
  verifyCommittedGeneration(storageRoot, journal);
  finishCommit(storageRoot, stagingDir, backupDir, journal.generation);
}

/** Replay a journal to completion. Throws when a committed file is lost. */
function runJournal(
  storageRoot: string,
  stagingDir: string,
  backupDir: string,
  journal: CommitJournal
): void {
  for (const entry of journal.entries) {
    if (entry.done) {
      continue;
    }
    const staged = path.join(stagingDir, entry.name);
    const live = path.join(storageRoot, entry.name);
    if (entry.action === 'commit') {
      if (!fs.existsSync(staged)) {
        // The staged file is gone but the swap was never marked done — either
        // the staged→live rename already happened (live matches the recorded
        // sha1) or the candidate is genuinely lost and the commit is torn.
        if (fs.existsSync(live) && entry.sha1 && sha1OfFile(live) === entry.sha1) {
          entry.done = true;
          writeJournal(stagingDir, journal);
          continue;
        }
        throw new Error(`memory.commit.lostStagedFile:${entry.name}`);
      }
    } else if (!fs.existsSync(live)) {
      // 'delete' whose target is already gone — nothing left to do.
      entry.done = true;
      writeJournal(stagingDir, journal);
      continue;
    }
    applyJournalEntry(storageRoot, stagingDir, backupDir, journal, entry);
  }
}

/**
 * Post-condition of a completed forward pass: every 'commit' entry's live
 * file must hash to the staged content, and every 'delete' entry's live file
 * must be absent. Claiming 'committed' on anything else would certify a
 * mixed generation — a torn or rolled-back file must instead send recovery
 * down the rollback path.
 */
function verifyCommittedGeneration(storageRoot: string, journal: CommitJournal): void {
  for (const entry of journal.entries) {
    const live = path.join(storageRoot, entry.name);
    if (entry.action === 'commit') {
      if (!fs.existsSync(live) || !entry.sha1 || sha1OfFile(live) !== entry.sha1) {
        throw new Error(`memory.commit.verifyFailed:${entry.name}`);
      }
    } else if (fs.existsSync(live)) {
      throw new Error(`memory.commit.verifyFailed:${entry.name}`);
    }
  }
}

function finishCommit(
  storageRoot: string,
  stagingDir: string,
  backupDir: string,
  generation: number
): void {
  writeGeneration(storageRoot, generation);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
}

/**
 * Roll a partially-applied journal back to the complete old generation.
 * The rollback direction is persisted (`phase: 'rollback'`) BEFORE the first
 * restore, and every file's rollback is journaled (`rolledBack`) right after
 * it lands — a crash mid-rollback therefore resumes the same direction and
 * never re-runs the forward journal against already-restored files.
 *
 * Per-entry rules (idempotent):
 * - backup exists → restore it over whatever live holds (covers the torn
 *   live→backup / staged→live window);
 * - no backup and live already matches the recorded old hash → done;
 * - no backup, oldExists=false, and live provably holds the staged content →
 *   the file was created by this commit: removing it restores the old
 *   absence. Content equality alone never proves that;
 * - no backup and live content is neither the old nor the staged file → the
 *   old generation cannot be reconstructed: stop and preserve materials.
 */
function rollbackJournal(
  storageRoot: string,
  stagingDir: string,
  backupDir: string,
  journal: CommitJournal
): void {
  journal.phase = 'rollback';
  writeJournal(stagingDir, journal);
  for (const entry of [...journal.entries].reverse()) {
    if (entry.rolledBack) {
      continue;
    }
    const live = path.join(storageRoot, entry.name);
    const backup = path.join(backupDir, entry.name);
    const staged = path.join(stagingDir, entry.name);
    try {
      if (fs.existsSync(backup)) {
        if (fs.existsSync(live)) {
          fs.rmSync(live, { force: true });
        }
        fs.renameSync(backup, live);
        entry.rolledBack = true;
        writeJournal(stagingDir, journal);
        continue;
      }
      const liveExists = fs.existsSync(live);
      const liveHash = liveExists ? sha1OfFile(live) : undefined;
      const stagedSha = entry.sha1 ?? (fs.existsSync(staged) ? sha1OfFile(staged) : undefined);
      if (entry.oldExists === true && entry.oldHash && liveHash === entry.oldHash) {
        // Already the old content — the earlier restore landed but its
        // rolledBack write crashed, or the entry never ran.
        entry.rolledBack = true;
      } else if (
        entry.oldExists === false &&
        entry.action === 'commit' &&
        stagedSha &&
        liveHash === stagedSha
      ) {
        // Provably created by this commit — removing restores the absence.
        fs.rmSync(live, { force: true });
        entry.rolledBack = true;
      } else if (!liveExists && entry.oldExists !== true) {
        // Nothing live and nothing was expected (or legacy-unknown) → old
        // state already holds.
        entry.rolledBack = true;
      } else if (entry.oldExists !== false && liveExists && !entry.oldHash) {
        // Legacy journal without oldHash — cannot prove the live file is
        // new, so leaving it is the safe rollback.
        entry.rolledBack = true;
      } else {
        // Live holds new-generation content but no backup remains, or the
        // old file vanished with nothing to restore it from.
        throw new Error(`memory.commit.rollbackLost:${entry.name}`);
      }
      writeJournal(stagingDir, journal);
    } catch (error) {
      writeJournal(stagingDir, journal);
      throw error;
    }
  }
  // Certify the restored generation before destroying recovery materials:
  // every file must now hold exactly its recorded old state.
  for (const entry of journal.entries) {
    const live = path.join(storageRoot, entry.name);
    if (entry.oldExists === true && entry.oldHash) {
      if (!fs.existsSync(live) || sha1OfFile(live) !== entry.oldHash) {
        throw new Error(`memory.commit.rollbackVerify:${entry.name}`);
      }
    } else if (entry.oldExists === false && fs.existsSync(live)) {
      throw new Error(`memory.commit.rollbackVerify:${entry.name}`);
    }
    // Legacy entries with unknown oldExists are left as-is — unprovable.
  }
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
}

/** True when a staging dir holds a marked (journaled) commit in progress. */
export function hasPendingCommit(storageRoot: string): boolean {
  const stagingDir = path.join(storageRoot, STAGING_DIR_NAME);
  return fs.existsSync(stagingDir) && fs.existsSync(journalPathFor(stagingDir));
}

/**
 * Boot-time (or post-commit-failure) recovery. Called before any store is
 * constructed:
 * - staging + journal → a committed swap crashed mid-move: finish it; if a
 *   staged file is unrecoverable, roll the applied entries back instead.
 * - staging without journal → candidate build never committed: discard it.
 * - backup without staging → interrupted very early: restore missing files.
 *
 * Returns the outcome so a failed `commitStagedGeneration` caller can tell an
 * actually-landed commit ('committed') from a restored previous generation
 * ('rolled_back') and report commit errors honestly. 'unresolved' means even
 * the rollback could not finish — journal, staging, and backup are preserved
 * for the next recovery attempt, and the caller must report a commit error.
 */
export function recoverPendingGeneration(
  storageRoot: string
): 'committed' | 'rolled_back' | 'unresolved' | 'none' {
  const stagingDir = path.join(storageRoot, STAGING_DIR_NAME);
  const backupDir = path.join(storageRoot, BACKUP_DIR_NAME);

  if (fs.existsSync(stagingDir)) {
    const journal = readJournal(stagingDir);
    if (journal) {
      // A journal already in the rollback phase MUST continue rolling back —
      // resuming forward would certify a mixed old/new generation.
      if (journal.phase === 'rollback') {
        logWarn('[Memory] Resuming interrupted commit rollback');
        try {
          rollbackJournal(storageRoot, stagingDir, backupDir, journal);
        } catch (rollbackError) {
          logWarn(
            '[Memory] Rollback incomplete; recovery materials preserved for the next attempt',
            rollbackError
          );
          return 'unresolved';
        }
        return 'rolled_back';
      }
      logWarn('[Memory] Resuming interrupted staged commit');
      try {
        runJournal(storageRoot, stagingDir, backupDir, journal);
        verifyCommittedGeneration(storageRoot, journal);
        finishCommit(storageRoot, stagingDir, backupDir, journal.generation);
        return 'committed';
      } catch (error) {
        logWarn(
          '[Memory] Staged commit is unrecoverable; rolling back to the previous generation',
          error
        );
        try {
          rollbackJournal(storageRoot, stagingDir, backupDir, journal);
        } catch (rollbackError) {
          logWarn(
            '[Memory] Rollback incomplete; recovery materials preserved for the next attempt',
            rollbackError
          );
          return 'unresolved';
        }
        return 'rolled_back';
      }
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
    restoreBackup(storageRoot);
    return 'none';
  }
  if (fs.existsSync(backupDir)) {
    restoreBackup(storageRoot);
  }
  return 'none';
}

// ---------------------------------------------------------------------------
// Ordinary-ingest commit protection
//
// An ingestion commit is a short synchronous critical section — every await
// (extraction, embeddings) happens before it — but a process crash can still
// land between two file writes. A write-ahead undo record makes that window
// durable: the pre-commit bytes of every touched file are persisted BEFORE
// the first mutation and the record is deleted only after the last write.
// Recovery replays the undo record to restore the complete pre-commit state.
// ---------------------------------------------------------------------------

const INGEST_UNDO_NAME = 'ingest_undo.json';

/** Files an ordinary ingest commit may mutate — all journaled. */
export const INGEST_COMMITTED_FILE_NAMES = [
  ...GENERATED_FILE_NAMES,
  'memory_manual_overlays.json',
  'memory_tombstones.json',
] as const;

interface IngestUndoFile {
  files?: Array<{ name: string; exists: boolean; contentBase64?: string }>;
}

function ingestUndoPathFor(storageRoot: string): string {
  return path.join(storageRoot, INGEST_UNDO_NAME);
}

/** Persist the pre-commit bytes of every committable file. Sync by design. */
export function writeIngestUndo(storageRoot: string): void {
  const files = INGEST_COMMITTED_FILE_NAMES.map((name) => {
    const filePath = path.join(storageRoot, name);
    return fs.existsSync(filePath)
      ? { name, exists: true, contentBase64: fs.readFileSync(filePath).toString('base64') }
      : { name, exists: false };
  });
  saveJsonFile(ingestUndoPathFor(storageRoot), { files });
}

export function clearIngestUndo(storageRoot: string): void {
  fs.rmSync(ingestUndoPathFor(storageRoot), { force: true });
}

export function hasPendingIngestUndo(storageRoot: string): boolean {
  return fs.existsSync(ingestUndoPathFor(storageRoot));
}

/**
 * Restore every journaled file to its pre-commit bytes. 'unresolved' keeps
 * the undo record for the next attempt — recovery materials are never
 * destroyed while the pre-commit state is not fully restored.
 */
export function recoverPendingIngest(storageRoot: string): 'restored' | 'unresolved' | 'none' {
  const undoPath = ingestUndoPathFor(storageRoot);
  if (!fs.existsSync(undoPath)) {
    return 'none';
  }
  const raw = loadJsonFile<IngestUndoFile>(undoPath, {});
  const files = Array.isArray(raw.files) ? raw.files : [];
  let failed = false;
  for (const item of files) {
    if (!item || typeof item.name !== 'string') {
      continue;
    }
    const filePath = path.join(storageRoot, item.name);
    try {
      if (item.exists && typeof item.contentBase64 === 'string') {
        fs.writeFileSync(filePath, Buffer.from(item.contentBase64, 'base64'));
      } else {
        fs.rmSync(filePath, { force: true });
      }
    } catch (error) {
      failed = true;
      logWarn('[Memory] Failed to restore pre-commit file during ingest recovery:', error);
    }
  }
  if (failed) {
    return 'unresolved';
  }
  fs.rmSync(undoPath, { force: true });
  return 'restored';
}

function restoreBackup(storageRoot: string): void {
  const backupDir = path.join(storageRoot, BACKUP_DIR_NAME);
  if (!fs.existsSync(backupDir)) {
    return;
  }
  let restoredAll = true;
  for (const name of GENERATED_FILE_NAMES) {
    const live = path.join(storageRoot, name);
    const backup = path.join(backupDir, name);
    try {
      if (!fs.existsSync(live) && fs.existsSync(backup)) {
        fs.renameSync(backup, live);
      }
    } catch {
      restoredAll = false;
    }
  }
  // Keep the backup dir when a restore failed — it is the only copy left.
  if (restoredAll) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}
