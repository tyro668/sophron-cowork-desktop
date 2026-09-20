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
  // When set, renames whose DESTINATION lives directly in this directory and
  // is a generated memory file fail — i.e. the staged→live commit swaps only.
  failDir: '',
  generatedNames: new Set([
    'core_memory.json',
    'project_memory.json',
    'experience_memory.json',
    'session_state.json',
  ]),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync = (...args: Parameters<typeof actual.renameSync>) => {
    const dest = String(args[1]);
    const base = dest.split('/').pop() || '';
    const dir = dest.slice(0, dest.length - base.length - 1);
    if (fsControl.failDir && dir === fsControl.failDir && fsControl.generatedNames.has(base)) {
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
  navigatorResponder: null as null | ((userPrompt: string) => string | Promise<string>),
  capturedCorePrompts: [] as string[],
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
import {
  hasPendingCommit,
  loadGeneration,
  recoverPendingGeneration,
} from '../../main/memory/memory-generation';
import type {
  MemoryCompletionRequest,
  MemoryLLMClientLike,
} from '../../main/memory/memory-llm-client';
import { MemoryService } from '../../main/memory/memory-service';
import { configStore } from '../../main/config/config-store';

class MockMemoryLLMClient implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    if (request.systemPrompt.includes('Memory Profiler')) {
      mockLLMState.capturedCorePrompts.push(request.userPrompt);
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
          confidence: 0.92,
        });
      }
      if (request.userPrompt.includes('English')) {
        actions.push({
          op: 'upsert',
          category: 'preferences',
          key: 'response_language',
          value: 'English',
          source_type: 'explicit_user_statement',
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

function insertSessionWithMessages(
  db: Database.Database,
  payload: { id: string; title: string; cwd?: string }
): void {
  insertSession(db, payload);
  ['请用中文回答，我叫 Jack。', '好的。', '我们修复了 gateway token rotation。', '完成。'].forEach(
    (text, index) => {
      insertMessage(db, {
        id: `${payload.id}-m-${index}`,
        sessionId: payload.id,
        role: index % 2 ? 'assistant' : 'user',
        text,
        timestamp: index + 1,
      });
    }
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

const memoryRoot = () => path.join(storageRootRef.current, 'memory-root');
const storageRootRef = { current: '' };

function readJobsFile(): {
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
  forgottenSessions: string[];
} {
  const file = path.join(memoryRoot(), 'memory_ingestion_jobs.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readStateFile(): {
  sessions: Record<
    string,
    {
      lastProcessedMessageCount: number;
      lastTranscriptHash?: string;
      lastError?: string | null;
    }
  >;
} {
  const file = path.join(memoryRoot(), 'session_state.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('memory round-2 review fixes', () => {
  let rawDb: Database.Database;
  let db: DatabaseInstance;
  let service: MemoryService;

  beforeEach(() => {
    mockLLMState.coreResponder = null;
    mockLLMState.experienceResponder = null;
    mockLLMState.navigatorResponder = null;
    mockLLMState.capturedCorePrompts = [];
    storageRootRef.current = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-memory-r2-'));
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
    // Drain clears any armed retry timer so a pending backoff cannot fire
    // after the storage root is removed.
    await service.drain();
    vi.useRealTimers();
    vi.restoreAllMocks();
    rawDb.close();
    fs.rmSync(storageRootRef.current, { recursive: true, force: true });
  });

  // R2-01: journaled commit — a crash mid-swap is replayed, never destructive.
  it('R2-01a: recovery completes a commit whose journal was mid-flight', () => {
    const root = memoryRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, '.staging-rebuild'), { recursive: true });
    // Old generation live.
    for (const name of [
      'core_memory.json',
      'project_memory.json',
      'experience_memory.json',
      'session_state.json',
    ]) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
      fs.writeFileSync(path.join(root, '.staging-rebuild', name), JSON.stringify({ new: name }));
    }
    // Simulate a crash AFTER the first file swapped but before the journal
    // marked it done: staged file gone (already moved), live holds new content.
    const stagedNew = path.join(root, '.staging-rebuild', 'core_memory.json');
    const liveCore = path.join(root, 'core_memory.json');
    const backupCore = path.join(root, '.backup-rebuild', 'core_memory.json');
    fs.mkdirSync(path.join(root, '.backup-rebuild'), { recursive: true });
    fs.renameSync(liveCore, backupCore);
    fs.renameSync(stagedNew, liveCore);
    // Journal records the swap as NOT done — sha1 proves the live file already
    // holds the staged content, so recovery must not move it away.
    fs.writeFileSync(
      path.join(root, '.staging-rebuild', 'commit_journal.json'),
      JSON.stringify({
        generation: 7,
        entries: [
          { name: 'core_memory.json', action: 'commit', sha1: sha1File(liveCore), done: false },
          {
            name: 'project_memory.json',
            action: 'commit',
            sha1: sha1File(path.join(root, '.staging-rebuild', 'project_memory.json')),
            done: false,
          },
          {
            name: 'experience_memory.json',
            action: 'commit',
            sha1: sha1File(path.join(root, '.staging-rebuild', 'experience_memory.json')),
            done: false,
          },
          {
            name: 'session_state.json',
            action: 'commit',
            sha1: sha1File(path.join(root, '.staging-rebuild', 'session_state.json')),
            done: false,
          },
        ],
      })
    );

    expect(recoverPendingGeneration(root)).toBe('committed');
    const live = JSON.parse(fs.readFileSync(liveCore, 'utf8'));
    expect(live.new).toBe('core_memory.json');
    expect(loadGeneration(root)).toBe(7);
    expect(fs.existsSync(path.join(root, '.staging-rebuild'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.backup-rebuild'))).toBe(false);
  });

  it('R2-01b: recovery rolls back when a journaled staged file is genuinely lost', () => {
    const root = memoryRoot();
    fs.mkdirSync(root, { recursive: true });
    const staging = path.join(root, '.staging-rebuild');
    const backup = path.join(root, '.backup-rebuild');
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(backup, { recursive: true });
    for (const name of [
      'core_memory.json',
      'project_memory.json',
      'experience_memory.json',
      'session_state.json',
    ]) {
      fs.writeFileSync(path.join(root, name), JSON.stringify({ old: name }));
    }
    // File 1 fully committed (staged→live, live→backup, done); file 2's staged
    // copy is LOST (not in staging, not matching live sha1) → torn commit.
    fs.writeFileSync(
      path.join(backup, 'core_memory.json'),
      JSON.stringify({ old: 'core_memory.json' })
    );
    fs.writeFileSync(
      path.join(root, 'core_memory.json'),
      JSON.stringify({ new: 'core_memory.json' })
    );
    fs.writeFileSync(path.join(staging, 'project_memory.json'), JSON.stringify({ new: 'x' }));
    fs.writeFileSync(path.join(staging, 'experience_memory.json'), JSON.stringify({ new: 'x' }));
    // session_state staged file missing entirely — unrecoverable mid-entry.
    fs.writeFileSync(
      path.join(staging, 'commit_journal.json'),
      JSON.stringify({
        generation: 9,
        entries: [
          { name: 'core_memory.json', action: 'commit', sha1: 'deadbeef', done: true },
          {
            name: 'project_memory.json',
            action: 'commit',
            sha1: sha1File(path.join(staging, 'project_memory.json')),
            done: false,
          },
          {
            name: 'experience_memory.json',
            action: 'commit',
            sha1: sha1File(path.join(staging, 'experience_memory.json')),
            done: false,
          },
          { name: 'session_state.json', action: 'commit', sha1: 'missingfile', done: false },
        ],
      })
    );

    expect(recoverPendingGeneration(root)).toBe('rolled_back');
    // The old generation is fully restored — both the pre-commit file and the
    // never-committed file, and nothing staged leaks through.
    const live = JSON.parse(fs.readFileSync(path.join(root, 'core_memory.json'), 'utf8'));
    expect(live.old).toBe('core_memory.json');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'session_state.json'), 'utf8')).old).toBe(
      'session_state.json'
    );
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.existsSync(backup)).toBe(false);
  });

  it('R2-01c: an injected rename failure reports commitError, not extraction failure', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    expect(service.listProjectEntries('/repo/a').length).toBeGreaterThan(0);
    const coreFile = path.join(memoryRoot(), 'core_memory.json');
    const liveBefore = fs.readFileSync(coreFile, 'utf8');

    // Every staged→live swap fails — the commit cannot finish and even the
    // rollback's restores fail, so recovery materials must be preserved.
    fsControl.failDir = memoryRoot();
    let result;
    try {
      result = await service.rebuildWorkspace('/repo/a');
    } finally {
      fsControl.failDir = '';
    }

    expect(result.success).toBe(false);
    expect(result.commitError).toBeTruthy();
    // Extraction stats stay clean — the commit layer reports separately, and
    // nothing was applied to live storage.
    expect(result.failedSessionCount).toBe(0);
    expect(result.preparedSessionCount).toBe(1);
    expect(result.committedSessionCount).toBe(0);
    // The journal, staging, and backup survive for the next recovery attempt.
    expect(hasPendingCommit(memoryRoot())).toBe(true);
    // The journal already entered the rollback phase — once the filesystem
    // heals, recovery must continue in that direction and land the complete
    // OLD generation, never a forward resume onto a mixed live set.
    expect(recoverPendingGeneration(memoryRoot())).toBe('rolled_back');
    expect(fs.existsSync(coreFile)).toBe(true);
    expect(fs.readFileSync(coreFile, 'utf8')).toBe(liveBefore);
    expect(service.listProjectEntries('/repo/a').length).toBeGreaterThan(0);
  });

  // R2-02: an older run must never delete a newer revision's job record.
  it('R2-02: a stale in-flight run cannot consume the newer revision record', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });

    let releaseV1!: () => void;
    let releaseV2!: () => void;
    let v1Entered!: () => void;
    const v1Gate = new Promise<void>((resolve) => {
      releaseV1 = resolve;
    });
    const v2Gate = new Promise<void>((resolve) => {
      releaseV2 = resolve;
    });
    // Fires when task A is inside the gated extraction call — at that point it
    // has already consumed the pending input and job token for revision A.
    const v1Started = new Promise<void>((resolve) => {
      v1Entered = resolve;
    });
    const gated = new MockMemoryLLMClient();
    vi.spyOn(gated, 'complete').mockImplementation(async (request) => {
      if (
        request.systemPrompt.includes('memory extraction system') &&
        request.userPrompt.includes('v1-marker') &&
        !request.userPrompt.includes('v2-marker')
      ) {
        v1Entered();
        await v1Gate;
      }
      if (
        request.systemPrompt.includes('memory extraction system') &&
        request.userPrompt.includes('v2-marker')
      ) {
        await v2Gate;
      }
      return new MockMemoryLLMClient().complete(request);
    });
    service = new MemoryService(db, { llmClient: gated });

    try {
      // Revision A starts and blocks inside extraction holding revA's token.
      const first = service.enqueueIngestion({
        session: makeSession('s1', 'A', '/repo/a'),
        prompt: 'x',
        messages: makeMessages('s1', [
          { role: 'user', text: 'v1-marker 请用中文回答。', timestamp: 1 },
          { role: 'assistant', text: '好的。', timestamp: 2 },
        ]),
      });
      await v1Started;
      // Revision B arrives while A is still running — the record is superseded.
      const second = service.enqueueIngestion({
        session: makeSession('s1', 'A', '/repo/a'),
        prompt: 'x',
        messages: makeMessages('s1', [
          { role: 'user', text: 'v1-marker 请用中文回答。', timestamp: 1 },
          { role: 'assistant', text: '好的。', timestamp: 2 },
          { role: 'user', text: 'v2-marker 继续。', timestamp: 3 },
        ]),
      });
      const revB = readJobsFile().jobs['s1']?.transcriptRevision;
      expect(revB).toBeTruthy();

      releaseV1();
      await first;
      // A's completion must NOT delete B's record — it survives pending.
      expect(readJobsFile().jobs['s1']?.transcriptRevision).toBe(revB);
      releaseV2();
      await second;
      await service.drain();

      // Both revisions processed; the session memory reflects the latest run.
      expect(readJobsFile().jobs['s1']).toBeUndefined();
      expect(service.inspectSession('s1')).not.toBeNull();
    } finally {
      releaseV1();
      releaseV2();
    }
  });

  it('R2-02b: a stale run that FAILS cannot poison the newer revision record', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });

    let releaseA!: () => void;
    let releaseB!: () => void;
    let aEntered!: () => void;
    const aGate = new Promise<void>((r) => {
      releaseA = r;
    });
    const bGate = new Promise<void>((r) => {
      releaseB = r;
    });
    const aStarted = new Promise<void>((r) => {
      aEntered = r;
    });
    const gated = new MockMemoryLLMClient();
    vi.spyOn(gated, 'complete').mockImplementation(async (request) => {
      if (
        request.systemPrompt.includes('memory extraction system') &&
        request.userPrompt.includes('old-rev') &&
        !request.userPrompt.includes('new-rev')
      ) {
        aEntered();
        await aGate;
        // Revision A's extraction fails mid-run.
        return { text: 'definitely not JSON' };
      }
      if (
        request.systemPrompt.includes('memory extraction system') &&
        request.userPrompt.includes('new-rev')
      ) {
        await bGate;
      }
      return new MockMemoryLLMClient().complete(request);
    });
    service = new MemoryService(db, { llmClient: gated });

    try {
      const first = service.enqueueIngestion({
        session: makeSession('s1', 'A', '/repo/a'),
        prompt: 'x',
        messages: makeMessages('s1', [
          { role: 'user', text: 'old-rev 消息。', timestamp: 1 },
          { role: 'assistant', text: '好的。', timestamp: 2 },
        ]),
      });
      await aStarted;
      const second = service.enqueueIngestion({
        session: makeSession('s1', 'A', '/repo/a'),
        prompt: 'x',
        messages: makeMessages('s1', [
          { role: 'user', text: 'old-rev 消息。', timestamp: 1 },
          { role: 'assistant', text: '好的。', timestamp: 2 },
          { role: 'user', text: 'new-rev 追加。', timestamp: 3 },
        ]),
      });
      const revB = readJobsFile().jobs['s1']?.transcriptRevision;

      releaseA();
      await first;
      // A's failure must NOT mark B's record failed or consume its attempts.
      const record = readJobsFile().jobs['s1'];
      expect(record?.transcriptRevision).toBe(revB);
      expect(record?.attempt).toBe(0);
      expect(record?.status).not.toBe('dead');

      releaseB();
      await second;
      await service.drain();
      expect(readJobsFile().jobs['s1']).toBeUndefined();
      expect(service.inspectSession('s1')).not.toBeNull();
    } finally {
      releaseA();
      releaseB();
    }
  });

  it('R2-02c: restart recovery replays the persisted revision from the store', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    // Simulate a pending job persisted before a crash — no in-memory input.
    fs.mkdirSync(memoryRoot(), { recursive: true });
    fs.writeFileSync(
      path.join(memoryRoot(), 'memory_ingestion_jobs.json'),
      JSON.stringify({
        jobs: {
          s1: {
            sessionId: 's1',
            transcriptRevision: 'rev-at-crash',
            generation: 0,
            status: 'pending',
            attempt: 0,
            nextRetryAt: null,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        forgottenSessions: [],
      })
    );

    const recovered = new MemoryService(db, { llmClient: new MockMemoryLLMClient() });
    recovered.getOverview(); // opens stores → replays the persisted job
    await recovered.drain();

    expect(readJobsFile().jobs['s1']).toBeUndefined();
    expect(recovered.inspectSession('s1')).not.toBeNull();
    expect(recovered.listProjectEntries('/repo/a').length).toBeGreaterThan(0);
  });

  // R2-03: a rebuild must not overwrite memory ingested during the rebuild.
  it('R2-03: ingestion landing mid-rebuild is replayed onto the new generation', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    const gated = new MockMemoryLLMClient();
    vi.spyOn(gated, 'complete').mockImplementation(async (request) => {
      if (request.systemPrompt.includes('memory extraction system')) {
        await rebuildGate;
      }
      return new MockMemoryLLMClient().complete(request);
    });
    service = new MemoryService(db, { llmClient: gated });
    service.getOverview(); // open stores on the same service instance

    const rebuildPromise = service.rebuildWorkspace('/repo/a');
    // Give the rebuild a beat to enter extraction, then ingest a NEW session
    // that the rebuild (which reads only db rows) does not cover.
    const fresh = service.enqueueIngestion({
      session: makeSession('s2', 'Fresh', '/repo/new'),
      prompt: 'x',
      messages: makeMessages('s2', [
        { role: 'user', text: '全新的会话内容，需要被记住。', timestamp: 1 },
        { role: 'assistant', text: '已记录。', timestamp: 2 },
      ]),
    });
    releaseRebuild();
    await rebuildPromise;
    await fresh;
    await service.drain();

    // The mid-rebuild ingestion must survive the generation swap.
    expect(service.inspectSession('s2')).not.toBeNull();
    expect(service.getOverview().experienceSessionCount).toBeGreaterThanOrEqual(2);
  });

  it('R2-03b: overlapping rebuilds serialize — no torn staging, both succeed', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    insertSessionWithMessages(rawDb, { id: 's2', title: 'B', cwd: '/repo/b' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.enqueueIngestion({
      session: makeSession('s2', 'B', '/repo/b'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s2'),
    });

    // Both rebuilds share the single staging dir — without serialization the
    // second prepareStagingDir would wipe the first's in-flight candidate.
    const [r1, r2] = await Promise.all([
      service.rebuildWorkspace('/repo/a'),
      service.rebuildWorkspace('/repo/b'),
    ]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(service.listProjectEntries('/repo/a').length).toBeGreaterThan(0);
    expect(service.listProjectEntries('/repo/b').length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(memoryRoot(), '.staging-rebuild'))).toBe(false);
  });

  // R2-04: manual edits, confirmations, and deletes survive full rebuilds.
  it('R2-04: manual override + verified state persist across rebuildAll', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    const coreEntry = service
      .listCoreEntries()
      .find((entry) => entry.combinedKey === 'preferences.response_language');
    expect(coreEntry?.value).toBe('中文');
    // User corrects the value AND confirms it.
    service.updateCoreEntry('preferences.response_language', {
      value: 'English',
      confidence: 1,
      status: 'active',
    });
    const projectEntry = service.listProjectEntries('/repo/a')[0];
    service.updateProjectEntry(projectEntry.id, {
      value: '人工修正的项目结论',
      confidence: 1,
      status: 'active',
    });
    // And deletes one project entry entirely.
    insertSessionWithMessages(rawDb, { id: 's2', title: 'B', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s2', 'B', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s2'),
    });
    const deletable = service
      .listProjectEntries('/repo/a')
      .find((entry) => entry.id !== projectEntry.id);
    if (deletable) {
      service.deleteProjectEntry(deletable.id);
    }

    const result = await service.rebuildAll();
    expect(result.success).toBe(true);

    const rebuiltCore = service
      .listCoreEntries()
      .find((entry) => entry.combinedKey === 'preferences.response_language');
    // The manual value wins — extraction would have re-derived 中文.
    expect(rebuiltCore?.value).toBe('English');
    expect(rebuiltCore?.confidenceSignals.userVerified).toBe(true);

    const rebuiltProject = service
      .listProjectEntries('/repo/a')
      .find((entry) => entry.key === projectEntry.key);
    expect(rebuiltProject?.value).toBe('人工修正的项目结论');
    expect(rebuiltProject?.confidenceSignals.userVerified).toBe(true);

    if (deletable) {
      const resurrected = service
        .listProjectEntries('/repo/a')
        .find((entry) => entry.key === deletable.key);
      expect(resurrected).toBeUndefined();
    }

    // Restart-proof: overlays live in a persisted file, not in-memory state.
    const reopened = new MemoryService(db, {
      llmClient: new MockMemoryLLMClient(),
      storageRootOverride: memoryRoot(),
    });
    const reopenedCore = reopened
      .listCoreEntries()
      .find((entry) => entry.combinedKey === 'preferences.response_language');
    expect(reopenedCore?.value).toBe('English');
    expect(reopenedCore?.confidenceSignals.userVerified).toBe(true);
  });

  // R2-05: invalid extractions must not advance the cursor or clear chunks.
  it('R2-05a: a malformed extraction preserves the cursor and stored chunks', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    const chunksBefore = service.inspectSession('s1')?.chunks.length ?? 0;
    expect(chunksBefore).toBeGreaterThan(0);
    const cursorBefore = readStateFile().sessions['s1'];

    // Bare {} — missing all required fields — is a malformed response.
    mockLLMState.experienceResponder = () => '{}';
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: [
        ...DEFAULT_MESSAGES('s1'),
        {
          id: 's1-m-4',
          sessionId: 's1',
          role: 'user' as const,
          content: [{ type: 'text' as const, text: '追加内容。' }],
          timestamp: 5,
        },
      ],
    });
    await service.drain();

    const cursorAfter = readStateFile().sessions['s1'];
    expect(cursorAfter.lastError).toBeTruthy();
    // Cursor untouched — same revision markers as before.
    expect(cursorAfter.lastTranscriptHash).toBe(cursorBefore.lastTranscriptHash);
    expect(cursorAfter.lastProcessedMessageCount).toBe(cursorBefore.lastProcessedMessageCount);
    // Stored memory is untouched — the failed extraction cleared nothing.
    expect(service.inspectSession('s1')?.chunks.length).toBe(chunksBefore);
  });

  it('R2-05b: all-out-of-range source turns fail the extraction outright', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    const chunksBefore = service.inspectSession('s1')?.chunks.length ?? 0;
    const cursorBefore = readStateFile().sessions['s1'];

    mockLLMState.experienceResponder = () =>
      JSON.stringify({
        session_summary: '看似合法但引用了不存在的轮次',
        session_confidence: 0.8,
        chunks: [
          {
            summary: '越界引用',
            details: 'source_turns 全部超出 transcript 范围。',
            keywords: ['bad'],
            source_turns: [97, 98, 99],
            confidence: 0.8,
          },
        ],
      });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: [
        ...DEFAULT_MESSAGES('s1'),
        {
          id: 's1-m-4',
          sessionId: 's1',
          role: 'user' as const,
          content: [{ type: 'text' as const, text: '追加。' }],
          timestamp: 5,
        },
      ],
    });
    await service.drain();

    const cursorAfter = readStateFile().sessions['s1'];
    expect(cursorAfter.lastError).toBeTruthy();
    expect(cursorAfter.lastTranscriptHash).toBe(cursorBefore.lastTranscriptHash);
    expect(service.inspectSession('s1')?.chunks.length).toBe(chunksBefore);
  });

  it('R2-05c: a chunk mixing valid and invalid source turns fails the extraction', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    const chunksBefore = service.inspectSession('s1')?.chunks.length ?? 0;
    const cursorBefore = readStateFile().sessions['s1'];

    mockLLMState.experienceResponder = () =>
      JSON.stringify({
        session_summary: '部分引用有效、部分越界',
        session_confidence: 0.8,
        chunks: [
          {
            summary: '合法片段',
            details: '引用在范围内。',
            keywords: ['ok'],
            source_turns: [1, 2],
            confidence: 0.8,
          },
          {
            summary: '混合引用片段',
            details: '一个引用越界。',
            keywords: ['bad'],
            source_turns: [1, 999],
            confidence: 0.8,
          },
        ],
      });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: [
        ...DEFAULT_MESSAGES('s1'),
        {
          id: 's1-m-4',
          sessionId: 's1',
          role: 'user' as const,
          content: [{ type: 'text' as const, text: '追加。' }],
          timestamp: 5,
        },
      ],
    });
    await service.drain();

    // One invalid turn poisons the whole extraction — nothing is committed.
    const cursorAfter = readStateFile().sessions['s1'];
    expect(cursorAfter.lastError).toBeTruthy();
    expect(cursorAfter.lastTranscriptHash).toBe(cursorBefore.lastTranscriptHash);
    expect(service.inspectSession('s1')?.chunks.length).toBe(chunksBefore);
  });

  // R2-06: backoff-waiting jobs actually wake up and run.
  it('R2-06: the retry timer replays a due job without another enqueue', async () => {
    vi.useFakeTimers();
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });

    mockLLMState.experienceResponder = () => 'not JSON';
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await vi.advanceTimersByTimeAsync(0);
    let job = readJobsFile().jobs['s1'];
    expect(job?.status).toBe('pending');
    expect(job?.attempt).toBe(1);
    expect(job?.nextRetryAt).not.toBeNull();

    // Fix the extractor — when the backoff timer fires, the job must replay.
    mockLLMState.experienceResponder = null;
    await vi.advanceTimersByTimeAsync(5_500);
    await service.drain();

    job = readJobsFile().jobs['s1'];
    expect(job).toBeUndefined();
    expect(service.inspectSession('s1')).not.toBeNull();
  });

  it('R2-06b: retries escalate to dead-letter through the real pipeline', async () => {
    vi.useFakeTimers();
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });

    mockLLMState.experienceResponder = () => 'not JSON';
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(readJobsFile().jobs['s1']?.attempt).toBe(1);

    // Backoff: +5s → attempt 2, +10s → attempt 3 → dead.
    await vi.advanceTimersByTimeAsync(5_500);
    expect(readJobsFile().jobs['s1']?.attempt).toBe(2);
    await vi.advanceTimersByTimeAsync(11_000);
    const dead = readJobsFile().jobs['s1'];
    expect(dead?.status).toBe('dead');
    expect(dead?.nextRetryAt).toBeNull();
    // A dead job never replays on its own.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readJobsFile().jobs['s1']?.status).toBe('dead');

    // Manual retry entry: requeue the dead letter, replay runs immediately.
    mockLLMState.experienceResponder = null;
    expect(service.retryIngestionJobs('s1')).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    await service.drain();
    expect(readJobsFile().jobs['s1']).toBeUndefined();
    expect(service.inspectSession('s1')).not.toBeNull();
  });

  // R2-07: in-place edits reprocess the full relevant transcript.
  it('R2-07: an early in-place edit reprocesses from the divergence, not the tail', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    mockLLMState.capturedCorePrompts = [];

    // Edit message 0 in place (same id, new content) and append one message.
    const edited = DEFAULT_MESSAGES('s1');
    edited[0] = {
      ...edited[0],
      content: [{ type: 'text' as const, text: '请改用 English 回答。' }],
    };
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: [
        ...edited,
        {
          id: 's1-m-4',
          sessionId: 's1',
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: '好的。' }],
          timestamp: 5,
        },
      ],
    });
    await service.drain();

    // The core extractor must have SEEN the edited early message — with an
    // id-only cursor it would have received just the appended tail.
    const lastCorePrompt = mockLLMState.capturedCorePrompts.at(-1) || '';
    expect(lastCorePrompt).toContain('请改用 English 回答');
    const coreEntry = service
      .listCoreEntries()
      .find((entry) => entry.combinedKey === 'preferences.response_language');
    expect(coreEntry?.value).toBe('English');
  });

  // R2-08: evidence messageIds survive the file round-trip.
  it('R2-08: messageIds in core/project evidence persist across reopen', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    const reopened = new MemoryService(db, {
      llmClient: new MockMemoryLLMClient(),
      storageRootOverride: memoryRoot(),
    });
    const coreEntry = reopened
      .listCoreEntries()
      .find((entry) => entry.combinedKey === 'preferences.response_language');
    expect(coreEntry?.evidence[0]?.messageIds?.length).toBeGreaterThan(0);
    const projectEntry = reopened.listProjectEntries('/repo/a')[0];
    expect(projectEntry?.evidence[0]?.messageIds?.length).toBeGreaterThan(0);
  });

  // R2-09: a hanging navigator degrades to summaries within the deadline.
  it('R2-09: a hanging navigator cannot stall prompt construction', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    // Retrieval must actually hit stored experience for navigation to engage.
    mockLLMState.experienceResponder = () =>
      JSON.stringify({
        session_summary: 'gateway token rotation 的修复记录',
        session_keywords: ['gateway'],
        session_confidence: 0.9,
        chunks: [
          {
            summary: 'gateway token rotation 的实现细节',
            details: '记录了 gateway token rotation 的完整实现过程。',
            keywords: ['gateway', 'rotation'],
            source_turns: [1, 2, 3, 4],
            confidence: 0.85,
          },
        ],
      });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.drain();

    mockLLMState.navigatorResponder = () => new Promise<string>(() => {}); // never resolves
    vi.useFakeTimers();
    const prefixPromise = service.buildPromptPrefix(
      { cwd: '/repo/a' },
      '请继续处理 gateway token rotation 相关的后续工作'
    );
    await vi.advanceTimersByTimeAsync(9_000);
    const prefix = await prefixPromise;
    vi.useRealTimers();

    // Degraded to the summary view — memory still reaches the prompt.
    expect(prefix).toContain('experience_memory');
    expect(prefix).toContain('Broad Summaries');
  });

  it('R2-09b: aborting the caller signal cancels prompt construction mid-navigation', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    mockLLMState.experienceResponder = () =>
      JSON.stringify({
        session_summary: 'gateway token rotation 的修复记录',
        session_confidence: 0.9,
        chunks: [
          {
            summary: 'gateway token rotation 的实现细节',
            details: '记录了实现过程。',
            keywords: ['gateway'],
            source_turns: [1, 2, 3, 4],
            confidence: 0.85,
          },
        ],
      });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.drain();

    mockLLMState.navigatorResponder = () => new Promise<string>(() => {});
    const controller = new AbortController();
    const prefixPromise = service.buildPromptPrefix(
      { cwd: '/repo/a' },
      '请继续处理 gateway token rotation 相关的后续工作',
      controller.signal
    );
    controller.abort();
    // Resolves immediately — no 8s wait needed once the caller aborts.
    const prefix = await prefixPromise;
    expect(typeof prefix).toBe('string');
  });

  // R2-10: provenance records only what actually entered the prompt.
  it('R2-10: injection provenance reflects the budgeted selection, not all candidates', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: Array.from({ length: 24 }, (_, index) => ({
          op: 'upsert',
          category: 'preferences',
          key: `bulk_pref_${index}`,
          value: `值${index}-`.repeat(60),
          source_type: 'llm_inference',
          confidence: 0.7,
        })),
      });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    const prefix = await service.buildPromptPrefix(
      { cwd: '/repo/a' },
      '继续处理 gateway token rotation 的工作项'
    );
    const [injection] = service.listInjections(1);
    expect(injection.truncated).toBe(true);
    // Only entries whose lines survived into the prompt are recorded.
    expect(injection.coreKeys.length).toBeLessThan(24);
    for (const key of injection.coreKeys) {
      expect(prefix).toContain(`- ${key}:`);
    }
  });
});

function sha1File(filePath: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}
