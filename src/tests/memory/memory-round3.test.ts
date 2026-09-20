import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfigState = vi.hoisted(() => ({
  config: {
    provider: 'openrouter',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    customProtocol: 'anthropic',
    model: 'anthropic/claude-sonnet-4-6',
    activeProfileKey: 'openrouter',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'light',
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: '',
        timeoutMs: 180000,
      },
      embedding: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: 'text-embedding-3-small',
        timeoutMs: 180000,
      },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 2,
      storageRoot: '',
    },
    enableThinking: false,
    isConfigured: true,
  } as Record<string, unknown>,
}));

const fsControl = vi.hoisted(() => ({
  /** When set, renameSync throws for destinations matching the predicate. */
  failRenameDest: null as null | ((dest: string) => boolean),
  /** When set, rmSync throws for targets matching the predicate. */
  failRmTarget: null as null | ((target: string) => boolean),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync = (...args: Parameters<typeof actual.renameSync>) => {
    if (fsControl.failRenameDest?.(String(args[1]))) {
      throw new Error('injected rename failure');
    }
    return actual.renameSync(...args);
  };
  const rmSync = (...args: Parameters<typeof actual.rmSync>) => {
    if (fsControl.failRmTarget?.(String(args[0]))) {
      throw new Error('injected rm failure');
    }
    return actual.rmSync(...args);
  };
  const cjsDefault = (actual as { default?: Record<string, unknown> }).default;
  return {
    ...actual,
    default: cjsDefault ? { ...cjsDefault, renameSync, rmSync } : actual,
    renameSync,
    rmSync,
  };
});

const mockLLMState = vi.hoisted(() => ({
  coreResponder: null as null | ((userPrompt: string) => string),
  experienceResponder: null as null | ((userPrompt: string) => string),
  navigatorResponder: null as null | ((userPrompt: string) => string | Promise<string>),
  /** When set, the core extractor call blocks until it resolves. */
  coreGate: null as null | Promise<void>,
  gateEntered: false,
  callCount: 0,
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp/sophron-test-app',
  },
}));

vi.mock('../../main/config/config-store', () => {
  const configStore = {
    getAll: () => ({ ...mockConfigState.config }),
    get: (key: string) => mockConfigState.config[key],
    update: (updates: Record<string, unknown>) => {
      mockConfigState.config = { ...mockConfigState.config, ...updates };
    },
    set: (key: string, value: unknown) => {
      mockConfigState.config = { ...mockConfigState.config, [key]: value };
    },
  };
  return {
    configStore,
    PROVIDER_PRESETS: {},
  };
});

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseInstance, MessageRow, SessionRow } from '../../main/db/database';
import type { MemoryRuntimeConfig } from '../../shared/contracts/config';
import { hasPendingCommit, recoverPendingGeneration } from '../../main/memory/memory-generation';
import type {
  MemoryCompletionRequest,
  MemoryLLMClientLike,
} from '../../main/memory/memory-llm-client';
import { MemoryService } from '../../main/memory/memory-service';
import { configStore } from '../../main/config/config-store';

