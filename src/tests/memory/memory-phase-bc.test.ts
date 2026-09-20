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

const mockLLMState = vi.hoisted(() => ({
  coreResponder: null as null | ((userPrompt: string) => string),
  experienceResponder: null as null | ((userPrompt: string) => string),
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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseInstance, MessageRow, SessionRow } from '../../main/db/database';
import { MemoryIngestionJobStore } from '../../main/memory/memory-ingestion-jobs';
import type {
  MemoryCompletionRequest,
  MemoryLLMClientLike,
} from '../../main/memory/memory-llm-client';
import { MEMORY_PROMPT_BUDGET } from '../../main/memory/memory-utils';
import { MemoryService } from '../../main/memory/memory-service';
import { configStore } from '../../main/config/config-store';

class MockMemoryLLMClient implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    if (request.systemPrompt.includes('Memory Profiler')) {
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
      return { text: JSON.stringify({ actions }) };
    }

    if (request.systemPrompt.includes('memory extraction system')) {
      if (mockLLMState.experienceResponder) {
        return { text: mockLLMState.experienceResponder(request.userPrompt) };
      }
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
              source_turns: [1, 2],
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
  jobs: Record<string, { status: string; attempt: number; generation: number }>;
  forgottenSessions: string[];
} {
  const file = path.join(memoryRoot(), 'memory_ingestion_jobs.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('memory phase-B reliability and phase-C retrieval hardening', () => {
  let rawDb: Database.Database;
  let db: DatabaseInstance;
  let service: MemoryService;

  beforeEach(() => {
    mockLLMState.coreResponder = null;
    mockLLMState.experienceResponder = null;
    storageRootRef.current = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-memory-bc-'));
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

  afterEach(() => {
    rawDb.close();
    fs.rmSync(storageRootRef.current, { recursive: true, force: true });
  });

  it('B1: a failed session extraction aborts the staged rebuild — live memory is untouched', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    insertSessionWithMessages(rawDb, { id: 's2', title: 'B', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.enqueueIngestion({
      session: makeSession('s2', 'B', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s2'),
    });
    const projectBefore = service.listProjectEntries('/repo/a').length;
    const coreBefore = service.listCoreEntries().length;
    expect(projectBefore).toBeGreaterThan(0);

    // Extraction fails for one session mid-rebuild: the candidate generation
    // must be discarded wholesale, not committed partially.
    mockLLMState.experienceResponder = () => 'not JSON';
    const result = await service.rebuildWorkspace('/repo/a');

    expect(result.failedSessionCount).toBeGreaterThan(0);
    expect(service.listProjectEntries('/repo/a')).toHaveLength(projectBefore);
    expect(service.listCoreEntries()).toHaveLength(coreBefore);
    // Staging dir is cleaned up after the aborted commit.
    expect(fs.existsSync(path.join(memoryRoot(), '.staging-rebuild'))).toBe(false);
  });

  it('B2: successful rebuild swaps the staged generation atomically', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    const result = await service.rebuildWorkspace('/repo/a');
    expect(result.failedSessionCount).toBe(0);
    expect(result.succeededSessionCount).toBe(1);
    expect(service.listProjectEntries('/repo/a').length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(memoryRoot(), '.staging-rebuild'))).toBe(false);
  });

  it('B3: stale-generation and forgotten jobs are fenced off on startup replay', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    insertSessionWithMessages(rawDb, { id: 's2', title: 'B', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    await service.enqueueIngestion({
      session: makeSession('s2', 'B', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s2'),
    });
    await service.clearWorkspace('/repo/a'); // bumps generation to 1

    // Simulate a crash image: a stale-generation job plus a forgotten session
    // that still has a pending job record.
    const jobsPath = path.join(memoryRoot(), 'memory_ingestion_jobs.json');
    fs.writeFileSync(
      jobsPath,
      JSON.stringify({
        jobs: {
          s1: {
            sessionId: 's1',
            transcriptRevision: 'rev',
            generation: 0,
            status: 'pending',
            attempt: 0,
            nextRetryAt: null,
            createdAt: 1,
            updatedAt: 1,
          },
          s2: {
            sessionId: 's2',
            transcriptRevision: 'rev',
            generation: 1,
            status: 'pending',
            attempt: 0,
            nextRetryAt: null,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        forgottenSessions: ['s2'],
        // A real post-clear file carries the clearance fence written at gen 1 —
        // the s1 record below predates it and must never replay.
        clearedGenerations: { core: 0, workspaces: { '/repo/a': 1 } },
      })
    );

    // A fresh service instance replays persisted jobs at store init.
    const recovered = new MemoryService(db, { llmClient: new MockMemoryLLMClient() });
    recovered.getOverview('/repo/a');
    await recovered.drain();

    const jobs = readJobsFile();
    expect(jobs.jobs['s1']).toBeUndefined(); // stale generation dropped
    expect(jobs.jobs['s2']).toBeUndefined(); // forgotten session dropped
    // Neither replay produced memory — the workspace stays cleared.
    expect(recovered.listProjectEntries('/repo/a')).toHaveLength(0);
    expect(recovered.getOverview('/repo/a').experienceSessionCount).toBe(0);
  });

  it('B4: retry attempts escalate to dead-letter; a fresh enqueue resets them', () => {
    const store = new MemoryIngestionJobStore(path.join(storageRootRef.current, 'jobs.json'));
    store.upsert('s1', { transcriptRevision: 'r1', generation: 0 });
    store.markFailed('s1', new Error('boom'));
    expect(store.get('s1')?.status).toBe('pending');
    expect(store.get('s1')?.attempt).toBe(1);
    store.markFailed('s1', new Error('boom'));
    store.markFailed('s1', new Error('boom'));
    expect(store.get('s1')?.status).toBe('dead');
    expect(store.deadCount()).toBe(1);

    // A new transcript revision supersedes the dead-lettered job.
    store.upsert('s1', { transcriptRevision: 'r2', generation: 0 });
    expect(store.get('s1')?.status).toBe('pending');
    expect(store.get('s1')?.attempt).toBe(0);
    expect(store.deadCount()).toBe(0);
  });

  it('B5: a corrupt store file is quarantined instead of overwriting data', async () => {
    const file = path.join(memoryRoot(), 'experience_memory.json');
    fs.mkdirSync(memoryRoot(), { recursive: true });
    fs.writeFileSync(file, '{{{ not json');

    const overview = service.getOverview();
    expect(overview.experienceSessionCount).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
    const quarantined = fs
      .readdirSync(memoryRoot())
      .filter((name) => name.startsWith('experience_memory.json.corrupt-'));
    expect(quarantined).toHaveLength(1);
  });

  it('C1: prompt prefix stays within the total budget and records truncation', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    // Stuff the core store far beyond its layer budget.
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: Array.from({ length: 60 }, (_, i) => ({
          op: 'upsert',
          category: 'preferences',
          key: `pref_${i}`,
          value: `值${i}-`.repeat(120),
          source_type: 'llm_inference',
          confidence: 0.7,
        })),
      });
    insertSessionWithMessages(rawDb, { id: 's2', title: 'B', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s2', 'B', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s2'),
    });

    const prefix = await service.buildPromptPrefix(
      { cwd: '/repo/a' },
      '继续 gateway token rotation 的工作'
    );
    expect(prefix.length).toBeLessThanOrEqual(MEMORY_PROMPT_BUDGET.totalChars);
    expect(prefix).toContain('[memory truncated');

    const [injection] = service.listInjections(1);
    expect(injection.truncated).toBe(true);
    expect(injection.totalChars).toBeLessThanOrEqual(MEMORY_PROMPT_BUDGET.totalChars);
  });

  it('C2: sensitive credentials are redacted from raw text and never stored as values', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    mockLLMState.coreResponder = () =>
      JSON.stringify({
        actions: [
          {
            op: 'upsert',
            category: 'identity',
            key: 'api_key',
            value: 'sk-1234567890abcdefghijklmnop',
            source_type: 'explicit_user_statement',
            confidence: 0.95,
          },
        ],
      });
    mockLLMState.experienceResponder = () =>
      JSON.stringify({
        session_summary: '会话包含密钥配置',
        session_keywords: ['credential'],
        session_confidence: 0.8,
        chunks: [
          {
            summary: '用户提供了 api key 配置',
            details: '正常描述，不含密钥本身。',
            keywords: ['api'],
            source_turns: [1],
            confidence: 0.8,
          },
        ],
      });

    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: makeMessages('s1', [
        {
          role: 'user',
          text: '我的密钥是 api_key = "sk-1234567890abcdefghijklmnop"，请保存。',
          timestamp: 1,
        },
      ]),
    });

    // The credential value is rejected outright at the store gate.
    expect(service.listCoreEntries().find((e) => e.key === 'api_key')).toBeUndefined();

    // The raw transcript excerpt stored on the chunk is redacted.
    const inspected = service.inspectSession('s1', '/repo/a');
    expect(inspected?.chunks[0]?.rawText).toContain('[redacted]');
    expect(inspected?.chunks[0]?.rawText).not.toContain('sk-1234567890');
  });

  it('C3: injection provenance records what entered the prompt', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    await service.buildPromptPrefix({ cwd: '/repo/a' }, '继续 gateway token rotation 的工作');

    const [injection] = service.listInjections(1);
    expect(injection).toBeDefined();
    expect(injection.workspaceKey).toBe('/repo/a');
    expect(injection.coreKeys).toContain('preferences.response_language');
    expect(injection.projectKeys.length).toBeGreaterThan(0);
    expect(injection.totalChars).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(memoryRoot(), 'memory_injections.json'))).toBe(true);
  });

  it('C4: navigator failure degrades to summary-only context instead of failing', async () => {
    insertSessionWithMessages(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    // Retrieval must actually hit stored experience for navigation to engage.
    mockLLMState.experienceResponder = () =>
      JSON.stringify({
        session_summary: '实现了 gateway token rotation 改造',
        session_keywords: ['gateway', 'rotation'],
        session_confidence: 0.85,
        chunks: [
          {
            summary: 'gateway token rotation 的实现细节',
            details: 'rotation 逻辑与 remote gateway 同步约束。',
            keywords: ['gateway', 'rotation'],
            source_turns: [3, 4],
            confidence: 0.85,
          },
        ],
      });
    await service.enqueueIngestion({
      session: makeSession('s1b', 'A2', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1b'),
    });

    // Navigator is a separate prompt — make every non-extractor call explode.
    const failingNavigator = new MockMemoryLLMClient();
    const original = failingNavigator.complete.bind(failingNavigator);
    failingNavigator.complete = async (request: MemoryCompletionRequest) => {
      if (request.systemPrompt.includes('memory retrieval navigator')) {
        throw new Error('navigator down');
      }
      return original(request);
    };
    const navService = new MemoryService(db, { llmClient: failingNavigator });

    const prefix = await navService.buildPromptPrefix(
      { cwd: '/repo/a' },
      '继续 gateway token rotation 的工作'
    );
    expect(prefix).toContain('== Broad Summaries');
    expect(prefix).not.toContain('== Expanded Chunk Raw Text ==');
  });
});
