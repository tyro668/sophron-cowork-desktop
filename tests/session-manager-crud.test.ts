/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-session-manager-crud-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

// Shared minimal DB factory used across tests
function makeDb(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
  const defaultProject = {
    id: 'project-1',
    name: 'workspace',
    cwd: '/tmp/workspace',
    path_key: '/tmp/workspace',
    created_at: 1,
    updated_at: 1,
  };
  return {
    raw: {
      transaction: (fn: () => void) => fn,
    } as any,
    projects: {
      create: vi.fn(),
      update: vi.fn(() => defaultProject),
      get: vi.fn(() => defaultProject),
      getByPathKey: vi.fn(() => defaultProject),
      getAll: vi.fn(() => [defaultProject]),
      ensureForCwd: vi.fn((cwd: string) => ({
        ...defaultProject,
        cwd,
        path_key: cwd,
      })),
      delete: vi.fn(),
    },
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
    ...overrides,
  } as unknown as DatabaseInstance;
}

// ------------------------------------------------------------------
// listSessions
// ------------------------------------------------------------------
describe('SessionManager.listSessions', () => {
  it('returns empty array when database is empty', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(manager.listSessions()).toEqual([]);
    expect(db.sessions.getAll).toHaveBeenCalledTimes(1);
  });

  it('maps database rows to Session objects', () => {
    const row = {
      id: 's1',
      title: 'My Session',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: '/tmp/workspace',
      mounted_paths: JSON.stringify([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]),
      allowed_tools: JSON.stringify(['read', 'write']),
      memory_enabled: 0,
      model: 'claude-3-5-sonnet',
      created_at: 1000,
      updated_at: 2000,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const sessions = manager.listSessions();

    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.id).toBe('s1');
    expect(s.title).toBe('My Session');
    expect(s.cwd).toBe('/tmp/workspace');
    expect(s.mountedPaths).toEqual([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]);
    expect(s.allowedTools).toEqual(['read', 'write']);
    expect(s.memoryEnabled).toBe(false);
    expect(s.model).toBe('claude-3-5-sonnet');
    expect(s.createdAt).toBe(1000);
    expect(s.updatedAt).toBe(2000);
  });

  it('falls back to empty arrays when mounted_paths or allowed_tools JSON is malformed', () => {
    const row = {
      id: 's2',
      title: 'Broken JSON',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: null,
      mounted_paths: '{{{broken',
      allowed_tools: '[unclosed',
      memory_enabled: 0,
      model: null,
      created_at: 1,
      updated_at: 1,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [s] = manager.listSessions();

    expect(s.mountedPaths).toEqual([]);
    expect(s.allowedTools).toEqual([]);
  });
});

// ------------------------------------------------------------------
// startSession — project/workdir persistence
// ------------------------------------------------------------------
describe('SessionManager.startSession project persistence', () => {
  it('persists the selected cwd on the project and stores only project_id on the session row', async () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());

    const session = await manager.startSession('Task', 'hello', '/tmp/workspace');

    expect(db.projects?.ensureForCwd).toHaveBeenCalledWith('/tmp/workspace');
    expect(session.cwd).toBe('/tmp/workspace');
    expect(session.projectId).toBe('project-1');
    expect(db.sessions.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.sessions.create).mock.calls[0][0]).toMatchObject({
      project_id: 'project-1',
      cwd: null,
    });
  });
});

// ------------------------------------------------------------------
// getMessages — content normalization
// ------------------------------------------------------------------
describe('SessionManager.getMessages content normalization', () => {
  it('parses a JSON array content correctly', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hello' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const messages = manager.getMessages('s1');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('wraps a single JSON object content in an array', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm2',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify({ type: 'text', text: 'single block' }),
            timestamp: 2,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'single block' }]);
  });

  it('wraps a plain JSON string as a text content block', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm3',
            session_id: 's1',
            role: 'assistant',
            content: JSON.stringify('plain string content'),
            timestamp: 3,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'plain string content' }]);
  });

  it('falls back to raw string as text block when JSON parse fails', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm4',
            session_id: 's1',
            role: 'assistant',
            content: 'not valid json {{{',
            timestamp: 4,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'not valid json {{{' }]);
  });
});