class MockMemoryLLMClient implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    if (request.systemPrompt.includes('Memory Profiler')) {
      if (mockLLMState.coreGate) {
        mockLLMState.gateEntered = true;
        await mockLLMState.coreGate;
      }
      mockLLMState.callCount += 1;
      if (mockLLMState.coreResponder) {
        return { text: mockLLMState.coreResponder(request.userPrompt) };
      }
      const actions = [];
      if (request.userPrompt.includes('中文')) {
        actions.push({
          op: 'upsert',
          category: 'preferences',
          key: 'response_language',
          value: '中文',
          source_type: 'explicit_user_statement',
          source_turns: [1],
          confidence: 0.92,
        });
      }
      if (request.userPrompt.includes('Deutsch')) {
        actions.push({
          op: 'upsert',
          category: 'preferences',
          key: 'response_language',
          value: 'Deutsch',
          source_type: 'explicit_user_statement',
          source_turns: [1],
          confidence: 0.95,
        });
      }
      return { text: JSON.stringify({ actions }) };
    }

    if (request.systemPrompt.includes('memory retrieval navigator')) {
      if (mockLLMState.navigatorResponder) {
        return { text: await mockLLMState.navigatorResponder(request.userPrompt) };
      }
      return { text: JSON.stringify({ sufficient: true, reason: 'ok', actions: [] }) };
    }

    if (request.systemPrompt.includes('memory extraction system')) {
      if (mockLLMState.experienceResponder) {
        return { text: mockLLMState.experienceResponder(request.userPrompt) };
      }
      const turnCount = Math.max(
        1,
        (request.userPrompt.split('Session transcript:')[1] || '')
          .split('\n')
          .filter((line) => line.trim()).length
      );
      return {
        text: JSON.stringify({
          session_summary: '记录用户稳定偏好',
          session_keywords: ['preference'],
          session_confidence: 0.86,
          chunks: [
            {
              summary: '用户声明希望用中文回答',
              details: '对话中明确要求默认使用中文交流。',
              keywords: ['中文', '偏好'],
              source_turns: Array.from({ length: turnCount }, (_, index) => index + 1),
              confidence: 0.88,
            },
          ],
        }),
      };
    }

    return { text: '{}' };
  }

  async embed(): Promise<number[]> {
    return [];
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent_session_id TEXT,
      openai_thread_id TEXT,
      status TEXT NOT NULL,
      cwd TEXT,
      mounted_paths TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      execution_time_ms INTEGER
    );
  `);
}

function createDatabaseInstance(db: Database.Database): DatabaseInstance {
  return {
    raw: db,
    sessions: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(
        (id: string) =>
          db.prepare('SELECT * FROM sessions WHERE id = ? LIMIT 1').get(id) as
            | SessionRow
            | undefined
      ),
      getAll: vi.fn(
        () => db.prepare('SELECT * FROM sessions ORDER BY created_at ASC').all() as SessionRow[]
      ),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(
        (sessionId: string) =>
          db
            .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC')
            .all(sessionId) as MessageRow[]
      ),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    scheduledTasks: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      delete: vi.fn(),
    },
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    pragma: (pragma: string) => db.pragma(pragma),
    close: () => db.close(),
  } as DatabaseInstance;
}

function insertSession(
  db: Database.Database,
  payload: { id: string; title: string; cwd?: string; createdAt?: number }
): void {
  db.prepare(
    `INSERT INTO sessions (
      id, title, agent_session_id, openai_thread_id, status, cwd, mounted_paths, allowed_tools,
      memory_enabled, model, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, 'idle', ?, '[]', '[]', 1, NULL, ?, ?)`
  ).run(
    payload.id,
    payload.title,
    payload.cwd || null,
    payload.createdAt || 1000,
    payload.createdAt || 1000
  );
}

function insertMessage(
  db: Database.Database,
  payload: { id: string; sessionId: string; role: string; text: string; timestamp: number }
): void {
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, timestamp, token_usage, execution_time_ms)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`
  ).run(
    payload.id,
    payload.sessionId,
    payload.role,
    JSON.stringify([{ type: 'text', text: payload.text }]),
    payload.timestamp
  );
}

