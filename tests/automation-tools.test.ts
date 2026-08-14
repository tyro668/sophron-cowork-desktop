import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import type { Automation } from '../src/shared/automation/types';
import { compileAutomationSchedule } from '../src/main/automation/tools/schedule-compiler';
import { AutomationToolService } from '../src/main/automation/tools/service';
import { AutomationDraftReceiptStore } from '../src/main/automation/tools/draft-receipt-store';
import { createAutomationCustomTools } from '../src/main/automation/tools';
import {
  AutomationPrepareParametersSchema,
  parseAutomationPrepareInput,
} from '../src/main/automation/tools/contract';
import { createDefaultAutomationActionRegistry } from '../src/main/automation/default-actions';

function createServiceFixture(options: { now?: () => number } = {}) {
  const automations: Automation[] = [];
  const create = vi.fn((input) => {
    const now = Date.now();
    const automation: Automation = {
      id: `automation-${automations.length + 1}`,
      name: input.name,
      description: input.description ?? null,
      projectId: input.projectId ?? null,
      enabled: input.enabled !== false,
      status: input.enabled === false ? 'disabled' : 'enabled',
      trigger: input.trigger,
      actionGraph: input.actionGraph,
      delivery: null,
      failurePolicy: {
        disableOnFailure: false,
        retry: { enabled: false, maxAttempts: 0, backoffMs: 60_000 },
        notifyOnFailure: true,
      },
      concurrencyPolicy: { overlapPolicy: 'skip' },
      nextRunAt: input.trigger.kind === 'once' ? input.trigger.runAt : now + 60_000,
      lockedRunId: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    automations.push(automation);
    return automation;
  });
  const automationService = {
    list: vi.fn(() => automations),
    get: vi.fn((id: string) => automations.find((automation) => automation.id === id) ?? null),
    create,
  };
  const task = {
    id: 'task-1',
    name: 'Clean sales',
    status: 'completed',
    nodeCount: 2,
  };
  const dataTaskStore = {
    getTaskRecord: vi.fn(async (id: string) => (id === task.id ? task : null)),
    getTaskWorkflow: vi.fn(async (id: string) => {
      if (id !== task.id) throw new Error('not found');
      return { nodes: [{ id: 'input' }, { id: 'output' }], edges: [] };
    }),
  };
  const onAutomationsChanged = vi.fn();
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const service = new AutomationToolService({
    automationService: automationService as never,
    dataTaskStore: dataTaskStore as never,
    receiptStore: new AutomationDraftReceiptStore({ now: options.now }),
    now: options.now,
    systemTimezone: () => systemTimezone,
    onAutomationsChanged,
  });
  return { service, create, dataTaskStore, onAutomationsChanged, systemTimezone };
}

describe('automation conversation tools', () => {
  it('exposes list, prepare, and create tools', () => {
    const { service } = createServiceFixture();
    const tools = createAutomationCustomTools(service, { sessionId: 'session-1' });
    expect(tools.map((tool) => tool.name)).toEqual([
      'automation_list',
      'automation_prepare',
      'automation_create',
    ]);
  });

  it('accepts model-serialized schedule and action objects, then validates them with Zod', async () => {
    const { service } = createServiceFixture();
    const tools = createAutomationCustomTools(service, { sessionId: 'session-1' });
    const prepareTool = tools.find((tool) => tool.name === 'automation_prepare');
    const rawArguments = {
      name: 'Daily sales cleanup',
      schedule: JSON.stringify({ kind: 'daily', times: ['10:00'] }),
      action: JSON.stringify({ kind: 'data_task', taskId: 'task-1' }),
    };

    expect(Value.Check(AutomationPrepareParametersSchema, rawArguments)).toBe(true);
    expect(prepareTool).toBeDefined();

    const prepared = await Reflect.apply(prepareTool!.execute, prepareTool, [
      'tool-call-1',
      rawArguments,
    ]);
    expect(prepared.details).toMatchObject({ status: 'ready' });
  });

  it('keeps strict validation after parsing compatibility JSON strings', () => {
    expect(() =>
      parseAutomationPrepareInput({
        name: 'Invalid time',
        schedule: JSON.stringify({ kind: 'daily', times: ['25:00'] }),
        action: JSON.stringify({ kind: 'data_task', taskId: 'task-1' }),
      })
    ).toThrow('Invalid automation_prepare arguments');

    expect(() =>
      parseAutomationPrepareInput({
        name: 'Malformed JSON',
        schedule: '{not-json}',
        action: JSON.stringify({ kind: 'data_task', taskId: 'task-1' }),
      })
    ).toThrow('schedule must be an object or a valid JSON object string');

    expect(() =>
      parseAutomationPrepareInput({
        name: 'Unexpected field',
        schedule: { kind: 'daily', times: ['10:00'], unexpected: true },
        action: { kind: 'data_task', taskId: 'task-1' },
      })
    ).toThrow('schedule: Invalid input');
  });

  it('prepares a saved data task and creates it idempotently', async () => {
    const { service, create, onAutomationsChanged } = createServiceFixture();
    const runAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const prepared = await service.prepare(
      {
        name: 'Hourly sales cleanup',
        schedule: { kind: 'once', runAt },
        action: { kind: 'data_task', taskId: 'task-1' },
      },
      { sessionId: 'session-1', currentUserMessageId: 'message-1' }
    );
    const draftId = (prepared.details as { draftId: string }).draftId;

    const first = await service.create(
      { draftId, confirmed: true },
      { sessionId: 'session-1', currentUserMessageId: 'message-1' }
    );
    const second = await service.create(
      { draftId, confirmed: true },
      { sessionId: 'session-1', currentUserMessageId: 'message-1' }
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(onAutomationsChanged).toHaveBeenCalledTimes(1);
    expect((first.details as { status: string }).status).toBe('created');
    expect((second.details as { status: string }).status).toBe('already_created');
    expect(create.mock.calls[0]?.[0].actionGraph.nodes[0]).toMatchObject({
      type: 'data.task.run',
      config: { taskId: 'task-1', outputMode: 'persisted' },
    });
  });

  it('rejects a data task that does not exist', async () => {
    const { service } = createServiceFixture();
    await expect(
      service.prepare(
        {
          name: 'Missing task',
          schedule: { kind: 'once', runAt: new Date(Date.now() + 60_000).toISOString() },
          action: { kind: 'data_task', taskId: 'missing' },
        },
        { sessionId: 'session-1' }
      )
    ).rejects.toThrow('Data task not found');
  });

  it('rejects a prepared one-time schedule after its run time has passed', async () => {
    let now = Date.now();
    const { service, create } = createServiceFixture({ now: () => now });
    const prepared = await service.prepare(
      {
        name: 'Soon',
        schedule: { kind: 'once', runAt: new Date(now + 60_000).toISOString() },
        action: { kind: 'conversation', prompt: 'Do something.' },
      },
      { sessionId: 'session-1' }
    );
    const draftId = (prepared.details as { draftId: string }).draftId;
    now += 120_000;

    await expect(
      service.create({ draftId, confirmed: true }, { sessionId: 'session-1' })
    ).rejects.toThrow('no longer has a future execution time');
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a general recurring task to conversation.run with unattended defaults', async () => {
    const { service, create } = createServiceFixture();
    const prepared = await service.prepare(
      {
        name: 'Daily joke',
        schedule: { kind: 'daily', times: ['09:00'] },
        action: { kind: 'conversation', prompt: '讲一个不重复的冷笑话。' },
      },
      { sessionId: 'session-1' }
    );
    const draftId = (prepared.details as { draftId: string }).draftId;
    await service.create({ draftId, confirmed: true }, { sessionId: 'session-1' });

    const createInput = create.mock.calls[0]?.[0];
    expect(createInput.actionGraph.nodes[0]).toMatchObject({
      type: 'conversation.run',
      config: {
        prompt: '讲一个不重复的冷笑话。',
        completionMode: 'wait',
        permissionPolicy: 'auto_review',
      },
    });
  });
});

describe('saved data task automation action', () => {
  it('emits the workflow output table id instead of the task id', async () => {
    const emitArtifact = vi.fn();
    const registry = createDefaultAutomationActionRegistry({
      dataTaskStore: {
        runTask: vi.fn(async () => ({
          id: 'task-1',
          name: 'Clean sales',
          rowCount: 2,
          columnCount: 3,
        })),
        getTaskWorkflow: vi.fn(async () => ({
          nodes: [
            {
              id: 'output',
              type: 'output',
              config: { outputDatasetId: 'output-table-1' },
            },
          ],
          edges: [],
        })),
      } as never,
      sessionManager: {} as never,
    });

    await registry.get('data.task.run')?.execute(
      { taskId: 'task-1', outputMode: 'persisted' },
      {
        automationId: 'automation-1',
        runId: 'run-1',
        now: Date.now(),
        outputs: new Map(),
        emitArtifact,
        log: vi.fn(),
      },
      { id: 'node-1', type: 'data.task.run', enabled: true, config: {} }
    );

    expect(emitArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        dataRef: { kind: 'output_table', id: 'output-table-1' },
      })
    );
  });
});

describe('automation schedule compiler', () => {
  it('computes future daily runs in the system timezone', () => {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const now = new Date(2026, 7, 14, 8, 0, 0, 0).getTime();
    const compiled = compileAutomationSchedule(
      { kind: 'daily', times: ['09:00'] },
      { now, systemTimezone, nextRunCount: 3 }
    );
    expect(compiled.nextRuns).toHaveLength(3);
    expect(compiled.nextRuns[0]?.at).toBe(new Date(2026, 7, 14, 9, 0, 0, 0).getTime());
  });

  it('rejects an empty recurring time and a non-system timezone', () => {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    expect(() =>
      compileAutomationSchedule({ kind: 'daily', times: [] }, { systemTimezone })
    ).toThrow('requires at least one execution time');

    const unsupportedTimezone = systemTimezone === 'UTC' ? 'Asia/Shanghai' : 'UTC';
    expect(() =>
      compileAutomationSchedule(
        { kind: 'daily', times: ['09:00'], timezone: unsupportedTimezone },
        { systemTimezone }
      )
    ).toThrow('only schedule in the system timezone');
  });
});
