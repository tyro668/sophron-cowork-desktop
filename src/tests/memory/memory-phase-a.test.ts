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
  completeCalls: 0,
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
import { CoreMemoryStore } from '../../main/memory/core-memory-store';
import { MemoryIngestionQueue } from '../../main/memory/memory-ingestion-queue';
import type {
  MemoryCompletionRequest,
  MemoryLLMClientLike,
} from '../../main/memory/memory-llm-client';
import { MemoryService } from '../../main/memory/memory-service';
import { ProjectMemoryStore } from '../../main/memory/project-memory-store';
import { configStore } from '../../main/config/config-store';

class MockMemoryLLMClient implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    mockLLMState.completeCalls += 1;
    if (request.systemPrompt.includes('Memory Profiler')) {
      if (mockLLMState.coreResponder) {
        return { text: mockLLMState.coreResponder(request.userPrompt) };
      }
      const actions = [];
      if (request.userPrompt.includes('Jack')) {
        actions.push({
          op: 'upsert',
          category: 'identity',
          key: 'name',
          value: 'Jack',
          source_type: 'explicit_user_statement',
          confidence: 0.94,
        });
      }
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

describe('memory phase-A correctness fixes', () => {
  let rawDb: Database.Database;
  let db: DatabaseInstance;
  let service: MemoryService;
  let storageRoot: string;

  beforeEach(() => {
    mockLLMState.coreResponder = null;
    mockLLMState.experienceResponder = null;
    mockLLMState.completeCalls = 0;
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophron-memory-a-'));
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
        storageRoot: path.join(storageRoot, 'memory-root'),
      },
    });
  });

  afterEach(() => {
    rawDb.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('R1: deletes derived core/project facts when their source session is deleted', async () => {
    const session = makeSession('s1', 'Gateway work', '/repo/a');
    insertSession(rawDb, { id: 's1', title: 'Gateway work', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session,
      prompt: 'gateway work',
      messages: DEFAULT_MESSAGES('s1'),
    });
    expect(service.getOverview('/repo/a').coreCount).toBeGreaterThan(0);
    expect(service.getOverview('/repo/a').projectCount).toBeGreaterThan(0);

    await service.deleteSession('s1');

    const overview = service.getOverview('/repo/a');
    expect(overview.experienceSessionCount).toBe(0);
    expect(overview.coreCount).toBe(0);
    expect(overview.projectCount).toBe(0);
  });

  it('R1b: keeps verified and multi-source entries when one source session is deleted', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    insertSession(rawDb, { id: 's2', title: 'B', cwd: '/repo/b' });
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

    // Same fact evidenced by two sessions survives single-source deletion.
    const coreBefore = service.listCoreEntries();
    const nameEntry = coreBefore.find((entry) => entry.combinedKey === 'identity.name');
    expect(nameEntry?.evidence.map((item) => item.sessionId).sort()).toEqual(['s1', 's2']);

    await service.deleteSession('s1');
    const nameAfter = service.listCoreEntries().find((e) => e.combinedKey === 'identity.name');
    expect(nameAfter).toBeDefined();
    expect(nameAfter?.evidence.map((item) => item.sessionId)).toEqual(['s2']);
    expect(nameAfter?.value).toBe('Jack');
  });

  it('R2: injects no project memory when the session has no workspace', async () => {
    insertSession(rawDb, { id: 's1', title: 'Gateway work', cwd: '/repo/a' });
    await service.enqueueIngestion({
      session: makeSession('s1', 'Gateway work', '/repo/a'),
      prompt: 'gateway',
      messages: DEFAULT_MESSAGES('s1'),
    });

    const noCwdPrefix = await service.buildPromptPrefix({}, 'unrelated request');
    expect(noCwdPrefix).not.toContain('<project_memory');

    const cwdPrefix = await service.buildPromptPrefix({ cwd: '/repo/a' }, 'unrelated request');
    expect(cwdPrefix).toContain('<project_memory workspace="/repo/a">');

    // The management search API applies the same strict scope: workspace scope
    // without a resolvable workspace matches nothing.
    const scoped = service.search({ query: 'preference', scope: 'workspace' });
    expect(scoped).toEqual([]);
  });

  it('R3: malformed extraction does not advance the cursor and retries succeed', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    mockLLMState.coreResponder = () => 'not JSON at all';
    mockLLMState.experienceResponder = () => 'not JSON at all';

    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });

    const state = JSON.parse(
      fs.readFileSync(path.join(storageRoot, 'memory-root', 'session_state.json'), 'utf8')
    ) as { sessions: Record<string, { lastProcessedMessageCount: number; lastError?: string }> };
    expect(state.sessions['s1'].lastProcessedMessageCount).toBe(0);
    expect(state.sessions['s1'].lastError).toContain('memory.extraction');

    mockLLMState.coreResponder = null;
    mockLLMState.experienceResponder = null;
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    const retried = JSON.parse(
      fs.readFileSync(path.join(storageRoot, 'memory-root', 'session_state.json'), 'utf8')
    ) as { sessions: Record<string, { lastProcessedMessageCount: number; lastError?: string }> };
    expect(retried.sessions['s1'].lastProcessedMessageCount).toBe(4);
    expect(retried.sessions['s1'].lastError).toBeNull();
    expect(service.getOverview('/repo/a').experienceSessionCount).toBe(1);
  });

  it('R3b: same-count message edits are reprocessed', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    const session = makeSession('s1', 'A', '/repo/a');
    await service.enqueueIngestion({
      session,
      prompt: 'x',
      messages: makeMessages('s1', [
        { role: 'user', text: '你好', timestamp: 1 },
        { role: 'assistant', text: '你好', timestamp: 2 },
      ]),
    });
    const callsAfterFirst = mockLLMState.completeCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Same count, edited content (different message ids → history fork).
    await service.enqueueIngestion({
      session,
      prompt: 'x',
      messages: [
        {
          id: 's1-edit-1',
          sessionId: 's1',
          role: 'user',
          content: [{ type: 'text' as const, text: '请用中文回答' }],
          timestamp: 1,
        },
        {
          id: 's1-edit-2',
          sessionId: 's1',
          role: 'assistant',
          content: [{ type: 'text' as const, text: '好的' }],
          timestamp: 2,
        },
      ],
    });
    expect(mockLLMState.completeCalls).toBeGreaterThan(callsAfterFirst);
  });

  it('R4: a conflicting value cannot inherit verification; verified value wins', () => {
    const filePath = path.join(storageRoot, 'core_memory.json');
    const store = new CoreMemoryStore(filePath);
    const evidence = [{ sessionId: 's1' }];
    store.applyActions(
      [
        {
          op: 'upsert',
          category: 'preferences',
          key: 'language',
          value: '中文',
          confidence: 0.9,
          sourceType: 'explicit_user_statement',
        },
      ],
      evidence
    );
    store.updateEntry('preferences.language', { confidence: 1 });

    store.applyActions(
      [
        {
          op: 'upsert',
          category: 'preferences',
          key: 'language',
          value: 'English',
          confidence: 0.9,
          sourceType: 'llm_inference',
        },
      ],
      [{ sessionId: 's2' }]
    );

    const entry = store.getEntry('preferences.language');
    expect(entry?.value).toBe('中文');
    expect(entry?.confidenceSignals.userVerified).toBe(true);
    expect(entry?.confidenceSignals.contradictionCount).toBe(1);
  });

  it('R4b: conflicting update on an unverified value replaces it without verification', () => {
    const filePath = path.join(storageRoot, 'core_memory.json');
    const store = new CoreMemoryStore(filePath);
    store.applyActions(
      [
        {
          op: 'upsert',
          category: 'preferences',
          key: 'language',
          value: '中文',
          confidence: 0.6,
          sourceType: 'llm_inference',
        },
      ],
      [{ sessionId: 's1' }]
    );
    store.applyActions(
      [
        {
          op: 'upsert',
          category: 'preferences',
          key: 'language',
          value: 'English',
          confidence: 0.8,
          sourceType: 'llm_inference',
        },
      ],
      [{ sessionId: 's2' }]
    );
    const entry = store.getEntry('preferences.language');
    expect(entry?.value).toBe('English');
    expect(entry?.confidenceSignals.userVerified).toBe(false);
    expect(entry?.confidenceSignals.contradictionCount).toBe(1);
  });

  it('R4c: replayed evidence from the same session does not inflate corroboration', () => {
    const filePath = path.join(storageRoot, 'core_memory.json');
    const store = new CoreMemoryStore(filePath);
    const action = {
      op: 'upsert' as const,
      category: 'preferences' as const,
      key: 'language',
      value: '中文',
      confidence: 0.9,
      sourceType: 'explicit_user_statement' as const,
    };
    store.applyActions([action], [{ sessionId: 's1' }]);
    store.applyActions([action], [{ sessionId: 's1' }]);
    expect(store.getEntry('preferences.language')?.confidenceSignals.corroborationCount).toBe(0);
    store.applyActions([action], [{ sessionId: 's2' }]);
    expect(store.getEntry('preferences.language')?.confidenceSignals.corroborationCount).toBe(1);
  });

  it('R5: a shorter explicit correction replaces a longer project summary', () => {
    const filePath = path.join(storageRoot, 'project_memory.json');
    const store = new ProjectMemoryStore(filePath);
    store.upsertFromExperience({
      workspaceKey: '/repo/a',
      sessionId: 's1',
      sessionTitle: 'Port policy',
      summary: 'The service uses port 3000 and this is the old longer description.',
      keywords: [],
      extractionConfidence: 0.8,
    });
    store.upsertFromExperience({
      workspaceKey: '/repo/a',
      sessionId: 's2',
      sessionTitle: 'Port policy',
      summary: 'Use port 4000.',
      keywords: [],
      extractionConfidence: 0.85,
    });
    const entries = store.getEntries('/repo/a');
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe('Use port 4000.');
    expect(entries[0].confidenceSignals.contradictionCount).toBe(1);
  });

  it('R6: completed queue tasks release their session key', async () => {
    const queue = new MemoryIngestionQueue();
    await queue.enqueue('s1', async () => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    expect(queue.pendingCount).toBe(0);
  });

  it('R7: rebuildWorkspace clears state without writing tombstones', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    for (const [index, text] of [
      '请用中文回答，我叫 Jack。',
      '好的。',
      '我们修复了 gateway token rotation。',
      '完成。',
    ].entries()) {
      insertMessage(rawDb, {
        id: `s1-m-${index}`,
        sessionId: 's1',
        role: index % 2 ? 'assistant' : 'user',
        text,
        timestamp: index + 1,
      });
    }
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    expect(service.listProjectEntries('/repo/a').length).toBeGreaterThan(0);

    // Rebuild must re-derive memory from still-present sessions; a tombstone
    // written here would permanently block re-extraction.
    await service.rebuildWorkspace('/repo/a');
    expect(service.listProjectEntries('/repo/a').length).toBeGreaterThan(0);
    expect(service.listCoreEntries().some((e) => e.value === 'Jack')).toBe(true);
  });

  it('R8: partially stripped evidence is persisted across reload', () => {
    const filePath = path.join(storageRoot, 'core_memory.json');
    const store = new CoreMemoryStore(filePath);
    const action = {
      op: 'upsert' as const,
      category: 'preferences' as const,
      key: 'language',
      value: '中文',
      confidence: 0.9,
      sourceType: 'explicit_user_statement' as const,
    };
    store.applyActions([action], [{ sessionId: 's1' }]);
    store.applyActions([action], [{ sessionId: 's2' }]);

    // The entry survives with only s2 evidence — and the strip must hit disk,
    // not just the in-memory map.
    store.removeEvidenceWhere((item) => item.sessionId === 's1');
    const reloaded = new CoreMemoryStore(filePath);
    const entry = reloaded.getEntry('preferences.language');
    expect(entry?.evidence.map((item) => item.sessionId)).toEqual(['s2']);
  });

  it('R9: a well-formed empty extraction does not delete stored experience', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    const session = makeSession('s1', 'A', '/repo/a');
    await service.enqueueIngestion({
      session,
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    expect(service.getOverview('/repo/a').experienceSessionCount).toBe(1);

    // A new message re-triggers ingestion; the extractor now returns a valid
    // but empty payload — the stored record must survive it.
    mockLLMState.experienceResponder = () => '{}';
    await service.enqueueIngestion({
      session,
      prompt: 'x',
      messages: [
        ...DEFAULT_MESSAGES('s1'),
        {
          id: 's1-m-4',
          sessionId: 's1',
          role: 'user',
          content: [{ type: 'text' as const, text: '补充一点细节' }],
          timestamp: 5,
        },
      ],
    });
    expect(service.getOverview('/repo/a').experienceSessionCount).toBe(1);
  });

  it('R10: in-place message edits with unchanged ids reprocess core memory', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    const session = makeSession('s1', 'A', '/repo/a');
    const messages = makeMessages('s1', [
      { role: 'user', text: '你好', timestamp: 1 },
      { role: 'assistant', text: '你好', timestamp: 2 },
    ]);
    await service.enqueueIngestion({ session, prompt: 'x', messages });
    expect(service.listCoreEntries().some((e) => e.value === 'Jack')).toBe(false);

    // Same ids, edited content: the id prefix is intact but the transcript
    // changed — the delta cannot be localized, so the core extractor must run.
    await service.enqueueIngestion({
      session,
      prompt: 'x',
      messages: [
        {
          id: 's1-m-0',
          sessionId: 's1',
          role: 'user',
          content: [{ type: 'text' as const, text: '我叫 Jack' }],
          timestamp: 1,
        },
        messages[1],
      ],
    });
    expect(service.listCoreEntries().some((e) => e.value === 'Jack')).toBe(true);
  });

  it('R11: an explicit user statement corrects even a verified value', () => {
    const filePath = path.join(storageRoot, 'core_memory.json');
    const store = new CoreMemoryStore(filePath);
    store.applyActions(
      [
        {
          op: 'upsert',
          category: 'preferences',
          key: 'language',
          value: '中文',
          confidence: 0.9,
          sourceType: 'explicit_user_statement',
        },
      ],
      [{ sessionId: 's1' }]
    );
    store.updateEntry('preferences.language', { confidence: 1 });

    store.applyActions(
      [
        {
          op: 'upsert',
          category: 'preferences',
          key: 'language',
          value: 'English',
          confidence: 0.95,
          sourceType: 'explicit_user_statement',
        },
      ],
      [{ sessionId: 's2' }]
    );

    const entry = store.getEntry('preferences.language');
    // The correction wins as a correction: no contradiction counted, and the
    // new value is not auto-verified (verification binds to the old value).
    expect(entry?.value).toBe('English');
    expect(entry?.confidenceSignals.userVerified).toBe(false);
    expect(entry?.confidenceSignals.contradictionCount).toBe(0);
  });

  it('tombstone: a deleted core fact is not resurrected by rebuild', async () => {
    insertSession(rawDb, { id: 's1', title: 'A', cwd: '/repo/a' });
    for (const [index, text] of [
      '请用中文回答，我叫 Jack。',
      '好的。',
      '我们修复了 gateway token rotation。',
      '完成。',
    ].entries()) {
      insertMessage(rawDb, {
        id: `s1-m-${index}`,
        sessionId: 's1',
        role: index % 2 ? 'assistant' : 'user',
        text,
        timestamp: index + 1,
      });
    }
    await service.enqueueIngestion({
      session: makeSession('s1', 'A', '/repo/a'),
      prompt: 'x',
      messages: DEFAULT_MESSAGES('s1'),
    });
    expect(service.listCoreEntries().some((e) => e.value === 'Jack')).toBe(true);

    service.deleteCoreEntry('identity.name');
    expect(service.listCoreEntries().some((e) => e.value === 'Jack')).toBe(false);

    await service.rebuildAll();
    expect(service.listCoreEntries().some((e) => e.value === 'Jack')).toBe(false);
  });
});