describe('SessionManager.getTraceSteps', () => {
  it('restores correlation, error, permission, output and timing metadata', () => {
    const db = makeDb({
      traceSteps: {
        create: vi.fn(),
        update: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'tool-1',
            session_id: 's1',
            turn_id: 'turn-1',
            parent_id: 'root-1',
            type: 'tool_call',
            status: 'error',
            title: 'Create data task',
            content: null,
            tool_name: 'data_create_task',
            tool_input: JSON.stringify({ name: 'Sales task' }),
            tool_output: '[INVALID_INPUT] missing source',
            tool_output_truncated: 1,
            tool_output_length: 3000,
            result_message_id: 'message-1',
            is_error: 1,
            error_json: JSON.stringify({
              stage: 'validation',
              code: 'INVALID_INPUT',
              message: 'missing source',
            }),
            permission_json: JSON.stringify({ decision: 'user_allow', source: 'user' }),
            outcome: 'tool_failed',
            metrics_json: JSON.stringify({
              inputTokens: 100,
              outputTokens: 20,
              cacheReadTokens: 10,
              cacheWriteTokens: 0,
              totalTokens: 130,
              costTotal: 0.01,
              modelCallCount: 2,
              toolCallCount: 1,
              toolErrorCount: 1,
              permissionPromptCount: 1,
              totalDurationMs: 60,
              firstResponseLatencyMs: 40,
              firstTokenLatencyMs: 45,
              modelDurationMs: 50,
              toolDurationMs: 10,
              permissionWaitMs: 5,
            }),
            timestamp: 100,
            ended_at: 160,
            duration: 60,
          },
        ]),
      } as any,
    });

    const [step] = new SessionManager(db, vi.fn()).getTraceSteps('s1');

    expect(step).toMatchObject({
      turnId: 'turn-1',
      parentId: 'root-1',
      toolInput: { name: 'Sales task' },
      toolOutputTruncated: true,
      toolOutputLength: 3000,
      resultMessageId: 'message-1',
      isError: true,
      error: { stage: 'validation', code: 'INVALID_INPUT' },
      permission: { decision: 'user_allow', source: 'user' },
      outcome: 'tool_failed',
      metrics: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        totalTokens: 130,
        costTotal: 0.01,
        modelCallCount: 2,
        toolCallCount: 1,
        toolErrorCount: 1,
        permissionPromptCount: 1,
        totalDurationMs: 60,
        firstResponseLatencyMs: 40,
        firstTokenLatencyMs: 45,
        modelDurationMs: 50,
        toolDurationMs: 10,
        permissionWaitMs: 5,
      },
      endedAt: 160,
      duration: 60,
    });
  });
});

// ------------------------------------------------------------------
// handlePermissionResponse
// ------------------------------------------------------------------
describe('SessionManager.handlePermissionResponse', () => {
  it('resolves the pending permission promise with the given result', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    // Inject a fake pending permission via requestPermission
    const permissionPromise = manager.requestPermission('s1', 'tool-1', 'bash', { command: 'ls' });

    // Synchronously resolve it
    manager.handlePermissionResponse('tool-1', 'allow');

    const result = await permissionPromise;
    expect(result).toBe('allow');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    // Should not throw
    expect(() => manager.handlePermissionResponse('nonexistent', 'deny')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// handleSudoPasswordResponse
// ------------------------------------------------------------------
describe('SessionManager.handleSudoPasswordResponse', () => {
  it('resolves the pending sudo password promise with the given password', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    const sudoPromise = manager.requestSudoPassword('s1', 'tool-2', 'sudo apt-get update');

    manager.handleSudoPasswordResponse('tool-2', 'secret123');

    const password = await sudoPromise;
    expect(password).toBe('secret123');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(() => manager.handleSudoPasswordResponse('nonexistent', 'pw')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// deleteSession — cache eviction
// ------------------------------------------------------------------
describe('SessionManager.deleteSession cache eviction', () => {
  it('evicts the message cache when a session is deleted', async () => {
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hi' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());

    // Populate the cache
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(1);

    // Delete the session (mocked: no real DB changes)
    await manager.deleteSession('s1');

    // Cache should have been evicted — DB should be hit again on next call
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(2);
  });
});
