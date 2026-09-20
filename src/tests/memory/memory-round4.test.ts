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
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync = (...args: Parameters<typeof actual.renameSync>) => {
    if (fsControl.failRenameDest?.(String(args[1]))) {
      throw new Error('injected rename failure');
    }
    return actual.renameSync(...args);
  };
  const cjsDefault = (actual as { default?: Record<string, unknown> }).default;
  return {
    ...actual,
    default: cjsDefault ? { ...cjsDefault, renameSync } : actual,
    renameSync,
  };
});

const mockLLMState = vi.hoisted(() => ({
  coreResponder: null as null | ((userPrompt: string) => string),
  experienceResponder: null as null | ((userPrompt: string) => string),
  /** When set, the core extractor call blocks until it resolves. */
  coreGate: null as null | Promise<void>,
  gateEntered: false,
  callCount: 0,
  /** AbortSignal seen by the most recent core extraction call. */
  lastSignal: null as AbortSignal | null,
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
import type { DatabaseInstance, SessionRow } from '../../main/db/database';
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
      mockLLMState.lastSignal = request.signal ?? null;
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
            .all(sessionId) as import('../../main/db/database').MessageRow[]
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
  } as unknown as DatabaseInstance;
}

function insertSession(
  db: Database.Database,
  payload: { id: string; title: string; cwd?: string; createdAt?: number }
): void {
  const now = payload.createdAt ?? Date.now();
  db.prepare(
    `INSERT INTO sessions (id, title, status, cwd, created_at, updated_at)
     VALUES (?, ?, 'idle', ?, ?, ?)`
  ).run(payload.id, payload.title, payload.cwd ?? null, now, now);
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

function readOverlays(root = memoryRoot()): Array<Record<string, unknown>> {
  const file = path.join(root, 'memory_manual_overlays.json');
  if (!fs.existsSync(file)) {
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { overlays?: unknown[] };
  return (raw.overlays || []) as Array<Record<string, unknown>>;
}

async function waitFor(predicate: () => boolean, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('waitFor timed out');
}

describe('memory round-4 review fixes', () => {
  let rawDb: Database.Database;
  let db: DatabaseInstance;
  let service: MemoryService;

  beforeEach(() => {
    mockLLMState.coreResponder = null;
    mockLLMState.experienceResponder = null;
    mockLLMState.coreGate = null;
    mockLLMState.gateEntered = false;
    mockLLMState.callCount = 0;
    mockLLMState.lastSignal = null;
    fsControl.failRenameDest = null;
    storageRootRef.current = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-memory-r4-'));
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

  // R4-01: forward commit fails → partial rollback runs → the rollback itself
  // fails mid-way. Once the fault heals, recovery must continue the SAME
  // rollback direction — never resume the forward journal — and certify the
  // complete OLD generation before reporting 'rolled_back'.
  it('R4-01: recovery after a torn rollback continues the rollback, never re-commits', () => {
    const root = memoryRoot();
    const staging = path.join(root, '.staging-rebuild');
    const backup = path.join(root, '.backup-rebuild');
    fs.mkdirSync(staging, { recursive: true });

    for (const name of GENERATED_FILES) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
      fs.writeFileSync(path.join(staging, name), JSON.stringify({ new: name }));
    }
    fs.mkdirSync(backup, { recursive: true });

    // Journal mid-rollback: core's restore ALREADY landed (rolledBack —
    // backup consumed, live holds old content). project is next in line: its
    // forward swap completed, so live holds NEW content while backup still
    // holds the old file that must come back.
    fs.renameSync(path.join(root, 'project_memory.json'), path.join(backup, 'project_memory.json'));
    fs.renameSync(
      path.join(staging, 'project_memory.json'),
      path.join(root, 'project_memory.json')
    );

    const journal = {
      generation: 5,
      phase: 'rollback',
      entries: GENERATED_FILES.map((name) => ({
        name,
        action: 'commit',
        sha1: sha1Text(JSON.stringify({ new: name })),
        oldExists: true,
        oldHash: sha1Text(JSON.stringify({ old: name })),
        done: name === 'core_memory.json' || name === 'project_memory.json',
        rolledBack: name === 'core_memory.json',
      })),
    };
    fs.writeFileSync(path.join(staging, 'commit_journal.json'), JSON.stringify(journal));

    // project still holds NEW content (swap done, restore pending) — a
    // forward resume would leave it certified as committed.
    const outcome = recoverPendingGeneration(root);
    expect(outcome).toBe('rolled_back');
    for (const name of GENERATED_FILES) {
      expect(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')).old).toBe(name);
    }
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.existsSync(backup)).toBe(false);
  });

  // R4-01b: a journal with a recorded rollback failure recovers the second
  // time — materials are preserved between attempts and the final state is a
  // complete old generation, not a mixed one.
  it('R4-01b: failed rollback leaves materials for a later, complete recovery', () => {
    const root = memoryRoot();
    const staging = path.join(root, '.staging-rebuild');
    const backup = path.join(root, '.backup-rebuild');
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(backup, { recursive: true });

    for (const name of GENERATED_FILES) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
      fs.writeFileSync(path.join(staging, name), JSON.stringify({ new: name }));
    }
    // core forward swap landed; project staged file was lost mid-commit.
    fs.renameSync(path.join(root, 'core_memory.json'), path.join(backup, 'core_memory.json'));
    fs.renameSync(path.join(staging, 'core_memory.json'), path.join(root, 'core_memory.json'));
    fs.rmSync(path.join(staging, 'project_memory.json'));

    fs.writeFileSync(
      path.join(staging, 'commit_journal.json'),
      JSON.stringify({
        generation: 7,
        phase: 'commit',
        entries: GENERATED_FILES.map((name) => ({
          name,
          action: 'commit',
          sha1: sha1Text(JSON.stringify({ new: name })),
          oldExists: true,
          oldHash: sha1Text(JSON.stringify({ old: name })),
          done: name === 'core_memory.json',
        })),
      })
    );

    // First recovery: forward resume hits the lost staged project file →
    // rollback starts → restore of core lands → injected failure during the
    // SECOND restore... block the backup→live restore of project? There is no
    // project backup (it never went forward), so instead fail the core
    // restore by blocking its destination rename.
    fsControl.failRenameDest = (dest) => dest === path.join(root, 'core_memory.json');
    expect(recoverPendingGeneration(root)).toBe('unresolved');
    // Journal, staging, and the backup copies all survive the failed attempt.
    expect(hasPendingCommit(root)).toBe(true);
    expect(fs.existsSync(path.join(backup, 'core_memory.json'))).toBe(true);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(staging, 'commit_journal.json'), 'utf8')
    ) as { phase: string; entries: Array<{ name: string; rolledBack?: boolean }> };
    expect(persisted.phase).toBe('rollback');

    fsControl.failRenameDest = null;
    expect(recoverPendingGeneration(root)).toBe('rolled_back');
    for (const name of GENERATED_FILES) {
      expect(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')).old).toBe(name);
    }
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.existsSync(backup)).toBe(false);
  });

  // R4-02: a failing commit must roll back ONLY its own writes — a concurrent
  // task's already-committed memory must survive the recovery untouched.
  it('R4-02: a failed ingestion restores only its own commit, never a neighbour\u2019s', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    insertSession(rawDb, { id: 's2', title: 'B', cwd: '/repo/b' });

    // s2 stalls inside core extraction while s1 commits cleanly.
    let releaseS2!: () => void;
    const s2Gate = new Promise<void>((resolve) => {
      releaseS2 = resolve;
    });
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'preferences',
            key: 'response_language',
            value: '中文',
            source_type: 'explicit_user_statement',
            source_turns: [1],
            confidence: 0.92,
          },
        ],
      });
    let s2Entered!: () => void;
    const s2InExtractor = new Promise<void>((resolve) => {
      s2Entered = resolve;
    });
    const originalComplete = MockMemoryLLMClient.prototype.complete;
    vi.spyOn(MockMemoryLLMClient.prototype, 'complete').mockImplementation(async function (
      this: MockMemoryLLMClient,
      request: MemoryCompletionRequest
    ) {
      if (
        request.systemPrompt.includes('Memory Profiler') &&
        request.userPrompt.includes('Session ID: s2')
      ) {
        s2Entered();
        await s2Gate;
      }
      return originalComplete.call(this, request);
    });

    const p1 = service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s1'),
    });
    const p2 = service.enqueueIngestion({
      session: makeSession('s2', 'B', '/repo/b'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s2'),
    });
    await p1;
    await waitFor(() => s2InExtractor !== undefined && mockLLMState.callCount >= 1);

    // s2's commit fails part-way: the experience store's save dies after the
    // core store already wrote. Recovery restores s2's pre-commit bytes —
    // which already include s1's committed data.
    fsControl.failRenameDest = (dest) =>
      dest === path.join(memoryRoot(), 'experience_memory.json') ||
      dest === path.join(memoryRoot(), 'experience_memory.json.tmp');
    releaseS2();
    await p2;
    await service.drain();
    fsControl.failRenameDest = null;

    // s1's committed core entry survives s2's torn commit.
    const entries = service.listCoreEntries();
    expect(entries.some((entry) => entry.combinedKey.includes('response_language'))).toBe(true);
    // s2's failure is honest: its session-state error is recorded and the job
    // is retryable, but no partial s2 experience record exists on disk.
    expect(readJobsFile().jobs.s2?.status).toBe('pending');
  });

  // R4-03: an unrelated NEWER message must not let an OLD fact supersede a
  // newer manual edit — effectiveAt comes from the action's supporting turn,
  // not the session tail. No evidence binding → never supersedes.
  it('R4-03: evidence-bound effectiveAt keeps a newer manual edit over an old fact', async () => {
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

    // Manual edit lands AFTER the original statement — its timestamp is now.
    await service.updateCoreEntry(key as string, { value: 'English' });
    expect(service.listCoreEntries().find((entry) => entry.combinedKey === key)?.value).toBe(
      'English'
    );

    // A fresh delta arrives: an unrelated assistant message timestamped NOW.
    // The extractor re-derives the SAME old fact with evidence bound to the
    // OLD turn (index 1) — support time is old, so the overlay survives.
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'preferences',
            key: 'response_language',
            value: '中文',
            source_type: 'explicit_user_statement',
            source_turns: [1],
            confidence: 0.92,
          },
        ],
      });
    const replay = makeMessages('s1', [
      { role: 'user', text: '请用中文回答，我叫 Jack。', timestamp: 1 },
      { role: 'assistant', text: '好的。', timestamp: 2 },
      { role: 'user', text: '我们修复了 gateway token rotation。', timestamp: 3 },
      { role: 'assistant', text: '已经完成 gateway token rotation。', timestamp: 4 },
      { role: 'assistant', text: '顺带完成了 lint。', timestamp: Date.now() + 60_000 },
    ]);
    await service.enqueueIngestion({
      session: makeSession('s1', 'A'),
      prompt: '',
      messages: replay,
    });
    await service.drain();
    expect(service.listCoreEntries().find((entry) => entry.combinedKey === key)?.value).toBe(
      'English'
    );

    // An action WITHOUT evidence turns can never outrank a human edit either.
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'preferences',
            key: 'response_language',
            value: '中文',
            source_type: 'explicit_user_statement',
            confidence: 0.92,
          },
        ],
      });
    const replay2 = [...replay, { ...replay[4], id: 's1-m-5', timestamp: Date.now() + 120_000 }];
    await service.enqueueIngestion({
      session: makeSession('s1', 'A'),
      prompt: '',
      messages: replay2,
    });
    await service.drain();
    expect(service.listCoreEntries().find((entry) => entry.combinedKey === key)?.value).toBe(
      'English'
    );
  });

  // R4-04: supersede decisions recorded while building a rebuild candidate
  // must not touch the live overlay ledger until the candidate commits. A
  // failed candidate leaves every manual record byte-identical.
  it('R4-04: an abandoned rebuild never mutates the live manual overlay store', async () => {
    insertSession(rawDb, { id: 's1', title: 'A' });
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
    await service.updateCoreEntry(key as string, { value: 'English' });
    const overlaysBefore = readOverlays();
    expect(overlaysBefore.length).toBe(1);

    // s2 carries a newer explicit correction that WOULD supersede the
    // overlay — if the candidate ever committed. s3's core extraction
    // explodes mid-build, discarding the whole candidate.
    insertSession(rawDb, { id: 's2', title: 'B', createdAt: Date.now() + 30_000 });
    insertMessage(rawDb, {
      id: 's2-m-0',
      sessionId: 's2',
      role: 'user',
      text: 'Please switch to Deutsch from now on',
      timestamp: Date.now() + 60_000,
    });
    insertSession(rawDb, { id: 's3', title: 'C', createdAt: Date.now() + 40_000 });
    insertMessage(rawDb, {
      id: 's3-m-0',
      sessionId: 's3',
      role: 'user',
      text: 'unrelated topic entirely',
      timestamp: Date.now() + 70_000,
    });
    mockLLMState.coreResponder = (prompt) => {
      if (prompt.includes('Session ID: s3')) {
        return 'not-json';
      }
      return JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'preferences',
            key: 'response_language',
            value: prompt.includes('Deutsch') ? 'Deutsch' : '中文',
            source_type: 'explicit_user_statement',
            source_turns: [1],
            confidence: 0.95,
          },
        ],
      });
    };

    const result = await service.rebuildAll();
    expect(result.success).toBe(false);
    expect(result.committedSessionCount).toBe(0);
    // The live overlay file is byte-identical — the candidate's supersede
    // decision died with it.
    expect(readOverlays()).toEqual(overlaysBefore);
    expect(service.listCoreEntries().find((entry) => entry.combinedKey === key)?.value).toBe(
      'English'
    );
  });

  // R4-05: tombstones are timestamped — an explicit re-assertion of the SAME
  // value, with evidence newer than the deletion, lifts both the tombstone
  // and the delete overlay. A replay of the OLD evidence stays blocked.
  it('R4-05: a newer explicit same-value re-assertion revives a deleted fact', async () => {
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
    await service.deleteCoreEntry(key as string);
    expect(service.listCoreEntries().some((entry) => entry.combinedKey === key)).toBe(false);

    // Old-evidence replay: a different session whose supporting user turn
    // predates the deletion — the tombstone still blocks the same value.
    insertSession(rawDb, { id: 's2', title: 'B' });
    await service.enqueueIngestion({
      session: makeSession('s2', 'B'),
      prompt: '',
      messages: makeMessages('s2', [
        { role: 'user', text: '请用中文回答', timestamp: 10 },
        { role: 'assistant', text: '好的', timestamp: 11 },
      ]),
    });
    await service.drain();
    expect(service.listCoreEntries().some((entry) => entry.combinedKey === key)).toBe(false);

    // New explicit re-assertion of the SAME value, timestamped after the
    // delete: tombstone and delete overlay both lift, the fact lands again.
    insertSession(rawDb, { id: 's3', title: 'C' });
    await service.enqueueIngestion({
      session: makeSession('s3', 'C'),
      prompt: '',
      messages: makeMessages('s3', [
        { role: 'user', text: '请用中文回答', timestamp: Date.now() + 60_000 },
        { role: 'assistant', text: '好的', timestamp: Date.now() + 61_000 },
      ]),
    });
    await service.drain();
    const revived = service.listCoreEntries().find((entry) => entry.combinedKey === key);
    expect(revived?.value).toBe('中文');
    expect(readOverlays().length).toBe(0);
  });

  // R4-06: disabling memory aborts the in-flight provider call itself and
  // fences the commit — the job returns to pending (no attempt burned) and
  // replays on re-enable.
  it('R4-06: disabling mid-extraction aborts the call and resumes on re-enable', async () => {
    insertSession(rawDb, { id: 's1', title: 'A' });
    // The re-enabled replay rebuilds its input from the DB — the messages
    // must exist as rows, not only inside the enqueued input.
    for (const message of DEFAULT_MESSAGES('s1')) {
      insertMessage(rawDb, {
        id: message.id,
        sessionId: 's1',
        role: message.role,
        text: message.content[0].text,
        timestamp: message.timestamp,
      });
    }
    let releaseExtraction!: () => void;
    mockLLMState.coreGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });

    const pending = service.enqueueIngestion({
      session: makeSession('s1', 'A'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await waitFor(() => mockLLMState.gateEntered);

    // Disable while the provider call is in-flight.
    service.setEnabled(false);
    expect(mockLLMState.lastSignal?.aborted).toBe(true);
    releaseExtraction();
    await pending;
    await service.drain();

    // Nothing committed; the job went back to pending without burning an
    // attempt, and no provider call ran after the disable.
    const callsDuringDisable = mockLLMState.callCount;
    expect(service.listCoreEntries().length).toBe(0);
    const job = readJobsFile().jobs.s1;
    expect(job?.status).toBe('pending');
    expect(job?.attempt).toBe(0);

    service.setEnabled(true);
    await service.drain();
    expect(mockLLMState.callCount).toBeGreaterThan(callsDuringDisable);
    expect(service.listCoreEntries().length).toBeGreaterThan(0);
  });

  // R4-07: a rebuild that prepares sessions but fails to commit reports
  // prepared>0 yet committed=0 — the caller is never told sessions were
  // applied when the live generation was untouched.
  it('R4-07: a commit failure reports committed=0 while prepared counts stay honest', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
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
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: '',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.drain();
    const coreFile = path.join(memoryRoot(), 'core_memory.json');
    const liveBefore = fs.readFileSync(coreFile, 'utf8');

    // Every staged→live swap fails AND every rollback restore fails — the
    // recovery materials must be preserved and the counts must not claim any
    // session landed. Scoped to the four generated filenames so manifest and
    // journal bookkeeping still work.
    const generated = new Set(GENERATED_FILES);
    fsControl.failRenameDest = (dest) =>
      path.dirname(dest) === memoryRoot() && generated.has(path.basename(dest));
    let result;
    try {
      result = await service.rebuildWorkspace('/repo/a');
    } finally {
      fsControl.failRenameDest = null;
    }

    expect(result.success).toBe(false);
    expect(result.commitError).toBeTruthy();
    expect(result.failedSessionCount).toBe(0);
    expect(result.preparedSessionCount).toBe(1);
    expect(result.committedSessionCount).toBe(0);
    expect(hasPendingCommit(memoryRoot())).toBe(true);

    // Healing lets the next store open finish the recorded rollback — the
    // old generation is restored whole, and nothing was ever reported
    // committed. A fresh service mirrors the restart path (ensureStores runs
    // the recovery before loading files).
    const restarted = new MemoryService(db, { llmClient: new MockMemoryLLMClient() });
    expect(restarted.listCoreEntries().length).toBeGreaterThan(0);
    expect(fs.readFileSync(coreFile, 'utf8')).toBe(liveBefore);
    expect(hasPendingCommit(memoryRoot())).toBe(false);
  });
});
