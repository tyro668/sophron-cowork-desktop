import { describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun, AutomationArtifact } from '../src/shared/automation/types';
import {
  AutomationActionRegistry,
  objectSchema,
} from '../src/main/automation/automation-action-registry';
import { AutomationRunner } from '../src/main/automation/automation-runner';
import type { AutomationStore } from '../src/main/automation/automation-store';

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  const now = 1_000;
  return {
    id: 'automation-1',
    name: 'Daily report',
    description: null,
    projectId: null,
    groupId: null,
    enabled: true,
    status: 'enabled',
    trigger: { kind: 'once', runAt: now + 1_000, timezone: 'UTC' },
    actionGraph: {
      version: 1,
      nodes: [
        { id: 'first', type: 'test.first', enabled: true, config: {} },
        { id: 'second', type: 'test.second', enabled: true, config: {} },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'first', targetNodeId: 'second' }],
    },
    delivery: null,
    failurePolicy: {
      disableOnFailure: false,
      retry: { enabled: false, maxAttempts: 0, backoffMs: 0 },
      notifyOnFailure: true,
    },
    concurrencyPolicy: { overlapPolicy: 'skip' },
    nextRunAt: now + 1_000,
    lockedRunId: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createStore(): AutomationStore & {
  runs: AutomationRun[];
  artifacts: AutomationArtifact[];
} {
  const runs: AutomationRun[] = [];
  const artifacts: AutomationArtifact[] = [];
  return {
    runs,
    artifacts,
    updateTogether: vi.fn(),
    getTablePolicy: vi.fn(() => ({ runOnChange: false, runOnTrigger: true })),
    setTablePolicy: vi.fn(),
    list: vi.fn(() => ({ automations: [], groupCounts: {} })),
    listGroups: vi.fn(() => []),
    createGroup: vi.fn(),
    renameGroup: vi.fn(() => false),
    deleteGroup: vi.fn(() => false),
    assignToGroup: vi.fn(),
    get: vi.fn(() => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listRunnable: vi.fn(() => []),
    setRuntimeState: vi.fn(() => null),
    createRun: vi.fn((input) => {
      const run: AutomationRun = {
        id: `run-${runs.length + 1}`,
        automationId: input.automationId,
        status: input.status,
        triggerReason: input.triggerReason,
        queuedAt: input.queuedAt ?? null,
        startedAt: input.startedAt ?? null,
        finishedAt: null,
        durationMs: null,
        error: null,
        artifactCount: 0,
        deliveryStatus: null,
        createdSessionId: null,
        createdAt: 1_000,
      };
      runs.push(run);
      return run;
    }),
    updateRun: vi.fn((id, updates) => {
      const index = runs.findIndex((run) => run.id === id);
      const next = { ...runs[index], ...updates };
      runs[index] = next;
      return next;
    }),
    listRuns: vi.fn(() => runs),
    createArtifact: vi.fn((input) => {
      const artifact: AutomationArtifact = {
        id: `artifact-${artifacts.length + 1}`,
        runId: input.runId,
        sourceNodeId: input.sourceNodeId ?? undefined,
        kind: input.kind,
        title: input.title,
        summary: input.summary ?? undefined,
        createdAt: 1_000,
      };
      artifacts.push(artifact);
      return artifact;
    }),
    listArtifacts: vi.fn(() => artifacts),
    migrateScheduledTasks: vi.fn(),
    recoverInterruptedRuns: vi.fn(() => ({
      failedRunningRuns: 0,
      cancelledQueuedRuns: 0,
      releasedAutomations: 0,
    })),
  };
}

describe('AutomationRunner', () => {
  it('executes actions in graph order and records artifacts', async () => {
    const store = createStore();
    const registry = new AutomationActionRegistry();
    const calls: string[] = [];
    registry.register({
      type: 'test.first',
      title: 'First',
      category: 'custom',
      icon: 'play',
      version: 1,
      configSchema: objectSchema({}),
      defaultConfig: {},
      execute: async (_config, context) => {
        calls.push('first');
        context.emitArtifact({ kind: 'text', title: 'first artifact' });
        return { ok: true };
      },
    });
    registry.register({
      type: 'test.second',
      title: 'Second',
      category: 'custom',
      icon: 'play',
      version: 1,
      configSchema: objectSchema({}),
      defaultConfig: {},
      execute: async (_config, context) => {
        calls.push('second');
        context.emitArtifact({ kind: 'text', title: 'second artifact' });
        return { ok: true };
      },
    });

    const notifyRunFinished = vi.fn();
    const runner = new AutomationRunner({ store, registry, now: () => 2_000, notifyRunFinished });
    const automation = createAutomation();
    const run = await runner.run(automation, 'manual');

    expect(calls).toEqual(['first', 'second']);
    expect(store.artifacts).toHaveLength(2);
    expect(run.status).toBe('succeeded');
    expect(run.artifactCount).toBe(2);
    expect(notifyRunFinished).toHaveBeenCalledWith(automation, run);
  });

  it('marks a run failed when an action throws', async () => {
    const store = createStore();
    const registry = new AutomationActionRegistry();
    registry.register({
      type: 'test.first',
      title: 'First',
      category: 'custom',
      icon: 'play',
      version: 1,
      configSchema: objectSchema({}),
      defaultConfig: {},
      execute: async () => {
        throw new Error('boom');
      },
    });

    const notifyRunFinished = vi.fn();
    const runner = new AutomationRunner({ store, registry, now: () => 2_000, notifyRunFinished });
    const automation = createAutomation({
      actionGraph: {
        version: 1,
        nodes: [{ id: 'first', type: 'test.first', enabled: true, config: {} }],
        edges: [],
      },
    });
    const run = await runner.run(automation, 'manual');

    expect(run.status).toBe('failed');
    expect(run.error).toBe('boom');
    expect(notifyRunFinished).toHaveBeenCalledWith(automation, run);
  });

  it('continues to the next action when a failed action has onFailure=continue', async () => {
    const store = createStore();
    const registry = new AutomationActionRegistry();
    const second = vi.fn(async () => ({ ok: true }));
    for (const [type, execute] of [
      [
        'test.first',
        async () => {
          throw new Error('boom');
        },
      ],
      ['test.second', second],
    ] as const) {
      registry.register({
        type,
        title: type,
        category: 'custom',
        icon: 'play',
        version: 1,
        configSchema: objectSchema({}),
        defaultConfig: {},
        execute,
      });
    }
    const runner = new AutomationRunner({ store, registry, now: () => 2_000 });
    const automation = createAutomation({
      actionGraph: {
        version: 1,
        nodes: [
          {
            id: 'first',
            type: 'test.first',
            enabled: true,
            config: {},
            failurePolicy: { onFailure: 'continue', emitErrorArtifact: false },
          },
          { id: 'second', type: 'test.second', enabled: true, config: {} },
        ],
        edges: [{ id: 'edge-1', sourceNodeId: 'first', targetNodeId: 'second' }],
      },
    });
    const run = await runner.run(automation, 'manual');

    expect(second).toHaveBeenCalled();
    expect(run.status).toBe('succeeded');
  });
});
