import { afterEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../src/main/agent/agent-runner', () => ({
  AgentRunner: class {
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

afterEach(() => vi.useRealTimers());

describe('permission confirmation lifecycle', () => {
  it('waits beyond both former deadlines and accepts a late decision', async () => {
    vi.useFakeTimers();
    const events = vi.fn();
    const manager = new SessionManager(makeDb(), events);
    const settled = vi.fn();
    const pending = manager.requestPermission('s1', 'p1', 'bash', { command: 'rm report.csv' });
    void pending.then(settled);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(settled).not.toHaveBeenCalled();
    expect(events.mock.calls.some(([event]) => event.type === 'permission.dismiss')).toBe(false);
    manager.handlePermissionResponse('p1', 'allow');
    await expect(pending).resolves.toBe('allow');
    expect(events).toHaveBeenCalledWith({
      type: 'permission.dismiss',
      payload: { toolUseId: 'p1' },
    });
  });

  it('stopping one task clears its waiters without affecting another task', async () => {
    const manager = new SessionManager(makeDb(), vi.fn());
    const first = manager.requestPermission('s1', 'p1', 'bash', {});
    const second = manager.requestPermission('s2', 'p2', 'bash', {});
    const settled = vi.fn();
    void second.then(settled);
    manager.stopSession('s1');
    await expect(first).resolves.toBe('deny');
    expect(settled).not.toHaveBeenCalled();
    manager.handlePermissionResponse('p1', 'allow'); // A late stale reply cannot revive it.
    manager.handlePermissionResponse('p2', 'allow_always');
    await expect(second).resolves.toBe('allow_always');
  });

  it('always-allow also approves queued requests for the same tool in that task', async () => {
    const events = vi.fn();
    const manager = new SessionManager(makeDb(), events);
    const first = manager.requestPermission('s1', 'p1', 'bash', { command: 'ls' });
    const queuedSameTool = manager.requestPermission('s1', 'p2', 'bash', { command: 'cat a' });
    const otherTool = manager.requestPermission('s1', 'p3', 'write', { path: 'a' });
    const otherTask = manager.requestPermission('s2', 'p4', 'bash', { command: 'ls' });
    const pendingOther = vi.fn();
    void otherTool.then(pendingOther);
    void otherTask.then(pendingOther);

    manager.handlePermissionResponse('p1', 'allow_always');
    await expect(first).resolves.toBe('allow_always');
    await expect(queuedSameTool).resolves.toBe('allow');
    expect(events).toHaveBeenCalledWith({
      type: 'permission.dismiss',
      payload: { toolUseId: 'p2' },
    });
    await Promise.resolve();
    expect(pendingOther).not.toHaveBeenCalled();
    manager.stopSession('s1');
    manager.stopSession('s2');
  });

  it('aborting a run dismisses approval and an already cancelled run never opens it', async () => {
    const events = vi.fn();
    const manager = new SessionManager(makeDb(), events);
    const controller = new AbortController();
    const pending = manager.requestPermission('s1', 'p1', 'bash', {}, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe('deny');
    events.mockClear();
    await expect(
      manager.requestPermission('s1', 'p2', 'bash', {}, controller.signal)
    ).resolves.toBe('deny');
    expect(events).not.toHaveBeenCalled();
  });

  it('unattended sessions deny permission requests instead of waiting for a human', async () => {
    const events = vi.fn();
    const manager = new SessionManager(makeDb(), events);
    const session = await manager.startSession(
      '修复脚本',
      'fix it',
      '/tmp/workspace',
      undefined,
      undefined,
      undefined,
      undefined,
      { denyPermissionRequests: true }
    );
    events.mockClear();
    await expect(
      manager.requestPermission(session.id, 'p1', 'bash', { command: 'rm -rf x' })
    ).resolves.toBe('deny');
    expect(events).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'permission.request' })
    );
  });
});
