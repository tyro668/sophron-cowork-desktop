import { harnessDatabase, temporaryDatabasePath } from './fixtures/harness-db';
import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';
import type { ServerEvent } from '../src/shared/contracts';

// --- Mocks (must be before SessionManager import) ---

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
    public path = '/tmp/mock-queue-config-store.json';

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

vi.mock('../src/main/agent/agent-runner', () => ({
  AgentRunner: class {
    run = vi.fn().mockResolvedValue({ status: 'succeeded' });
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import Database from 'better-sqlite3';
import { migrateMainSchema } from '../src/main/db/database';
import { PathResolver } from '../src/main/sandbox/path-resolver';
import * as modelResolution from '../src/main/agent/agent-runner-model';
import * as sandboxSync from '../src/main/agent/agent-runner-sandbox-sync';
import { getSandboxAdapter } from '../src/main/sandbox/sandbox-adapter';
import { AutomationRunner } from '../src/main/automation/automation-runner';
import { createAutomationStore } from '../src/main/automation/automation-store';
import { createDefaultAutomationActionRegistry } from '../src/main/automation/default-actions';
import { harnessMessage } from '../src/main/utils/harness-messages';
import { waitForSessionTurn } from '../src/main/automation/wait-for-session';
import { SessionManager } from '../src/main/session/session-manager';
import { configStore } from '../src/main/config/config-store';
import { getPermissionRulesForPolicy } from '../src/shared/permission-policies';

// Helper: create a minimal mock DB
function createMockDb() {
  const storage = harnessDatabase();
  storage.raw
    .prepare(
      "INSERT INTO sessions(id,title,cwd,created_at,updated_at) VALUES ('s1','Test','/tmp',0,0)"
    )
    .run();
  return {
    ...storage,
    sessions: {
      ...storage.sessions,
      create: vi.fn(storage.sessions.create),
      get: vi.fn(storage.sessions.get),
      update: vi.fn(storage.sessions.update),
    },
    messages: {
      ...storage.messages,
      create: vi.fn(storage.messages.create),
      getBySessionId: vi.fn(storage.messages.getBySessionId),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

describe('SessionManager processQueue concurrency', () => {
  let db: DatabaseInstance;
  let sendToRenderer: Mock<(event: ServerEvent) => void>;

  beforeEach(() => {
    db = createMockDb();
    sendToRenderer = vi.fn<(event: ServerEvent) => void>();
  });

  it('settles each queued turn independently with the same ID passed to the runner', async () => {
    const manager = new SessionManager(db, sendToRenderer);
    const runtime = manager as unknown as {
      ensureSandboxInitialized: Mock;
      agentRunner: { run: Mock };
      runSessionTitleGeneration: Mock;
    };
    vi.spyOn(runtime, 'ensureSandboxInitialized').mockResolvedValue(undefined);
    vi.spyOn(runtime, 'runSessionTitleGeneration').mockResolvedValue(undefined);
    let fail!: (error: Error) => void;
    runtime.agentRunner.run
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          })
      )
      .mockResolvedValueOnce({ status: 'succeeded' });
    const first = await manager.continueSession('s1', 'first');
    const second = await manager.continueSession('s1', 'second');
    expect(first.turnId).not.toBe(second.turnId);
    await vi.waitFor(() => expect(runtime.agentRunner.run).toHaveBeenCalledTimes(1));
    fail(new Error('first failed'));
    await expect(waitForSessionTurn(first, 1000)).rejects.toThrow('first failed');
    await expect(waitForSessionTurn(second, 1000)).resolves.toBeUndefined();
    expect(runtime.agentRunner.run.mock.calls.map((call) => call[4].turnId)).toEqual([
      first.turnId,
      second.turnId,
    ]);
  });

  it('recovers queued input once and keeps the receipt of an interrupted write', async () => {
    const path = temporaryDatabasePath();
    const original = harnessDatabase(path);
    original.raw
      .prepare(
        "INSERT INTO sessions(id,title,cwd,created_at,updated_at) VALUES ('s1','Test','/tmp',0,0)"
      )
      .run();
    const route = vi.fn().mockResolvedValue({ model: 'stored-model', apiKey: 'ephemeral-secret' });
    const prepare = (storage: DatabaseInstance) => {
      const manager = new SessionManager(
        storage,
        sendToRenderer,
        undefined,
        undefined,
        undefined,
        undefined,
        route
      );
      const internals = manager as unknown as {
        ensureSandboxInitialized: Mock;
        agentRunner: { run: Mock };
        runSessionTitleGeneration: Mock;
      };
      vi.spyOn(internals, 'ensureSandboxInitialized').mockResolvedValue(undefined);
      vi.spyOn(internals, 'runSessionTitleGeneration').mockResolvedValue(undefined);
      return { manager, run: internals.agentRunner.run };
    };
    const first = prepare(original);
    first.run.mockImplementationOnce(() => new Promise(() => {}));
    const inFlight = await first.manager.continueSession('s1', 'commit once');
    const queued = await first.manager.continueSession('s1', 'inspect receipt', undefined, {
      modelConfigSetId: 'inspection',
      permissionPolicy: 'default',
      selectedSkillNames: ['inspect'],
    });
    await vi.waitFor(() => expect(first.run).toHaveBeenCalledOnce());
    expect(JSON.stringify(first.run.mock.calls[0][2])).not.toContain('inspect receipt');
    first.manager.saveMessage({
      id: 'receipt',
      sessionId: 's1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [
        {
          type: 'tool_result',
          toolUseId: 'write',
          content: 'saved',
          structuredContent: { receiptId: 'stored-123' },
        },
      ],
    });
    expect(first.manager.getMessages('s1').map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    const copiedId = first.manager.duplicateSession('s1', ' (copy)')!;
    expect(first.manager.getMessages(copiedId).map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(
      original.raw
        .prepare('SELECT status FROM session_turns WHERE session_id=? ORDER BY sequence')
        .pluck()
        .all(copiedId)
    ).toEqual(['cancelled', 'cancelled']);
    original.close();

    const reopened = harnessDatabase(path);
    const next = prepare(reopened);
    next.manager.restorePendingTurns();
    next.manager.restorePendingTurns();
    await next.manager.waitForSessionIdle('s1');
    expect(next.run).toHaveBeenCalledOnce();
    const [, prompt, history, config, settings] = next.run.mock.calls[0];
    expect(prompt).toBe('inspect receipt');
    expect(config.model).toBe('stored-model');
    expect(route).toHaveBeenCalledWith('inspection');
    expect(settings).toMatchObject({
      turnId: queued.turnId,
      selectedSkillNames: ['inspect'],
      permissionPolicy: 'default',
      permissionRules: getPermissionRulesForPolicy('default'),
    });
    expect(history.filter((message: { role: string }) => message.role === 'user')).toHaveLength(2);
    expect(JSON.stringify(history)).toContain('stored-123');
    expect(history.at(-1).id).toBe(settings.messageId);
    const records = reopened.raw
      .prepare(
        "SELECT turn_id,status,options_json FROM session_turns WHERE session_id='s1' ORDER BY sequence"
      )
      .all();
    expect(records).toMatchObject([
      { turn_id: inFlight.turnId, status: 'interrupted' },
      { turn_id: queued.turnId, status: 'succeeded' },
    ]);
    expect(JSON.stringify(records)).not.toContain('ephemeral-secret');
    expect(JSON.stringify(next.manager.getMessages('s1'))).toContain(harnessMessage('interrupted'));
    reopened.close();
    const final = prepare(harnessDatabase(path));
    final.manager.restorePendingTurns();
    await final.manager.waitForSessionIdle('s1');
    expect(final.run).not.toHaveBeenCalled();
  });

  it('keeps receipts of cancelled running turns while omitting unexecuted cancelled input', async () => {
    const manager = new SessionManager(db, sendToRenderer);
    const runtime = manager as unknown as {
      ensureSandboxInitialized: Mock;
      agentRunner: { run: Mock };
      runSessionTitleGeneration: Mock;
    };
    vi.spyOn(runtime, 'ensureSandboxInitialized').mockResolvedValue(undefined);
    vi.spyOn(runtime, 'runSessionTitleGeneration').mockResolvedValue(undefined);
    let stop!: () => void;
    runtime.agentRunner.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stop = () => resolve({ status: 'cancelled' });
        })
    );
    const first = await manager.continueSession('s1', 'save record');
    await vi.waitFor(() => expect(runtime.agentRunner.run).toHaveBeenCalledOnce());
    await manager.continueSession('s1', 'never execute this');
    manager.stopSession('s1');
    manager.saveMessage({
      id: 'saved',
      sessionId: 's1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [{ type: 'tool_result', toolUseId: 'write', content: 'committed-123' }],
    });
    stop();
    await first.completion;
    const next = await manager.continueSession('s1', 'review the receipt');
    await next.completion;
    const history = JSON.stringify(runtime.agentRunner.run.mock.calls[1][2]);
    expect(history).toContain('committed-123');
    expect(history).not.toContain('never execute this');
  });

  it('distinguishes a turn timeout from the deadline of an individual waiter', async () => {
    vi.useFakeTimers();
    try {
      const manager = new SessionManager(db, sendToRenderer);
      const runtime = manager as unknown as {
        ensureSandboxInitialized: Mock;
        agentRunner: { run: Mock };
      };
      let release!: () => void;
      vi.spyOn(runtime, 'ensureSandboxInitialized').mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      runtime.agentRunner.run.mockResolvedValue({ status: 'timed_out' });
      const turn = await manager.continueSession('s1', 'slow');
      const longWait = expect(waitForSessionTurn(turn, 30 * 24 * 60 * 60 * 1000)).rejects.toThrow(
        harnessMessage('turnTimeout')
      );
      const expired = expect(waitForSessionTurn(turn, 25)).rejects.toThrow(
        harnessMessage('waitTimeout', { timeoutMs: 25 })
      );
      await vi.advanceTimersByTimeAsync(25);
      await expired;
      release();
      await expect(turn.completion).resolves.toEqual({ status: 'timed_out' });
      await longWait;
      await expect(waitForSessionTurn(turn, 1000)).rejects.toThrow(harnessMessage('turnTimeout'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a failed conversation step and stops before the next action', async () => {
    const raw = new Database(':memory:');
    try {
      migrateMainSchema(raw);
      const store = createAutomationStore({ raw } as DatabaseInstance);
      const manager = new SessionManager(db, sendToRenderer);
      const row = db.sessions.get('s1')!;
      vi.mocked(db.sessions.get).mockImplementation((id) => ({ ...row, id }));
      const { AgentRunner } = await vi.importActual<
        typeof import('../src/main/agent/agent-runner')
      >('../src/main/agent/agent-runner');
      const agentRunner = new AgentRunner(
        {
          sendToRenderer,
          saveMessage: (message) => manager.saveMessage(message),
        },
        new PathResolver()
      );
      const runtime = manager as unknown as {
        ensureSandboxInitialized: Mock;
        agentRunner: typeof agentRunner;
      };
      runtime.agentRunner = agentRunner;
      vi.spyOn(runtime, 'ensureSandboxInitialized').mockResolvedValue(undefined);
      vi.spyOn(sandboxSync, 'initSandboxSyncForRun').mockResolvedValueOnce({
        sandboxPath: null,
        useSandboxIsolation: false,
        sandbox: getSandboxAdapter(),
      });
      vi.spyOn(modelResolution, 'resolveRunModel').mockRejectedValueOnce(
        new Error('provider unavailable')
      );
      const registry = createDefaultAutomationActionRegistry({
        sessionManager: manager,
        dataPipelineStore: {} as never,
      });
      const next = vi.fn();
      registry.register({
        type: 'test.next',
        title: 'Next',
        category: 'custom',
        icon: 'play',
        version: 1,
        configSchema: { type: 'object', properties: {} },
        defaultConfig: {},
        execute: next,
      });
      const automation = store.create({
        name: 'Chat failure',
        trigger: { kind: 'manual', timezone: 'UTC' },
        actionGraph: {
          version: 1,
          nodes: [
            {
              id: 'chat',
              type: 'conversation.run',
              enabled: true,
              config: { prompt: 'go', completionMode: 'wait' },
            },
            { id: 'next', type: 'test.next', enabled: true, config: {} },
          ],
          edges: [{ id: 'flow', sourceNodeId: 'chat', targetNodeId: 'next' }],
        },
      });
      await new AutomationRunner({ store, registry }).run(automation, 'manual');
      const [run] = store.listRuns(automation.id);
      expect(run).toMatchObject({
        status: 'failed',
        executionSummary: {
          steps: [
            expect.objectContaining({
              nodeId: 'chat',
              status: 'failed',
              error: 'provider unavailable',
            }),
          ],
        },
      });
      const [artifact] = store.listArtifacts(run.id);
      const sessionId = artifact.dataRef?.id;
      expect(manager.getMessages(sessionId!)).toContainEqual(
        expect.objectContaining({
          role: 'assistant',
          content: [{ type: 'text', text: '**Error**: provider unavailable' }],
        })
      );
      expect(next).not.toHaveBeenCalled();
    } finally {
      raw.close();
    }
  });

  it('returns the submitted turn immediately in fire-and-forget mode', async () => {
    const manager = new SessionManager(db, sendToRenderer);
    const runtime = manager as unknown as { ensureSandboxInitialized: Mock };
    let release!: () => void;
    vi.spyOn(runtime, 'ensureSandboxInitialized').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const registry = createDefaultAutomationActionRegistry({
      sessionManager: manager,
      dataPipelineStore: {} as never,
    });
    const action = registry.get('conversation.run')!;
    const result = (await action.execute(
      { prompt: 'go', completionMode: 'fire_and_forget' },
      { emitArtifact: vi.fn() } as never,
      {} as never
    )) as { sessionId: string; turnId: string };
    expect(result).toMatchObject({ sessionId: expect.any(String), turnId: expect.any(String) });
    manager.stopSession(result.sessionId);
    release();
    await manager.waitForSessionIdle(result.sessionId);
  });

  it('keeps the permission policy passed to startSession together with its rules', async () => {
    const manager = new SessionManager(db, sendToRenderer);
    const processPrompt = vi.fn().mockResolvedValue({ status: 'succeeded' });
    (manager as unknown as { processPrompt: typeof processPrompt }).processPrompt = processPrompt;
    const rules = getPermissionRulesForPolicy('auto_review');
    const { session } = await manager.startSession(
      'Background',
      'go',
      '/tmp',
      undefined,
      undefined,
      undefined,
      undefined,
      { permissionPolicy: 'auto_review', permissionRules: rules }
    );
    await vi.waitFor(() => expect(processPrompt).toHaveBeenCalledTimes(1));
    expect(processPrompt.mock.calls[0][3]).toMatchObject({
      permissionPolicy: 'auto_review',
      permissionRules: rules,
    });
    await manager.waitForSessionIdle(session.id);
  });

  it('drains messages sent immediately after stop before announcing idle', async () => {
    const onCompleted = vi.fn();
    const manager = new SessionManager(db, sendToRenderer, undefined, undefined, onCompleted);
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const processPrompt = vi
      .fn()
      .mockReturnValueOnce(first.then(() => ({ status: 'cancelled' })))
      .mockReturnValueOnce(second.then(() => ({ status: 'succeeded' })))
      .mockResolvedValue({ status: 'succeeded' });
    (manager as unknown as { processPrompt: typeof processPrompt }).processPrompt = processPrompt;
    const statuses = () =>
      sendToRenderer.mock.calls.flatMap(([event]) =>
        event.type === 'session.status' ? [event.payload.status] : []
      );

    await manager.continueSession('s1', 'running');
    const discarded = await manager.continueSession('s1', 'discarded by stop');
    manager.stopSession('s1');
    await expect(discarded.completion).resolves.toEqual({ status: 'cancelled' });
    await manager.continueSession('s1', 'after stop');
    await manager.continueSession('s1', 'last');
    const becameIdle = vi.fn();
    const idle = manager.waitForSessionIdle('s1').then(becameIdle);
    expect(processPrompt).toHaveBeenCalledTimes(1);
    finishFirst();
    await vi.waitFor(() => expect(processPrompt).toHaveBeenCalledTimes(2));
    expect(statuses()).toEqual(['running']);
    expect(becameIdle).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
    finishSecond();
    await idle;
    expect(processPrompt.mock.calls.map((call) => call[1])).toEqual([
      'running',
      'after stop',
      'last',
    ]);
    expect(statuses()).toEqual(['running', 'idle']);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('stopping during prompt preparation prevents the cancelled agent turn from starting', async () => {
    let finishSetup!: () => void;
    const setup = new Promise<void>((resolve) => {
      finishSetup = resolve;
    });
    const onCompleted = vi.fn();
    const manager = new SessionManager(db, sendToRenderer, undefined, undefined, onCompleted);
    const runtime = manager as unknown as {
      ensureSandboxInitialized: () => Promise<void>;
      agentRunner: { run: Mock };
    };
    vi.spyOn(runtime, 'ensureSandboxInitialized').mockReturnValue(setup);
    const preparing = await manager.continueSession('s1', 'preparing');
    const idle = manager.waitForSessionIdle('s1');
    manager.stopSession('s1');
    finishSetup();
    await expect(preparing.completion).resolves.toEqual({ status: 'cancelled' });
    await idle;
    expect(runtime.agentRunner.run).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('captures the current policy for each queued turn before another mode is selected', async () => {
    const manager = new SessionManager(db, sendToRenderer);
    const originalPolicy = configStore.get('permissionPolicy');
    const session = {
      id: 's1',
      title: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
      status: 'idle',
      cwd: '/tmp',
    };
    let finishFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const processPrompt = vi
      .fn()
      .mockImplementationOnce(() => firstRun.then(() => ({ status: 'succeeded' })))
      .mockResolvedValue({ status: 'succeeded' });
    (manager as unknown as { processPrompt: typeof processPrompt }).processPrompt = processPrompt;
    (manager as unknown as { loadSession: (id: string) => unknown }).loadSession = () => session;
    const enqueuePrompt = (
      manager as unknown as {
        enqueuePrompt: (session: unknown, prompt: string) => void;
      }
    ).enqueuePrompt.bind(manager);

    try {
      configStore.set('permissionPolicy', 'default');
      enqueuePrompt(session, 'first');
      await vi.waitFor(() => expect(processPrompt).toHaveBeenCalledTimes(1));

      configStore.set('permissionPolicy', 'full_access');
      enqueuePrompt(session, 'second');
      finishFirst();
      await vi.waitFor(() => expect(processPrompt).toHaveBeenCalledTimes(2));

      expect(processPrompt.mock.calls[0][3].permissionRules).toEqual(
        getPermissionRulesForPolicy('default')
      );
      expect(processPrompt.mock.calls[0][3].permissionPolicy).toBe('default');
      expect(processPrompt.mock.calls[1][3].permissionRules).toEqual(
        getPermissionRulesForPolicy('full_access')
      );
      expect(processPrompt.mock.calls[1][3].permissionPolicy).toBe('full_access');
    } finally {
      finishFirst();
      configStore.set('permissionPolicy', originalPolicy);
      await manager.waitForSessionIdle('s1');
    }
  });

  it('publishes a single running and idle transition for consecutive queued turns', async () => {
    const manager = new SessionManager(db, sendToRenderer);

    const statusUpdates: string[] = [];
    sendToRenderer.mockImplementation((msg: ServerEvent) => {
      if (msg.type === 'session.status' && msg.payload.status) {
        statusUpdates.push(msg.payload.status);
      }
    });

    // Spy on processPrompt to simulate async work.
    // The first call resolves normally; we'll enqueue a second prompt during it.
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstCall = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const secondCall = new Promise<void>((r) => {
      resolveSecond = r;
    });

    let callCount = 0;
    const processPromptSpy = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return firstCall.then(() => ({ status: 'succeeded' }));
      return secondCall.then(() => ({ status: 'succeeded' }));
    });

    // Replace the private processPrompt with our spy
    (manager as unknown as { processPrompt: typeof processPromptSpy }).processPrompt =
      processPromptSpy;

    // Also mock loadSession to return a session
    (manager as unknown as { loadSession: (id: string) => unknown }).loadSession = (
      id: string
    ) => ({
      id,
      title: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
      status: 'running' as const,
      cwd: '/tmp',
    });

    // Enqueue first prompt — starts processQueue
    (manager as unknown as { enqueuePrompt: (s: unknown, p: string) => void }).enqueuePrompt(
      {
        id: 's1',
        title: 'Test',
        created_at: Date.now(),
        updated_at: Date.now(),
        status: 'idle',
        cwd: '/tmp',
      },
      'first prompt'
    );

    // processQueue is now running and awaiting firstCall.
    // Enqueue a second prompt while the first is still processing.
    (manager as unknown as { enqueuePrompt: (s: unknown, p: string) => void }).enqueuePrompt(
      {
        id: 's1',
        title: 'Test',
        created_at: Date.now(),
        updated_at: Date.now(),
        status: 'idle',
        cwd: '/tmp',
      },
      'second prompt'
    );

    // Releasing the first turn starts the second without an idle transition.
    resolveFirst();
    await new Promise((r) => setTimeout(r, 10));

    // The second call should be in flight now.
    expect(processPromptSpy).toHaveBeenCalledTimes(2);

    // Resolve the second call to let processQueue finish cleanly.
    resolveSecond();
    await new Promise((r) => setTimeout(r, 10));

    // Status should be: running → idle (only ONE running/idle cycle, not two).
    const runningCount = statusUpdates.filter((s) => s === 'running').length;
    const idleCount = statusUpdates.filter((s) => s === 'idle').length;
    expect(runningCount).toBe(1);
    expect(idleCount).toBe(1);
  });

  it('finally block does not restart processQueue (no duplicate queue possible)', async () => {
    const manager = new SessionManager(db, sendToRenderer);

    const processQueue = vi.spyOn(
      manager as unknown as { processQueue: (...args: unknown[]) => Promise<void> },
      'processQueue'
    );

    // Mock processPrompt to resolve immediately
    (
      manager as unknown as { processPrompt: () => Promise<{ status: 'succeeded' }> }
    ).processPrompt = vi.fn().mockResolvedValue({ status: 'succeeded' });
    (manager as unknown as { loadSession: (id: string) => unknown }).loadSession = (
      id: string
    ) => ({
      id,
      title: 'Test',
      created_at: Date.now(),
      updated_at: Date.now(),
      status: 'running' as const,
      cwd: '/tmp',
    });

    // Enqueue two prompts at once — both should be processed in a single processQueue call
    (manager as unknown as { enqueuePrompt: (s: unknown, p: string) => void }).enqueuePrompt(
      {
        id: 's1',
        title: 'Test',
        created_at: Date.now(),
        updated_at: Date.now(),
        status: 'idle',
        cwd: '/tmp',
      },
      'prompt 1'
    );
    (manager as unknown as { enqueuePrompt: (s: unknown, p: string) => void }).enqueuePrompt(
      {
        id: 's1',
        title: 'Test',
        created_at: Date.now(),
        updated_at: Date.now(),
        status: 'idle',
        cwd: '/tmp',
      },
      'prompt 2'
    );

    await new Promise((r) => setTimeout(r, 50));

    // processQueue should have been entered exactly once (not re-entered from finally)
    expect(processQueue).toHaveBeenCalledTimes(1);
  });
});

describe('SessionManager cache eviction', () => {
  it('does not evict when saving a message for an already-cached session', () => {
    const db = createMockDb();
    const manager = new SessionManager(db, vi.fn());

    db.raw
      .prepare(
        "INSERT INTO sessions(id,title,created_at,updated_at) VALUES ('session-0','Test',0,0)"
      )
      .run();
    // Fill the cache to MAX_CACHE_SIZE by fetching messages for many sessions.
    // getMessages populates the cache via messageCache.set.
    const MAX = 100; // SessionManager.MAX_CACHE_SIZE
    for (let i = 0; i < MAX + 1; i++) {
      const sid = `session-${i}`;
      (db.messages.getBySessionId as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        {
          id: `m-${i}`,
          session_id: sid,
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: `msg ${i}` }]),
          timestamp: i,
          token_usage: null,
        },
      ]);
      manager.getMessages(sid);
    }

    // At this point cache has 101 entries. The oldest is 'session-0'.
    // Save a message for 'session-0' (already cached) — this should NOT
    // trigger eviction and delete session-0's cache.
    manager.saveMessage({
      id: 'new-msg',
      sessionId: 'session-0',
      role: 'assistant',
      content: [{ type: 'text', text: 'reply' }],
      timestamp: 999,
    });

    // session-0 should still be cached and contain the new message
    const msgs = manager.getMessages('session-0');
    expect(msgs.some((m) => m.id === 'new-msg')).toBe(true);
    // DB should NOT have been re-read for session-0 (cache still intact)
    const getBySessionCalls = (db.messages.getBySessionId as ReturnType<typeof vi.fn>).mock.calls;
    const session0Reads = getBySessionCalls.filter((c: string[]) => c[0] === 'session-0');
    expect(session0Reads).toHaveLength(1); // only the initial getMessages call
  });
});