function makeSession(id: string, title: string, cwd?: string) {
  return {
    id,
    title,
    status: 'idle' as const,
    cwd,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeMessages(
  sessionId: string,
  items: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>
) {
  return items.map((item, index) => ({
    id: `${sessionId}-m-${index}`,
    sessionId,
    role: item.role,
    content: [{ type: 'text' as const, text: item.text }],
    timestamp: item.timestamp,
  }));
}

const DEFAULT_MESSAGES = (sessionId: string) =>
  makeMessages(sessionId, [
    { role: 'user', text: '请用中文回答，我叫 Jack。', timestamp: 1 },
    { role: 'assistant', text: '好的。', timestamp: 2 },
    { role: 'user', text: '我们修复了 gateway token rotation。', timestamp: 3 },
    { role: 'assistant', text: '已经完成 gateway token rotation。', timestamp: 4 },
  ]);

const storageRootRef = { current: '' };
const memoryRoot = () => path.join(storageRootRef.current, 'memory-root');

const GENERATED_FILES = [
  'core_memory.json',
  'project_memory.json',
  'experience_memory.json',
  'session_state.json',
];

function sha1Text(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function readJobsFile(root = memoryRoot()): {
  jobs: Record<
    string,
    {
      status: string;
      attempt: number;
      generation: number;
      transcriptRevision: string;
      nextRetryAt: number | null;
    }
  >;
} {
  const file = path.join(root, 'memory_ingestion_jobs.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  return fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>)
    : null;
}

describe('memory round-3 review fixes', () => {
  let rawDb: Database.Database;
  let db: DatabaseInstance;
  let service: MemoryService;

  beforeEach(() => {
    mockLLMState.coreResponder = null;
    mockLLMState.experienceResponder = null;
    mockLLMState.navigatorResponder = null;
    mockLLMState.coreGate = null;
    mockLLMState.gateEntered = false;
    mockLLMState.callCount = 0;
    fsControl.failRenameDest = null;
    fsControl.failRmTarget = null;
    storageRootRef.current = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-memory-r3-'));
    rawDb = new Database(':memory:');
    createSchema(rawDb);
    db = createDatabaseInstance(rawDb);
    service = new MemoryService(db, { llmClient: new MockMemoryLLMClient() });
    configStore.update({
      memoryEnabled: true,
      memoryRuntime: {
        llm: { inheritFromActive: true, apiKey: '', baseUrl: '', model: '', timeoutMs: 180000 },
        embedding: {
          inheritFromActive: true,
          apiKey: '',
          baseUrl: '',
          model: 'text-embedding-3-small',
          timeoutMs: 180000,
        },
        useEmbedding: false,
        maxNavSteps: 2,
        ingestionConcurrency: 2,
        storageRoot: memoryRoot(),
      },
    });
  });

  afterEach(async () => {
    await service.drain();
    vi.useRealTimers();
    vi.restoreAllMocks();
    rawDb.close();
    fs.rmSync(storageRootRef.current, { recursive: true, force: true });
  });

  // R3-01: rollback must never infer "the old file did not exist" from content
  // equality — a file the commit never touched keeps its old content.
  it('R3-01a: rollback preserves an untouched file whose new content equals the old', () => {
    const root = memoryRoot();
    const staging = path.join(root, '.staging-rebuild');
    const backup = path.join(root, '.backup-rebuild');
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(backup, { recursive: true });

    for (const name of GENERATED_FILES) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
      fs.writeFileSync(path.join(staging, name), JSON.stringify({ new: name }));
    }
    // session_state is regenerated byte-identical — the pre-fix rollback used
    // sha equality to conclude "newly created" and deleted the live file.
    const sameContent = JSON.stringify({ same: true });
    fs.writeFileSync(path.join(root, 'session_state.json'), sameContent);
    fs.writeFileSync(path.join(staging, 'session_state.json'), sameContent);

    // core committed (done), project staged lost → runJournal throws → rollback.
    fs.renameSync(path.join(root, 'core_memory.json'), path.join(backup, 'core_memory.json'));
    fs.renameSync(path.join(staging, 'core_memory.json'), path.join(root, 'core_memory.json'));
    fs.rmSync(path.join(staging, 'project_memory.json'));

    fs.writeFileSync(
      path.join(staging, 'commit_journal.json'),
      JSON.stringify({
        generation: 3,
        entries: GENERATED_FILES.map((name) => ({
          name,
          action: 'commit',
          // The journal records the STAGED content hash — hashing whatever
          // file happens to exist would make a lost staged file look
          // "already committed".
          sha1: sha1Text(
            name === 'session_state.json' ? sameContent : JSON.stringify({ new: name })
          ),
          oldExists: true,
          oldHash: sha1Text(
            name === 'session_state.json' ? sameContent : JSON.stringify({ old: name })
          ),
          done: name === 'core_memory.json',
        })),
      })
    );

    const outcome = recoverPendingGeneration(root);
    expect(outcome).toBe('rolled_back');
    expect(readJsonFile(path.join(root, 'session_state.json'))).toEqual({ same: true });
    expect(readJsonFile(path.join(root, 'core_memory.json'))).toEqual({ old: 'core_memory.json' });
    expect(fs.existsSync(staging)).toBe(false);
  });

  it('R3-01b: legacy journal without oldExists never deletes an untouched file', () => {
    const root = memoryRoot();
    const staging = path.join(root, '.staging-rebuild');
    const backup = path.join(root, '.backup-rebuild');
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(backup, { recursive: true });

    for (const name of GENERATED_FILES) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
      fs.writeFileSync(path.join(staging, name), JSON.stringify({ new: name }));
    }
    // session_state regenerated byte-identical: the untouched file whose
    // staged content equals live content is the regression case.
    const sameContent = JSON.stringify({ same: true });
    fs.writeFileSync(path.join(root, 'session_state.json'), sameContent);
    fs.writeFileSync(path.join(staging, 'session_state.json'), sameContent);
    fs.rmSync(path.join(staging, 'project_memory.json'));

    // Journal written by the pre-oldExists format — the field is unknown, so
    // rollback must conservatively keep every file it cannot prove is new.
    fs.writeFileSync(
      path.join(staging, 'commit_journal.json'),
      JSON.stringify({
        generation: 3,
        entries: GENERATED_FILES.map((name) => ({
          name,
          action: 'commit',
          sha1: sha1Text(
            name === 'session_state.json' ? sameContent : JSON.stringify({ new: name })
          ),
          done: false,
        })),
      })
    );

    const outcome = recoverPendingGeneration(root);
    expect(outcome).toBe('rolled_back');
    for (const name of GENERATED_FILES) {
      expect(readJsonFile(path.join(root, name))).toEqual(
        name === 'session_state.json' ? { same: true } : { old: name }
      );
    }
  });

  it('R3-01c: rollback removes only files provably created by the torn commit', () => {
    const root = memoryRoot();
    const staging = path.join(root, '.staging-rebuild');
    fs.mkdirSync(staging, { recursive: true });

    // Old generation lacks project_memory.json entirely.
    for (const name of GENERATED_FILES) {
      if (name === 'project_memory.json') {
        continue;
      }
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
      fs.writeFileSync(path.join(staging, name), JSON.stringify({ new: name }));
    }
    fs.writeFileSync(
      path.join(staging, 'project_memory.json'),
      JSON.stringify({ new: 'project_memory.json' })
    );

    // project staged→live completed but the done write crashed (live holds the
    // staged content, staged file gone); experience staged is lost → rollback.
    fs.renameSync(
      path.join(staging, 'project_memory.json'),
      path.join(root, 'project_memory.json')
    );
    fs.rmSync(path.join(staging, 'experience_memory.json'));

    fs.writeFileSync(
      path.join(staging, 'commit_journal.json'),
      JSON.stringify({
        generation: 4,
        entries: GENERATED_FILES.map((name) => ({
          name,
          action: 'commit',
          sha1: sha1Text(JSON.stringify({ new: name })),
          oldExists: name !== 'project_memory.json',
          done: false,
        })),
      })
    );

    const outcome = recoverPendingGeneration(root);
    expect(outcome).toBe('rolled_back');
    // The file created by the torn commit is removed — old generation absence
    // restored — while the untouched old files survive.
    expect(fs.existsSync(path.join(root, 'project_memory.json'))).toBe(false);
    expect(readJsonFile(path.join(root, 'session_state.json'))).toEqual({
      old: 'session_state.json',
    });
    expect(readJsonFile(path.join(root, 'core_memory.json'))).toEqual({ old: 'core_memory.json' });
  });

  it('R3-01d: an unresolved recovery preserves materials and blocks the next transition', async () => {
    const root = memoryRoot();
    const staging = path.join(root, '.staging-rebuild');
    const backup = path.join(root, '.backup-rebuild');
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(backup, { recursive: true });

    for (const name of GENERATED_FILES) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
      fs.writeFileSync(path.join(staging, name), JSON.stringify({ new: name }));
    }
    fs.rmSync(path.join(staging, 'project_memory.json'));
    // core half-applied: old in backup, live holds nothing yet (staged still present).
    fs.renameSync(path.join(root, 'core_memory.json'), path.join(backup, 'core_memory.json'));

    fs.writeFileSync(
      path.join(staging, 'commit_journal.json'),
      JSON.stringify({
        generation: 5,
        entries: GENERATED_FILES.map((name) => ({
          name,
          action: 'commit',
          sha1: sha1Text(JSON.stringify({ new: name })),
          oldExists: true,
          oldHash: sha1Text(JSON.stringify({ old: name })),
          done: false,
        })),
      })
    );

    // Rollback's restore rename (backup→live) fails for core → unresolved;
    // journal/staging/backup must ALL survive for the next attempt.
    fsControl.failRenameDest = (dest) => dest === path.join(root, 'core_memory.json');
    expect(recoverPendingGeneration(root)).toBe('unresolved');
    expect(hasPendingCommit(root)).toBe(true);
    expect(fs.existsSync(path.join(backup, 'core_memory.json'))).toBe(true);

    // While recovery is unresolved a rebuild must refuse to wipe the evidence.
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await expect(service.rebuildAll()).rejects.toThrow('memory.commit.pendingRecovery');
    expect(hasPendingCommit(root)).toBe(true);

    // Heal → recovery rolls back cleanly; a retrying rebuild succeeds.
    fsControl.failRenameDest = null;
    expect(recoverPendingGeneration(root)).toBe('rolled_back');
    expect(readJsonFile(path.join(root, 'core_memory.json'))).toEqual({ old: 'core_memory.json' });
  });

  // R3-02: a storage-root switch mid-extraction fences the commit — bound
  // stores can never write old-root data into the new root.
  it('R3-02: an in-flight job cannot commit across a storage-root switch', async () => {
    const rootA = memoryRoot();
    insertSession(rawDb, { id: 's1', title: 'A' });
    const input = { session: makeSession('s1', 'A'), prompt: '', messages: DEFAULT_MESSAGES('s1') };

    let release!: () => void;
    mockLLMState.coreGate = new Promise((resolve) => {
      release = resolve;
    });
    const enqueuePromise = service.enqueueIngestion(input);
    await vi.waitFor(() => expect(mockLLMState.gateEntered).toBe(true));

    // Switch the storage root while the core extraction is in flight.
    const rootB = path.join(storageRootRef.current, 'memory-root-b');
    configStore.update({
      memoryRuntime: {
        ...(mockConfigState.config.memoryRuntime as Record<string, unknown>),
        storageRoot: rootB,
      } as MemoryRuntimeConfig,
    });
    release();
    await enqueuePromise;
    await service.drain();

    // Root B must not gain session s1's memory — the job was never authorized
    // for B. Root A keeps the job pending (resumable) with no torn writes.
    const bExperience = readJsonFile(path.join(rootB, 'experience_memory.json'));
    expect(!bExperience || !JSON.stringify(bExperience).includes('s1')).toBe(true);
    const aCore = readJsonFile(path.join(rootA, 'core_memory.json'));
    expect(!aCore || !JSON.stringify(aCore).includes('response_language')).toBe(true);
    const jobsA = readJobsFile(rootA);
    expect(jobsA.jobs.s1?.status).toBe('pending');
  });

  // R3-03: a mid-commit disk failure rolls the whole commit back — layers can
  // never split across revisions; healing retries into a complete new state.
  it('R3-03: a disk error mid-commit restores the complete previous state', async () => {
    insertSession(rawDb, { id: 's1', title: 'A' });
    const input = { session: makeSession('s1', 'A'), prompt: '', messages: DEFAULT_MESSAGES('s1') };

    // Fail only the experience file's tmp→live rename inside the memory root.
    fsControl.failRenameDest = (dest) => {
      const base = dest.split('/').pop() || '';
      return base === 'experience_memory.json' && path.dirname(dest) === memoryRoot();
    };
    await service.enqueueIngestion(input);
    await service.drain();

    const core = readJsonFile(path.join(memoryRoot(), 'core_memory.json'));
    expect(!core || !JSON.stringify(core).includes('response_language')).toBe(true);
    expect(fs.existsSync(path.join(memoryRoot(), 'experience_memory.json'))).toBe(false);
    const state = readJsonFile(path.join(memoryRoot(), 'session_state.json')) as {
      sessions?: Record<string, { lastProcessedMessageCount?: number; lastError?: string | null }>;
    };
    expect(state?.sessions?.s1?.lastProcessedMessageCount ?? 0).toBe(0);
    expect(state?.sessions?.s1?.lastError).toBeTruthy();

    // Heal and retry — the whole bundle commits under one revision.
    fsControl.failRenameDest = null;
    await service.enqueueIngestion(input);
    await service.drain();

    const healedCore = readJsonFile(path.join(memoryRoot(), 'core_memory.json'));
    expect(JSON.stringify(healedCore)).toContain('response_language');
    const healedExp = readJsonFile(path.join(memoryRoot(), 'experience_memory.json'));
    expect(JSON.stringify(healedExp)).toContain('s1');
    const healedState = readJsonFile(path.join(memoryRoot(), 'session_state.json')) as {
      sessions?: Record<string, { lastTranscriptHash?: string }>;
    };
    expect(healedState?.sessions?.s1?.lastTranscriptHash).toBeTruthy();
  });

  // R3-04: a manual delete is a forgetting rule for every write path — an
  // inferred re-statement under different wording cannot resurrect the fact,
  // while a genuinely new explicit user statement may.
  it('R3-04: deleted facts stay deleted across normal ingest; explicit re-assertion revives', async () => {
    insertSession(rawDb, { id: 's1', title: 'A' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.drain();
    const key = service
      .listCoreEntries()
      .find((entry) => entry.combinedKey.includes('response_language'))?.combinedKey;
    expect(key).toBeTruthy();
    service.deleteCoreEntry(key as string);
    expect(service.listCoreEntries().some((entry) => entry.combinedKey === key)).toBe(false);

    // Re-derived as INFERENCE with different wording — the delete overlay must
    // suppress it even though the value-hash tombstone does not match.
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'preferences',
            key: 'response_language',
            value: '默认使用中文回复',
            source_type: 'llm_inference',
            confidence: 0.6,
          },
        ],
      });
    insertSession(rawDb, { id: 's2', title: 'B' });
    await service.enqueueIngestion({
      session: makeSession('s2', 'B'),
      prompt: '',
      messages: makeMessages('s2', [
        { role: 'user', text: '继续处理', timestamp: 10 },
        { role: 'assistant', text: '好的', timestamp: 11 },
      ]),
    });
    await service.drain();
    expect(service.listCoreEntries().some((entry) => entry.combinedKey === key)).toBe(false);

    // A NEW explicit user statement (timestamped after the delete) is a
    // deliberate re-assertion: it lifts the overlay and lands the value.
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'preferences',
            key: 'response_language',
            value: 'English only',
            source_type: 'explicit_user_statement',
            source_turns: [1],
            confidence: 0.95,
          },
        ],
      });
    insertSession(rawDb, { id: 's3', title: 'C' });
    await service.enqueueIngestion({
      session: makeSession('s3', 'C'),
      prompt: '',
      messages: makeMessages('s3', [
        { role: 'user', text: 'From now on reply in English only', timestamp: Date.now() + 60_000 },
        { role: 'assistant', text: 'Understood.', timestamp: Date.now() + 61_000 },
      ]),
    });
    await service.drain();
    const revived = service.listCoreEntries().find((entry) => entry.combinedKey === key);
    expect(revived?.value).toBe('English only');
  });

  // R3-05: disabling memory pauses the persisted backlog — no timer wakes the
  // model while disabled, and re-enabling resumes exactly where it stopped.
  it('R3-05: disabled memory never retries the model; re-enable resumes the backlog', async () => {
    vi.useFakeTimers({ now: Date.now() });
    insertSession(rawDb, { id: 's1', title: 'A' });
    // Replays rebuild input from the DB, so the session's messages must be
    // persisted there — not just passed to enqueue.
    DEFAULT_MESSAGES('s1').forEach((message, index) => {
      insertMessage(rawDb, {
        id: message.id,
        sessionId: 's1',
        role: message.role,
        text: (message.content[0] as { text: string }).text,
        timestamp: index + 1,
      });
    });
    mockLLMState.experienceResponder = () => 'not-json';

    await service.enqueueIngestion({
      session: makeSession('s1', 'A'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.drain();
    const callsAfterFailure = mockLLMState.callCount;
    expect(readJobsFile().jobs.s1?.status).toBe('pending');
    expect(readJobsFile().jobs.s1?.attempt).toBe(1);

    // Backoff expires while disabled — the wake-up must not reach the model.
    service.setEnabled(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockLLMState.callCount).toBe(callsAfterFailure);
    expect(readJobsFile().jobs.s1?.status).toBe('pending');
    expect(readJobsFile().jobs.s1?.attempt).toBe(1);

    // Re-enable → the paused job replays immediately and commits.
    mockLLMState.experienceResponder = null;
    service.setEnabled(true);
    await service.drain();
    expect(mockLLMState.callCount).toBeGreaterThan(callsAfterFailure);
    expect(readJobsFile().jobs.s1).toBeUndefined();
  });

  // R3-06: an explicit correction newer than a manual overlay supersedes it —
  // rebuilds must not resurrect the pre-correction manual value.
  it('R3-06: a newer explicit correction supersedes the manual overlay across rebuilds', async () => {
    insertSession(rawDb, { id: 's1', title: 'A' });
    // Rebuilds re-derive from the DB transcript — the messages must exist as
    // rows, not only inside the enqueued input.
    for (const message of DEFAULT_MESSAGES('s1')) {
      insertMessage(rawDb, {
        id: message.id,
        sessionId: 's1',
        role: message.role,
        text: message.content[0].text,
        timestamp: message.timestamp,
      });
    }
    await service.enqueueIngestion({
      session: makeSession('s1', 'A'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.drain();
    const key = service
      .listCoreEntries()
      .find((entry) => entry.combinedKey.includes('response_language'))?.combinedKey;
    expect(key).toBeTruthy();

    // Manual confirm/edit to English — the overlay is stamped at real now.
    service.updateCoreEntry(key as string, { value: 'English' });
    expect(service.listCoreEntries().find((entry) => entry.combinedKey === key)?.value).toBe(
      'English'
    );

    // Later the user explicitly corrects to Deutsch — a NEW transcript turn
    // whose effectiveAt is after the overlay was recorded.
    insertSession(rawDb, { id: 's2', title: 'B', createdAt: Date.now() + 30_000 });
    const correction = makeMessages('s2', [
      {
        role: 'user',
        text: 'Please switch to Deutsch from now on',
        timestamp: Date.now() + 60_000,
      },
      { role: 'assistant', text: 'Verstanden.', timestamp: Date.now() + 61_000 },
    ]);
    for (const message of correction) {
      insertMessage(rawDb, {
        id: message.id,
        sessionId: 's2',
        role: message.role,
        text: message.content[0].text,
        timestamp: message.timestamp,
      });
    }
    await service.enqueueIngestion({
      session: makeSession('s2', 'B'),
      prompt: '',
      messages: correction,
    });
    await service.drain();
    expect(service.listCoreEntries().find((entry) => entry.combinedKey === key)?.value).toBe(
      'Deutsch'
    );

    // The stale overlay must not resurrect English on a full rebuild.
    const result = await service.rebuildAll();
    expect(result.success).toBe(true);
    expect(service.listCoreEntries().find((entry) => entry.combinedKey === key)?.value).toBe(
      'Deutsch'
    );
  });

  // R3-07: the total budget is enforced on escaped text with the closing tag
  // always intact, and provenance reflects only the surviving item set.
  it('R3-07: escaped-budget reconcile keeps the closing tag and honest provenance', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/ws' });
    // Core entries whose escaped size blows the layer budget ('&' → '&amp;').
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'preferences',
            key: 'long_a',
            value: '&'.repeat(1500),
            source_type: 'explicit_user_statement',
            confidence: 0.9,
          },
          {
            op: 'upsert',
            category: 'preferences',
            key: 'long_b',
            value: '&'.repeat(1500),
            source_type: 'explicit_user_statement',
            confidence: 0.9,
          },
        ],
      });
    mockLLMState.experienceResponder = () =>
      JSON.stringify({
        session_summary: 'session &'.repeat(400),
        session_keywords: ['k'],
        session_confidence: 0.9,
        chunks: Array.from({ length: 12 }, (_, index) => ({
          summary: `chunk-${index} ${'&'.repeat(300)}`,
          details: 'd',
          keywords: ['k'],
          source_turns: [1],
          confidence: 0.8,
        })),
      });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/ws'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.drain();

    const prefix = await service.buildPromptPrefix(
      { cwd: '/repo/ws' },
      'gateway token rotation work'
    );
    expect(prefix.length).toBeLessThanOrEqual(16_000);
    // The closing tag can never be severed — no hard cut on the assembled text.
    expect(prefix).toContain('</memory_context>');
    expect(prefix).toContain('<memory_context>');

    const record = service.listInjections(1)[0];
    expect(record).toBeTruthy();
    // Every recorded key/id is actually present in the emitted body.
    for (const key of record.coreKeys) {
      expect(prefix).toContain(`- ${key}:`);
    }
    for (const key of record.projectKeys) {
      expect(prefix).toContain(`- ${key}:`);
    }
    for (const id of record.experienceChunkIds) {
      expect(prefix).toContain(`chunk_id=${id}`);
    }
    for (const id of record.experienceSessionIds) {
      expect(prefix).toContain(`session_id=${id}`);
    }
    expect(record.truncated).toBe(true);
  });

  // R3-08: the rebuild contract carries commitError through bridge → UI.
  it('R3-08: commit failure is declared in the shared contract and handled in the UI', () => {
    const electronApi = fs.readFileSync(
      path.resolve(process.cwd(), 'src/shared/contracts/electron-api.ts'),
      'utf8'
    );
    const memoryApi = fs.readFileSync(
      path.resolve(process.cwd(), 'src/preload/api/memory.ts'),
      'utf8'
    );
    const settings = fs.readFileSync(
      path.resolve(process.cwd(), 'src/renderer/components/settings/SettingsMemory.tsx'),
      'utf8'
    );
    const contracts = fs.readFileSync(
      path.resolve(process.cwd(), 'src/shared/contracts/memory/index.ts'),
      'utf8'
    );
    expect(contracts).toContain('MemoryRebuildResult');
    expect(contracts).toContain('commitError');
    expect(electronApi).toContain('MemoryRebuildResult');
    expect(memoryApi).toContain('MemoryRebuildResult');
    expect(settings).toContain('result.commitError');
    expect(settings).toContain('rebuildCommitFailed');
  });
});
